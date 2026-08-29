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
import { Server } from 'socket.io';
import { io as createClient } from 'socket.io-client';
import { initializeSocketHandlers } from '../socket/index.js';

let passed = 0;
const failures = [];

const httpServer = createServer();
const ioServer = new Server(httpServer, { cors: { origin: '*' } });
initializeSocketHandlers(ioServer);

const PORT = 34117;
const URL = `http://localhost:${PORT}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Connect a client with a stable session id (the reconnection identity). */
function connect(sessionId) {
  return new Promise((resolve, reject) => {
    const socket = createClient(URL, {
      auth: { sessionId },
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
      resolve(payload);
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
