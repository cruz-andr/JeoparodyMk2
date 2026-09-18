/**
 * The month grid behind the archive calendar.
 *
 * Pure date arithmetic, kept out of the page so it can be tested directly with
 * node. Everything is UTC, matching the window the archive is keyed on.
 *
 * Kept free of imports so it runs under plain node, like the rest of this
 * repo's logic tests; that is why the one line of archiveWindow it needs is
 * spelled out again rather than imported through the @shared alias, which
 * only Vite knows how to resolve.
 */

/** YYYY-MM-DD for a Date, in UTC. */
const toDateString = (date) => date.toISOString().split('T')[0];

/** Column headings, Sunday first, as the calendar reads them. */
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The first day of the month a date falls in. */
export function startOfMonth(dateString) {
  return `${dateString.slice(0, 7)}-01`;
}

/**
 * The month `months` either side of the one a date falls in, as its first day.
 *
 * Built from the year and month directly rather than by adding days, because
 * "a month later" is not a fixed number of them. Setting the day to 1 first
 * also avoids the classic overflow where the 31st of January plus one month
 * lands in March.
 */
export function shiftMonth(dateString, months) {
  const d = new Date(`${startOfMonth(dateString)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return toDateString(d);
}

/**
 * The weeks of a month, Sunday first.
 *
 * Each week is seven entries; days outside the month are null, so a caller can
 * render the padding as empty cells without working out where the month began.
 */
export function monthMatrix(dateString) {
  const first = new Date(`${startOfMonth(dateString)}T00:00:00Z`);
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();

  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = first.getUTCDay(); // 0 is Sunday, which is the first column

  const cells = Array(leading).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(toDateString(new Date(Date.UTC(year, month, day))));
  }
  // Pad the last week out so every row is seven wide.
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
