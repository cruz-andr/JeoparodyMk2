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
 * The streak after finishing a run.
 *
 * Deliberately unchanged from the original rule, which is stricter than most
 * daily games: only a perfect run extends a streak. A run with at least one
 * right answer holds it, and a run with none breaks it.
 */
export function computeStreak(stats, { correctCount, totalQuestions, today }) {
  const perfect = totalQuestions > 0 && correctCount === totalQuestions;
  const playedYesterday = stats.lastPlayedDate === previousDateString(today);

  if (playedYesterday) {
    if (perfect) return stats.currentStreak + 1;
    return correctCount > 0 ? stats.currentStreak : 0;
  }
  return perfect ? 1 : 0;
}

/** Stats after finishing a run. Returns the same object if already played today. */
export function applyCompletion(stats, { correctCount, totalQuestions, today }) {
  if (stats.lastPlayedDate === today) return stats;

  const currentStreak = computeStreak(stats, { correctCount, totalQuestions, today });

  return {
    gamesPlayed: stats.gamesPlayed + 1,
    totalCorrect: stats.totalCorrect + correctCount,
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    lastPlayedDate: today,
  };
}

/** A fresh, unplayed run for a set of clues. */
export function freshRun(date, questions, categories = null) {
  return {
    date,
    questions,
    categories,
    currentIndex: 0,
    answers: questions.map(() => ({ correct: null, revealed: false, playerAnswer: '' })),
    userAnswers: questions.map(() => ''),
    isComplete: false,
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
