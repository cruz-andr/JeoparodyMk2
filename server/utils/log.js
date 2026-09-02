/**
 * One JSON line per event, nothing else.
 *
 * Fly collects stdout and stderr line by line, so a log entry that is a single
 * JSON object can be searched by field and a stack trace is one entry rather
 * than forty. There is no logging dependency here on purpose: the whole thing
 * is a formatter and a write.
 *
 * `format` is pure so the tests can assert on the exact line. `info`, `warn`,
 * `error` and `fatal` wrap it with the transport: info and warn to stdout,
 * error and fatal to stderr. The console.* calls this replaces would spread an
 * Error across many lines; here an Error becomes {err, stack} on the entry.
 */

const LEVELS = new Set(['info', 'warn', 'error', 'fatal']);

/** Level and time belong to the line, not to the caller: `info({ level: 'debug' })`
    would otherwise emit a level no reader filters on. */
const RESERVED = new Set(['level', 'time']);

/** Anything that is not a plain object becomes a field, so callers can pass
    a message, an Error, or extra fields in any order. An array is one field
    (`data`) rather than a spread of numeric keys. */
function fold(entry, value) {
  if (value === undefined || value === null) return;
  if (value instanceof Error) {
    entry.err = value.message;
    if (value.stack) entry.stack = value.stack;
    if (value.code !== undefined && entry.code === undefined) entry.code = value.code;
    return;
  }
  if (typeof value === 'string') {
    entry.msg = entry.msg === undefined ? value : `${entry.msg} ${value}`;
    return;
  }
  if (Array.isArray(value)) {
    entry.data = value;
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (!RESERVED.has(key)) entry[key] = value[key];
    }
    return;
  }
  entry.msg = entry.msg === undefined ? String(value) : `${entry.msg} ${String(value)}`;
}

/**
 * Build the line. Returns a string with no trailing newline.
 *   format('info', 'Socket connected', { socketId })
 *   format('fatal', new Error('boom'))
 * Always carries level and time; the rest is whatever the caller gave.
 */
export function format(level, ...parts) {
  const lvl = LEVELS.has(level) ? level : 'info';
  const entry = { level: lvl, time: new Date().toISOString() };
  for (const part of parts) fold(entry, part);
  return JSON.stringify(entry, (key, value) => {
    if (value instanceof Error) return { err: value.message, stack: value.stack };
    if (typeof value === 'bigint') return value.toString();
    return value;
  });
}

function emit(stream, level, parts) {
  let line;
  try {
    line = format(level, ...parts);
  } catch (err) {
    /* A circular structure in a field must not take the process down while
       it is trying to report something else. */
    line = format(level, { msg: 'unserialisable log entry', err: err.message });
  }
  stream.write(`${line}\n`);
}

export const info = (...parts) => emit(process.stdout, 'info', parts);
export const warn = (...parts) => emit(process.stdout, 'warn', parts);
export const error = (...parts) => emit(process.stderr, 'error', parts);
export const fatal = (...parts) => emit(process.stderr, 'fatal', parts);

export default { format, info, warn, error, fatal };
