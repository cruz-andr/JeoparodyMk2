/**
 * Who may connect as which player.
 * Run with: node server/test/sessionClaims.test.js
 */
import assert from 'node:assert/strict';
import { createSessionClaims } from '../socket/sessionClaims.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push({ name, err }); }
}

const KEY_A = '3f0c9a52-6b1e-4d7a-9e0f-1a2b3c4d5e6f';
const KEY_B = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

test('the first connection with an id claims it, and the same key gets back in', () => {
  const claims = createSessionClaims();
  assert.equal(claims.admit('ada', KEY_A), 'ok');
  assert.equal(claims.admit('ada', KEY_A), 'ok');
});

test('someone who has only seen the id cannot connect as that player', () => {
  const claims = createSessionClaims();
  claims.admit('ada', KEY_A);
  assert.equal(claims.admit('ada', KEY_B), 'taken');
  assert.equal(claims.admit('ada', undefined), 'no-key');
});

test('an id already at a table cannot be claimed by a newcomer: a bot\'s, for one', () => {
  const claims = createSessionClaims();
  assert.equal(claims.admit('bot-1', KEY_B, { seated: true }), 'taken');
});

test('a key has to look like one', () => {
  const claims = createSessionClaims();
  assert.equal(claims.admit('ada', ''), 'no-key');
  assert.equal(claims.admit('ada', 'short'), 'no-key');
  assert.equal(claims.admit('ada', { key: KEY_A }), 'no-key');
});

test('an idle id away from any table is forgotten after a day; a seated one is kept', () => {
  let t = 0;
  const claims = createSessionClaims({ now: () => t });
  claims.admit('away', KEY_A);
  claims.admit('playing', KEY_A);
  t = 25 * 60 * 60 * 1000;
  claims.sweep((id) => id === 'playing');
  assert.equal(claims.size(), 1);
  assert.equal(claims.admit('away', KEY_B), 'ok', 'free to claim again');
  assert.equal(claims.admit('playing', KEY_B), 'taken');
});

test('a disconnect counts as being seen', () => {
  let t = 0;
  const claims = createSessionClaims({ now: () => t });
  claims.admit('ada', KEY_A);
  t = 23 * 60 * 60 * 1000;
  claims.touch('ada');
  t = 25 * 60 * 60 * 1000;
  claims.sweep(() => false);
  assert.equal(claims.admit('ada', KEY_B), 'taken', 'seen an hour ago, still hers');
});

// --- report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
