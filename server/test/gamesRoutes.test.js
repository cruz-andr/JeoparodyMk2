/**
 * The archive, over real HTTP against a real database.
 * Run with: node server/test/gamesRoutes.test.js
 *
 * Boots the actual server on a spare port with a throwaway SQLite file, the
 * way boardsRoutes.test.js does, so the migrations that add the archive's
 * columns to a table that already existed are the ones that run here.
 *
 * The room path is covered without a socket: recordRoomGame is handed a room
 * shaped the way GameStateManager shapes one, against a second throwaway
 * database opened in this process. What matters there is who gets a row and
 * who does not.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';

import { validateFinish, statsRow, historyRow } from '../services/gameHistory.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 3996;
const DB = join(here, 'tmp-games.sqlite');
const UNIT_DB = join(here, 'tmp-games-unit.sqlite');
const base = `http://127.0.0.1:${PORT}`;

for (const f of [DB, UNIT_DB]) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${f}${suffix}`); } catch { /* not there */ }
  }
}

const server = spawn('node', [join(here, '..', 'index.js')], {
  env: {
    ...process.env,
    SERVER_PORT: String(PORT),
    DATABASE_PATH: DB,
    JWT_SECRET: 'test-secret-not-a-real-one',
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function signUp(email) {
  const { data } = await api('/auth/register', {
    method: 'POST',
    body: {
      email, password: 'hunter2hunter2', displayName: email.split('@')[0],
      username: email.split('@')[0],
    },
  });
  if (!data.token) throw new Error(`could not register ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

const game = (over = {}) => ({
  mode: 'single', score: 3200, correct: 8, total: 10,
  categories: ['Rivers', 'Kings', 'Cinema', 'Chemistry', 'Jazz', 'Islands'],
  genre: 'General knowledge',
  ...over,
});

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server never started:\n${serverLog}`);
}

// ============================================================ validation, pure

await test('a good game is accepted and cleaned', () => {
  const { entry, error } = validateFinish(game({ categories: [' Rivers ', { name: 'Kings' }, '', 7] }));
  assert.equal(error, undefined);
  assert.deepEqual(entry.categories, ['Rivers', 'Kings']);
  assert.equal(entry.genre, 'General knowledge');
  assert.equal(entry.boardSlug, null);
});

await test('the mode has to be one we have', () => {
  assert.match(validateFinish(game({ mode: 'ranked' })).error, /mode/);
});

await test('correct cannot exceed total and neither can be negative', () => {
  assert.ok(validateFinish(game({ correct: 11, total: 10 })).error);
  assert.ok(validateFinish(game({ correct: -1 })).error);
  assert.ok(validateFinish(game({ total: 3.5 })).error);
});

await test('a score must be a whole number', () => {
  assert.ok(validateFinish(game({ score: '3200' })).error);
  assert.ok(validateFinish(game({ score: 12.5 })).error);
  assert.equal(validateFinish(game({ score: -600 })).error, undefined, 'negative is a real score');
});

await test('categories are capped, not refused, when there are too many', () => {
  const { entry } = validateFinish(game({ categories: Array.from({ length: 30 }, (_, i) => `C${i}`) }));
  assert.equal(entry.categories.length, 12);
});

await test('statsRow works out the derived numbers and copes with no row', () => {
  assert.equal(statsRow(null).gamesPlayed, 0);
  const s = statsRow({
    games_played: 4, games_won: 3, total_score: 8000, highest_score: 4000,
    correct_answers: 30, incorrect_answers: 10, last_played_at: '2026-01-01 00:00:00',
  });
  assert.equal(s.avgScore, 2000);
  assert.equal(s.accuracy, 75);
  assert.equal(s.total, 40);
  assert.equal(s.bestScore, 4000);
});

await test('historyRow survives a row with no categories', () => {
  assert.deepEqual(historyRow({ id: 'x', categories: null }).categories, []);
  assert.deepEqual(historyRow({ id: 'x', categories: 'not json' }).categories, []);
});

// ============================================================ over HTTP

await waitForServer();

const ada = await signUp('ada@example.com');
const bob = await signUp('bob@example.com');

await test('a visitor with no token is refused', async () => {
  const { status } = await api('/games/finish', { method: 'POST', body: game() });
  assert.equal(status, 401);
  assert.equal((await api('/games/history')).status, 401);
  assert.equal((await api('/users/me/stats')).status, 401);
});

await test('a guest token is refused with a sentence', async () => {
  const { data: guest } = await api('/auth/guest', { method: 'POST', body: { displayName: 'Guest' } });
  assert.ok(guest.token, `no guest token: ${JSON.stringify(guest)}`);
  const { status, data } = await api('/games/finish', { method: 'POST', token: guest.token, body: game() });
  assert.equal(status, 403);
  assert.equal(data.error.code, 'GUEST');
  assert.match(data.error.message, /Sign in/);

  // The same answer from every door to the archive, so a client that asks
  // for stats and history together never gets one of each.
  const history = await api('/games/history', { token: guest.token });
  assert.equal(history.status, 403);
  assert.equal(history.data.error.code, 'GUEST');
  const stats = await api('/users/me/stats', { token: guest.token });
  assert.equal(stats.status, 403);
  assert.equal(stats.data.error.code, 'GUEST');
});

await test('a fresh account has an empty record', async () => {
  const { status, data } = await api('/users/me/stats', { token: ada });
  assert.equal(status, 200);
  assert.equal(data.stats.gamesPlayed, 0);
  assert.equal(data.stats.bestScore, 0);
  assert.equal(data.stats.lastPlayedAt, null);
  assert.deepEqual((await api('/games/history', { token: ada })).data.games, []);
});

await test('finishing a game writes one history row and bumps the stats', async () => {
  const { status, data } = await api('/games/finish', { method: 'POST', token: ada, body: game() });
  assert.equal(status, 201);
  assert.equal(data.game.score, 3200);
  assert.equal(data.game.mode, 'single');
  assert.deepEqual(data.game.categories, game().categories);
  assert.ok(data.game.playedAt);

  const { data: history } = await api('/games/history', { token: ada });
  assert.equal(history.games.length, 1);
  assert.equal(history.games[0].id, data.game.id);

  const { data: stats } = await api('/users/me/stats', { token: ada });
  assert.equal(stats.stats.gamesPlayed, 1);
  assert.equal(stats.stats.bestScore, 3200);
  assert.equal(stats.stats.totalScore, 3200);
  assert.equal(stats.stats.correct, 8);
  assert.equal(stats.stats.total, 10);
  assert.equal(stats.stats.accuracy, 80);
  assert.ok(stats.stats.lastPlayedAt, 'last_played_at is written');
});

await test('best score only rises', async () => {
  await api('/games/finish', { method: 'POST', token: ada, body: game({ score: 1000, correct: 3, total: 6 }) });
  let { data } = await api('/users/me/stats', { token: ada });
  assert.equal(data.stats.gamesPlayed, 2);
  assert.equal(data.stats.bestScore, 3200, 'a worse game does not lower the best');
  assert.equal(data.stats.totalScore, 4200);
  assert.equal(data.stats.correct, 11);
  assert.equal(data.stats.total, 16);

  await api('/games/finish', { method: 'POST', token: ada, body: game({ score: 5000, correct: 10, total: 10 }) });
  ({ data } = await api('/users/me/stats', { token: ada }));
  assert.equal(data.stats.bestScore, 5000, 'a better game raises it');
  assert.equal(data.stats.gamesPlayed, 3);
});

await test('history is newest first', async () => {
  const { data } = await api('/games/history', { token: ada });
  assert.deepEqual(data.games.map((g) => g.score), [5000, 1000, 3200]);
});

await test('history is per user', async () => {
  const { data } = await api('/games/history', { token: bob });
  assert.deepEqual(data.games, [], 'bob has played nothing');
  await api('/games/finish', { method: 'POST', token: bob, body: game({ score: 200, correct: 1, total: 1 }) });
  const mine = (await api('/games/history', { token: bob })).data.games;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].score, 200);
  const hers = (await api('/games/history', { token: ada })).data.games;
  assert.equal(hers.length, 3, "bob's game is not in ada's list");
  assert.equal((await api('/users/me/stats', { token: bob })).data.stats.gamesPlayed, 1);
});

await test('the limit is honoured and capped', async () => {
  assert.equal((await api('/games/history?limit=2', { token: ada })).data.games.length, 2);
  assert.equal((await api('/games/history?limit=0', { token: ada })).data.games.length, 3, 'nonsense falls back to the default');
  assert.equal((await api('/games/history?limit=100000', { token: ada })).data.games.length, 3);
});

await test('a board slug is kept with the game', async () => {
  const { data } = await api('/games/finish', {
    method: 'POST', token: bob, body: game({ boardSlug: 'abc123abc123', genre: 'Ada’s board' }),
  });
  assert.equal(data.game.boardSlug, 'abc123abc123');
});

await test('a bad game is refused with a sentence and writes nothing', async () => {
  const before = (await api('/users/me/stats', { token: bob })).data.stats.gamesPlayed;
  const { status, data } = await api('/games/finish', {
    method: 'POST', token: bob, body: game({ correct: 12, total: 10 }),
  });
  assert.equal(status, 400);
  assert.equal(data.error.code, 'INVALID_GAME');
  assert.match(data.error.message, /exceed/);
  assert.equal((await api('/users/me/stats', { token: bob })).data.stats.gamesPlayed, before);
});

await test('a room game cannot be posted by a client', async () => {
  const { status, data } = await api('/games/finish', {
    method: 'POST', token: bob, body: game({ mode: 'multiplayer' }),
  });
  assert.equal(status, 400);
  assert.equal(data.error.code, 'WRONG_MODE');
});

await test('the old per-id stats route still answers', async () => {
  const { data: me } = await api('/auth/me', { token: ada });
  const { status, data } = await api(`/users/${me.user.id}/stats`, { token: ada });
  assert.equal(status, 200);
  assert.equal(data.gamesPlayed, 3);
  assert.equal(data.highestScore, 5000);
});

server.kill();

// ============================================================ the room path

process.env.DATABASE_PATH = UNIT_DB;
const { initializeDatabase, closeDatabase } = await import('../config/database.js');
const { recordRoomGame } = await import('../services/gameHistory.js');
const db = await initializeDatabase();

for (const id of ['u-ada', 'u-bob', 'u-host']) {
  db.prepare('INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)').run(id, id, id);
  db.prepare('INSERT INTO user_stats (user_id) VALUES (?)').run(id);
}

const player = (id, over = {}) => ({
  id, displayName: id, score: 0, correct: 0, answered: 0, userId: null, isHost: false, ...over,
});

/* `persisted` writes the rooms row the way the HTTP route does. A socket room
   usually has none, and the archive must cope with both. */
function mkRoom(type, players, { hostId, persisted = false } = {}) {
  const id = `room-${type}-${Math.random().toString(36).slice(2, 8)}`;
  if (persisted) {
    db.prepare("INSERT INTO rooms (id, code, type, status) VALUES (?, ?, ?, 'completed')")
      .run(id, id.slice(-4).toUpperCase(), type === 'quickplay' ? 'quickplay' : type);
  }
  return {
    id,
    code: 'ABCD',
    type,
    hostId: hostId ?? players[0].id,
    players: new Map(players.map((p) => [p.id, p])),
    gameState: { categories: ['A', 'B', 'C', 'D', 'E', 'F'] },
  };
}

const rowsFor = (userId) =>
  db.prepare('SELECT * FROM game_history WHERE user_id = ? ORDER BY played_at DESC').all(userId);
const statsFor = (userId) =>
  statsRow(db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId));

await test('a multiplayer room writes a row for each signed-in player and none for a visitor', () => {
  const room = mkRoom('multiplayer', [
    player('s1', { userId: 'u-ada', score: 2400, correct: 4, answered: 5 }),
    player('s2', { userId: 'u-bob', score: 800, correct: 2, answered: 4 }),
    player('s3', { score: 9000 }), // signed out, and winning
  ], { persisted: true });
  const written = recordRoomGame(db, room);
  assert.equal(written.length, 2);

  const ada = rowsFor('u-ada');
  assert.equal(ada.length, 1);
  assert.equal(ada[0].mode, 'multiplayer');
  assert.equal(ada[0].score, 2400);
  assert.equal(ada[0].correct, 4);
  assert.equal(ada[0].total, 5);
  assert.equal(ada[0].room_id, room.id);
  assert.deepEqual(JSON.parse(ada[0].categories), ['A', 'B', 'C', 'D', 'E', 'F']);
  const standings = JSON.parse(ada[0].final_scores);
  assert.deepEqual(standings.map((s) => s.score), [9000, 2400, 800]);
  assert.equal(ada[0].winner_id, null, 'the winner had no account to name');

  assert.equal(rowsFor('u-bob').length, 1);
  assert.equal(statsFor('u-ada').gamesPlayed, 1);
  assert.equal(statsFor('u-ada').gamesWon, 0, 'ada did not finish on top');
  assert.equal(statsFor('u-bob').bestScore, 800);
});

await test('the same room is never written twice', () => {
  const room = mkRoom('quickplay', [
    player('s1', { userId: 'u-ada', score: 100, correct: 1, answered: 1 }),
  ]);
  assert.equal(recordRoomGame(db, room).length, 1);
  assert.equal(recordRoomGame(db, room).length, 0);
  assert.equal(rowsFor('u-ada').length, 2);
  assert.equal(statsFor('u-ada').gamesPlayed, 2);
});

await test('a room that was never written to the rooms table is still archived', () => {
  const room = mkRoom('quickplay', [
    player('s1', { userId: 'u-bob', score: 300, correct: 1, answered: 1 }),
  ]);
  assert.equal(recordRoomGame(db, room).length, 1);
  const row = rowsFor('u-bob').find((r) => r.score === 300);
  assert.ok(row);
  assert.equal(row.room_id, null, 'no row to point at, so no pointer');
});

await test('the host of a hosted room is not a player and gets no row', () => {
  const wonBefore = statsFor('u-bob').gamesWon;
  const room = mkRoom('host', [
    player('h', { userId: 'u-host', isHost: true }),
    player('s1', { userId: 'u-bob', score: 1200, correct: 3, answered: 3 }),
    player('s2', { userId: 'u-ada', score: 1200, correct: 2, answered: 3 }),
  ], { hostId: 'h', persisted: true });
  const written = recordRoomGame(db, room);
  assert.deepEqual(written.map((w) => w.userId).sort(), ['u-ada', 'u-bob']);
  assert.equal(rowsFor('u-host').length, 0);
  assert.equal(statsFor('u-host').gamesPlayed, 0);
  // Tied on top: a draw is not a loss for either of them.
  assert.equal(statsFor('u-bob').gamesWon, wonBefore + 1);
  const bobRow = rowsFor('u-bob').find((r) => r.room_id === room.id);
  assert.equal(bobRow.mode, 'host');
  assert.equal(bobRow.winner_id, 'u-bob', 'the first on top with an account');
});

await test('in a multiplayer room the host is a player like anyone else', () => {
  const room = mkRoom('multiplayer', [
    player('h', { userId: 'u-host', isHost: true, score: 400, correct: 1, answered: 2 }),
    player('s1', { userId: 'u-bob', score: 200, correct: 1, answered: 1 }),
  ], { hostId: 'h' });
  recordRoomGame(db, room);
  assert.equal(rowsFor('u-host').length, 1);
  assert.equal(statsFor('u-host').gamesWon, 1);
});

await test('best score still only rises through the room path', () => {
  const before = statsFor('u-bob').bestScore;
  recordRoomGame(db, mkRoom('quickplay', [player('s1', { userId: 'u-bob', score: -500, answered: 2 })]));
  assert.equal(statsFor('u-bob').bestScore, before);
  assert.equal(rowsFor('u-bob').at(-1).score, -500, 'the loss is still on the record');
});

closeDatabase();

// ============================================================ report

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  console.error(`\nserver output:\n${serverLog}`);
  process.exit(1);
}
