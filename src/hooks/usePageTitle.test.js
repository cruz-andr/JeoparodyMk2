/**
 * Verification harness for the tab title format.
 * Run with: node src/hooks/usePageTitle.test.js
 *
 * No framework, so it runs anywhere with zero install.
 */
import assert from 'node:assert/strict';
import { formatPageTitle, SITE_NAME } from './usePageTitle.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

test('a page is "<Page> · Jeoparody"', () => {
  assert.equal(formatPageTitle('The Sixer'), 'The Sixer · Jeoparody');
  assert.equal(formatPageTitle('Host a game'), 'Host a game · Jeoparody');
  assert.equal(formatPageTitle('Community Boards'), 'Community Boards · Jeoparody');
});

test('the menu is just the site name', () => {
  assert.equal(formatPageTitle('Jeoparody'), SITE_NAME);
  assert.equal(formatPageTitle('Jeoparody!'), SITE_NAME);
  assert.equal(formatPageTitle('jeoparody'), SITE_NAME);
});

test('nothing at all is the site name, never a dangling separator', () => {
  for (const nothing of ['', '   ', null, undefined, 0, false]) {
    const title = formatPageTitle(nothing);
    assert.equal(title, SITE_NAME, `for ${JSON.stringify(nothing)}`);
    assert.ok(!title.includes('·'), 'no separator without a page name');
  }
});

test('whitespace is tidied, including a menu label with a line break', () => {
  assert.equal(formatPageTitle('  Single\nPlayer  '), 'Single Player · Jeoparody');
});

test('a name that already carries the suffix is not doubled', () => {
  assert.equal(formatPageTitle('The Board · Jeoparody'), 'The Board · Jeoparody');
});

test('a room code stays in front of the site name', () => {
  assert.equal(formatPageTitle('Board · ABCD'), 'Board · ABCD · Jeoparody');
});

test('the separator is a middle dot, never a dash', () => {
  const title = formatPageTitle('Settings');
  assert.ok(title.includes(' · '));
  assert.ok(!/[-–—]/.test(title));
});

test('every page gets a different title', () => {
  const names = ['The Sixer', 'The Board', 'Host a game', 'Quickplay', 'Multiplayer', 'Settings'];
  const titles = new Set(names.map(formatPageTitle));
  assert.equal(titles.size, names.length);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
