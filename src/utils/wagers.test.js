/**
 * Wager rules for the single-player screens.
 * Run with: node src/utils/wagers.test.js
 */
import assert from 'node:assert/strict';
import {
  canPlayFinalJeopardy, finalWagerLimit, clampFinalWager,
  dailyDoubleLimit, clampDailyDoubleWager, wagerEntry,
} from './wagers.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (err) { failures.push({ name, err }); }
}

/* Final Jeopardy was offered at $0, and with nothing to wager the modal made
   up a $1,000 limit. On the show you need more than $0 to play. */
test('Final Jeopardy needs a score above $0', () => {
  assert.equal(canPlayFinalJeopardy(1), true);
  assert.equal(canPlayFinalJeopardy(0), false);
  assert.equal(canPlayFinalJeopardy(-400), false);
});

test('a Final Jeopardy wager runs from $0 to the score', () => {
  assert.equal(finalWagerLimit(2400), 2400);
  assert.equal(clampFinalWager(0, 2400), 0, '$0 is a real wager');
  assert.equal(clampFinalWager(99999, 2400), 2400);
  assert.equal(clampFinalWager(-50, 2400), 0);
  assert.equal(clampFinalWager(612.9, 2400), 612);
  assert.equal(clampFinalWager(undefined, 2400), 0);
});

test('a Daily Double wager runs from $5 to the score or the round\'s top value', () => {
  assert.equal(dailyDoubleLimit(0, 1), 1000);
  assert.equal(dailyDoubleLimit(0, 2), 2000);
  assert.equal(dailyDoubleLimit(4600, 2), 4600);
  assert.equal(clampDailyDoubleWager(1, 1000), 5);
  assert.equal(clampDailyDoubleWager(300, 1000), 300);
  assert.equal(clampDailyDoubleWager(5000, 1000), 1000);
});

/* The Daily Double box clamped every keystroke to $5..max, so the first digit
   of "300" became 5 and the box ended up at 500. What is typed stays as typed
   until the wager is locked in. */
test('a wager being typed is kept as typed, digits only', () => {
  assert.equal(wagerEntry('3'), '3');
  assert.equal(wagerEntry('30'), '30');
  assert.equal(wagerEntry('300'), '300');
  assert.equal(wagerEntry(''), '');
  assert.equal(wagerEntry('1,200'), '1200');
  assert.equal(wagerEntry('-5'), '5');
});

// --- report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
