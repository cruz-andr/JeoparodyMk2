/**
 * What the app says, and to whom, when something throws.
 *
 * Two audiences, kept apart on purpose. The visitor gets a screen with a
 * short sentence on it and a way back. The console, and any reporter the
 * page has been given, get the whole thing. Nothing in the visitor's half
 * may be derived from the error, because an error message is written by a
 * library for its author, and "Unexpected Application Error" or a stack
 * trace on a game screen is exactly what this file exists to prevent.
 */

/* Copy shown to a visitor. Pure strings, never built from an error. */
export const VISITOR_COPY = {
  notFound: {
    title: 'Nothing here',
    body: 'There is no page at this address. It may have moved, or the link may be wrong.',
  },
  broke: {
    title: 'Something broke',
    body: 'This screen ran into a problem it could not recover from on its own. Your scores and boards are safe.',
  },
};

/* Words a visitor must never read on an error screen, lower case. Checked by
   the tests and by the browser suite, and kept here so both look for the
   same things. */
export const FORBIDDEN_WORDS = ['developer', 'application error', 'errorboundary', 'stack trace'];

/* Says whether a piece of copy is fit for a visitor. */
export function isVisitorSafe(text) {
  const lower = String(text ?? '').toLowerCase();
  return FORBIDDEN_WORDS.every((word) => !lower.includes(word));
}

/* Turns whatever was thrown into a plain object a reporter can serialise.

   Anything can be thrown: an Error, a string, a Response from a loader, or
   undefined. Every branch produces the same shape so a reporter never has to
   guess. */
export function describeError(error, info = {}) {
  const report = {
    name: 'Error',
    message: '',
    stack: null,
    componentStack: info?.componentStack ?? null,
    status: null,
  };
  if (error instanceof Error) {
    report.name = error.name || 'Error';
    report.message = error.message || '';
    report.stack = error.stack || null;
  } else if (error && typeof error === 'object') {
    /* A route error response from react-router carries status and data. */
    if (typeof error.status === 'number') report.status = error.status;
    report.name = typeof error.name === 'string' ? error.name : 'Error';
    report.message = typeof error.message === 'string'
      ? error.message
      : typeof error.data === 'string'
        ? error.data
        : typeof error.statusText === 'string'
          ? error.statusText
          : '';
    if (typeof error.stack === 'string') report.stack = error.stack;
  } else if (error !== undefined && error !== null) {
    report.message = String(error);
  }
  return report;
}

/* Sends an error where it should go and nowhere else.

   `log` is console.error unless told otherwise, `hook` is the future error
   reporter: window.__reportError if a page defines it. Neither is allowed to
   throw back into the boundary, because a reporter that breaks the error
   screen is worse than no reporter. Returns the report so callers can test
   what was said. */
export function reportError(error, info, { log, hook } = {}) {
  const report = describeError(error, info);
  const say = log ?? (typeof console !== 'undefined' ? console.error.bind(console) : null);
  const send = hook ?? (typeof window !== 'undefined' && typeof window.__reportError === 'function'
    ? window.__reportError
    : null);
  try { say?.(error, report); } catch { /* the console is not our problem */ }
  try { send?.(error, report); } catch { /* neither is the reporter */ }
  return report;
}
