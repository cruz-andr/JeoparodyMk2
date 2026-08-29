/**
 * Pure logic behind the daily challenges.
 *
 * Kept free of React, zustand and browser APIs so it can be unit tested
 * directly with node. The store is the only thing that owns state; everything
 * here takes what it needs as arguments and returns a new value.
 */

/** The two daily formats. The Board is the full 6x5; The Sixer is one clue per category. */
export const DAILY_FORMATS = ['board', 'sixer'];

export const BOARD_CATEGORY_COUNT = 6;
export const BOARD_ROW_COUNT = 5;
export const SIXER_CLUE_COUNT = 6;

export const emptyFormatStats = () => ({
  gamesPlayed: 0,
  totalCorrect: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastPlayedDate: null,
  // null, not 0: a board can be scored below zero, so "no score yet" and
  // "scored nothing" are different states and must look different.
  bestScore: null,
  weekBestScore: null,
  weekKey: null,
  // How long the last board took, and the quickest one yet.
  lastTimeMs: null,
  bestTimeMs: null,
});

/** YYYY-MM-DD for a Date, in UTC so every player gets the same board. */
export function toDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * The day before a YYYY-MM-DD string.
 *
 * Derived from the string rather than from `new Date()` so it cannot disagree
 * with it: the previous code took "today" in UTC and "yesterday" in local time,
 * so either side of midnight a player's streak could break for no reason.
 */
export function previousDateString(dateString) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return toDateString(d);
}

/**
 * The Monday on or before a date, as YYYY-MM-DD. Weeks run Monday to Sunday in
 * UTC, matching the boundary the daily board itself turns on.
 */
export function startOfWeek(dateString) {
  const d = new Date(`${dateString}T00:00:00Z`);
  // getUTCDay: 0 is Sunday, so Sunday belongs to the week that began six days back
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return toDateString(d);
}

/**
 * This week's best, or null once the week has rolled over.
 *
 * Read through this rather than off the field directly: a stored value from
 * last week is stale, and showing it would make the reset look broken.
 */
export function currentWeekBest(stats, today) {
  if (!stats || stats.weekKey !== startOfWeek(today)) return null;
  return stats.weekBestScore ?? null;
}

/**
 * The streak after finishing a run: showing up is what counts.
 *
 * The original rule only extended a streak on a PERFECT run. That was written
 * for the six-clue daily, where a clean sheet is achievable. Applied unchanged
 * to the thirty-clue Board it makes the streak unreachable in practice, so the
 * Board's streak would have read zero for every player forever.
 *
 * Finishing the run is now what extends the streak, which is how daily games
 * generally work and is the only rule that behaves sensibly at both lengths.
 */
export function computeStreak(stats, { totalQuestions, today }) {
  // An empty board is not a run, so it neither extends nor breaks anything.
  if (!(totalQuestions > 0)) return stats.currentStreak;

  const playedYesterday = stats.lastPlayedDate === previousDateString(today);
  return playedYesterday ? stats.currentStreak + 1 : 1;
}

/**
 * Stats after finishing a run. Returns the same object if already played today.
 *
 * `score` is optional: The Board is worth dollars, The Sixer is just six clues
 * right or wrong, so only the former carries one.
 */
export function applyCompletion(
  stats,
  { correctCount, totalQuestions, today, score = null, timeMs = null }
) {
  if (stats.lastPlayedDate === today) return stats;

  const currentStreak = computeStreak(stats, { totalQuestions, today });
  const week = startOfWeek(today);
  const scored = typeof score === 'number' && Number.isFinite(score);
  const timed = typeof timeMs === 'number' && Number.isFinite(timeMs) && timeMs > 0;

  // A best that never resets saturates: the board tops out at a fixed maximum,
  // so an all-time high stops being a target within a few weeks. The weekly one
  // stays beatable; the all-time one is kept for the highscores page.
  const weekIsCurrent = stats.weekKey === week;
  const priorWeekBest = weekIsCurrent ? stats.weekBestScore : null;

  return {
    ...stats,
    gamesPlayed: stats.gamesPlayed + 1,
    totalCorrect: stats.totalCorrect + correctCount,
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    lastPlayedDate: today,
    bestScore: scored
      ? Math.max(stats.bestScore ?? -Infinity, score)
      : stats.bestScore ?? null,
    weekBestScore: scored
      ? Math.max(priorWeekBest ?? -Infinity, score)
      : priorWeekBest ?? null,
    weekKey: scored ? week : stats.weekKey ?? null,
    lastTimeMs: timed ? timeMs : stats.lastTimeMs ?? null,
    bestTimeMs: timed
      ? Math.min(stats.bestTimeMs ?? Infinity, timeMs)
      : stats.bestTimeMs ?? null,
  };
}

/**
 * What a board is worth.
 *
 * A pass is not a wrong answer: it uses the clue up but costs nothing, so it
 * has to be told apart from a miss rather than folded in with it.
 */
export function boardScore(answers, values) {
  if (!Array.isArray(answers) || !Array.isArray(values) || values.length === 0) return 0;
  return answers.reduce((total, answer, i) => {
    if (!answer?.revealed || answer.passed) return total;
    const points = values[i % values.length];
    return answer.correct ? total + points : total - points;
  }, 0);
}

/** How a played clue reads on the results grid and in a share. */
export function answerMark(answer) {
  if (!answer?.revealed) return 'unplayed';
  if (answer.passed) return 'passed';
  return answer.correct ? 'correct' : 'wrong';
}

/** mm:ss, or h:mm:ss once a board has taken an hour. */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Elapsed time for a run that can be paused.
 *
 * The board is timed like a crossword, so time spent with the tab shut is not
 * time spent playing: `elapsedMs` banks the finished stretches and `startedAt`
 * marks the one still running.
 */
export function elapsedMs(timing, now = Date.now()) {
  if (!timing) return 0;
  const banked = Number.isFinite(timing.elapsedMs) ? timing.elapsedMs : 0;
  if (!Number.isFinite(timing.startedAt)) return banked;
  return banked + Math.max(0, now - timing.startedAt);
}

/** A fresh, unplayed run for a set of clues. */
export function freshRun(date, questions, categories = null) {
  return {
    date,
    questions,
    categories,
    currentIndex: 0,
    answers: questions.map(() => ({
      correct: null,
      revealed: false,
      passed: false,
      playerAnswer: '',
    })),
    userAnswers: questions.map(() => ''),
    isComplete: false,
    // The board is timed; a new run starts a new clock.
    timing: { elapsedMs: 0, startedAt: null },
  };
}

export const emptyRun = () => freshRun(null, []);

/**
 * Fold a flat 30-clue list into the [category][row] grid GameBoard expects.
 * Clues arrive ordered by category, cheapest first.
 */
export function toBoardGrid(questions, {
  categories = BOARD_CATEGORY_COUNT,
  rows = BOARD_ROW_COUNT,
} = {}) {
  const grid = [];
  for (let c = 0; c < categories; c++) {
    const column = [];
    for (let r = 0; r < rows; r++) {
      const q = questions[c * rows + r];
      if (!q) return null; // an incomplete board is not a board
      column.push(q);
    }
    grid.push(column);
  }
  return grid;
}

/**
 * Lay the board's results out the way the board itself reads: six categories
 * across, five values down. Returns rows of cells, so callers can render them
 * or join them as they need.
 *
 * Answers are stored category-major (all of category 1, then category 2), so
 * emitting them in storage order and wrapping every six produces a grid where
 * no row means anything. Transpose instead.
 */
export function boardGridRows(cells, { categories = BOARD_CATEGORY_COUNT, rows = BOARD_ROW_COUNT } = {}) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < categories; c++) {
      const cell = cells[c * rows + r];
      if (cell === undefined) return null;
      row.push(cell);
    }
    out.push(row);
  }
  return out;
}

/**
 * Pack the player's typed answers into a URL-safe blob so a friend opening a
 * shared link can reveal them after playing.
 *
 * btoa only accepts latin1, and answers can contain anything a keyboard emits,
 * so the JSON is UTF-8 encoded first. Encode and decode must stay a matched
 * pair; that is what the round-trip test guards.
 */
export function encodeAnswers(answers) {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(answers));
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return encodeURIComponent(btoa(binary));
  } catch {
    return null;
  }
}

export function decodeAnswers(code) {
  try {
    const binary = atob(decodeURIComponent(code));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Migrate the single-format persisted state to the two-format shape.
 *
 * The daily that shipped was the six-clue one, so its history becomes The
 * Sixer's and The Board starts clean. Losing a long streak to a refactor would
 * be worse than any bug in it.
 */
export function migrateToTwoFormats(old) {
  if (!old || typeof old !== 'object') return null;

  const stats = old.stats && typeof old.stats === 'object' ? old.stats : {};
  const sixerStats = { ...emptyFormatStats(), ...stats };

  const questions = Array.isArray(old.questions) ? old.questions : [];
  const sixerRun = questions.length
    ? {
        date: old.todayDate ?? null,
        questions,
        currentIndex: old.currentIndex ?? 0,
        answers: Array.isArray(old.answers) && old.answers.length === questions.length
          ? old.answers
          : questions.map(() => ({ correct: null, revealed: false, playerAnswer: '' })),
        userAnswers: Array.isArray(old.userAnswers) && old.userAnswers.length === questions.length
          ? old.userAnswers
          : questions.map(() => ''),
        categories: null,
        isComplete: Boolean(old.isComplete),
      }
    : emptyRun();

  return {
    board: emptyRun(),
    sixer: sixerRun,
    stats: { board: emptyFormatStats(), sixer: sixerStats },
  };
}
