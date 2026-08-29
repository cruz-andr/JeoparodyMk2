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
  startOfWeek,
  currentWeekBest,
  boardGridRows,
  encodeAnswers,
  decodeAnswers,
  boardScore,
  answerMark,
  formatDuration,
  elapsedMs,
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
// Streaks: finishing the run is what counts
// =========================================================================

test('finishing the day after playing extends the streak', () => {
  const s = stats({ currentStreak: 4, lastPlayedDate: '2026-08-28' });
  assert.equal(computeStreak(s, { totalQuestions: 6, today: '2026-08-29' }), 5);
});

test('a thirty clue board can extend a streak without being perfect', () => {
  // The old rule only counted perfect runs, which nobody achieves on a 30
  // clue board, so the Board's streak would have been stuck at zero forever.
  const s = stats({ currentStreak: 3, lastPlayedDate: '2026-08-28' });
  assert.equal(computeStreak(s, { totalQuestions: 30, today: '2026-08-29' }), 4);
});

test('a rough day still keeps the streak alive', () => {
  const s = stats({ currentStreak: 9, lastPlayedDate: '2026-08-28' });
  assert.equal(computeStreak(s, { totalQuestions: 30, today: '2026-08-29' }), 10,
    'turning up is the habit worth rewarding');
});

test('missing a day restarts the streak at one', () => {
  const s = stats({ currentStreak: 9, lastPlayedDate: '2026-08-20' });
  assert.equal(computeStreak(s, { totalQuestions: 6, today: '2026-08-29' }), 1);
});

test('a first ever run starts the streak at one', () => {
  assert.equal(computeStreak(stats(), { totalQuestions: 6, today: '2026-08-29' }), 1);
});

test('an empty board neither extends nor breaks a streak', () => {
  const s = stats({ currentStreak: 4, lastPlayedDate: '2026-08-28' });
  assert.equal(computeStreak(s, { totalQuestions: 0, today: '2026-08-29' }), 4);
});

// =========================================================================
// Weeks
// =========================================================================

test('a week begins on Monday', () => {
  assert.equal(startOfWeek('2026-08-24'), '2026-08-24', 'Monday is its own start');
  assert.equal(startOfWeek('2026-08-26'), '2026-08-24', 'Wednesday looks back');
});

test('Sunday belongs to the week that began six days earlier', () => {
  assert.equal(startOfWeek('2026-08-30'), '2026-08-24',
    'the usual off-by-one: Sunday is day 0, but it ends the week');
  assert.equal(startOfWeek('2026-08-31'), '2026-08-31', 'the next Monday starts a new one');
});

test('a week can span a year boundary', () => {
  assert.equal(startOfWeek('2026-01-01'), '2025-12-29');
});

test('last week\'s best does not leak into this week', () => {
  const s = stats({ weekBestScore: 9000, weekKey: '2026-08-17' });
  assert.equal(currentWeekBest(s, '2026-08-26'), null, 'the week rolled over');
  assert.equal(currentWeekBest(s, '2026-08-19'), 9000, 'same week, still shown');
});

test('a player with no scores has no weekly best', () => {
  assert.equal(currentWeekBest(stats(), '2026-08-26'), null);
  assert.equal(currentWeekBest(null, '2026-08-26'), null);
});

// =========================================================================
// Best scores
// =========================================================================

test('a first score sets both the weekly and the all-time best', () => {
  const next = applyCompletion(stats(), {
    correctCount: 20, totalQuestions: 30, today: '2026-08-26', score: 7400,
  });
  assert.equal(next.bestScore, 7400);
  assert.equal(next.weekBestScore, 7400);
  assert.equal(next.weekKey, '2026-08-24');
});

test('a better score raises both bests', () => {
  const s = stats({ bestScore: 7400, weekBestScore: 7400, weekKey: '2026-08-24', lastPlayedDate: '2026-08-26' });
  const next = applyCompletion(s, { correctCount: 26, totalQuestions: 30, today: '2026-08-27', score: 11200 });
  assert.equal(next.bestScore, 11200);
  assert.equal(next.weekBestScore, 11200);
});

test('a worse score raises neither', () => {
  const s = stats({ bestScore: 11200, weekBestScore: 11200, weekKey: '2026-08-24', lastPlayedDate: '2026-08-26' });
  const next = applyCompletion(s, { correctCount: 9, totalQuestions: 30, today: '2026-08-27', score: 1800 });
  assert.equal(next.bestScore, 11200);
  assert.equal(next.weekBestScore, 11200);
});

test('a new week resets the weekly best but never the all-time one', () => {
  const s = stats({ bestScore: 11200, weekBestScore: 11200, weekKey: '2026-08-24', lastPlayedDate: '2026-08-28' });
  const next = applyCompletion(s, { correctCount: 12, totalQuestions: 30, today: '2026-08-31', score: 3000 });

  assert.equal(next.weekKey, '2026-08-31', 'rolled to the new week');
  assert.equal(next.weekBestScore, 3000, 'this week starts fresh, even from a lower score');
  assert.equal(next.bestScore, 11200, 'the trophy survives');
});

test('a negative score is a real score, not an absent one', () => {
  const next = applyCompletion(stats(), {
    correctCount: 2, totalQuestions: 30, today: '2026-08-26', score: -1400,
  });
  assert.equal(next.bestScore, -1400, 'a bad day still beats never having played');
  assert.equal(next.weekBestScore, -1400);
});

test('a scoreless format leaves the best fields alone', () => {
  // The Sixer is six clues right or wrong; it carries no dollar score.
  const next = applyCompletion(stats(), { correctCount: 5, totalQuestions: 6, today: '2026-08-26' });
  assert.equal(next.bestScore, null);
  assert.equal(next.weekBestScore, null);
  assert.equal(next.weekKey, null);
});

// =========================================================================
// Completion
// =========================================================================

test('completing a run records the day, the score and the streak', () => {
  const s = stats({ gamesPlayed: 3, totalCorrect: 11, currentStreak: 2, maxStreak: 5, lastPlayedDate: '2026-08-28' });
  const next = applyCompletion(s, { correctCount: 4, totalQuestions: 6, today: '2026-08-29' });

  assert.equal(next.gamesPlayed, 4);
  assert.equal(next.totalCorrect, 15, 'correct answers still feed the accuracy total');
  assert.equal(next.currentStreak, 3, 'and the streak counts the day, not the score');
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
  assert.deepEqual(run.answers[0], {
    correct: null,
    revealed: false,
    passed: false,
    playerAnswer: '',
  });
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
// Share grid
// =========================================================================

test('the board grid reads six across and five down', () => {
  // cells are stored category-major: c0r0..c0r4, c1r0..c1r4, ...
  const cells = [];
  for (let c = 0; c < 6; c++) for (let r = 0; r < 5; r++) cells.push(`${c}${r}`);

  const rows = boardGridRows(cells);
  assert.equal(rows.length, 5, 'five value tiers');
  assert.equal(rows[0].length, 6, 'six categories across');
  assert.equal(rows[0].join(''), '001020304050', 'the top row is each category\'s cheapest clue');
  assert.equal(rows[4].join(''), '041424344454', 'the bottom row is each category\'s dearest');
});

test('the grid preserves cell types, so booleans survive it', () => {
  const flags = Array.from({ length: 30 }, (_, i) => i % 2 === 0);
  const rows = boardGridRows(flags);
  assert.equal(typeof rows[0][0], 'boolean', 'the results grid renders booleans, not text');
  assert.equal(rows.flat().length, 30);
});

test('a short board yields no grid rather than a scrambled one', () => {
  assert.equal(boardGridRows(['a', 'b']), null);
});

// =========================================================================
// Shared answer payload
// =========================================================================

test('typed answers survive a round trip through a shared link', () => {
  const answers = ['Mars', 'what is gold', '', 'Moby Dick'];
  assert.deepEqual(decodeAnswers(encodeAnswers(answers)), answers);
});

test('the payload handles characters btoa alone would choke on', () => {
  // btoa throws on anything outside latin1, which a keyboard produces easily.
  const answers = ['Beyoncé', '日本', 'naïve café', '\u{1F7E9} emoji'];
  assert.deepEqual(decodeAnswers(encodeAnswers(answers)), answers);
});

test('a corrupt or hostile verify code is refused, not thrown on', () => {
  assert.equal(decodeAnswers('not-base64!!'), null);
  assert.equal(decodeAnswers(''), null);
  assert.equal(decodeAnswers(btoa('{"not":"an array"}')), null);
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

// --- passing a clue -----------------------------------------------------

const VALUES = [200, 400, 600, 800, 1000];
const played = (over) => ({ correct: false, revealed: true, passed: false, playerAnswer: '', ...over });

test('a pass uses the clue up but costs nothing', () => {
  const answers = [played({ passed: true })];
  assert.equal(boardScore(answers, VALUES), 0);
});

test('a pass is not a wrong answer', () => {
  assert.equal(boardScore([played({ passed: true })], VALUES), 0);
  assert.equal(boardScore([played()], VALUES), -200);
});

test('a right answer adds the value of its row', () => {
  assert.equal(boardScore([played({ correct: true })], VALUES), 200);
  assert.equal(boardScore([played(), played({ correct: true })], VALUES), -200 + 400);
});

test('an unplayed clue scores nothing either way', () => {
  assert.equal(boardScore([{ correct: null, revealed: false }], VALUES), 0);
});

test('values repeat down each category', () => {
  const all = Array.from({ length: 30 }, () => played({ correct: true }));
  assert.equal(boardScore(all, VALUES), 18000); // 6 categories x $3,000
});

test('a board of nothing but passes scores zero, not minus everything', () => {
  const all = Array.from({ length: 30 }, () => played({ passed: true }));
  assert.equal(boardScore(all, VALUES), 0);
});

test('answerMark tells the three played states apart', () => {
  assert.equal(answerMark({ revealed: false }), 'unplayed');
  assert.equal(answerMark(played({ passed: true })), 'passed');
  assert.equal(answerMark(played({ correct: true })), 'correct');
  assert.equal(answerMark(played()), 'wrong');
});

test('a fresh run starts with nothing passed', () => {
  const run = freshRun('2026-08-29', [{}, {}]);
  assert.equal(run.answers.every((a) => a.passed === false), true);
});

// --- timing the board ---------------------------------------------------

test('formatDuration reads as a clock', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(9000), '0:09');
  assert.equal(formatDuration(754000), '12:34');
  assert.equal(formatDuration(3661000), '1:01:01');
});

test('formatDuration refuses nonsense rather than printing it', () => {
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(-1), null);
  assert.equal(formatDuration(NaN), null);
});

test('time spent with the tab shut does not count', () => {
  // banked five minutes, then paused
  assert.equal(elapsedMs({ elapsedMs: 300000, startedAt: null }, 9e12), 300000);
});

test('a running stretch is added to what is already banked', () => {
  assert.equal(elapsedMs({ elapsedMs: 300000, startedAt: 1000 }, 4000), 303000);
});

test('a clock that has never started reads zero', () => {
  assert.equal(elapsedMs(undefined), 0);
  assert.equal(elapsedMs({}), 0);
});

test('completion records the time, and keeps the quickest', () => {
  const base = { ...emptyFormatStats(), lastPlayedDate: null };
  const first = applyCompletion(base, {
    correctCount: 10, totalQuestions: 30, today: '2026-08-29', score: 1000, timeMs: 754000,
  });
  assert.equal(first.lastTimeMs, 754000);
  assert.equal(first.bestTimeMs, 754000);

  const quicker = applyCompletion({ ...first, lastPlayedDate: '2026-08-29' }, {
    correctCount: 10, totalQuestions: 30, today: '2026-08-30', score: 1000, timeMs: 600000,
  });
  assert.equal(quicker.bestTimeMs, 600000);

  const slower = applyCompletion({ ...quicker, lastPlayedDate: '2026-08-30' }, {
    correctCount: 10, totalQuestions: 30, today: '2026-08-31', score: 1000, timeMs: 900000,
  });
  assert.equal(slower.lastTimeMs, 900000, 'the latest time is still the last time');
  assert.equal(slower.bestTimeMs, 600000, 'but the best is not overwritten by a slower one');
});

test('an untimed completion leaves the recorded times alone', () => {
  const withTime = { ...emptyFormatStats(), lastTimeMs: 754000, bestTimeMs: 754000 };
  const after = applyCompletion(withTime, {
    correctCount: 6, totalQuestions: 6, today: '2026-08-29',
  });
  assert.equal(after.lastTimeMs, 754000);
  assert.equal(after.bestTimeMs, 754000);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
