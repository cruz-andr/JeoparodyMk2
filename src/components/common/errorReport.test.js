/**
 * What the error screens say, and what they never say.
 * Run with: node src/components/common/errorReport.test.js
 *
 * No framework, so it runs anywhere with zero install.
 */
import assert from 'node:assert/strict';
import {
  VISITOR_COPY,
  FORBIDDEN_WORDS,
  isVisitorSafe,
  describeError,
  reportError,
} from './errorReport.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (err) { failures.push({ name, err }); }
}

test('every line of visitor copy is fit for a visitor', () => {
  for (const [key, { title, body }] of Object.entries(VISITOR_COPY)) {
    assert.ok(isVisitorSafe(title), `${key} title`);
    assert.ok(isVisitorSafe(body), `${key} body`);
    assert.ok(!title.includes('—') && !body.includes('—'), `${key}: no em dashes`);
  }
});

test('the titles are the ones on the ticket', () => {
  assert.equal(VISITOR_COPY.notFound.title.toUpperCase(), 'NOTHING HERE');
  assert.equal(VISITOR_COPY.broke.title.toUpperCase(), 'SOMETHING BROKE');
});

test('isVisitorSafe catches the words in any case', () => {
  assert.equal(isVisitorSafe('Hey Developer'), false);
  assert.equal(isVisitorSafe('Unexpected Application Error'), false);
  assert.equal(isVisitorSafe('caught by ErrorBoundary'), false);
  assert.equal(isVisitorSafe('see the stack trace below'), false);
  assert.equal(isVisitorSafe('Back to the menu'), true);
  assert.equal(isVisitorSafe(null), true);
  assert.ok(FORBIDDEN_WORDS.includes('developer'));
});

test('describeError reads an Error', () => {
  const err = new TypeError('x is not a function');
  const r = describeError(err, { componentStack: '\n  at GameBoard' });
  assert.equal(r.name, 'TypeError');
  assert.equal(r.message, 'x is not a function');
  assert.ok(r.stack && r.stack.includes('x is not a function'));
  assert.equal(r.componentStack, '\n  at GameBoard');
  assert.equal(r.status, null);
});

test('describeError reads a route error response', () => {
  const r = describeError({ status: 404, statusText: 'Not Found', data: 'Error: No route matches URL "/nope"' });
  assert.equal(r.status, 404);
  assert.equal(r.message, 'Error: No route matches URL "/nope"');
  assert.equal(r.stack, null);
});

test('describeError survives strings, undefined and null', () => {
  assert.equal(describeError('boom').message, 'boom');
  assert.equal(describeError(undefined).message, '');
  assert.equal(describeError(null).message, '');
  assert.equal(describeError(null).name, 'Error');
});

test('reportError logs and calls the hook with the same report', () => {
  const logged = [];
  const sent = [];
  const err = new Error('nope');
  const report = reportError(err, { componentStack: 's' }, {
    log: (...a) => logged.push(a),
    hook: (...a) => sent.push(a),
  });
  assert.equal(logged.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(logged[0][0], err);
  assert.equal(sent[0][0], err);
  assert.deepEqual(sent[0][1], report);
  assert.equal(report.componentStack, 's');
});

test('a reporter that throws does not take the screen down with it', () => {
  const logged = [];
  assert.doesNotThrow(() => reportError(new Error('a'), {}, {
    log: (...a) => logged.push(a),
    hook: () => { throw new Error('reporter is broken'); },
  }));
  assert.equal(logged.length, 1);
});

test('with no hook at all nothing is sent and nothing throws', () => {
  const logged = [];
  const report = reportError('plain string', undefined, { log: (...a) => logged.push(a), hook: null });
  assert.equal(report.message, 'plain string');
  assert.equal(logged.length, 1);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
