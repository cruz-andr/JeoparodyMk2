/**
 * The quickplay wait, as the client sees it.
 * Run with: node src/hooks/matchmakingWait.test.js
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_TIMINGS, NO_MATCH_FALLBACK, initialWait, needsJoin, waitReducer,
} from './matchmakingWait.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

/** Runs a list of actions through the reducer, returning the final state. */
const play = (...actions) => actions.reduce(waitReducer, initialWait);
const request = { type: 'request', displayName: 'Ada', signature: 'sig' };
const joined = { type: 'joined', timings: { pairAfterMs: 20000, giveUpAfterMs: 45000 } };

// ------------------------------------------------------------ joining

test('nothing is wanted and nothing is asked for at rest', () => {
  assert.equal(needsJoin(initialWait), false);
});

test('asking for a match means the server must be asked', () => {
  const s = play(request);
  assert.equal(needsJoin(s), true);
  assert.deepEqual(s.wants, { displayName: 'Ada', signature: 'sig' });
  assert.equal(s.isInQueue, false, 'not in until the server says so');
});

test('the ack puts us in the queue on a fresh clock and stops the asking', () => {
  const s = play(request, joined);
  assert.equal(s.isInQueue, true);
  assert.equal(s.queueTime, 0);
  assert.equal(needsJoin(s), false, 'in the queue, so no second join');
});

test('the clock counts only while the server has us', () => {
  const s = play(request, joined, { type: 'tick' }, { type: 'tick' });
  assert.equal(s.queueTime, 2);
  const idle = waitReducer(initialWait, { type: 'tick' });
  assert.equal(idle.queueTime, 0, 'a stray tick off the queue counts nothing');
  assert.equal(idle, initialWait, 'and changes nothing');
});

test('the server thresholds replace the defaults; a bad ack keeps them', () => {
  const s = play(request, { type: 'joined', timings: { pairAfterMs: 1000, giveUpAfterMs: 2000 } });
  assert.deepEqual(s.timings, { pairAfterMs: 1000, giveUpAfterMs: 2000 });
  const bad = play(request, { type: 'joined', timings: { pairAfterMs: 0 } });
  assert.deepEqual(bad.timings, DEFAULT_TIMINGS);
  const none = play(request, { type: 'joined' });
  assert.deepEqual(none.timings, DEFAULT_TIMINGS);
});

// ------------------------------------------------------------ the reconnect hole

test('a dropped connection leaves the queue but keeps the wish', () => {
  const s = play(request, joined, { type: 'tick' }, { type: 'dropped' });
  assert.equal(s.isInQueue, false, 'the server has already forgotten us');
  assert.equal(s.queueTime, 0, 'no frozen clock');
  assert.deepEqual(s.wants, { displayName: 'Ada', signature: 'sig' });
  assert.equal(needsJoin(s), true, 'so the reconnect asks again');
});

test('the ack after a reconnect restarts the wait as before', () => {
  const s = play(request, joined, { type: 'tick' }, { type: 'tick' }, { type: 'dropped' }, joined);
  assert.equal(s.isInQueue, true);
  assert.equal(s.queueTime, 0, 'the server clock restarted, so ours does');
  assert.equal(needsJoin(s), false);
});

test('a drop while not queued is a no-op', () => {
  assert.equal(waitReducer(initialWait, { type: 'dropped' }), initialWait);
  const wanting = play(request);
  assert.equal(waitReducer(wanting, { type: 'dropped' }), wanting, 'still waiting for the first ack');
});

test('cancelling while offline means the reconnect does not re-queue', () => {
  const s = play(request, joined, { type: 'dropped' }, { type: 'cancel' });
  assert.equal(s.wants, null);
  assert.equal(needsJoin(s), false);
});

// ------------------------------------------------------------ leaving

test('the server confirming a leave ends the wish and the clock', () => {
  const s = play(request, joined, { type: 'tick' }, { type: 'cancel' }, { type: 'left' });
  assert.equal(s.isInQueue, false);
  assert.equal(s.wants, null);
  assert.equal(s.queueTime, 0);
});

test('a match ends the wait and is remembered', () => {
  const match = { roomCode: 'ABCD', players: [] };
  const s = play(request, joined, { type: 'match', match });
  assert.equal(s.isInQueue, false);
  assert.equal(s.wants, null, 'a reconnect on the way to the game must not re-queue');
  assert.equal(s.matchFound, match);
});

test('no-match ends the wait, carries the message, and falls back to a plain one', () => {
  const s = play(request, joined, { type: 'no-match', message: 'Nobody here.' });
  assert.equal(s.isInQueue, false);
  assert.equal(s.wants, null);
  assert.deepEqual(s.noMatch, { message: 'Nobody here.' });
  const bare = play(request, joined, { type: 'no-match' });
  assert.equal(bare.noMatch.message, NO_MATCH_FALLBACK);
});

test('trying again clears the no-match and the old match', () => {
  const s = play(request, joined, { type: 'no-match' }, request);
  assert.equal(s.noMatch, null);
  assert.equal(s.matchFound, null);
  assert.equal(needsJoin(s), true);
});

test('an unknown action changes nothing', () => {
  const s = play(request, joined);
  assert.equal(waitReducer(s, { type: 'weather' }), s);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
