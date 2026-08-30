/**
 * Verification harness for the two settings that decide whether accounts
 * survive and whether their tokens mean anything.
 * Run with: node server/test/config.test.js
 */
import assert from 'node:assert/strict';
import { resolveDatabasePath } from '../config/database.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (err) { failures.push({ name, err }); }
}

const DEV = '/repo/server/db/jeopardy.sqlite';

test('in production the database lands on the mounted volume', () => {
  // The bug this guards: the code read DATABASE_PATH, the Dockerfile set
  // DATABASE_URL, so neither matched and it fell back inside the container
  // image. The volume sat empty and every deploy destroyed every account.
  assert.equal(resolveDatabasePath({ NODE_ENV: 'production' }, DEV), '/data/jeopardy.sqlite');
});

test('the name the Dockerfile actually sets is honoured', () => {
  assert.equal(
    resolveDatabasePath({ NODE_ENV: 'production', DATABASE_URL: 'file:///data/sqlite.db' }, DEV),
    '/data/sqlite.db'
  );
});

test('a plain path in DATABASE_URL works too', () => {
  assert.equal(
    resolveDatabasePath({ NODE_ENV: 'production', DATABASE_URL: '/data/plain.sqlite' }, DEV),
    '/data/plain.sqlite'
  );
});

test('DATABASE_PATH still wins when set', () => {
  assert.equal(
    resolveDatabasePath(
      { NODE_ENV: 'production', DATABASE_PATH: '/data/custom.sqlite', DATABASE_URL: 'file:///data/other.sqlite' },
      DEV
    ),
    '/data/custom.sqlite'
  );
});

test('no production configuration can put the database inside the image', () => {
  const envs = [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', DATABASE_URL: 'file:///data/sqlite.db' },
    { NODE_ENV: 'production', DATABASE_PATH: '/data/custom.sqlite' },
  ];
  for (const env of envs) {
    assert.ok(
      resolveDatabasePath(env, DEV).startsWith('/data/'),
      `${JSON.stringify(env)} resolved off the volume`
    );
  }
});

test('development still uses the repo copy', () => {
  assert.equal(resolveDatabasePath({}, DEV), DEV);
});

test('a relative DATABASE_URL is ignored rather than half-honoured', () => {
  // "db/thing.sqlite" is not a location we can trust; fall through instead.
  assert.equal(
    resolveDatabasePath({ NODE_ENV: 'production', DATABASE_URL: 'db/thing.sqlite' }, DEV),
    '/data/jeopardy.sqlite'
  );
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
