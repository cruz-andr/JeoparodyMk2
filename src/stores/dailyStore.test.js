/**
 * The daily store's bookkeeping when a run ends.
 * Run with: node src/stores/dailyStore.test.js
 */
import assert from 'node:assert/strict';
import { useDailyStore } from './dailyStore.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push({ name, err }); }
}

const clues = (n) => Array.from({ length: n }, (_, i) => ({ answer: `clue ${i}`, question: `What is ${i}?` }));

/* Started before midnight and finished after: the run belongs to the day it
   was dealt for. Credited to the day it ended, it locked the player out of
   that day's puzzle and broke the streak the next day. */
test('a daily finished after midnight is recorded against the day it was dealt for', () => {
  const store = useDailyStore.getState();
  store.setDailyChallenge('sixer', { date: '2000-01-01', questions: clues(6) });
  useDailyStore.getState().completeGame('sixer');
  assert.equal(useDailyStore.getState().stats.sixer.lastPlayedDate, '2000-01-01');
  assert.equal(useDailyStore.getState().hasPlayedToday('sixer'), false, "today's puzzle is still open");
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
