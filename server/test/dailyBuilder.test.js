/**
 * Verification harness for the daily challenge builder.
 * Run with: node server/test/dailyBuilder.test.js
 */
import assert from 'node:assert/strict';
import { candidateGameIds } from '../services/jarchiveScraper.js';
import {
  orderCategoryMajor,
  buildBoard,
  buildSixer,
  buildDailyChallenge,
  ROW_VALUES,
} from '../services/dailyBuilder.js';

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

/** A round as J-Archive emits it: row-major, six categories wide. */
function mkRound(round, categoryPrefix, { rows = 5, categories = 6 } = {}) {
  const clues = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < categories; c++) {
      clues.push({
        category: `${categoryPrefix}${c}`,
        clue: `${categoryPrefix}${c} clue row ${r}`,
        answer: `${categoryPrefix}${c} answer row ${r}`,
        value: (r + 1) * 200,
        round,
      });
    }
  }
  return clues;
}

const fullGame = () => [...mkRound('jeopardy', 'J'), ...mkRound('double_jeopardy', 'D')];

// =========================================================================
// Ordering
// =========================================================================

test('row-major clues are re-ordered into contiguous columns', () => {
  const round = mkRound('jeopardy', 'J');
  const ordered = orderCategoryMajor(round);

  assert.equal(ordered.length, 30);
  assert.equal(ordered[0].category, 'J0');
  assert.equal(ordered[4].category, 'J0', 'first five are all one category');
  assert.equal(ordered[5].category, 'J1', 'then the next category begins');
  assert.equal(ordered[0].clue, 'J0 clue row 0', 'cheapest clue first');
  assert.equal(ordered[4].clue, 'J0 clue row 4', 'dearest clue last');
});

// =========================================================================
// The Board
// =========================================================================

test('a complete round produces a six by five board', () => {
  const board = buildBoard(mkRound('jeopardy', 'J'));
  assert.equal(board.categories.length, 6);
  assert.equal(board.questions.length, 30);
  assert.deepEqual(board.categories, ['J0', 'J1', 'J2', 'J3', 'J4', 'J5']);
});

test('board questions use the component convention, not the scraper one', () => {
  // This mapping is inverted between the two and silently breaks the modal.
  const board = buildBoard(mkRound('jeopardy', 'J'));
  const first = board.questions[0];

  assert.equal(first.answer, 'J0 clue row 0', 'answer holds the text shown to the player');
  assert.equal(first.question, 'J0 answer row 0', 'question holds the correct response');
  assert.equal(first.revealed, false);
});

test('board row values are normalised to 200 through 1000', () => {
  const board = buildBoard(mkRound('jeopardy', 'J'));
  assert.deepEqual(board.questions.slice(0, 5).map((q) => q.points), ROW_VALUES);
  assert.deepEqual(board.questions.slice(5, 10).map((q) => q.points), ROW_VALUES,
    'every column restarts at 200');
});

test('an incomplete round yields no board at all', () => {
  const short = mkRound('jeopardy', 'J').slice(0, 29);
  assert.equal(buildBoard(short), null, 'better no board than a board with a hole');
  assert.equal(buildBoard([]), null);
  assert.equal(buildBoard(null), null);
});

test('a round with a missing answer yields no board', () => {
  const round = mkRound('jeopardy', 'J');
  round[17].answer = '';
  assert.equal(buildBoard(round), null);
});

// =========================================================================
// The Sixer
// =========================================================================

test('the sixer takes one clue from each of six categories', () => {
  const sixer = buildSixer(mkRound('double_jeopardy', 'D'), 0);
  assert.equal(sixer.questions.length, 6);
  assert.equal(new Set(sixer.questions.map((q) => q.category)).size, 6, 'no category twice');
});

test('the sixer keeps the scraper convention DailyPage reads', () => {
  const sixer = buildSixer(mkRound('double_jeopardy', 'D'), 0);
  const first = sixer.questions[0];
  assert.ok(first.clue, 'clue holds the text shown');
  assert.ok(first.answer, 'answer holds the response');
  assert.ok(Object.prototype.hasOwnProperty.call(first, 'value'));
});

test('the same seed always picks the same six', () => {
  const round = mkRound('double_jeopardy', 'D');
  assert.deepEqual(buildSixer(round, 7), buildSixer(round, 7), 'every player gets one board');
});

test('a different seed picks a different set', () => {
  const round = mkRound('double_jeopardy', 'D');
  assert.notDeepEqual(buildSixer(round, 1), buildSixer(round, 2));
});

test('too few usable clues yields no sixer', () => {
  assert.equal(buildSixer(mkRound('double_jeopardy', 'D').slice(0, 5), 0), null);
  assert.equal(buildSixer([], 0), null);
});

// =========================================================================
// The pair
// =========================================================================

test('a full game produces both formats', () => {
  const out = buildDailyChallenge(fullGame(), { seed: 42, date: '2026-08-29', gameId: 1234 });
  assert.equal(out.board.questions.length, 30);
  assert.equal(out.sixer.questions.length, 6);
  assert.equal(out.date, '2026-08-29');
  assert.equal(out.gameId, 1234);
});

test('the two formats never share a clue or a category', () => {
  const out = buildDailyChallenge(fullGame(), { seed: 3, date: '2026-08-29', gameId: 1 });

  const boardCategories = new Set(out.board.categories);
  for (const q of out.sixer.questions) {
    assert.ok(!boardCategories.has(q.category),
      `sixer category ${q.category} also appears on the board`);
  }

  const boardClues = new Set(out.board.questions.map((q) => q.answer));
  for (const q of out.sixer.questions) {
    assert.ok(!boardClues.has(q.clue), 'a sixer clue also appears on the board');
  }
});

test('a game with no Double Jeopardy round is rejected outright', () => {
  const out = buildDailyChallenge(mkRound('jeopardy', 'J'), { seed: 1, date: 'x', gameId: 1 });
  assert.equal(out, null, 'without a second round the sixer would have to spoil the board');
});

test('a game with an incomplete first round is rejected outright', () => {
  const clues = [...mkRound('jeopardy', 'J').slice(0, 20), ...mkRound('double_jeopardy', 'D')];
  assert.equal(buildDailyChallenge(clues, { seed: 1, date: 'x', gameId: 1 }), null);
});

test('junk input does not throw', () => {
  assert.equal(buildDailyChallenge(null, {}), null);
  assert.doesNotThrow(() => buildDailyChallenge([], {}));
});

// =========================================================================
// Candidate game ids
// =========================================================================

test('a day gets several distinct games to try', () => {
  const ids = candidateGameIds(20260829);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6, 'retrying the same game would be pointless');
});

test('every candidate lands inside the archive range', () => {
  for (const seed of [0, 1, 20260829, 99999999]) {
    for (const id of candidateGameIds(seed)) {
      assert.ok(id >= 1000 && id < 9000, `${id} is outside the range`);
    }
  }
});

test('the same day always tries the same games', () => {
  assert.deepEqual(candidateGameIds(20260829), candidateGameIds(20260829));
});

// --- report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
