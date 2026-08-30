/**
 * The account endpoints, over real HTTP against a real database.
 * Run with: node server/test/authRoutes.test.js
 *
 * Boots the actual server on a spare port with a throwaway SQLite file, so the
 * routing, the middleware, the migrations and the queries are all the ones that
 * run in production.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 3999;
const DB = join(here, 'tmp-auth.sqlite');
const base = `http://127.0.0.1:${PORT}`;

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
  try { fs.unlinkSync(f); } catch { /* not there */ }
}

const server = spawn('node', [join(here, '..', 'index.js')], {
  env: {
    ...process.env,
    SERVER_PORT: String(PORT),
    DATABASE_PATH: DB,
    JWT_SECRET: 'test-secret-not-a-real-one',
    NODE_ENV: 'test',
    CLIENT_URL: 'http://localhost:5000',
    SERVER_URL: base,
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

const api = (path, options = {}) =>
  fetch(base + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; } catch (err) { failures.push({ name, err }); }
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

if (!(await waitForServer())) {
  console.log('\nserver did not start\n');
  server.kill();
  process.exit(1);
}

let token = null;

await test('an account can be created', async () => {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'a@example.com', password: 'hunter22A', displayName: 'Ada' },
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.ok(body.token, 'a token comes back');
  assert.equal(body.user.email, 'a@example.com');
  token = body.token;
});

await test('the same email cannot be taken twice', async () => {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'a@example.com', password: 'hunter22A', displayName: 'Ada again' },
  });
  assert.equal(r.status, 409);
});

await test('signing in returns the same account', async () => {
  const r = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'a@example.com', password: 'hunter22A' },
  });
  const body = await r.json();
  assert.equal(r.status, 200, `login returned ${r.status}: ${JSON.stringify(body)}`);
  assert.equal(body.user.email, 'a@example.com');
});

await test('a wrong password and an unknown email fail identically', async () => {
  // Saying which was wrong tells a stranger whether an email has an account.
  const wrong = await api('/api/auth/login', {
    method: 'POST', body: { email: 'a@example.com', password: 'not-it' },
  });
  const missing = await api('/api/auth/login', {
    method: 'POST', body: { email: 'nobody@example.com', password: 'not-it' },
  });
  assert.equal(wrong.status, missing.status);
  assert.deepEqual(await wrong.json(), await missing.json());
});

await test('who am I needs a token', async () => {
  assert.equal((await api('/api/auth/me')).status, 401);
  assert.equal((await api('/api/auth/me', { token: 'nonsense' })).status, 403);
});

await test('who am I answers with the account', async () => {
  const r = await api('/api/auth/me', { token });
  assert.equal(r.status, 200);
  const { user } = await r.json();
  assert.equal(user.email, 'a@example.com');
  assert.equal(user.hasPassword, true);
  assert.equal(user.hasGoogle, false);
  assert.equal(user.signature, null);
});

await test('the account never hands back the password hash', async () => {
  const { user } = await (await api('/api/auth/me', { token })).json();
  assert.equal('password_hash' in user, false);
  assert.equal('passwordHash' in user, false);
});

await test('a drawn name can be saved and read back', async () => {
  const put = await api('/api/auth/signature', { method: 'PUT', token, body: { signature: PNG } });
  assert.equal(put.status, 200);
  const { user } = await (await api('/api/auth/me', { token })).json();
  assert.equal(user.signature, PNG);
});

await test('a drawn name can be cleared', async () => {
  assert.equal((await api('/api/auth/signature', { method: 'DELETE', token })).status, 200);
  const { user } = await (await api('/api/auth/me', { token })).json();
  assert.equal(user.signature, null);
});

await test('only a PNG data URL is accepted as a signature', async () => {
  for (const bad of ['hello', 'data:text/html,<script>', 'http://example.com/x.png', 42]) {
    const r = await api('/api/auth/signature', { method: 'PUT', token, body: { signature: bad } });
    assert.equal(r.status, 400, `${JSON.stringify(bad)} was accepted`);
  }
});

await test('an enormous drawing is refused rather than stored', async () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(300 * 1024);
  const r = await api('/api/auth/signature', { method: 'PUT', token, body: { signature: huge } });
  assert.equal(r.status, 413);
});

await test('one account cannot touch another', async () => {
  const other = await (await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'b@example.com', password: 'hunter22A', displayName: 'Bob' },
  })).json();
  await api('/api/auth/signature', { method: 'PUT', token: other.token, body: { signature: PNG } });

  const mine = await (await api('/api/auth/me', { token })).json();
  assert.equal(mine.user.signature, null, "Bob's drawing did not land on Ada");
  const theirs = await (await api('/api/auth/me', { token: other.token })).json();
  assert.equal(theirs.user.signature, PNG);
});

await test('Google says plainly when it is not configured', async () => {
  const status = await (await api('/api/auth/google/status')).json();
  assert.equal(status.configured, false);
  const start = await api('/api/auth/google');
  assert.equal(start.status, 503, 'it refuses rather than redirecting nowhere');
});

await test('a Google callback with no code sends you back, not into an error', async () => {
  const r = await api('/api/auth/google/callback');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/signin\?error=missing_code/);
});

await test('a forged state is rejected', async () => {
  const r = await api('/api/auth/google/callback?code=x&state=not-a-real-state');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/signin\?error=bad_state/);
});

await test('deleting the account really deletes it', async () => {
  assert.equal((await api('/api/auth/account', { method: 'DELETE', token })).status, 200);
  // the token is still valid, but there is nothing behind it any more
  assert.equal((await api('/api/auth/me', { token })).status, 404);
  const again = await api('/api/auth/login', {
    method: 'POST', body: { email: 'a@example.com', password: 'hunter22A' },
  });
  assert.equal(again.status, 401, 'the old password no longer signs anyone in');
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
server.kill();
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
  try { fs.unlinkSync(f); } catch { /* fine */ }
}
process.exit(failures.length ? 1 : 0);
