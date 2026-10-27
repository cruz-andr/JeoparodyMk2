/**
 * Pure logic behind the daily challenges.
 *
 * Kept free of React, zustand and browser APIs so it can be unit tested
 * directly with node. The store is the only thing that owns state; everything
 * here takes what it needs as arguments and returns a new value.
 */

// The grader's own reading of a response, so a hint shows the form it accepts.
import { acceptedForms } from '../../server/shared/answerMatch.js';

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
 * The streak as it stands today. The stored number only changes when a run
 * is finished, so a streak broken by a missed day went on showing until the
 * next puzzle was played. Read through this rather than off the field.
 */
export function liveStreak(stats, today) {
  if (!stats?.lastPlayedDate) return 0;
  const alive = stats.lastPlayedDate === today || stats.lastPlayedDate === previousDateString(today);
  return alive ? stats.currentStreak || 0 : 0;
}

/**
 * Whether the archive slot already holds this daily's run for this day. The
 * slot is shared by both dailies, so a date alone matched the other one's
 * run: The Board picked up a Sixer, and sat on a spinner for good.
 */
export function isArchiveRunFor(run, { date, format }) {
  return Boolean(run && run.date === date && run.format === format && run.questions?.length > 0);
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
  // Already counted, or a day behind one that was: a streak only moves forward.
  if (stats.lastPlayedDate && today <= stats.lastPlayedDate) return stats;

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
  if (answer.correct) return answer.hinted ? 'hinted' : 'correct';
  return 'wrong';
}

/* ------------------------------------------------------------ the Sixer

   Each clue is worth its row in dollars, as on the show. A miss is not the
   end of it: the hint comes up and there is one more try, for half. Nothing
   is ever taken away. A Sixer that started a new player at -$400 was a
   Sixer they did not come back to. */

/** What one clue paid. */
export function sixerEarned(answer, value) {
  if (!answer?.revealed || answer.passed || !answer.correct) return 0;
  const worth = Number(value) || 0;
  return answer.hinted ? Math.round(worth / 2) : worth;
}

/** What a run won, out of `sixerTop`. */
export function sixerScore(answers, questions) {
  if (!Array.isArray(answers) || !Array.isArray(questions)) return 0;
  return answers.reduce((sum, answer, i) => sum + sixerEarned(answer, questions[i]?.value), 0);
}

/** What the day's six were worth together. */
export function sixerTop(questions) {
  return (questions ?? []).reduce((sum, q) => sum + (Number(q?.value) || 0), 0);
}

const SHOWN_WHOLE = new Set(['a', 'an', 'the', 'of', 'and', '&', 'or', 'in', 'on', 'to']);

/**
 * The shape of the answer: each word's first letter, then a blank per letter.
 * Articles and small joining words are shown whole, and punctuation as it is.
 * A one-word answer of four letters or fewer is blanks only, since its first
 * letter would be most of it. Taken from the main form of the response, not
 * its optional or alternate parts.
 */
export function answerHint(response) {
  let main = acceptedForms(response)[0] ?? '';
  if (main.includes('/')) main = main.split('/')[0];
  main = main.replace(/["“”]/g, '').trim();
  const words = main.split(/\s+/).filter(Boolean);
  const shortOne = words.length === 1 && words[0].replace(/[^\p{L}\p{N}]/gu, '').length <= 4;

  return words.map((word) => {
    if (SHOWN_WHOLE.has(word.toLowerCase())) return word;
    let shown = shortOne;
    return [...word].map((ch) => {
      if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
      if (!shown) { shown = true; return ch.toUpperCase(); }
      return '_';
    }).join(' ');
  }).join('   ');
}

/* Red and green is the one pairing red green colourblindness cannot separate,
   and it affects roughly one man in twelve. It is also the only part of the
   game people share, so the grid has to work for them. Orange and blue is the
   substitution Wordle settled on for the same problem. */
/* Got with the hint is yellow, as a near miss is in every word game. The
   high-contrast set has orange for right already, so it takes purple. */
const MARK_EMOJI = {
  normal: { correct: '\u{1F7E9}', hinted: '\u{1F7E8}', wrong: '\u{1F7E5}', passed: '\u{2B1C}' },
  highContrast: { correct: '\u{1F7E7}', hinted: '\u{1F7EA}', wrong: '\u{1F7E6}', passed: '\u{2B1C}' },
};

/** The square a played clue shows, in the palette the player can read. */
export function markEmoji(mark, highContrast = false) {
  const set = highContrast ? MARK_EMOJI.highContrast : MARK_EMOJI.normal;
  return set[mark] ?? set.wrong;
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
