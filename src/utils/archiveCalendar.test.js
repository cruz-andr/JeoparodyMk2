/**
 * Verification harness for the archive calendar grid.
 * Run with: node src/utils/archiveCalendar.test.js
 *
 * No framework, so it runs anywhere with zero install.
 */
import assert from 'node:assert/strict';
import { monthMatrix, shiftMonth, startOfMonth, WEEKDAY_INITIALS } from './archiveCalendar.js';

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

test('startOfMonth keeps the month and drops the day', () => {
  assert.equal(startOfMonth('2026-09-18'), '2026-09-01');
  assert.equal(startOfMonth('2026-09-01'), '2026-09-01');
});

test('shiftMonth crosses the year boundary', () => {
  assert.equal(shiftMonth('2026-09-18', -1), '2026-08-01');
  assert.equal(shiftMonth('2026-01-15', -1), '2025-12-01');
  assert.equal(shiftMonth('2026-12-15', 1), '2027-01-01');
});

test('shiftMonth does not overflow off a long month', () => {
  // The 31st of January plus a month is February, not the 3rd of March.
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-01');
  assert.equal(shiftMonth('2026-03-31', -1), '2026-02-01');
});

test('every row is a full week', () => {
  for (const date of ['2026-09-18', '2026-02-01', '2024-02-15', '2026-11-30']) {
    for (const week of monthMatrix(date)) {
      assert.equal(week.length, 7, `${date} has a short week`);
    }
  }
});

test('the month lands in the right columns', () => {
  // The 1st of September 2026 is a Tuesday: two blanks, then the 1st.
  const [firstWeek] = monthMatrix('2026-09-18');
  assert.deepEqual(firstWeek.slice(0, 2), [null, null]);
  assert.equal(firstWeek[2], '2026-09-01');
  assert.equal(WEEKDAY_INITIALS[2], 'T');
});

test('a month holds exactly its own days, in order', () => {
  const days = monthMatrix('2026-09-18').flat().filter(Boolean);
  assert.equal(days.length, 30, 'September is 30 days');
  assert.equal(days[0], '2026-09-01');
  assert.equal(days[29], '2026-09-30');
  assert.deepEqual(days, [...days].sort(), 'in order');
  assert.equal(new Set(days).size, days.length, 'no repeats');
});

test('February knows about leap years', () => {
  assert.equal(monthMatrix('2024-02-10').flat().filter(Boolean).length, 29);
  assert.equal(monthMatrix('2026-02-10').flat().filter(Boolean).length, 28);
});

test('padding is null and nothing else', () => {
  for (const cell of monthMatrix('2026-09-18').flat()) {
    assert.ok(cell === null || /^\d{4}-\d{2}-\d{2}$/.test(cell), `bad cell ${cell}`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
