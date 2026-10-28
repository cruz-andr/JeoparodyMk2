/**
 * How everyone did on the Sixer: recording a finished run, and the day's
 * spread of scores.
 * Run with: node server/test/sixerResults.test.js
 *
 * The pure parts and the queries run against an in-memory database; the
 * routes run against a real server on a throwaway one.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

import {
  SIXER_RESULTS_SQL, validateSixerResult, scoreFor, recordSixerResult, sixerStats,
  DEFAULT_ROW_RATES, PRIOR_PLAYERS, CONFIDENT_PLAYERS, estimateDay, learnedRowRates,
} from '../services/sixerResults.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

const TODAY = '2026-10-28'; // a Wednesday: rows 1, 2, 2, 3, 4, 4
const WEDNESDAY = [400, 800, 800, 1200, 1600, 1600];
const player = (n) => `player-${String(n).padStart(12, '0')}`;
const result = (over = {}) => ({ date: TODAY, player: player(1), marks: 'chwpcc', values: WEDNESDAY, ...over });

// ============================================================ validation

await test('a finished run is accepted, and scored by the server', async () => {
  const { entry, error } = validateSixerResult(result(), { today: TODAY });
  assert.equal(error, undefined);
  assert.equal(entry.score, 400 + 400 + 0 + 0 + 1600 + 1600);
  assert.equal(entry.marks, 'chwpcc');
});

await test('the score is the server\'s: right pays the value, the hint half, the rest nothing', async () => {
  assert.equal(scoreFor('cccccc', WEDNESDAY), 6400);
  assert.equal(scoreFor('hhhhhh', WEDNESDAY), 3200);
  assert.equal(scoreFor('wwwppp', WEDNESDAY), 0);
});

await test('a value above the day\'s climb is refused, so a score cannot be inflated', async () => {
  const { error } = validateSixerResult(result({ values: [2000, 2000, 2000, 2000, 2000, 2000] }), { today: TODAY });
  assert.ok(error);
  const odd = validateSixerResult(result({ values: [400, 800, 800, 1200, 1600, 1700] }), { today: TODAY });
  assert.ok(odd.error, 'not a row value at all');
});

await test('a value below its row is fine: a short category gives up a lower clue', async () => {
  const { error } = validateSixerResult(result({ values: [400, 800, 800, 800, 1600, 1600] }), { today: TODAY });
  assert.equal(error, undefined);
});

await test('only today\'s run counts, or yesterday\'s finished after midnight', async () => {
  assert.equal(validateSixerResult(result({ date: '2026-10-27', values: [400, 400, 800, 1200, 1200, 1600] }), { today: TODAY }).error, undefined);
  assert.ok(validateSixerResult(result({ date: '2026-10-20' }), { today: TODAY }).error, 'an archive day');
  assert.ok(validateSixerResult(result({ date: '2026-10-29' }), { today: TODAY }).error, 'tomorrow');
  assert.ok(validateSixerResult(result({ date: 'yesterday' }), { today: TODAY }).error);
});

await test('marks and a player are what they should be', async () => {
  assert.ok(validateSixerResult(result({ marks: 'ccccc' }), { today: TODAY }).error, 'five clues');
  assert.ok(validateSixerResult(result({ marks: 'ccccxx' }), { today: TODAY }).error, 'not a mark');
  assert.ok(validateSixerResult(result({ player: 'short' }), { today: TODAY }).error);
  assert.ok(validateSixerResult(result({ player: undefined }), { today: TODAY }).error);
  assert.ok(validateSixerResult(null, { today: TODAY }).error);
});

// ============================================================ the day's spread

const memory = () => {
  const db = new Database(':memory:');
  db.exec(SIXER_RESULTS_SQL);
  return db;
};
const record = (db, n, marks) => recordSixerResult(db, validateSixerResult(result({ player: player(n), marks }), { today: TODAY }).entry);

const total = (scores) => scores.reduce((n, s) => n + s.count, 0);

await test('one result per player per day: a second is ignored, not counted again', async () => {
  const db = memory();
  assert.equal(record(db, 1, 'cccccc').recorded, true);
  assert.equal(record(db, 1, 'wwwwww').recorded, false);
  assert.equal(sixerStats(db, TODAY).players, 1);
});

await test('a day nobody has played yet is the estimate alone, from how hard its clues are', async () => {
  const stats = sixerStats(memory(), TODAY);
  assert.equal(stats.players, 0);
  assert.equal(stats.estimated, true);
  assert.ok(Math.abs(total(stats.scores) - PRIOR_PLAYERS) < 1e-9, 'the estimate stands in for PRIOR_PLAYERS players');
  assert.ok(stats.average > 0 && stats.average < 6400, `average ${stats.average}`);
  // The first clue is the easiest row and the last the hardest, so more get the first.
  assert.ok(stats.clues[0].share > stats.clues[5].share);
});

await test('the estimate is a whole spread: every score the six can pay, and nothing else', async () => {
  const day = estimateDay(WEDNESDAY, [1, 2, 2, 3, 4, 4], DEFAULT_ROW_RATES);
  const sum = day.scores.reduce((n, s) => n + s.p, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(day.scores.every((s) => s.score % 200 === 0 && s.score >= 0 && s.score <= 6400));
  assert.ok(day.scores.some((s) => s.score === 6400), 'a perfect day is possible');
  assert.ok(day.scores.some((s) => s.score === 0), 'and so is a blank one');
});

await test('real players take over as they come in', async () => {
  const db = memory();
  const before = sixerStats(db, TODAY).average;
  for (let n = 1; n <= 60; n += 1) record(db, n, 'cccccc'); // everybody perfect
  const after = sixerStats(db, TODAY);
  assert.equal(after.players, 60);
  assert.equal(after.estimated, after.players < CONFIDENT_PLAYERS);
  assert.ok(Math.abs(total(after.scores) - (PRIOR_PLAYERS + 60)) < 1e-9);
  const share = 60 / (60 + PRIOR_PLAYERS);
  assert.ok(Math.abs(after.average - (share * 6400 + (1 - share) * before)) < 1e-6, 'a weighted blend');
  assert.ok(after.clues[5].share > 0.6, 'the hardest clue now reads as one most people got');
});

await test('the rates learn from every day played, and lean on the defaults until they have seen enough', async () => {
  const db = memory();
  assert.deepEqual(learnedRowRates(db), DEFAULT_ROW_RATES, 'nothing seen yet');
  for (let n = 1; n <= 200; n += 1) record(db, n, 'cccccc');
  const learned = learnedRowRates(db);
  for (const row of [1, 2, 3, 4]) {
    assert.ok(learned[row].right > DEFAULT_ROW_RATES[row].right, `row ${row} learned it is easier than guessed`);
  }
  assert.ok(learned[4].right < 1, 'still a blend, not the raw count');
});

await test('each clue\'s real counts are still there beside the blend', async () => {
  const db = memory();
  record(db, 1, 'chwwww');
  record(db, 2, 'chwwww');
  const stats = sixerStats(db, TODAY);
  assert.deepEqual({ right: stats.clues[0].right, hinted: stats.clues[0].hinted }, { right: 2, hinted: 0 });
  assert.deepEqual({ right: stats.clues[1].right, hinted: stats.clues[1].hinted }, { right: 0, hinted: 2 });
  assert.equal(sixerStats(db, '2026-10-01').players, 0, 'another day is its own');
});

// ============================================================ over HTTP

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 3992;
const DB = join(here, 'tmp-sixer.sqlite');
for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(`${DB}${suffix}`); } catch { /* not there */ } }
const server = spawn('node', [join(here, '..', 'index.js')], {
  env: { ...process.env, SERVER_PORT: String(PORT), DATABASE_PATH: DB, JWT_SECRET: 'test-secret-not-a-real-one', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const base = `http://127.0.0.1:${PORT}/api/daily/sixer`;
const today = new Date().toISOString().split('T')[0];
const valuesToday = async () => {
  const { sixerRows, DOUBLE_ROW_VALUES } = await import('../services/dailyBuilder.js');
  return sixerRows(today).map((row) => DOUBLE_ROW_VALUES[row - 1]);
};

try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100));
  }

  await test('posting a finished run records it and hands back the day\'s spread', async () => {
    const values = await valuesToday();
    const res = await fetch(`${base}/result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today, player: player(7), marks: 'cchwpc', values }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.recorded, true);
    assert.equal(body.score, values[0] + values[1] + values[2] / 2 + values[5]);
    assert.equal(body.stats.players, 1);
    assert.equal(body.stats.estimated, true);
  });

  await test('a bad run is a 400, and the spread can be read on its own', async () => {
    const res = await fetch(`${base}/result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today, player: player(8), marks: 'cc' }),
    });
    assert.equal(res.status, 400);
    const stats = await (await fetch(`${base}/stats?date=${today}`)).json();
    assert.equal(stats.players, 1);
    assert.equal((await fetch(`${base}/stats?date=nope`)).status, 400);
  });
} finally {
  server.kill();
}

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (failures.length && serverLog) console.log(serverLog.slice(-2000));
process.exit(failures.length ? 1 : 0);
