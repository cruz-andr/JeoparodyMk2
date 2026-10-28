/**
 * End-to-end checks over real socket.io connections.
 * Run with: node server/test/socketFlow.test.js
 *
 * The unit suite covers GameStateManager in isolation; this one exercises the
 * event handlers in socket/index.js — authorization, payload shapes, and the
 * timers that drive a clue — the way an actual client would.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { io as createClient } from 'socket.io-client';
import { initializeSocketHandlers } from '../socket/index.js';

let passed = 0;
const failures = [];

const httpServer = createServer();
const ioServer = new Server(httpServer, { cors: { origin: '*' } });
/* NODE_ENV=test deals quickplay the written board: a unit run must not scrape
   another site for an episode. */
const { gameManager } = initializeSocketHandlers(ioServer, { env: { ...process.env, NODE_ENV: 'test' } });

const PORT = 34117;
const URL = `http://localhost:${PORT}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Each session's key, so a test that reconnects as the same player brings the
   same one, the way the browser keeps it in a cookie. */
const sessionKeys = new Map();
const keyFor = (sessionId) => {
  if (!sessionKeys.has(sessionId)) sessionKeys.set(sessionId, randomUUID());
  return sessionKeys.get(sessionId);
};

/** Connect a client with a stable session id (the reconnection identity). */
function connect(sessionId) {
  return new Promise((resolve, reject) => {
    const socket = createClient(URL, {
      auth: { sessionId, sessionKey: keyFor(sessionId) },
      transports: ['websocket'],
      forceNew: true,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

/** Resolves with the event payload, or rejects if it never arrives. */
function once(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeout
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload ?? true);
    });
  });
}

/** Resolves true if the event does NOT arrive within the window. */
async function notEmitted(socket, event, window = 400) {
  let fired = false;
  const onEvent = () => { fired = true; };
  socket.on(event, onEvent);
  await wait(window);
  socket.off(event, onEvent);
  return !fired;
}

const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

const board = () =>
  Array.from({ length: 2 }, (_, c) =>
    Array.from({ length: 2 }, (_, r) => ({
      category: `CAT${c}`,
      points: (r + 1) * 200,
      answer: `clue ${c}-${r}`,
      question: `answer ${c}-${r}`,
      revealed: false,
    }))
  );

/** A started 2-player game. `buzzMs` sets both server-side clue timers. */
async function startGame({ buzzMs = 30000, answerMs = 5000 } = {}) {
  const host = await connect(`host-${Math.random()}`);
  const guest = await connect(`guest-${Math.random()}`);

  const { roomCode } = await emitAck(host, 'room:create', {
    type: 'multiplayer',
    settings: {
      enableDailyDouble: false,
      questionTimeLimit: buzzMs,
      answerTimeLimit: answerMs,
    },
  });

  const hostJoin = await emitAck(host, 'room:join', { roomCode, displayName: 'Host' });
  const guestJoin = await emitAck(guest, 'room:join', { roomCode, displayName: 'Guest' });

  const ready = once(guest, 'game:questions-ready');
  host.emit('game:set-questions', {
    roomCode,
    questions: board(),
    categories: ['A', 'B'],
    firstPickerId: hostJoin.players[0].id,
  });
  await ready;

  return { host, guest, roomCode, hostId: hostJoin.players[0].id, guestId: guestJoin.players[1].id };
}

/** A started host-run game: host controls the board, players answer. */
async function startHostGame({ answerMs = 400, answerMode = 'verbal' } = {}) {
  const host = await connect(`h-${Math.random()}`);
  const guest = await connect(`g-${Math.random()}`);

  const { roomCode } = await emitAck(host, 'room:create', {
    type: 'host',
    settings: { enableDailyDouble: false, answerMode, answerTimeLimit: answerMs },
  });

  const hostJoin = await emitAck(host, 'room:join', { roomCode, displayName: 'Host' });
  await emitAck(guest, 'room:join', { roomCode, displayName: 'Guest' });

  await emitAck(host, 'host:set-custom-questions', {
    roomCode, questions: board(), categories: ['A', 'B'],
  });

  return { host, guest, roomCode, hostId: hostJoin.players[0].id };
}

async function test(name, fn) {
  const sockets = [];
  try {
    await fn(sockets);
    passed++;
  } catch (err) {
    failures.push({ name, err });
  } finally {
    sockets.forEach((s) => s.disconnect());
  }
}

async function run() {
  await new Promise((r) => httpServer.listen(PORT, r));

  await test('a clue is broadcast to every player when selected', async (open) => {
    const { host, guest, roomCode } = await startGame();
    open.push(host, guest);

    const seen = once(guest, 'game:question-selected');
    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 1 });

    const payload = await seen;
    assert.equal(payload.categoryIndex, 0);
    assert.equal(payload.pointIndex, 1);
    assert.equal(payload.question.points, 400);
    assert.equal(payload.question.answer, 'clue 0-1');
  });

  await test('a non-picker cannot select a clue', async (open) => {
    const { host, guest, roomCode } = await startGame();
    open.push(host, guest);

    guest.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    assert.ok(await notEmitted(host, 'game:question-selected'));
  });

  await test('a non-host cannot replace the board mid-game', async (open) => {
    const { host, guest, roomCode } = await startGame();
    open.push(host, guest);

    guest.emit('game:set-questions', {
      roomCode,
      questions: board(),
      categories: ['HACKED', 'HACKED'],
      firstPickerId: 'nobody',
    });
    assert.ok(
      await notEmitted(host, 'game:questions-ready'),
      'only the host may set the board'
    );
  });

  await test('a non-host cannot end the game for everyone', async (open) => {
    const { host, guest, roomCode } = await startGame();
    open.push(host, guest);

    guest.emit('game:end', { roomCode });
    assert.ok(await notEmitted(host, 'game:ended'));
  });

  await test('the fastest buzz wins and is announced to the room', async (open) => {
    const { host, guest, roomCode, guestId } = await startGame();
    open.push(host, guest);

    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    await once(guest, 'game:question-selected');

    const winner = once(host, 'game:buzzer-winner');
    guest.emit('game:buzz-in', { roomCode, reactionTime: 120 });

    const payload = await winner;
    assert.equal(payload.playerId, guestId);
    assert.equal(payload.playerName, 'Guest');
  });

  await test('a client cannot inflate its own score', async (open) => {
    const { host, guest, roomCode, guestId } = await startGame();
    open.push(host, guest);

    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 1 }); // $400
    await once(guest, 'game:question-selected');
    guest.emit('game:buzz-in', { roomCode, reactionTime: 100 });
    await once(guest, 'game:buzzer-winner');

    const result = once(host, 'game:answer-result');
    guest.emit('game:submit-answer', { roomCode, correct: true, points: 1000000 });

    const payload = await result;
    assert.equal(payload.playerId, guestId);
    assert.equal(payload.newScore, 400, 'the board decides the value, not the client');
  });

  await test('a rejected re-buzz does not freeze the clue', async (open) => {
    // The original bug: any buzz cancelled the server timer and marked the clue
    // as answered, so a second buzz from an ineligible player left the room with
    // no winner and no timeout — stuck forever.
    const { host, guest, roomCode } = await startGame({ buzzMs: 700 });
    open.push(host, guest);

    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    await once(guest, 'game:question-selected');

    guest.emit('game:buzz-in', { roomCode, reactionTime: 50 });
    await once(guest, 'game:buzzer-winner');

    const wrong = once(guest, 'game:answer-result');
    guest.emit('game:submit-answer', { roomCode, correct: false });
    assert.equal((await wrong).canBuzzAgain, true, 'the host has not buzzed yet');

    // The guest, already out, hammers the buzzer again.
    const timeout = once(host, 'game:buzz-timeout-result', 3000);
    guest.emit('game:buzz-in', { roomCode, reactionTime: 10 });
    guest.emit('game:buzz-in', { roomCode, reactionTime: 10 });

    const payload = await timeout;
    assert.ok(payload, 'the buzz window still times out and the game moves on');
  });

  await test('a clue skipped mid-buzz does not announce a winner', async (open) => {
    // The winner is announced 500ms after the first buzz, to collect near-ties.
    // Nothing used to check that the clue still existed by then.
    const { host, guest, roomCode } = await startGame();
    open.push(host, guest);

    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    await once(guest, 'game:question-selected');

    guest.emit('game:buzz-in', { roomCode, reactionTime: 40 });
    await wait(100);
    // The clue goes away inside the collection window. Straight onto the room:
    // in an ordinary game nobody may skip a clue for everyone.
    gameManager.clearCurrentQuestion(roomCode);

    assert.ok(
      await notEmitted(guest, 'game:buzzer-winner', 900),
      'the clue is gone, so there is nobody to award it to'
    );
  });

  await test('the answer clock is shorter than the buzz clock', async (open) => {
    const { host, guest, roomCode } = await startGame({ buzzMs: 5000, answerMs: 400 });
    open.push(host, guest);

    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    await once(guest, 'game:question-selected');
    guest.emit('game:buzz-in', { roomCode, reactionTime: 50 });
    await once(guest, 'game:buzzer-winner');

    // No answer submitted: the short answer clock should expire well before the
    // 5s buzz clock would have.
    const started = Date.now();
    const result = await once(host, 'game:answer-result', 3000);
    assert.equal(result.timeout, true);
    assert.equal(result.correct, false);
    assert.ok(Date.now() - started < 3000, 'answer clock, not the buzz clock');
  });

  await test('a player who reconnects keeps their score', async (open) => {
    const { host, guest, roomCode, guestId } = await startGame();
    open.push(host, guest);

    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 1 });
    await once(guest, 'game:question-selected');
    guest.emit('game:buzz-in', { roomCode, reactionTime: 60 });
    await once(guest, 'game:buzzer-winner');
    const scored = once(host, 'game:answer-result');
    guest.emit('game:submit-answer', { roomCode, correct: true });
    assert.equal((await scored).newScore, 400);

    // Same session id, brand new socket — a page reload.
    guest.disconnect();
    await wait(100);
    const returning = await connect(guestId);
    open.push(returning);

    const state = await emitAck(returning, 'room:reconnect', { roomCode });
    assert.equal(state.success, true);
    const me = state.players.find((p) => p.id === guestId);
    assert.equal(me.score, 400, 'a reload must not wipe the scoreboard');
  });

  await test('host mode leaves the verdict to the host, not a timer', async (open) => {
    const { host, guest, roomCode } = await startHostGame({ answerMs: 300 });
    open.push(host, guest);

    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    await once(guest, 'game:question-selected');
    host.emit('host:open-buzzer', { roomCode });
    await once(guest, 'host:buzzer-opened');

    guest.emit('game:buzz-in', { roomCode, reactionTime: 40 });
    await once(guest, 'game:buzzer-winner');

    // The host is still deciding. Nothing may score the answer for them.
    assert.ok(
      await notEmitted(guest, 'game:answer-result', 1200),
      'an auto-timeout would dock the player and clear the clue mid-judgement'
    );
  });

  await test('a skipped clue cannot be scored by its stale answer timer', async (open) => {
    const { host, guest, roomCode } = await startHostGame({ answerMs: 600 });
    open.push(host, guest);

    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    await once(guest, 'game:question-selected');
    host.emit('host:open-buzzer', { roomCode });
    await once(guest, 'host:buzzer-opened');
    guest.emit('game:buzz-in', { roomCode, reactionTime: 30 });
    await once(guest, 'game:buzzer-winner');

    // Host abandons the clue and opens a different, more valuable one.
    host.emit('host:skip-question', { roomCode });
    await once(guest, 'host:question-skipped');
    host.emit('game:select-question', { roomCode, categoryIndex: 1, pointIndex: 1 });
    await once(guest, 'game:question-selected');

    assert.ok(
      await notEmitted(guest, 'game:answer-result', 1200),
      'the abandoned clue\'s timer must not charge anyone for the new one'
    );
  });

  await test('a non-host cannot rewrite the genre or categories', async (open) => {
    const { host, guest, roomCode } = await startGame();
    open.push(host, guest);

    guest.emit('game:genre-selected', { roomCode, genre: 'HACKED' });
    assert.ok(await notEmitted(host, 'game:genre-selected'));

    guest.emit('game:category-edited', { roomCode, index: 0, value: 'HACKED' });
    assert.ok(await notEmitted(host, 'game:category-edited'));
  });

  await test('a private room honours the Daily Double setting it was created with', async (open) => {
    const host = await connect(`h-${Math.random()}`);
    open.push(host);

    const { roomCode } = await emitAck(host, 'room:create', {
      type: 'multiplayer',
      settings: { enableDailyDouble: true, questionTimeLimit: 30000 },
    });
    const join = await emitAck(host, 'room:join', { roomCode, displayName: 'Host' });

    const ready = once(host, 'game:questions-ready');
    host.emit('game:set-questions', {
      roomCode, questions: board(), categories: ['A', 'B'],
      firstPickerId: join.players[0].id,
    });
    await ready;

    // Walk the whole 2x2 board; one cell must be a Daily Double.
    let sawDailyDouble = false;
    for (const [c, r] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const selected = once(host, 'game:question-selected');
      host.emit('game:select-question', { roomCode, categoryIndex: c, pointIndex: r });
      const payload = await selected;
      if (payload.isDailyDouble) sawDailyDouble = true;
      // Clear the clue to move on; nobody may skip one in an ordinary game.
      gameManager.clearAnswerTimeout(roomCode);
      gameManager.clearBuzzTimeout(roomCode);
      gameManager.clearCurrentQuestion(roomCode);
    }
    assert.ok(sawDailyDouble, 'the setting was sent at creation, so it must apply');
  });

  await test('the buzzer still works on the clue after a skip', async (open) => {
    const { host, guest, roomCode } = await startHostGame();
    open.push(host, guest);

    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    await once(guest, 'game:question-selected');
    host.emit('host:open-buzzer', { roomCode });
    await once(guest, 'host:buzzer-opened');
    guest.emit('game:buzz-in', { roomCode, reactionTime: 30 });
    await once(guest, 'game:buzzer-winner');

    host.emit('host:skip-question', { roomCode });
    await once(guest, 'host:question-skipped');

    // A stale buzzedPlayerId would make recordBuzz reject every later buzz.
    host.emit('game:select-question', { roomCode, categoryIndex: 1, pointIndex: 0 });
    await once(guest, 'game:question-selected');
    host.emit('host:open-buzzer', { roomCode });
    await once(guest, 'host:buzzer-opened');

    const winner = once(guest, 'game:buzzer-winner', 2000);
    guest.emit('game:buzz-in', { roomCode, reactionTime: 25 });
    assert.ok(await winner, 'the next clue must be buzzable');
  });

  await test('Final Jeopardy is skipped when nobody qualifies', async (open) => {
    const { host, guest, roomCode } = await startGame();
    open.push(host, guest);

    // Both players are on $0, so nobody may play. The game should end rather
    // than strand everyone on a wager screen that can never be satisfied.
    const ended = once(guest, 'game:ended', 2500);
    host.emit('game:start-final-jeopardy', { roomCode });
    assert.ok(await ended);
  });

  await test('Final Jeopardy is not blocked by a player who drops out', async (open) => {
    const { host, guest, roomCode, hostId, guestId } = await startGame();
    open.push(host, guest);

    // Give both players a positive score so both are eligible. Straight onto
    // the room: in an ordinary game nobody may override scores.
    const room = gameManager.rooms.get(roomCode);
    room.players.get(hostId).score = 500;
    room.players.get(guestId).score = 500;

    host.emit('game:start-final-jeopardy', { roomCode });
    await once(guest, 'game:final-jeopardy-started');

    // The guest leaves without wagering; the host alone must still advance.
    guest.disconnect();
    await wait(150);

    const showClue = once(host, 'game:fj-show-clue', 2500);
    host.emit('game:fj-wager', { roomCode, wager: 100 });
    assert.ok(await showClue, 'a departed player cannot hold the round open');
  });

  await test('joining the quickplay queue is acknowledged with the matchmaking thresholds', async (open) => {
    const lone = await connect(`lone-${Math.random()}`);
    open.push(lone);

    const ack = once(lone, 'quickplay:queue-joined');
    lone.emit('quickplay:join-queue', { displayName: 'Lone' });
    const timings = await ack;
    assert.equal(timings.pairAfterMs, 20000);
    assert.equal(timings.giveUpAfterMs, 45000);

    assert.ok(await notEmitted(lone, 'quickplay:match-found'), 'one player is not a match');
    lone.emit('quickplay:leave-queue');
    await once(lone, 'quickplay:queue-left');
  });

  await test('three in the quickplay queue are matched the instant the third arrives', async (open) => {
    const players = [];
    for (let i = 0; i < 3; i += 1) players.push(await connect(`qp-${i}-${Math.random()}`));
    open.push(...players);

    const found = players.map((p) => once(p, 'quickplay:match-found'));
    players.forEach((p, i) => p.emit('quickplay:join-queue', { displayName: `P${i}` }));
    const payloads = await Promise.all(found);

    const codes = new Set(payloads.map((m) => m.roomCode));
    assert.equal(codes.size, 1, 'everyone lands in the same room');
    assert.equal(payloads[0].players.length, 3);
  });

  /* A player's session id is in every payload that names them, so everyone at
     the table has it, and the handshake used to take it as given. Anyone could
     connect as another player and buzz, answer or leave for them. */
  await test('nobody can connect as another player by sending their id', async (open) => {
    const { host, guest, guestId } = await startGame();
    open.push(host, guest);

    const impostor = createClient(URL, {
      auth: { sessionId: guestId, sessionKey: randomUUID() },
      transports: ['websocket'], forceNew: true, reconnection: false,
    });
    open.push(impostor);
    const refused = await new Promise((resolve) => {
      impostor.on('connect', () => resolve(null));
      impostor.on('connect_error', (err) => resolve(err.message));
    });
    assert.equal(refused, 'session-taken');

    const bare = createClient(URL, {
      auth: { sessionId: `someone-${Math.random()}` }, transports: ['websocket'], forceNew: true, reconnection: false,
    });
    open.push(bare);
    const keyless = await new Promise((resolve) => {
      bare.on('connect', () => resolve(null));
      bare.on('connect_error', (err) => resolve(err.message));
    });
    assert.equal(keyless, 'session-key-required');
  });

  /* A hosted room's players are judged by the host, so they never need the
     responses. They were sent the whole board anyway, responses and the
     multiple-choice options in written order (the correct one first), and
     every clue again with its response as it was opened. */
  await test('the players in a hosted room are not sent the responses', async (open) => {
    const host = await connect(`hh-${Math.random()}`);
    const guest = await connect(`hg-${Math.random()}`);
    open.push(host, guest);

    const { roomCode } = await emitAck(host, 'room:create', {
      type: 'host', settings: { enableDailyDouble: false, answerMode: 'verbal' },
    });
    const hostJoin = await emitAck(host, 'room:join', { roomCode, displayName: 'Host' });
    await emitAck(guest, 'room:join', { roomCode, displayName: 'Guest' });

    const written = board();
    written[0][0].options = [written[0][0].question, 'decoy 1', 'decoy 2', 'decoy 3'];

    const guestBoard = once(guest, 'game:questions-ready');
    const hostBoard = once(host, 'game:questions-ready');
    host.emit('game:set-questions', {
      roomCode, questions: written, categories: ['A', 'B'], firstPickerId: hostJoin.players[0].id,
    });
    const seen = await guestBoard;
    for (const clue of seen.questions.flat()) {
      assert.equal(clue.question, undefined, 'no response on the board');
      assert.equal(clue.options, undefined, 'no options in written order');
      assert.ok(clue.answer, 'the clue itself is still there');
    }
    assert.equal((await hostBoard).questions[0][0].question, written[0][0].question, 'the host keeps them');

    const guestClue = once(guest, 'game:question-selected');
    const hostClue = once(host, 'game:question-selected');
    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    const opened = await guestClue;
    assert.equal(opened.question.question, undefined, 'no response with the clue');
    assert.equal(opened.question.options.length, 4, 'the options still come, shuffled');
    assert.equal((await hostClue).question.question, written[0][0].question);

    const back = gameManager.reconnectPlayer({ id: 'later', sessionId: [...gameManager.rooms.get(roomCode).players.keys()][1] }, roomCode);
    assert.equal(back.gameState.currentQuestion.question, undefined, 'nor on a reconnect');
    assert.equal(back.gameState.questions[1][1].question, undefined);
  });

  /* host:skip-question cleared the buzz and answer timers before anything
     checked who sent it, so any player could leave a clue with no timer to
     end it, and the room hung. */
  await test('a player cannot cancel the clue timers with host:skip-question', async (open) => {
    const { host, guest, roomCode } = await startGame({ buzzMs: 700 });
    open.push(host, guest);

    const selected = once(guest, 'game:question-selected');
    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    await selected;

    const timedOut = once(host, 'game:buzz-timeout-result', 2500);
    guest.emit('host:skip-question', { roomCode });
    host.emit('host:skip-question', { roomCode });
    assert.ok(await timedOut, 'the clue still times out');
  });

  await test('the creator of an ordinary room cannot set scores', async (open) => {
    const { host, guest, roomCode, hostId } = await startGame();
    open.push(host, guest);
    host.emit('host:override-score', { roomCode, playerId: hostId, newScore: 99999 });
    assert.ok(await notEmitted(guest, 'host:score-overridden'));
    assert.equal(gameManager.rooms.get(roomCode).players.get(hostId).score, 0);
  });

  /* The clue went out with the category, before anyone had wagered, and the
     correct response with it, which the server then graded typed answers
     against. Anyone reading the socket frames won Final Jeopardy. */
  await test('Final Jeopardy sends the clue only once wagers are in, and the response only at the reveal', async (open) => {
    const { host, guest, roomCode, hostId, guestId } = await startGame();
    open.push(host, guest);
    const room = gameManager.rooms.get(roomCode);
    room.players.get(hostId).score = 500;
    room.players.get(guestId).score = 500;

    const started = once(guest, 'game:final-jeopardy-started');
    host.emit('game:start-final-jeopardy', { roomCode });
    const start = await started;
    assert.ok(start.category, 'the category is shown first');
    assert.equal(start.clue, undefined, 'no clue before the wagers');
    assert.equal(start.answer, undefined, 'no response before the reveal');

    const shown = once(guest, 'game:fj-show-clue');
    host.emit('game:fj-wager', { roomCode, wager: 100 });
    guest.emit('game:fj-wager', { roomCode, wager: 100 });
    const { clue, media } = await shown;
    assert.equal(clue, room.gameState.finalJeopardy.clue);
    assert.equal(media, null, 'the stock clue has no picture, and says so');

    const revealed = once(guest, 'game:fj-reveal');
    host.emit('game:fj-answer', { roomCode, answer: 'x' });
    guest.emit('game:fj-answer', { roomCode, answer: 'y' });
    const reveal = await revealed;
    assert.equal(reveal.answer, room.gameState.finalJeopardy.answer);
    assert.equal(reveal.results.length, 2);
  });

  /* Handlers destructured their payload and called their callback blind, so
     one bare emit threw inside socket.io's dispatch, and the server's
     uncaughtException handler exited the process with every room in it. */
  await test('an event with no payload or no callback is shrugged off, not fatal', async (open) => {
    const s = await connect(`bare-${Math.random()}`);
    open.push(s);

    s.emit('game:buzz-in');
    s.emit('game:suggest-question', null);
    s.emit('room:join', null);
    s.emit('room:create', { type: 'multiplayer', settings: {} }); // no callback
    await wait(200);

    const created = await emitAck(s, 'room:create', { type: 'multiplayer', settings: {} });
    assert.equal(created.success, true, 'the server is still up and answering');
    const bare = await new Promise((resolve) => s.emit('room:create', resolve));
    assert.equal(typeof bare.success, 'boolean', 'a callback with no payload still gets an answer');
  });

  // --- Phase 4: players coming and going ---------------------------------

  await test('the host leaving a hosted game ends it for the players, rather than stranding them', async (open) => {
    const { host, guest, roomCode, hostId } = await startHostGame();
    open.push(host, guest);
    // The host presses Start, as the page does.
    const started = once(guest, 'game:questions-ready');
    host.emit('game:set-questions', { roomCode, questions: board(), categories: ['A', 'B'], firstPickerId: hostId });
    await started;

    const ended = once(guest, 'game:ended');
    host.emit('room:leave', { roomCode });
    await ended;
  });

  await test('rejoining a game in progress by its code brings the game back and adds no second seat', async (open) => {
    const { host, guest, roomCode, guestId: guestSession } = await startGame();
    open.push(host, guest);
    guest.disconnect();
    await wait(100);

    const joinedAgain = notEmitted(host, 'room:player-joined', 600);
    const reconnected = once(host, 'room:player-reconnected').then(() => true, () => false);
    const back = await connect(guestSession);
    open.push(back);
    const ack = await emitAck(back, 'room:join', { roomCode, displayName: 'Guest' });
    assert.equal(ack.success, true);
    assert.equal(ack.isRejoin, true);
    assert.ok(ack.gameState?.questions, 'the board comes with the ack');
    assert.equal(ack.players.length, 2);
    assert.equal(await reconnected, true, 'the others are told the player is back');
    assert.equal(await joinedAgain, true, 'nobody is told a new player arrived');
  });

  await test('a host who reloads gets back the second round and final they wrote', async (open) => {
    const host = await connect(`h-${Math.random()}`);
    const guest = await connect(`g-${Math.random()}`);
    open.push(host, guest);
    const { roomCode } = await emitAck(host, 'room:create', { type: 'host', settings: { enableDailyDouble: false } });
    await emitAck(host, 'room:join', { roomCode, displayName: 'Host' });
    await emitAck(guest, 'room:join', { roomCode, displayName: 'Guest' });
    const round2 = { categories: ['X', 'Y'], questions: board(), dailyDoubles: null };
    const finalJeopardy = { category: 'F', answer: 'the clue', question: 'the response' };
    await emitAck(host, 'host:set-custom-questions', {
      roomCode, questions: board(), categories: ['A', 'B'], round2, finalJeopardy,
    });

    const hostBack = await emitAck(host, 'room:reconnect', { roomCode });
    assert.deepEqual(hostBack.hostPlan.finalJeopardy, finalJeopardy);
    assert.deepEqual(hostBack.hostPlan.round2.categories, ['X', 'Y']);
    assert.equal(hostBack.status, 'waiting', 'still the lobby: the game has not been started');
    const guestBack = await emitAck(guest, 'room:reconnect', { roomCode });
    assert.equal(guestBack.hostPlan, undefined, 'the players are not sent the host\'s answers');
  });

  await test('a player whose connection drops during Final Jeopardy does not hold up the clue', async (open) => {
    const { host, guest, roomCode } = await startGame();
    open.push(host, guest);
    for (const p of gameManager.rooms.get(roomCode).players.values()) p.score = 1000;
    const started = once(guest, 'game:final-jeopardy-started');
    host.emit('game:start-final-jeopardy', { roomCode });
    await started;

    const clue = once(host, 'game:fj-show-clue').then(() => true, () => false);
    host.emit('game:fj-wager', { roomCode, wager: 100 });
    await wait(100);
    guest.disconnect();
    assert.equal(await clue, true, 'the clue goes up for the player still here');
  });

  await test('in quickplay a player cannot mark their own answer right; the typed one is graded', async (open) => {
    const { host, guest, roomCode, guestId } = await startGame();
    open.push(host, guest);
    gameManager.rooms.get(roomCode).type = 'quickplay';

    const selected = once(guest, 'game:question-selected');
    host.emit('game:select-question', { roomCode, categoryIndex: 0, pointIndex: 0 });
    await selected;
    const winner = once(guest, 'game:buzzer-winner');
    guest.emit('game:buzz-in', { roomCode, reactionTime: 10 });
    await winner;
    assert.equal(gameManager.rooms.get(roomCode).gameState.buzzedPlayerId, guestId);

    guest.emit('game:submit-answer', { roomCode, correct: true });
    guest.emit('game:reveal-answer', { roomCode });
    assert.equal(await notEmitted(host, 'game:answer-result', 400), true, 'self-judging is ignored');

    const result = once(host, 'game:answer-result');
    guest.emit('game:submit-response', { roomCode, answer: 'What is answer 0-0?' });
    const { correct, said } = await result;
    assert.equal(correct, true);
    assert.equal(said, 'What is answer 0-0?');
  });

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  for (const { name, err } of failures) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message.split('\n')[0]}`);
  }

  ioServer.close();
  httpServer.close();
  process.exit(failures.length ? 1 : 0);
}

run();
