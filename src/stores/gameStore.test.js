/**
 * The single-player game store.
 * Run with: node src/stores/gameStore.test.js
 *
 * No framework, so it runs anywhere with zero install.
 */
import assert from 'node:assert/strict';
import { useGameStore } from './gameStore.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    useGameStore.getState().resetGame();
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

/** A board with every clue revealed but the last, which is open. */
function lastClueOpen(round) {
  const questions = Array.from({ length: 6 }, (_, c) =>
    Array.from({ length: 5 }, (_, r) => ({ category: `C${c}`, points: (r + 1) * 200 * round, revealed: true })));
  useGameStore.setState({ questions, currentRound: round, phase: 'questionActive', currentQuestion: questions[5][4] });
}

/* Clearing Double Jeopardy's board went straight to 'finished'. The round-end
   screen is where Final Jeopardy is offered and where the game is saved, so a
   single-player game with Double Jeopardy on never reached Final Jeopardy and
   never recorded its stats, high score or history. */
test('clearing Double Jeopardy leads to the round-end screen, not past it', () => {
  lastClueOpen(2);
  useGameStore.getState().closeQuestion();
  assert.equal(useGameStore.getState().phase, 'roundEnd');
});

test('clearing round one leads to the round-end screen as before', () => {
  lastClueOpen(1);
  useGameStore.getState().closeQuestion();
  assert.equal(useGameStore.getState().phase, 'roundEnd');
});

test('a clue that leaves others on the board goes back to the board', () => {
  lastClueOpen(2);
  useGameStore.getState().questions[0][0].revealed = false;
  useGameStore.getState().closeQuestion();
  assert.equal(useGameStore.getState().phase, 'playing');
});

// --- report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
