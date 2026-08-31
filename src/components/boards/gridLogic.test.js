/**
 * Moving around the board.
 * Run with: node src/components/boards/gridLogic.test.js
 *
 * No framework, so it runs anywhere with zero install.
 */
import assert from 'node:assert/strict';
import {
  CATEGORIES, CLUES, POINTS, ROWS,
  countWritten, finalState, isWritten, moveSelection, nextEmptyFrom,
} from './gridLogic.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

/** A board with the first `written` clues filled, in board order. */
function board({ written = 0, final = null } = {}) {
  let left = written;
  return {
    version: 1,
    categories: Array.from({ length: CATEGORIES }, (_, c) => ({
      name: `CATEGORY ${c + 1}`,
      questions: POINTS.map((points) => {
        const fill = left-- > 0;
        return { points, answer: fill ? 'clue' : '', question: fill ? 'response' : '' };
      }),
    })),
    finalJeopardy: final,
  };
}

const clue = (c, r) => ({ kind: 'clue', c, r });

// ------------------------------------------------------------ written

test('a clue needs both halves', () => {
  assert.equal(isWritten({ answer: 'x', question: 'y' }), true);
  assert.equal(isWritten({ answer: 'x', question: '' }), false);
  assert.equal(isWritten({ answer: '', question: 'y' }), false);
  assert.equal(isWritten(undefined), false);
});

test('whitespace is not a clue', () => {
  assert.equal(isWritten({ answer: '  ', question: '\n' }), false);
});

test('counting agrees with what was filled', () => {
  assert.equal(countWritten(board({ written: 0 })), 0);
  assert.equal(countWritten(board({ written: 17 })), 17);
  assert.equal(countWritten(board({ written: CLUES })), CLUES);
});

// ------------------------------------------------------------ arrows

test('a key that is not an arrow moves nothing', () => {
  assert.equal(moveSelection(clue(0, 0), 'a'), null);
  assert.equal(moveSelection(clue(0, 0), 'Enter'), null);
});

test('down walks a category', () => {
  assert.deepEqual(moveSelection(clue(2, 1), 'ArrowDown'), clue(2, 2));
});

test('up walks back and then reaches the header', () => {
  assert.deepEqual(moveSelection(clue(2, 1), 'ArrowUp'), clue(2, 0));
  assert.deepEqual(moveSelection(clue(2, 0), 'ArrowUp'), { kind: 'category', c: 2 });
});

test('left and right change category and keep the row', () => {
  assert.deepEqual(moveSelection(clue(2, 3), 'ArrowRight'), clue(3, 3));
  assert.deepEqual(moveSelection(clue(2, 3), 'ArrowLeft'), clue(1, 3));
});

test('the board does not wrap at its edges', () => {
  // Wrapping in a grid you are looking at is disorienting: the eye expects
  // the selection to stay put when it cannot go further.
  assert.deepEqual(moveSelection(clue(0, 2), 'ArrowLeft'), clue(0, 2));
  assert.deepEqual(moveSelection(clue(CATEGORIES - 1, 2), 'ArrowRight'), clue(CATEGORIES - 1, 2));
});

test('a header goes down into its own category', () => {
  assert.deepEqual(moveSelection({ kind: 'category', c: 4 }, 'ArrowDown'), clue(4, 0));
});

test('a header cannot go further up', () => {
  assert.deepEqual(moveSelection({ kind: 'category', c: 4 }, 'ArrowUp'), { kind: 'category', c: 4 });
});

test('headers move sideways as headers', () => {
  assert.deepEqual(moveSelection({ kind: 'category', c: 4 }, 'ArrowLeft'), { kind: 'category', c: 3 });
});

// ------------------------------------------------------------ final jeopardy

test('down off the last row reaches Final Jeopardy', () => {
  assert.deepEqual(moveSelection(clue(3, ROWS - 1), 'ArrowDown'), { kind: 'final', c: 3 });
});

test('Final Jeopardy remembers the column you came down from', () => {
  const down = moveSelection(clue(4, ROWS - 1), 'ArrowDown');
  assert.deepEqual(moveSelection(down, 'ArrowUp'), clue(4, ROWS - 1));
});

test('sideways on Final Jeopardy stays put', () => {
  // It is one tile. Moving within it would only change the column you return
  // to, with nothing on screen to show for it.
  assert.deepEqual(moveSelection({ kind: 'final', c: 2 }, 'ArrowLeft'), { kind: 'final', c: 2 });
  assert.deepEqual(moveSelection({ kind: 'final', c: 2 }, 'ArrowDown'), { kind: 'final', c: 2 });
});

test('without a Final Jeopardy tile the last row is the floor', () => {
  assert.deepEqual(
    moveSelection(clue(3, ROWS - 1), 'ArrowDown', { hasFinal: false }),
    clue(3, ROWS - 1)
  );
});

test('Final Jeopardy is none, partial or complete', () => {
  assert.equal(finalState(board()), 'none');
  assert.equal(finalState(board({ final: { category: 'RIVERS' } })), 'partial');
  assert.equal(finalState(board({ final: { category: 'RIVERS', answer: 'a' } })), 'partial');
  assert.equal(
    finalState(board({ final: { category: 'RIVERS', answer: 'a', question: 'q' } })),
    'complete'
  );
});

test('a Final Jeopardy of blank strings counts as none', () => {
  assert.equal(finalState(board({ final: { category: ' ', answer: '', question: '' } })), 'none');
});

// ------------------------------------------------------------ next empty

test('next empty walks down the category before moving across', () => {
  const b = board({ written: 0 });
  assert.deepEqual(nextEmptyFrom(b, clue(0, 0)), clue(0, 1));
  assert.deepEqual(nextEmptyFrom(b, clue(0, ROWS - 1)), clue(1, 0));
});

test('next empty skips the ones already written', () => {
  // First seven written: 0-0..0-4 and 1-0, 1-1. So from 0-0 the next hole is 1-2.
  const b = board({ written: 7 });
  assert.deepEqual(nextEmptyFrom(b, clue(0, 0)), clue(1, 2));
});

test('next empty wraps round the board once', () => {
  const b = board({ written: 0 });
  b.categories[5].questions[4].answer = 'x';
  b.categories[5].questions[4].question = 'y';
  // Standing on the last cell, the only way on is back to the beginning.
  assert.deepEqual(nextEmptyFrom(b, clue(5, 4)), clue(0, 0));
});

test('next empty returns null on a finished board', () => {
  // Which is what disables the button, rather than leaving it to do nothing.
  assert.equal(nextEmptyFrom(board({ written: CLUES }), clue(0, 0)), null);
});

test('next empty works from a header', () => {
  const b = board({ written: 0 });
  assert.deepEqual(nextEmptyFrom(b, { kind: 'category', c: 2 }), clue(2, 0));
});

test('next empty works from Final Jeopardy', () => {
  const b = board({ written: 0 });
  assert.deepEqual(nextEmptyFrom(b, { kind: 'final', c: 3 }), clue(3, 0));
});

test('a doubled board keeps its own values', () => {
  // Double Jeopardy is the same grid at twice the money, so nothing may assume
  // the row values are the round-one ones.
  const doubled = board();
  const DOUBLE = [400, 800, 1200, 1600, 2000];
  doubled.categories.forEach((c) => c.questions.forEach((q, r) => { q.points = DOUBLE[r]; }));

  assert.deepEqual(doubled.categories[0].questions.map((q) => q.points), DOUBLE);
  // The arithmetic does not care about values, and must not start to.
  assert.deepEqual(moveSelection(clue(0, 0), 'ArrowDown'), clue(0, 1));
  assert.equal(countWritten(doubled), 0);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
