/**
 * How far back the archive reaches, and who may open what.
 *
 * Shared with the API for the same reason boardFormat is: both ends have to
 * give the same answer. The client decides which cards to draw and the API
 * decides which days it is willing to build, and a window that disagreed
 * between them would put a card on screen that fails when it is clicked.
 *
 * Every date here is a YYYY-MM-DD string in UTC, matching the boundary the
 * daily itself turns on, so a player near midnight sees the same archive as
 * everyone else rather than one shifted by their offset.
 */

/** Days the archive reaches back, today included. */
export const ARCHIVE_DAYS = 90;

/** The two dailies, in the order the menu lists them. */
export const ARCHIVE_FORMATS = ['sixer', 'board'];

/**
 * Past days anyone may play without an account.
 *
 * Four, split two and two, so the row shows both dailies rather than making
 * the Board look like the only thing worth coming back for. This is the taste:
 * the rest of the window is what an account is for.
 */
export const FREE_PICK_COUNT = 4;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86400000;

/** YYYY-MM-DD for a Date, in UTC. */
export function toDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Whether a string is a date this module will accept.
 *
 * The shape is checked first and then the value, because Date happily parses
 * "2026-02-31" into the 3rd of March: a string that round-trips is the only
 * proof the day it names actually exists.
 */
export function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && toDateString(parsed) === value;
}

/** The date `days` either side of a YYYY-MM-DD string. */
export function shiftDate(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateString(d);
}

/** Whole days from `from` to `to`; negative when `to` is the earlier one. */
export function daysBetween(from, to) {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

/** The earliest day the archive still holds. */
export function oldestArchiveDate(today = toDateString()) {
  return shiftDate(today, -(ARCHIVE_DAYS - 1));
}

/** Whether a date is a real day inside the window, and not in the future. */
export function isWithinArchive(date, today = toDateString()) {
  if (!isValidDateString(date) || !isValidDateString(today)) return false;
  if (date > today) return false;
  return date >= oldestArchiveDate(today);
}

/**
 * The four days that stay free, newest first.
 *
 * Taken from the days just gone and alternating format, so the row reads as
 * "the last few days" rather than an arbitrary scatter, and so a player who
 * missed yesterday can still play it. Today is not among them: today is free
 * to everyone anyway and does not belong in an archive.
 */
export function freeArchivePicks(today = toDateString()) {
  const picks = [];
  for (let i = 0; i < FREE_PICK_COUNT; i++) {
    picks.push({
      date: shiftDate(today, -(i + 1)),
      // Alternating from the Sixer gives two of each across the four.
      format: ARCHIVE_FORMATS[i % ARCHIVE_FORMATS.length],
    });
  }
  return picks;
}

/** Whether a given day and format is one of the free ones. */
export function isFreePick(date, format, today = toDateString()) {
  return freeArchivePicks(today).some((p) => p.date === date && p.format === format);
}

/**
 * Whether this player may open this day.
 *
 * Today is always free, the four picks are always free, and everything else
 * inside the window is what signing in buys. Anything outside the window is
 * shut to everybody, account or not, because the API will not build it.
 *
 * The whole gate is this one function on purpose: if the archive ever moves
 * behind something other than an account, this is the only thing that changes.
 */
export function canPlayDate({
  date,
  format,
  today = toDateString(),
  isAuthenticated = false,
} = {}) {
  if (!isWithinArchive(date, today)) return false;
  if (date === today) return true;
  if (isFreePick(date, format, today)) return true;
  return Boolean(isAuthenticated);
}
