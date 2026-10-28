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

test('a Sixer shares what it won, with the hint shown as its own square', () => {
  const store = useDailyStore.getState();
  store.setDailyChallenge('sixer', {
    date: '2000-01-02',
    questions: [400, 400, 800, 800, 1200, 1200].map((value, i) => ({ value, clue: `c${i}`, answer: `a${i}` })),
  });
  const s = useDailyStore.getState();
  s.revealAnswer('sixer', 0, true, 'a0');
  s.revealAnswer('sixer', 1, true, 'a1', true);
  s.revealAnswer('sixer', 2, false, 'x', true);
  s.passQuestion('sixer', 3);
  s.revealAnswer('sixer', 4, true, 'a4');
  s.revealAnswer('sixer', 5, true, 'a5', true);
  // Title, squares, tally, link.
  const [, grid, tally] = useDailyStore.getState().getShareText('sixer').split('\n');
  assert.equal(grid, '\u{1F7E9}\u{1F7E8}\u{1F7E5}\u{2B1C}\u{1F7E9}\u{1F7E8}');
  assert.equal(tally, '$2,400 · 4/6');
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
