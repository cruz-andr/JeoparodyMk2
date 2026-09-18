/**
 * Verification harness for the archive window.
 * Run with: node server/test/archiveWindow.test.js
 *
 * No framework, so it runs anywhere with zero install.
 *
 * This is the module the client and the API both read to decide what may be
 * opened, so the cases that matter most are the edges of the window and the
 * gate itself: an off-by-one here is a card that renders and then fails.
 */
import assert from 'node:assert/strict';
import {
  ARCHIVE_DAYS,
  ARCHIVE_FORMATS,
  FREE_PICK_COUNT,
  canPlayDate,
  daysBetween,
  freeArchivePicks,
  isFreePick,
  isValidDateString,
  isWithinArchive,
  oldestArchiveDate,
  shiftDate,
  toDateString,
} from '../shared/archiveWindow.js';

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

const TODAY = '2026-09-18';

test('a date string has to name a day that exists', () => {
  assert.equal(isValidDateString('2026-09-18'), true);
  assert.equal(isValidDateString('2026-02-29'), false, '2026 is not a leap year');
  assert.equal(isValidDateString('2024-02-29'), true, '2024 is');
  assert.equal(isValidDateString('2026-13-01'), false);
  assert.equal(isValidDateString('2026-9-18'), false, 'unpadded is not the format');
  assert.equal(isValidDateString(''), false);
  assert.equal(isValidDateString(null), false);
  assert.equal(isValidDateString(20260918), false);
});

test('shifting crosses month and year boundaries', () => {
  assert.equal(shiftDate('2026-09-01', -1), '2026-08-31');
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2024-02-28', 1), '2024-02-29');
});

test('daysBetween counts whole days, signed', () => {
  assert.equal(daysBetween('2026-09-18', '2026-09-18'), 0);
  assert.equal(daysBetween('2026-09-18', '2026-09-19'), 1);
  assert.equal(daysBetween('2026-09-19', '2026-09-18'), -1);
  assert.equal(daysBetween('2026-01-01', '2026-12-31'), 364);
});

test('the window holds exactly ARCHIVE_DAYS days, today included', () => {
  const oldest = oldestArchiveDate(TODAY);
  assert.equal(daysBetween(oldest, TODAY), ARCHIVE_DAYS - 1);
  assert.equal(isWithinArchive(oldest, TODAY), true, 'the oldest day is in');
  assert.equal(isWithinArchive(shiftDate(oldest, -1), TODAY), false, 'the day before is out');
  assert.equal(isWithinArchive(TODAY, TODAY), true, 'today is in');
});

test('the future is never in the archive', () => {
  assert.equal(isWithinArchive(shiftDate(TODAY, 1), TODAY), false);
  assert.equal(isWithinArchive('2099-01-01', TODAY), false);
});

test('a malformed date is not in the archive', () => {
  assert.equal(isWithinArchive('yesterday', TODAY), false);
  assert.equal(isWithinArchive('2026-02-31', TODAY), false);
});

test('the free picks are four recent days, two of each format', () => {
  const picks = freeArchivePicks(TODAY);
  assert.equal(picks.length, FREE_PICK_COUNT);

  for (const format of ARCHIVE_FORMATS) {
    assert.equal(
      picks.filter((p) => p.format === format).length,
      FREE_PICK_COUNT / ARCHIVE_FORMATS.length,
      `an even split for ${format}`
    );
  }

  assert.deepEqual(
    picks.map((p) => p.date),
    ['2026-09-17', '2026-09-16', '2026-09-15', '2026-09-14'],
    'the days just gone, newest first'
  );
});

test('today is never a free pick: it is not archive', () => {
  for (const pick of freeArchivePicks(TODAY)) {
    assert.notEqual(pick.date, TODAY);
  }
});

test('every free pick is inside the window', () => {
  for (const pick of freeArchivePicks(TODAY)) {
    assert.equal(isWithinArchive(pick.date, TODAY), true, pick.date);
  }
});

test('a pick is only free for the format it was picked for', () => {
  const [first] = freeArchivePicks(TODAY);
  const other = ARCHIVE_FORMATS.find((f) => f !== first.format);
  assert.equal(isFreePick(first.date, first.format, TODAY), true);
  assert.equal(isFreePick(first.date, other, TODAY), false);
});

test('a guest gets today and the four picks, and nothing else', () => {
  const guest = { today: TODAY, isAuthenticated: false };

  for (const format of ARCHIVE_FORMATS) {
    assert.equal(canPlayDate({ date: TODAY, format, ...guest }), true, 'today is free');
  }

  for (const pick of freeArchivePicks(TODAY)) {
    assert.equal(canPlayDate({ date: pick.date, ...pick, ...guest }), true, pick.date);
  }

  const older = shiftDate(TODAY, -30);
  assert.equal(canPlayDate({ date: older, format: 'board', ...guest }), false);
});

test('an account opens the whole window but not past its edges', () => {
  const user = { today: TODAY, isAuthenticated: true, format: 'board' };

  assert.equal(canPlayDate({ date: shiftDate(TODAY, -30), ...user }), true);
  assert.equal(canPlayDate({ date: oldestArchiveDate(TODAY), ...user }), true);
  assert.equal(
    canPlayDate({ date: shiftDate(oldestArchiveDate(TODAY), -1), ...user }),
    false,
    'signing in does not widen the window'
  );
  assert.equal(
    canPlayDate({ date: shiftDate(TODAY, 1), ...user }),
    false,
    'nor does it unlock tomorrow'
  );
});

test('the gate refuses nonsense rather than throwing', () => {
  assert.equal(canPlayDate(), false);
  assert.equal(canPlayDate({}), false);
  assert.equal(canPlayDate({ date: null, format: 'board', today: TODAY }), false);
});

test('toDateString agrees with the strings the window is built from', () => {
  assert.equal(toDateString(new Date('2026-09-18T23:59:59Z')), '2026-09-18');
  assert.equal(toDateString(new Date('2026-09-18T00:00:00Z')), '2026-09-18');
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
