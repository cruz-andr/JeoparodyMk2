/**
 * The typed-response rule every mode shares.
 * Run with: node src/utils/typedClue.test.js
 */
import assert from 'node:assert/strict';
import { gradeAnswer } from '../../server/shared/answerMatch.js';
import { judgeTyped, CLOSE_NOTE } from './typedClue.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (err) { failures.push({ name, err }); }
}

test('a right response is right', () => {
  assert.deepEqual(judgeTyped(gradeAnswer, 'Beethoven', 'Who is Beethoven?'), { correct: true });
});

test('a wrong one is wrong, with no second go', () => {
  assert.deepEqual(judgeTyped(gradeAnswer, 'Mozart', 'Who is Beethoven?'), { correct: false });
});

test('a close one asks for the spelling again, once', () => {
  assert.deepEqual(judgeTyped(gradeAnswer, 'Beethavan', 'Who is Beethoven?'), { retry: true });
  assert.deepEqual(judgeTyped(gradeAnswer, 'Beethavan', 'Who is Beethoven?', { closeUsed: true }), { correct: false },
    'a second close is wrong');
  assert.deepEqual(judgeTyped(gradeAnswer, 'Beethoven', 'Who is Beethoven?', { closeUsed: true }), { correct: true },
    'and the corrected spelling is right');
});

test('the note says what to do without giving the answer away', () => {
  assert.match(CLOSE_NOTE, /spelling/i);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const { name, err } of failures) console.error(`  FAIL  ${name}\n        ${err.message}`);
  process.exit(1);
}
