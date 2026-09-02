/**
 * Tidying what the model sends back.
 * Run with: node server/test/tidyBoard.test.js
 *
 * None of this asks a model anything, so the suite costs nothing to run.
 */
import assert from 'node:assert/strict';
import { hedged, singleResponse, tidyBoard } from '../services/gemini.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

// ------------------------------------------------------- one answer, not two

test('a parenthesised alternative is dropped', () => {
  // The real one, from a board about a university: the model hedged because it
  // was not sure, and a host would have had to decide mid game.
  assert.equal(
    singleResponse('What is the PEAK Experience Award (or the President Co-op Support Fund)?'),
    'What is the PEAK Experience Award?'
  );
});

test('"also known as" is dropped', () => {
  assert.equal(singleResponse('What is Mount Cook, also known as Aoraki?'), 'What is Mount Cook?');
});

test('an aka is dropped, however it is spelled', () => {
  assert.equal(singleResponse('Who is Samuel Clemens (a.k.a. Mark Twain)?'), 'Who is Samuel Clemens?');
  assert.equal(singleResponse('Who is Samuel Clemens, aka Mark Twain?'), 'Who is Samuel Clemens?');
});

test('a slashed pair keeps the first', () => {
  assert.equal(singleResponse('What is Myanmar / Burma?'), 'What is Myanmar?');
});

test('the question mark survives', () => {
  assert.match(singleResponse('What is Mount Cook, also known as Aoraki'), /\?$/);
});

// --------------------------------------------------------- and left alone

test('an answer that is genuinely a pair is not cut in half', () => {
  // "Bonnie and Clyde" is one answer. Only or, aka and a slash mean two.
  assert.equal(singleResponse('Who is Bonnie and Clyde?'), 'Who is Bonnie and Clyde?');
});

test('a one word answer is untouched', () => {
  assert.equal(singleResponse('What is six?'), 'What is six?');
  assert.equal(singleResponse('What is Switzerland?'), 'What is Switzerland?');
});

test('a response that is not a question is left as it is', () => {
  // Nothing to split safely, and mangling it would be worse than leaving it.
  assert.equal(singleResponse('Mount Cook or Aoraki'), 'Mount Cook or Aoraki');
});

test('nothing in, nothing out', () => {
  assert.equal(singleResponse(''), '');
  assert.equal(singleResponse(null), '');
  assert.equal(singleResponse(undefined), '');
});

test('an answer that is nothing but the alternative is kept whole', () => {
  /* Cutting here would leave "What is ?", which is worse than a response the
     host has to read twice. */
  assert.match(singleResponse('What is or?'), /or/);
});

// ------------------------------------------------------------ a whole board

const board = () => ({
  categories: [
    { name: 'PEAKS', questions: [
      { points: 200, answer: 'Highest in Africa', question: 'What is Kilimanjaro?' },
      { points: 400, answer: 'Highest in NZ', question: 'What is Mount Cook (or Aoraki)?' },
    ] },
  ],
});

test('a board comes back with its responses tidied', () => {
  const out = tidyBoard(board());
  assert.equal(out.categories[0].questions[1].question, 'What is Mount Cook?');
});

test('and everything else about it untouched', () => {
  const out = tidyBoard(board());
  assert.equal(out.categories[0].name, 'PEAKS');
  assert.equal(out.categories[0].questions[0].answer, 'Highest in Africa');
  assert.equal(out.categories[0].questions[1].points, 400);
});

test('tidying does not reach into the board it was given', () => {
  const original = board();
  tidyBoard(original);
  assert.equal(original.categories[0].questions[1].question, 'What is Mount Cook (or Aoraki)?');
});

test('a shape that is not a board is handed straight back', () => {
  assert.equal(tidyBoard(null), null);
  assert.deepEqual(tidyBoard({}), {});
});

// ------------------------------------------------------------ what is left

test('anything still carrying two answers is listed, not hidden', () => {
  /* The tidy cannot catch everything, so what it misses is reported rather
     than left for a host to meet mid game. */
  const left = hedged({ categories: [{ name: 'PEAKS', questions: [
    { points: 200, question: 'What is Kilimanjaro?' },
    { points: 400, question: 'What is Everest or Chomolungma?' },
  ] }] });
  assert.equal(left.length, 1);
  assert.equal(left[0].points, 400);
  assert.equal(left[0].category, 'PEAKS');
});

test('a clean board reports nothing', () => {
  assert.deepEqual(hedged(tidyBoard(board())), []);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
