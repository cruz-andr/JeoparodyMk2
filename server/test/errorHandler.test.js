/**
 * What a client sees when a request fails.
 * Run with: node server/test/errorHandler.test.js
 *
 * The bug this guards: a thrown error's message went to the client as-is in
 * every environment, and the stack went too whenever NODE_ENV happened to be
 * "development". A SQLite error names the table and the query; that is not a
 * thing to hand to a browser in production.
 */
import assert from 'node:assert/strict';
import { shapeError, errorHandler, AppError, isProduction } from '../middleware/errorHandler.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

const PROD = { NODE_ENV: 'production' };
const DEV = { NODE_ENV: 'development' };

/** A fake Express response that records what was sent. */
function fakeRes() {
  const res = { statusCode: null, body: null, headersSent: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function captureStderr(fn) {
  const lines = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { fn(); } finally { process.stderr.write = original; }
  return lines;
}

function captureStdout(fn) {
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { fn(); } finally { process.stdout.write = original; }
  return lines;
}

// ------------------------------------------------------------- environment

test('anything that is not development or test counts as production', () => {
  assert.equal(isProduction({}), true);
  assert.equal(isProduction({ NODE_ENV: 'production' }), true);
  assert.equal(isProduction({ NODE_ENV: 'staging' }), true);
  assert.equal(isProduction(DEV), false);
  assert.equal(isProduction({ NODE_ENV: 'test' }), false);
});

// ----------------------------------------------------------- 5xx, production

test('a 500 in production returns a generic message', () => {
  const err = new Error('SQLITE_ERROR: no such table: users');
  const { statusCode, body } = shapeError(err, PROD);
  assert.equal(statusCode, 500);
  assert.equal(body.error.message, 'Something went wrong on our side. Please try again.');
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(body).includes('SQLITE'), false, 'the internal message must not leak');
});

test('a 500 in production carries no stack', () => {
  const { body } = shapeError(new Error('boom'), PROD);
  assert.equal('stack' in body.error, false);
  assert.equal(JSON.stringify(body).includes('errorHandler.test'), false);
});

test('an unset NODE_ENV is treated like production for a 500', () => {
  const { body } = shapeError(new Error('boom'), {});
  assert.equal(body.error.message, 'Something went wrong on our side. Please try again.');
  assert.equal('stack' in body.error, false);
});

test('a 5xx AppError in production still hides its message and code', () => {
  const err = new AppError('Model quota exceeded for key abc123', 503, 'UPSTREAM_DOWN');
  const { statusCode, body } = shapeError(err, PROD);
  assert.equal(statusCode, 503);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message.includes('abc123'), false);
});

test('details on a 5xx are dropped in production', () => {
  const err = new AppError('boom', 500);
  err.details = { query: 'SELECT * FROM users' };
  const { body } = shapeError(err, PROD);
  assert.equal('details' in body.error, false);
});

test('a non-Error thrown value still yields a safe 500', () => {
  const { statusCode, body } = shapeError('a string was thrown', PROD);
  assert.equal(statusCode, 500);
  assert.equal(body.error.message, 'Something went wrong on our side. Please try again.');
  const nothing = shapeError(undefined, PROD);
  assert.equal(nothing.statusCode, 500);
});

// ---------------------------------------------------------- 4xx, production

test('a 4xx AppError keeps its message, code and details in production', () => {
  const err = new AppError('That board changed while you were editing', 409, 'STALE_BOARD');
  err.details = { board: { id: 7 } };
  const { statusCode, body } = shapeError(err, PROD);
  assert.equal(statusCode, 409);
  assert.equal(body.error.message, 'That board changed while you were editing');
  assert.equal(body.error.code, 'STALE_BOARD');
  assert.deepEqual(body.error.details, { board: { id: 7 } });
  assert.equal('stack' in body.error, false);
});

test('a bogus statusCode falls back to 500', () => {
  const err = new Error('x');
  err.statusCode = 'nope';
  assert.equal(shapeError(err, PROD).statusCode, 500);
  err.statusCode = 200;
  assert.equal(shapeError(err, PROD).statusCode, 500);
});

// ------------------------------------------------------------- development

test('in development the real message and stack of a 500 come through', () => {
  const err = new Error('SQLITE_ERROR: no such table: users');
  const { body } = shapeError(err, DEV);
  assert.equal(body.error.message, 'SQLITE_ERROR: no such table: users');
  assert.ok(body.error.stack.includes('SQLITE_ERROR'));
});

test('a 4xx never carries a stack, even in development', () => {
  // Two refusals that must be indistinguishable (wrong password, unknown
  // email) were told apart by the line number in their stacks.
  const a = shapeError(new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS'), DEV);
  const b = shapeError(new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS'), DEV);
  assert.equal('stack' in a.body.error, false);
  assert.deepEqual(a.body, b.body);
});

// ------------------------------------------------------- the middleware

test('the middleware sends the shaped body and logs one JSON line for a 5xx', () => {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = fakeRes();
    const err = new Error('disk full');
    let nextCalled = false;
    const lines = captureStderr(() => {
      errorHandler(err, { method: 'POST', originalUrl: '/api/boards/3' }, res, () => { nextCalled = true; });
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.message, 'Something went wrong on our side. Please try again.');
    assert.equal('stack' in res.body.error, false);

    assert.equal(lines.length, 1, 'exactly one line');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.level, 'error');
    assert.equal(entry.status, 500);
    assert.equal(entry.code, 'INTERNAL_ERROR');
    assert.equal(entry.path, '/api/boards/3');
    assert.equal(entry.method, 'POST');
    assert.equal(entry.msg, 'disk full');
    assert.ok(entry.stack.includes('disk full'), 'the stack goes to the log, not the client');
  } finally {
    process.env.NODE_ENV = saved;
  }
});

test('a 4xx is logged as a warning on stdout and never on stderr', () => {
  const res = fakeRes();
  const err = new AppError('Bad code', 400, 'INVALID_INPUT');
  let errLines;
  const outLines = captureStdout(() => {
    errLines = captureStderr(() => errorHandler(err, { method: 'GET', url: '/api/rooms/x' }, res, () => {}));
  });
  assert.equal(errLines.length, 0);
  assert.equal(outLines.length, 1);
  const entry = JSON.parse(outLines[0]);
  assert.equal(entry.level, 'warn');
  assert.equal(entry.status, 400);
  assert.equal(entry.path, '/api/rooms/x');
  assert.equal(res.statusCode, 400);
});

test('a 404 is not logged at all', () => {
  const res = fakeRes();
  const outLines = captureStdout(() => {
    captureStderr(() => errorHandler(new AppError('Not found', 404, 'NOT_FOUND'), { method: 'GET', url: '/x' }, res, () => {}));
  });
  assert.equal(outLines.length, 0);
  assert.equal(res.statusCode, 404);
});

test('once headers are sent the error is passed on rather than written twice', () => {
  const res = fakeRes();
  res.headersSent = true;
  let passedOn = null;
  const err = new Error('late');
  captureStderr(() => errorHandler(err, { method: 'GET', url: '/x' }, res, (e) => { passedOn = e; }));
  assert.equal(passedOn, err);
  assert.equal(res.statusCode, null);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
