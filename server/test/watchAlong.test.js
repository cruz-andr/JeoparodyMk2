/**
 * Watching along: when the video stops, and what a skip costs.
 * Run with: node server/test/watchAlong.test.js
 */
import assert from 'node:assert/strict';
import { reached, scored, stopsFor } from '../shared/watchAlong.js';

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
};

const board = {
  categories: [
    { name: 'MULAN', questions: [{ points: 200, answer: 'a', question: 'What is A?' }, { points: 400, answer: 'b', question: 'What is B?' }] },
    { name: 'BLUEY', questions: [{ points: 200, answer: 'c', question: 'What is C?' }, { points: 400, answer: 'd', question: 'What is D?' }] },
  ],
  finalJeopardy: { category: 'AVATAR', answer: 'e', question: 'What is E?' },
};
const watch = {
  youtube: 'aMS9UidTUUY',
  clues: [
    { column: 1, row: 0, at: 40, pause: 50 },
    { column: 0, row: 0, at: 10, pause: 20 },
    { column: 0, row: 1, at: 70, pause: 80 },
    { column: 1, row: 1, at: 100, pause: 110 },
  ],
  final: { at: 200, pause: 230 },
};
const stops = stopsFor(watch, board);

test('the stops come in the order the video reaches them, Final last', () => {
  assert.deepEqual(stops.map((s) => s.key), ['0:0', '1:0', '0:1', '1:1', 'final']);
  assert.equal(stops[0].category, 'MULAN');
  assert.equal(stops[0].clue.points, 200);
  assert.equal(stops.at(-1).final, true);
});

test('nothing to stop for before the first pause', () => {
  assert.deepEqual(reached(stops, new Set(), 19.9), { ask: null, skipped: [] });
});

test('reaching a pause stops there', () => {
  assert.equal(reached(stops, new Set(), 20.2).ask.key, '0:0');
});

test('a stop already answered is never asked again, going back or not', () => {
  assert.equal(reached(stops, new Set(['0:0']), 20.2).ask, null);
});

test('jumping ahead past stops skips them, and stops at the one it lands on', () => {
  const { ask, skipped } = reached(stops, new Set(), 80.5);
  assert.equal(ask.key, '0:1');
  assert.deepEqual(skipped.map((s) => s.key), ['0:0', '1:0']);
});

test('a right response is worth the clue, a wrong one costs it; Final is the wager', () => {
  assert.equal(scored(stops[1], true), 200);
  assert.equal(scored(stops[2], false), -400);
  assert.equal(scored(stops.at(-1), true, 1500), 1500);
  assert.equal(scored(stops.at(-1), false, 1500), -1500);
});

test('a board without Final, or a clue the board no longer has, is left out', () => {
  const short = stopsFor({ ...watch, clues: [...watch.clues, { column: 5, row: 0, at: 1, pause: 2 }], final: null }, board);
  assert.deepEqual(short.map((s) => s.key), ['0:0', '1:0', '0:1', '1:1']);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
