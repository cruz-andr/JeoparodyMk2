/**
 * When a player goes, for a moment or for good.
 * Run with: node server/test/departures.test.js
 *
 * A room spends most of a game waiting on its players: for a wager, an
 * answer, a Continue, a pass, a pick. These check that a player who drops or
 * leaves in the middle of one of those waits does not leave everybody else
 * waiting on them for ever.
 */
import assert from 'node:assert/strict';
import { GameStateManager } from '../socket/GameStateManager.js';
import { createGameActions, PICKER_GRACE_MS } from '../socket/actions.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push({ name, err }); }
}

// --- a clock we own -------------------------------------------------------

function mkClock() {
  let now = 0;
  let seq = 0;
  const due = new Map();
  const setTimeout = (fn, ms) => { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; };
  function advance(ms) {
    const until = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of due) if (t.at <= until && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      due.delete(next.id);
      now = next.t.at;
      next.t.fn();
    }
    now = until;
  }
  return { setTimeout, advance, now: () => now };
}

const board = () => Array.from({ length: 6 }, (_, c) =>
  Array.from({ length: 5 }, (_, r) => ({
    category: `CAT${c}`, points: (r + 1) * 200, answer: `clue ${c}-${r}`, question: `answer ${c}-${r}`, revealed: false,
  })));
const CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'F'];

/** A room mid-game, p0 holding the pick (or the host, in a hosted room). */
function mkRoom({ count = 3, type = 'multiplayer', settings = {} } = {}) {
  const clock = mkClock();
  const gm = new GameStateManager({ now: clock.now });
  const heard = [];
  const emitRoom = (code, event, payload) => heard.push({ event, payload });
  const actions = createGameActions({ gameManager: gm, emitRoom, archiveRoom: () => {}, setTimeout: clock.setTimeout });

  const sockets = Array.from({ length: count }, (_, i) => ({ id: `sock-${i}`, sessionId: `p${i}` }));
  const host = type === 'host' ? { id: 'sock-host', sessionId: 'host' } : null;
  const room = gm.createRoom(type, host || sockets[0], { enableDailyDouble: false, ...settings });
  if (host) gm.joinRoom(host, room.code, 'Host');
  sockets.forEach((s, i) => gm.joinRoom(s, room.code, `P${i}`));
  if (host) gm.setHostQuestions(room.code, board(), CATEGORIES, 'host');
  gm.setQuestions(room.code, board(), CATEGORIES, host ? 'host' : 'p0');

  const code = room.code;
  const events = (name) => heard.filter((h) => h.event === name);
  /* What the socket layer does when a connection drops, and when a player
     leaves the room on purpose. */
  const drop = (i) => {
    gm.handleDisconnect(sockets[i]);
    actions.playerDropped(code, sockets[i].sessionId);
  };
  const leave = (i) => {
    const left = gm.leaveRoom(sockets[i], code);
    actions.playerLeft(code, sockets[i].sessionId, left ?? {});
  };
  return { clock, gm, actions, room, code, sockets, heard, events, drop, leave, gs: () => room.gameState };
}

const everyoneHas = (t, score) => { for (const p of t.room.players.values()) p.score = score; };

// =========================================================================
// Final Jeopardy
// =========================================================================

test('a Final Jeopardy wager wait ends when the last player still to wager drops', () => {
  const t = mkRoom();
  everyoneHas(t, 1000);
  t.actions.startFinalJeopardy(t.code, null);
  t.actions.fjWager('p0', t.code, 100);
  t.actions.fjWager('p1', t.code, 100);
  assert.equal(t.events('game:fj-show-clue').length, 0, 'still waiting on p2');

  t.drop(2);
  assert.equal(t.events('game:fj-show-clue').length, 1, 'the clue goes up for the two still here');
});

test('a Final Jeopardy answer wait ends when the last player still to answer drops', () => {
  const t = mkRoom();
  everyoneHas(t, 1000);
  t.actions.startFinalJeopardy(t.code, null);
  ['p0', 'p1', 'p2'].forEach((id) => t.actions.fjWager(id, t.code, 100));
  t.actions.fjAnswer('p0', t.code, 'x');
  t.actions.fjAnswer('p1', t.code, 'y');
  assert.equal(t.events('game:fj-reveal').length, 0);

  t.drop(2);
  const [reveal] = t.events('game:fj-reveal');
  assert.ok(reveal, 'the results are revealed');
  assert.equal(reveal.payload.results.length, 3, 'the player who dropped is still scored on their wager');
});

// =========================================================================
// Continue, and passing
// =========================================================================

/** p0 opens a clue and lets the buzzer clock run out. */
function timedOut(t) {
  t.actions.selectQuestion('p0', t.code, 0, 0);
  t.clock.advance(30000);
  assert.equal(t.events('game:buzz-timeout-result').length, 1, 'nobody buzzed');
}

test('the Continue wait ends when the last player still to press it drops', () => {
  const t = mkRoom();
  timedOut(t);
  t.actions.timeoutContinue('p0', t.code);
  t.actions.timeoutContinue('p1', t.code);
  assert.equal(t.events('game:all-continued').length, 0);

  t.drop(2);
  assert.equal(t.events('game:all-continued').length, 1);
  assert.equal(t.gs().currentQuestion, null);
});

test('a Continue sent before any clue has timed out is ignored', () => {
  const t = mkRoom();
  t.actions.selectQuestion('p0', t.code, 0, 0);
  ['p0', 'p1', 'p2'].forEach((id) => t.actions.timeoutContinue(id, t.code));
  assert.equal(t.events('game:all-continued').length, 0);
  assert.ok(t.gs().currentQuestion, 'the live clue is still up');
});

test('a Continue left over from one clue does not close the next', () => {
  const t = mkRoom();
  timedOut(t);
  ['p0', 'p1', 'p2'].forEach((id) => t.actions.timeoutContinue(id, t.code));
  assert.equal(t.events('game:all-continued').length, 1);

  t.actions.selectQuestion('p0', t.code, 0, 1);
  t.actions.timeoutContinue('p1', t.code);
  assert.equal(t.events('game:all-continued').length, 1, 'no second all-continued');
  assert.ok(t.gs().currentQuestion, 'the new clue is still up');
});

test('the pass wait ends when the last player still to pass drops', () => {
  const t = mkRoom();
  t.actions.selectQuestion('p0', t.code, 0, 0);
  t.actions.skipQuestion('p1', t.code);
  t.actions.skipQuestion('p2', t.code);
  assert.equal(t.events('game:buzz-timeout-result').length, 0, 'p0 has not passed');

  t.drop(0);
  assert.equal(t.events('game:buzz-timeout-result').length, 1, 'everyone still here has passed');
});

// =========================================================================
// The pick
// =========================================================================

test('a dropped picker hands the pick on after a grace period, and not before', () => {
  const t = mkRoom();
  t.drop(0);
  t.clock.advance(PICKER_GRACE_MS - 1);
  assert.equal(t.events('game:picker-changed').length, 0, 'a reload gets time to come back');

  t.clock.advance(2);
  const [changed] = t.events('game:picker-changed');
  assert.ok(changed, 'the room is told who picks now');
  assert.ok(['p1', 'p2'].includes(changed.payload.nextPickerId));
  assert.equal(t.gs().currentPickerId, changed.payload.nextPickerId);
});

test('a picker who comes back inside the grace period keeps the pick', () => {
  const t = mkRoom();
  t.drop(0);
  t.clock.advance(5000);
  t.gm.reconnectPlayer({ id: 'sock-0b', sessionId: 'p0' }, t.code);
  t.clock.advance(PICKER_GRACE_MS * 3);
  assert.equal(t.events('game:picker-changed').length, 0);
  assert.equal(t.gs().currentPickerId, 'p0');
});

test('a picker who drops with a clue up loses the pick once the clue is over', () => {
  const t = mkRoom();
  t.actions.selectQuestion('p0', t.code, 0, 0);
  t.drop(0);
  t.clock.advance(30000); // nobody buzzes
  t.actions.timeoutContinue('p1', t.code);
  t.actions.timeoutContinue('p2', t.code);
  assert.equal(t.events('game:all-continued').length, 1);
  assert.equal(t.gs().currentPickerId, 'p0', 'nobody answered, so the pick stayed put');

  t.clock.advance(PICKER_GRACE_MS * 2);
  assert.equal(t.events('game:picker-changed').length, 1);
  assert.notEqual(t.gs().currentPickerId, 'p0');
});

test('a Daily Double whose picker drops is called off after the grace period, scoring nobody', () => {
  const t = mkRoom({ settings: { enableDailyDouble: true } });
  t.gs().dailyDoubles = [{ categoryIndex: 0, pointIndex: 0 }];
  t.room.players.get('p0').score = 600;
  t.actions.selectQuestion('p0', t.code, 0, 0);
  assert.equal(t.gs().phase, 'dailyDouble');

  t.drop(0);
  t.clock.advance(PICKER_GRACE_MS + 1);
  const [result] = t.events('game:daily-double-result');
  assert.ok(result, 'the Daily Double is settled');
  assert.equal(result.payload.wager, 0);
  assert.equal(t.room.players.get('p0').score, 600, 'no score moved');
  assert.equal(t.gs().currentQuestion, null);
  assert.notEqual(t.gs().currentPickerId, 'p0', 'and the pick moves on');
});

test('a player who leaves holding the pick hands it on, and the room is told', () => {
  const t = mkRoom();
  t.leave(0);
  const [changed] = t.events('game:picker-changed');
  assert.ok(changed);
  assert.ok(['p1', 'p2'].includes(changed.payload.nextPickerId));
});

// =========================================================================
// Leaving while holding the buzz
// =========================================================================

test('the player holding the buzz leaves: the others get the clue back', () => {
  const t = mkRoom();
  t.actions.selectQuestion('p0', t.code, 0, 0);
  t.actions.buzz('p1', t.code, 0);
  t.clock.advance(600);
  assert.equal(t.gs().buzzedPlayerId, 'p1');

  t.leave(1);
  const [result] = t.events('game:answer-result');
  assert.ok(result, 'the room is told the buzz is over');
  assert.equal(result.payload.canBuzzAgain, true);
  assert.equal(t.gs().buzzedPlayerId, null);
  assert.equal(t.actions.buzz('p2', t.code, 0), true, 'p2 can ring in');
});

test('the last player who could answer leaves holding the buzz: the clue ends', () => {
  const t = mkRoom({ count: 2 });
  t.actions.selectQuestion('p0', t.code, 0, 0);
  t.actions.buzz('p0', t.code, 0);
  t.clock.advance(600);
  t.actions.submitAnswer('p0', t.code, false);
  t.actions.buzz('p1', t.code, 0);
  t.clock.advance(600);
  assert.equal(t.gs().buzzedPlayerId, 'p1');

  t.leave(1);
  const last = t.events('game:answer-result').at(-1);
  assert.equal(last.payload.canBuzzAgain, false);
  assert.equal(last.payload.correctAnswer, 'answer 0-0', 'the response is shown');
  assert.equal(t.gs().currentQuestion, null, 'the board comes back');
});

test('in a hosted room, the buzzed player leaving reopens the buzzer for the rest', () => {
  const t = mkRoom({ type: 'host' });
  t.actions.selectQuestion('host', t.code, 0, 0);
  t.clock.advance(3000); // the buzzer opens once the clue has been read
  assert.equal(t.events('host:buzzer-opened').length, 1);
  t.actions.buzz('p0', t.code, 0);
  t.clock.advance(600);
  assert.equal(t.gs().buzzedPlayerId, 'p0');

  t.leave(0);
  assert.equal(t.events('host:buzzer-opened').length, 2);
  assert.equal(t.gs().buzzWindowOpen, true);
  assert.equal(t.gs().buzzedPlayerId, null);
});

// --- report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n').slice(0, 3).join('\n        ')}`);
}
process.exit(failures.length ? 1 : 0);
