/**
 * Who a request counts as.
 * Run with: node server/test/rateLimit.test.js
 *
 * The bug this replaces was invisible from the outside: every visitor shared
 * one bucket because `trust proxy` was false behind Fly's proxy, and the only
 * sign was a validation warning in the boot logs. These assert the identity
 * the limiter derives, which is the part that was wrong.
 */
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-secret-not-a-real-one';
const { generateToken } = await import('../middleware/auth.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

/** A request, as far as the limiter is concerned. */
const req = ({ ip, headers = {} } = {}) => ({
  ip,
  socket: {},
  headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
});

// --------------------------------------------------- address normalisation

const { normaliseAddress } = await import('../middleware/rateLimit.js');

test('an IPv4 address is itself', () => {
  assert.equal(normaliseAddress('203.0.113.7'), '203.0.113.7');
});

test('an IPv4-mapped IPv6 address is the IPv4 address', () => {
  assert.equal(normaliseAddress('::ffff:203.0.113.7'), '203.0.113.7');
});

test('IPv6 collapses to the /64 a customer is actually given', () => {
  assert.equal(
    normaliseAddress('2001:db8:1234:5678:9abc:def0:1234:5678'),
    '2001:db8:1234:5678::/64'
  );
});

test('rotating inside a /64 does not buy a new bucket', () => {
  // This is the whole point: an IPv6 customer has billions of addresses, so
  // limiting the full address limits nothing at all.
  const a = normaliseAddress('2001:db8:1234:5678:aaaa:aaaa:aaaa:aaaa');
  const b = normaliseAddress('2001:db8:1234:5678:ffff:ffff:ffff:ffff');
  assert.equal(a, b);
});

test('a different /64 is a different bucket', () => {
  assert.notEqual(
    normaliseAddress('2001:db8:1234:5678::1'),
    normaliseAddress('2001:db8:1234:9999::1')
  );
});

test('a shortened IPv6 address expands before it is truncated', () => {
  assert.equal(normaliseAddress('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(normaliseAddress('2001:db8::1'), normaliseAddress('2001:db8:0:0:aaaa::9'));
});

test('a zone index does not create a second bucket', () => {
  assert.equal(normaliseAddress('fe80::1%eth0'), normaliseAddress('fe80::2'));
});

test('a missing address is a bucket rather than a crash', () => {
  assert.equal(normaliseAddress(undefined), 'unknown');
  assert.equal(normaliseAddress(''), 'unknown');
});

// --------------------------------------------------- who the request is

/* The module reads FLY_APP_NAME once, at import. Both states need testing, so
   each gets its own module instance. */
async function loadWithFly(appName) {
  const before = process.env.FLY_APP_NAME;
  if (appName) process.env.FLY_APP_NAME = appName;
  else delete process.env.FLY_APP_NAME;

  const mod = await import(`../middleware/rateLimit.js?fly=${appName ?? 'off'}`);

  if (before === undefined) delete process.env.FLY_APP_NAME;
  else process.env.FLY_APP_NAME = before;
  return mod;
}

const offFly = await loadWithFly(null);
const onFly = await loadWithFly('jeoparody-server');

test('off Fly, a forged Fly-Client-IP is ignored', () => {
  const key = offFly.clientKey(req({
    ip: '203.0.113.7',
    headers: { 'Fly-Client-IP': '198.51.100.1' },
  }));
  assert.equal(key, 'ip:203.0.113.7', 'the header is only believable behind the proxy that writes it');
});

test('on Fly, Fly-Client-IP is the visitor', () => {
  const key = onFly.clientKey(req({
    ip: '172.16.0.1', // the proxy, which is the same for everybody
    headers: { 'Fly-Client-IP': '198.51.100.1' },
  }));
  assert.equal(key, 'ip:198.51.100.1');
});

test('on Fly, two visitors behind one proxy are two buckets', () => {
  // The bug: without this they were one, and the whole site shared 100
  // requests per fifteen minutes.
  const a = onFly.clientKey(req({ ip: '172.16.0.1', headers: { 'Fly-Client-IP': '198.51.100.1' } }));
  const b = onFly.clientKey(req({ ip: '172.16.0.1', headers: { 'Fly-Client-IP': '198.51.100.2' } }));
  assert.notEqual(a, b);
});

test('X-Forwarded-For is never read, forged or not', () => {
  const key = onFly.clientKey(req({
    ip: '172.16.0.1',
    headers: { 'Fly-Client-IP': '198.51.100.1', 'X-Forwarded-For': '1.2.3.4' },
  }));
  assert.equal(key, 'ip:198.51.100.1');
});

test('a signed-in visitor is counted as an account, not an address', () => {
  const token = generateToken({ userId: 'user-1', isGuest: false });
  const key = onFly.clientKey(req({
    ip: '172.16.0.1',
    headers: { Authorization: `Bearer ${token}`, 'Fly-Client-IP': '198.51.100.1' },
  }));
  assert.equal(key, 'u:user-1');
});

test('one account on two networks is one bucket', () => {
  const token = generateToken({ userId: 'user-1', isGuest: false });
  const home = onFly.clientKey(req({ headers: { Authorization: `Bearer ${token}`, 'Fly-Client-IP': '198.51.100.1' } }));
  const work = onFly.clientKey(req({ headers: { Authorization: `Bearer ${token}`, 'Fly-Client-IP': '203.0.113.9' } }));
  assert.equal(home, work);
});

test('two accounts on one office address are two buckets', () => {
  // A school or an office is one address and many people. Counting by address
  // alone hands them a shared budget they cannot see.
  const one = generateToken({ userId: 'user-1', isGuest: false });
  const two = generateToken({ userId: 'user-2', isGuest: false });
  const shared = { 'Fly-Client-IP': '198.51.100.1' };
  assert.notEqual(
    onFly.clientKey(req({ headers: { ...shared, Authorization: `Bearer ${one}` } })),
    onFly.clientKey(req({ headers: { ...shared, Authorization: `Bearer ${two}` } }))
  );
});

test('a forged token falls back to the address rather than throwing', () => {
  const key = onFly.clientKey(req({
    headers: { Authorization: 'Bearer not.a.real.token', 'Fly-Client-IP': '198.51.100.1' },
  }));
  assert.equal(key, 'ip:198.51.100.1', 'rejecting a bad token is the route\'s job, not the counter\'s');
});

test('a token with no userId falls back to the address', () => {
  const state = generateToken({ purpose: 'google-oauth' });
  const key = onFly.clientKey(req({
    headers: { Authorization: `Bearer ${state}`, 'Fly-Client-IP': '198.51.100.1' },
  }));
  assert.equal(key, 'ip:198.51.100.1');
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
