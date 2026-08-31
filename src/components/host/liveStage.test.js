/**
 * What the host should be doing right now.
 * Run with: node src/components/host/liveStage.test.js
 */
import assert from 'node:assert/strict';
import {
  cluesLeft, hostStage, isWindowMode, money, primaryAction, reaction, stageHeading, standings,
} from './liveStage.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

const CLUE = { category: 'RIVERS', points: 600, answer: 'It is long', question: 'What is the Nile?' };

// ------------------------------------------------------------ stages

test('no clue means the board is the thing to look at', () => {
  assert.equal(hostStage({ currentQuestion: null }), 'picking');
  // Even with stale buzzer state left over from the clue before.
  assert.equal(hostStage({ currentQuestion: null, buzzerOpen: true }), 'picking');
});

test('a fresh clue is read out before anything opens', () => {
  assert.equal(hostStage({ currentQuestion: CLUE }), 'reading');
});

test('an open buzzer with nobody on it is waiting', () => {
  assert.equal(hostStage({ currentQuestion: CLUE, buzzerOpen: true }), 'waiting');
});

test('a buzz is something to judge', () => {
  assert.equal(hostStage({ currentQuestion: CLUE, buzzerOpen: true, buzzedPlayerId: 'p1' }), 'judging');
});

test('a buzz is judged even after the buzzer shut', () => {
  // Closing the buzzer must not strand the person who already buzzed.
  assert.equal(hostStage({ currentQuestion: CLUE, buzzerOpen: false, buzzedPlayerId: 'p1' }), 'judging');
});

test('a wager comes before anything else about the clue', () => {
  assert.equal(hostStage({
    currentQuestion: CLUE, isDailyDouble: true, dailyDoublePhase: 'wager', buzzedPlayerId: 'p1',
  }), 'wagering');
});

test('a Daily Double past its wager is an ordinary clue again', () => {
  assert.equal(hostStage({
    currentQuestion: CLUE, isDailyDouble: true, dailyDoublePhase: 'question',
  }), 'reading');
});

// ------------------------------------------------------------ typed and tapped

test('typed answers wait until one arrives', () => {
  const at = (o) => hostStage({ currentQuestion: CLUE, answerMode: 'typed', ...o });
  assert.equal(at({}), 'reading');
  assert.equal(at({ answerWindowOpen: true }), 'waiting');
  assert.equal(at({ answerWindowOpen: true, answers: [{ playerId: 'p1', answer: 'Nile' }] }), 'judging');
});

test('a host who has judged every answer is no longer judging', () => {
  // Otherwise the rail keeps asking "was that right?" about nobody.
  assert.equal(hostStage({
    currentQuestion: CLUE, answerMode: 'typed', answerWindowOpen: true,
    answers: [{ playerId: 'p1' }, { playerId: 'p2' }],
    judgedPlayerIds: ['p1', 'p2'],
  }), 'waiting');
});

test('one judged of two still leaves one to judge', () => {
  assert.equal(hostStage({
    currentQuestion: CLUE, answerMode: 'typed', answerWindowOpen: true,
    answers: [{ playerId: 'p1' }, { playerId: 'p2' }],
    judgedPlayerIds: ['p1'],
  }), 'judging');
});

test('multiple choice and auto grade behave like typed', () => {
  for (const answerMode of ['multiple_choice', 'auto_grade']) {
    assert.equal(hostStage({ currentQuestion: CLUE, answerMode, answerWindowOpen: true }), 'waiting',
      answerMode);
  }
});

test('a buzz in a typed round is not a verdict', () => {
  // Nobody buzzes in these modes, so a stale winner id must not hijack the rail.
  assert.equal(hostStage({
    currentQuestion: CLUE, answerMode: 'typed', answerWindowOpen: true, buzzedPlayerId: 'p1',
  }), 'waiting');
});

test('which modes have an answer window', () => {
  assert.equal(isWindowMode('verbal'), false);
  assert.equal(isWindowMode('typed'), true);
  assert.equal(isWindowMode('multiple_choice'), true);
  assert.equal(isWindowMode('auto_grade'), true);
});

// ------------------------------------------------------------ what it says

test('every stage names the moment, not the screen', () => {
  assert.equal(stageHeading('picking'), 'Pick a clue');
  assert.equal(stageHeading('reading'), 'Read the clue out');
  assert.equal(stageHeading('judging'), 'Was that right?');
  assert.equal(stageHeading('wagering'), 'Waiting for the wager');
});

test('waiting says what it is waiting for', () => {
  assert.equal(stageHeading('waiting', 'verbal'), 'Waiting for a buzz');
  assert.equal(stageHeading('waiting', 'typed'), 'Waiting for answers');
});

// ------------------------------------------------------------ the one button

test('reading offers to open, waiting offers to close', () => {
  assert.equal(primaryAction('reading', 'verbal').label, 'Open the buzzer now');
  assert.equal(primaryAction('waiting', 'verbal').label, 'Close the buzzer');
  assert.equal(primaryAction('reading', 'typed').label, 'Open answers now');
  assert.equal(primaryAction('waiting', 'typed').label, 'Close answers');
});

test('opening early says "now", because it opens by itself anyway', () => {
  /* The server opens the buzzer a few seconds after the clue goes up. A button
     labelled "Open the buzzer" would take credit for something that was going
     to happen without it. */
  for (const mode of ['verbal', 'typed']) {
    assert.match(primaryAction('reading', mode).label, /now$/, mode);
  }
});

test('the button carries the event it sends', () => {
  assert.equal(primaryAction('reading', 'verbal').event, 'host:open-buzzer');
  assert.equal(primaryAction('reading', 'typed').event, 'host:open-answer-window');
});

test('stages whose next move is not a button get none', () => {
  // Picking is done on the board, judging names a person, a wager is somebody
  // else's to enter. A button here would be one that does nothing.
  assert.equal(primaryAction('picking'), null);
  assert.equal(primaryAction('judging'), null);
  assert.equal(primaryAction('wagering'), null);
});

// ------------------------------------------------------------ scores

test('the host is not in the standings', () => {
  const rows = standings([{ id: 'h', isHost: true, score: 0 }, { id: 'a', displayName: 'Ada', score: 5 }]);
  assert.deepEqual(rows.map((r) => r.id), ['a']);
});

test('biggest score first', () => {
  const rows = standings([
    { id: 'a', displayName: 'Ada', score: 200 },
    { id: 'b', displayName: 'Bo', score: 1200 },
    { id: 'c', displayName: 'Cy', score: -400 },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c']);
});

test('a tie is broken by name, so the list does not jitter', () => {
  // Two players on nothing is the first minute of every game, and a list that
  // reorders itself between renders is unreadable.
  const rows = standings([
    { id: 'z', displayName: 'Zoe', score: 0 },
    { id: 'a', displayName: 'Ada', score: 0 },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'z']);
});

test('a missing score is nothing, not a crash', () => {
  assert.deepEqual(standings([{ id: 'a', displayName: 'Ada' }])[0].score, 0);
});

test('money never reads $-200', () => {
  assert.equal(money(1200), '$1,200');
  assert.equal(money(-200), '-$200');
  assert.equal(money(0), '$0');
  assert.equal(money(undefined), '$0');
});

test('reaction times are readable at both ends', () => {
  assert.equal(reaction(420), '420ms');
  assert.equal(reaction(1240), '1.24s');
  assert.equal(reaction(undefined), '');
});

test('clues left counts what is not yet revealed', () => {
  const grid = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => ({})));
  assert.equal(cluesLeft(grid, new Set()), 30);
  assert.equal(cluesLeft(grid, new Set(['0-0', '1-1'])), 28);
  assert.equal(cluesLeft([], new Set()), 0);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
