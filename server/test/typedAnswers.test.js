/**
 * Quickplay answers: typed by the player, graded by the server.
 * Run with: node server/test/typedAnswers.test.js
 *
 * Quickplay seats strangers, and a player used to mark their own answer
 * right or wrong with the response already on their screen. These check that
 * the response never reaches a quickplay player before the clue is over, and
 * that the only way to score is to type it.
 */
import assert from 'node:assert/strict';
import { GameStateManager } from '../socket/GameStateManager.js';
import { createGameActions } from '../socket/actions.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push({ name, err }); }
}

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
    category: `CAT${c}`, points: (r + 1) * 200, answer: `clue ${c}-${r}`,
    question: c === 0 && r === 0 ? 'Bruce Wayne (Batman)' : `answer ${c}-${r}`, revealed: false,
  })));

/**
 * A table of the given type. What the players are sent and what the house
 * hears are recorded apart, the way the socket layer splits them.
 */
function mkTable({ type = 'quickplay', settings = {} } = {}) {
  const clock = mkClock();
  const gm = new GameStateManager({ now: clock.now });
  const toPlayers = [];
  const toHouse = [];
  const toOne = [];
  const emitRoom = (code, event, payload) => { toPlayers.push({ event, payload }); toHouse.push({ event, payload }); };
  const emitSplit = (code, event, forHost, forPlayers) => {
    toPlayers.push({ event, payload: forPlayers });
    toHouse.push({ event, payload: forHost });
  };
  const emitPlayer = (code, playerId, event, payload) => toOne.push({ playerId, event, payload });
  const actions = createGameActions({
    gameManager: gm, emitRoom, emitSplit, emitPlayer, archiveRoom: () => {}, setTimeout: clock.setTimeout,
  });

  const sockets = ['p0', 'p1', 'p2'].map((id) => ({ id: `sock-${id}`, sessionId: id }));
  let code;
  if (type === 'quickplay') {
    ({ roomCode: code } = gm.buildMatch(sockets.map((socket, i) => ({ socket, displayName: `P${i}` }))));
    Object.assign(gm.rooms.get(code).settings, { enableDailyDouble: false, ...settings });
  } else {
    code = gm.createRoom(type, sockets[0], { enableDailyDouble: false, ...settings }).code;
    sockets.forEach((s, i) => gm.joinRoom(s, code, `P${i}`));
  }
  actions.setQuestions(code, { questions: board(), categories: ['A', 'B', 'C', 'D', 'E', 'F'], firstPickerId: 'p0' });

  const room = gm.rooms.get(code);
  const sent = (list, name) => list.filter((h) => h.event === name);
  /* p0 opens the Batman clue and p1 wins the buzz. */
  const buzzedIn = () => {
    actions.selectQuestion('p0', code, 0, 0);
    actions.buzz('p1', code, 0);
    clock.advance(600);
    assert.equal(room.gameState.buzzedPlayerId, 'p1');
  };
  return { clock, gm, actions, room, code, toPlayers, toHouse, toOne, sent, buzzedIn };
}

// ------------------------------------------------------------ nothing given away

test('a quickplay player is sent the board and the clue without their responses', () => {
  const t = mkTable();
  const [ready] = t.sent(t.toPlayers, 'game:questions-ready');
  assert.ok(ready.payload.questions.flat().every((q) => q.question === undefined), 'the board');
  t.actions.selectQuestion('p0', t.code, 0, 0);
  const [clue] = t.sent(t.toPlayers, 'game:question-selected');
  assert.equal(clue.payload.question.question, undefined, 'the clue');
  assert.equal(clue.payload.question.answer, 'clue 0-0', 'the clue itself is there');
  const [house] = t.sent(t.toHouse, 'game:question-selected');
  assert.equal(house.payload.question.question, 'Bruce Wayne (Batman)', 'the house still knows it');
});

test('a quickplay reconnect is not sent the responses either', () => {
  const t = mkTable();
  t.actions.selectQuestion('p0', t.code, 0, 0);
  const gs = t.gm.reconnectPlayer({ id: 'again', sessionId: 'p1' }, t.code).gameState;
  assert.equal(gs.currentQuestion.question, undefined);
  assert.ok(gs.questions.flat().every((q) => q.question === undefined));
});

test('a Daily Double wager confirmed is sent without its response, in quickplay and in a hosted room', () => {
  const q = mkTable({ settings: { enableDailyDouble: true } });
  q.room.gameState.dailyDoubles = [{ categoryIndex: 0, pointIndex: 0 }];
  q.actions.selectQuestion('p0', q.code, 0, 0);
  q.actions.dailyDoubleWager('p0', q.code, 500);
  const [confirmed] = q.sent(q.toPlayers, 'game:daily-double-wager-confirmed');
  assert.equal(confirmed.payload.question.question, undefined);

  const h = mkTable({ type: 'host', settings: { enableDailyDouble: true } });
  h.room.gameState.dailyDoubles = [{ categoryIndex: 0, pointIndex: 0 }];
  h.actions.selectQuestion('p0', h.code, 0, 0);
  h.actions.hostDailyDoubleWager('p0', h.code, 'p1', 500);
  const [hosted] = h.sent(h.toPlayers, 'game:daily-double-wager-confirmed');
  assert.ok(hosted, 'confirmed');
  assert.equal(hosted.payload.question.question, undefined);
  assert.equal(h.sent(h.toHouse, 'game:daily-double-wager-confirmed')[0].payload.question.question,
    'Bruce Wayne (Batman)', 'the host still gets it');
});

// ------------------------------------------------------------ graded

test('a typed response that is right scores, and the room is told what was said', () => {
  const t = mkTable();
  t.buzzedIn();
  t.actions.submitResponse('p1', t.code, 'Who is Batman?');
  const [result] = t.sent(t.toPlayers, 'game:answer-result');
  assert.equal(result.payload.correct, true);
  assert.equal(result.payload.said, 'Who is Batman?');
  assert.equal(result.payload.correctAnswer, 'Bruce Wayne (Batman)', 'the response, now the clue is over');
  assert.equal(t.room.players.get('p1').score, 200);
});

test('a typed response that is wrong costs the clue, and the others can buzz', () => {
  const t = mkTable();
  t.buzzedIn();
  t.actions.submitResponse('p1', t.code, 'Superman');
  const [result] = t.sent(t.toPlayers, 'game:answer-result');
  assert.equal(result.payload.correct, false);
  assert.equal(result.payload.canBuzzAgain, true);
  assert.equal(t.room.players.get('p1').score, -200);
});

test('a close response gets one more go, told to that player alone, without the answer', () => {
  const t = mkTable();
  t.buzzedIn();
  t.actions.submitResponse('p1', t.code, 'Brooce Wain');
  assert.equal(t.sent(t.toPlayers, 'game:answer-result').length, 0, 'no verdict yet');
  assert.deepEqual(t.toOne.map((m) => [m.playerId, m.event]), [['p1', 'game:answer-close']]);
  assert.equal(JSON.stringify(t.toOne[0].payload).includes('Batman'), false);

  t.actions.submitResponse('p1', t.code, 'Brooce Wain');
  const [result] = t.sent(t.toPlayers, 'game:answer-result');
  assert.equal(result.payload.correct, false, 'a second close is wrong');
});

test('only the player holding the buzz can answer', () => {
  const t = mkTable();
  t.buzzedIn();
  assert.equal(t.actions.submitResponse('p2', t.code, 'Batman'), null);
  assert.equal(t.sent(t.toPlayers, 'game:answer-result').length, 0);
});

test('a quickplay Daily Double is typed too, and the response shown after', () => {
  const t = mkTable({ settings: { enableDailyDouble: true } });
  t.room.gameState.dailyDoubles = [{ categoryIndex: 0, pointIndex: 0 }];
  t.room.players.get('p0').score = 1000;
  t.actions.selectQuestion('p0', t.code, 0, 0);
  t.actions.dailyDoubleWager('p0', t.code, 600);
  t.actions.submitResponse('p0', t.code, 'Batman');
  const [result] = t.sent(t.toPlayers, 'game:daily-double-result');
  assert.equal(result.payload.correct, true);
  assert.equal(result.payload.said, 'Batman');
  assert.equal(result.payload.correctAnswer, 'Bruce Wayne (Batman)');
  assert.equal(t.room.players.get('p0').score, 1600);
});

test('a room whose players judge themselves is not graded this way', () => {
  const t = mkTable({ type: 'multiplayer' });
  t.buzzedIn();
  assert.equal(t.actions.submitResponse('p1', t.code, 'Batman'), null);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n').slice(0, 3).join('\n        ')}`);
}
process.exit(failures.length ? 1 : 0);
