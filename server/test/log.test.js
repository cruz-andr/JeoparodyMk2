/**
 * The log formatter: one JSON line per event.
 * Run with: node server/test/log.test.js
 *
 * Fly reads stdout a line at a time, so the whole contract is that `format`
 * returns exactly one line that JSON.parse can read back, with level and time
 * always present and an Error folded into {err, stack}.
 */
import assert from 'node:assert/strict';
import { format, info, warn, error, fatal } from '../utils/log.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

const parse = (line) => JSON.parse(line);

// ------------------------------------------------------------------ shape

test('a line is a single JSON object with level and time', () => {
  const line = format('info', 'hello');
  assert.equal(line.includes('\n'), false);
  const entry = parse(line);
  assert.equal(entry.level, 'info');
  assert.equal(entry.msg, 'hello');
  assert.equal(typeof entry.time, 'string');
  assert.ok(!Number.isNaN(Date.parse(entry.time)), 'time is an ISO timestamp');
});

test('level comes first so a human can scan the line', () => {
  assert.ok(format('warn', 'x').startsWith('{"level":"warn"'));
});

test('an unknown level falls back to info rather than throwing', () => {
  assert.equal(parse(format('shout', 'x')).level, 'info');
});

test('fields are spread onto the entry', () => {
  const entry = parse(format('info', { msg: 'Socket connected', socketId: 'abc', userId: 'anonymous' }));
  assert.equal(entry.msg, 'Socket connected');
  assert.equal(entry.socketId, 'abc');
  assert.equal(entry.userId, 'anonymous');
});

test('a message and fields can be given in either order', () => {
  const a = parse(format('info', 'Room created', { code: 'ABCD' }));
  const b = parse(format('info', { code: 'ABCD' }, 'Room created'));
  assert.equal(a.msg, 'Room created');
  assert.equal(a.code, 'ABCD');
  assert.equal(b.msg, 'Room created');
  assert.equal(b.code, 'ABCD');
});

test('two strings join into one msg', () => {
  assert.equal(parse(format('info', 'Failed to', 'start')).msg, 'Failed to start');
});

test('null and undefined parts are skipped', () => {
  const entry = parse(format('info', undefined, { a: 1 }, null));
  assert.deepEqual(Object.keys(entry).sort(), ['a', 'level', 'time']);
});

test('a caller cannot overwrite level or time through a fields object', () => {
  const entry = parse(format('info', { msg: 'x', level: 'debug', time: 'yesterday', ok: true }));
  assert.equal(entry.level, 'info');
  assert.ok(!Number.isNaN(Date.parse(entry.time)), 'time is still the real timestamp');
  assert.equal(entry.time !== 'yesterday', true);
  assert.equal(entry.ok, true);
  assert.equal(entry.msg, 'x');
});

test('an array is one data field, not a spread of numeric keys', () => {
  const entry = parse(format('info', 'rooms', ['ABCD', 'EFGH']));
  assert.deepEqual(entry.data, ['ABCD', 'EFGH']);
  assert.equal('0' in entry, false);
  assert.equal(entry.msg, 'rooms');
});

// ----------------------------------------------------------------- errors

test('an Error becomes err and stack, not a multi-line dump', () => {
  const boom = new Error('boom');
  const line = format('fatal', boom);
  assert.equal(line.includes('\n'), false, 'the stack is escaped inside the JSON string');
  const entry = parse(line);
  assert.equal(entry.level, 'fatal');
  assert.equal(entry.err, 'boom');
  assert.ok(entry.stack.startsWith('Error: boom'));
});

test('an Error carrying a code exposes it', () => {
  const e = new Error('nope');
  e.code = 'ECONNREFUSED';
  assert.equal(parse(format('error', e)).code, 'ECONNREFUSED');
});

test('an Error nested in a field is still serialised', () => {
  const entry = parse(format('error', { cause: new Error('inner') }));
  assert.equal(entry.cause.err, 'inner');
  assert.ok(entry.cause.stack);
});

test('the fatal shape the crash handlers emit has err and stack at top level', () => {
  // server/index.js writes exactly {level:'fatal', msg, err, stack}.
  const boom = new Error('kaboom');
  const entry = parse(format('fatal', { msg: 'uncaughtException', err: boom.message, stack: boom.stack }));
  assert.equal(entry.level, 'fatal');
  assert.equal(entry.err, 'kaboom');
  assert.ok(entry.stack.includes('kaboom'));
});

// -------------------------------------------------------------- transport

function capture(stream, fn) {
  const written = [];
  const original = stream.write;
  stream.write = (chunk) => { written.push(String(chunk)); return true; };
  try { fn(); } finally { stream.write = original; }
  return written;
}

test('info and warn go to stdout, one line each, newline terminated', () => {
  const out = capture(process.stdout, () => { info('a'); warn('b'); });
  assert.equal(out.length, 2);
  assert.ok(out.every((l) => l.endsWith('\n')));
  assert.equal(parse(out[0]).level, 'info');
  assert.equal(parse(out[1]).level, 'warn');
});

test('error and fatal go to stderr', () => {
  const out = capture(process.stderr, () => { error('a'); fatal(new Error('b')); });
  assert.equal(out.length, 2);
  assert.equal(parse(out[0]).level, 'error');
  assert.equal(parse(out[1]).level, 'fatal');
  assert.equal(parse(out[1]).err, 'b');
});

test('a circular field does not throw out of the logger', () => {
  const loop = { name: 'loop' };
  loop.self = loop;
  const out = capture(process.stdout, () => info({ loop }));
  assert.equal(out.length, 1);
  const entry = parse(out[0]);
  assert.equal(entry.level, 'info');
  assert.equal(entry.msg, 'unserialisable log entry');
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
