/**
 * What each daily is called, what it looks like, and where it is played.
 *
 * Its own module rather than an export beside a component, so both the menu
 * row and the archive calendar can read it without either importing the
 * other's component file.
 */
export const FORMAT_META = {
  sixer: { name: 'The Sixer', icon: '/icons/the-sixer.png', path: '/daily' },
  board: { name: 'The Board', icon: '/icons/the-board.png', path: '/daily/board' },
};

/* Weekday and date, in the reader's own locale but on the board's own day.
   timeZone UTC because the archive is keyed in UTC: without it a player west
   of Greenwich sees a card labelled the day before the board it opens. */
const utcDate = (date) => new Date(`${date}T00:00:00Z`);

export const weekdayOf = (date) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(utcDate(date));

export const dayOf = (date) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(date));

export const monthTitleOf = (date) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(date));
