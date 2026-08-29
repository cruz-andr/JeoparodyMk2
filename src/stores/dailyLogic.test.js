/**
 * Verification harness for the daily challenge logic.
 * Run with: node src/stores/dailyLogic.test.js
 *
 * No framework, so it runs anywhere with zero install.
 */
import assert from 'node:assert/strict';
import {
  toDateString,
  previousDateString,
  computeStreak,
  applyCompletion,
  freshRun,
  toBoardGrid,
  migrateToTwoFormats,
  emptyFormatStats,
} from './dailyLogic.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

const stats = (over = {}) => ({ ...emptyFormatStats(), ...over });

// =========================================================================
// Dates
// =========================================================================

test('a date string is the UTC calendar day', () => {
  assert.equal(toDateString(new Date('2026-08-29T23:30:00Z')), '2026-08-29');
});

test('the previous day is derived from the string, not the clock', () => {
  assert.equal(previousDateString('2026-08-29'), '2026-08-28');
});

test('the previous day crosses a month boundary', () => {
  assert.equal(previousDateString('2026-09-01'), '2026-08-31');
});

test('the previous day crosses a year boundary', () => {
  assert.equal(previousDateString('2026-01-01'), '2025-12-31');
});

test('the previous day handles a leap day', () => {
  assert.equal(previousDateString('2028-03-01'), '2028-02-29');
});

// =========================================================================
// Streaks — the original rule, preserved
// =========================================================================

test('a perfect run the day after playing extends the streak', () => {
  const s = stats({ currentStreak: 4, lastPlayedDate: '2026-08-28' });
  assert.equal(computeStreak(s, { correctCount: 6, totalQuestions: 6, today: '2026-08-29' }), 5);
});

test('an imperfect run with some right answers holds the streak', () => {
  const s = stats({ currentStreak: 4, lastPlayedDate: '2026-08-28' });
  assert.equal(computeStreak(s, { correctCount: 3, totalQuestions: 6, today: '2026-08-29' }), 4);
});

test('a run with nothing right breaks the streak', () => {
  const s = stats({ currentStreak: 4, lastPlayedDate: '2026-08-28' });
  assert.equal(computeStreak(s, { correctCount: 0, totalQuestions: 6, today: '2026-08-29' }), 0);
});

test('missing a day resets to 1 on a perfect run', () => {
  const s = stats({ currentStreak: 9, lastPlayedDate: '2026-08-20' });
  assert.equal(computeStreak(s, { correctCount: 6, totalQuestions: 6, today: '2026-08-29' }), 1);
});

test('missing a day resets to 0 on an imperfect run', () => {
  const s = stats({ currentStreak: 9, lastPlayedDate: '2026-08-20' });
  assert.equal(computeStreak(s, { correctCount: 5, totalQuestions: 6, today: '2026-08-29' }), 0);
});

test('a first-ever perfect run starts the streak at 1', () => {
  assert.equal(computeStreak(stats(), { correctCount: 6, totalQuestions: 6, today: '2026-08-29' }), 1);
});

test('an empty board is never counted as perfect', () => {
  assert.equal(computeStreak(stats(), { correctCount: 0, totalQuestions: 0, today: '2026-08-29' }), 0);
});

// =========================================================================
// Completion
// =========================================================================

test('completing a run records the day, the score and the streak', () => {
  const s = stats({ gamesPlayed: 3, totalCorrect: 11, currentStreak: 2, maxStreak: 5, lastPlayedDate: '2026-08-28' });
  const next = applyCompletion(s, { correctCount: 6, totalQuestions: 6, today: '2026-08-29' });

  assert.equal(next.gamesPlayed, 4);
  assert.equal(next.totalCorrect, 17);
  assert.equal(next.currentStreak, 3);
  assert.equal(next.lastPlayedDate, '2026-08-29');
});

test('max streak only ever rises', () => {
  const s = stats({ currentStreak: 1, maxStreak: 9, lastPlayedDate: '2026-08-28' });
  assert.equal(applyCompletion(s, { correctCount: 6, totalQuestions: 6, today: '2026-08-29' }).maxStreak, 9);
});

test('max streak follows a new record', () => {
  const s = stats({ currentStreak: 9, maxStreak: 9, lastPlayedDate: '2026-08-28' });
  assert.equal(applyCompletion(s, { correctCount: 6, totalQuestions: 6, today: '2026-08-29' }).maxStreak, 10);
});

test('completing twice in one day changes nothing', () => {
  const s = stats({ gamesPlayed: 4, currentStreak: 3, lastPlayedDate: '2026-08-29' });
  const next = applyCompletion(s, { correctCount: 6, totalQuestions: 6, today: '2026-08-29' });
  assert.deepEqual(next, s, 'a double submit must not double count or reset the streak');
});

// =========================================================================
// Runs
// =========================================================================

test('a fresh run carries its categories through', () => {
  const run = freshRun('2026-08-29', [{ clue: 'a' }], ['CAT A']);
  assert.deepEqual(run.categories, ['CAT A']);
  assert.equal(freshRun('2026-08-29', []).categories, null, 'the sixer has none');
});

test('a fresh run is blank and sized to its clues', () => {
  const run = freshRun('2026-08-29', [{ clue: 'a' }, { clue: 'b' }]);
  assert.equal(run.currentIndex, 0);
  assert.equal(run.isComplete, false);
  assert.equal(run.answers.length, 2);
  assert.equal(run.userAnswers.length, 2);
  assert.deepEqual(run.answers[0], { correct: null, revealed: false, playerAnswer: '' });
});

// =========================================================================
// Board grid
// =========================================================================

test('thirty clues fold into a 6 by 5 grid, cheapest first', () => {
  const questions = Array.from({ length: 30 }, (_, i) => ({ id: i }));
  const grid = toBoardGrid(questions);

  assert.equal(grid.length, 6);
  assert.equal(grid[0].length, 5);
  assert.equal(grid[0][0].id, 0, 'first category, first row');
  assert.equal(grid[0][4].id, 4, 'first category, last row');
  assert.equal(grid[1][0].id, 5, 'second category starts after the first');
  assert.equal(grid[5][4].id, 29);
});

test('a short board is refused rather than half built', () => {
  assert.equal(toBoardGrid(Array.from({ length: 29 }, (_, i) => ({ id: i }))), null);
  assert.equal(toBoardGrid([]), null);
});

// =========================================================================
// Migration off the single-format shape
// =========================================================================

test('an existing streak survives the move to two formats', () => {
  const old = {
    todayDate: '2026-08-29',
    questions: [{ clue: 'a' }, { clue: 'b' }],
    currentIndex: 1,
    answers: [{ correct: true, revealed: true, playerAnswer: 'x' }, { correct: null, revealed: false, playerAnswer: '' }],
    userAnswers: ['x', ''],
    isComplete: false,
    stats: { gamesPlayed: 12, totalCorrect: 50, currentStreak: 7, maxStreak: 9, lastPlayedDate: '2026-08-29' },
  };

  const next = migrateToTwoFormats(old);
  assert.equal(next.stats.sixer.currentStreak, 7, 'the old daily was the Sixer');
  assert.equal(next.stats.sixer.maxStreak, 9);
  assert.equal(next.stats.sixer.gamesPlayed, 12);
  assert.equal(next.stats.board.currentStreak, 0, 'the Board is new, so it starts clean');
  assert.equal(next.sixer.questions.length, 2, 'a run in progress is preserved');
  assert.equal(next.sixer.currentIndex, 1);
  assert.equal(next.board.questions.length, 0);
});

test('migrating a player who never played yields empty state', () => {
  const next = migrateToTwoFormats({ stats: emptyFormatStats(), questions: [] });
  assert.equal(next.sixer.questions.length, 0);
  assert.equal(next.stats.sixer.gamesPlayed, 0);
});

test('migration repairs answer arrays that do not match the clues', () => {
  const next = migrateToTwoFormats({
    questions: [{ clue: 'a' }, { clue: 'b' }, { clue: 'c' }],
    answers: [{ correct: true }],
    userAnswers: [],
    stats: emptyFormatStats(),
  });
  assert.equal(next.sixer.answers.length, 3);
  assert.equal(next.sixer.userAnswers.length, 3);
});

test('migration tolerates junk without throwing', () => {
  assert.equal(migrateToTwoFormats(null), null);
  assert.equal(migrateToTwoFormats('nonsense'), null);
  assert.doesNotThrow(() => migrateToTwoFormats({}));
});

// --- report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
