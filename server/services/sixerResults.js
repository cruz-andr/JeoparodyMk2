/**
 * How everyone did on the Sixer.
 *
 * A finished Sixer is recorded anonymously: the day, a per-browser player
 * id, how each of the six clues went, and what that paid. That is enough to
 * show a player where they landed among everyone who played the same six,
 * which is the part of a daily puzzle people share. No account, no name.
 *
 * The score is worked out here from the marks and the clues' values, never
 * taken from the client, and a value above the day's climb is refused, so a
 * result can be wrong about itself only by being lower.
 */
import { DOUBLE_ROW_VALUES, sixerRows } from './dailyBuilder.js';
import { isValidDateString, toDateString } from '../shared/archiveWindow.js';

/* One row per player per day. The player is the browser's own session id: a
   deduplicator rather than an identity, and the write limiter is what stops
   anybody minting them fast. */
export const SIXER_RESULTS_SQL = `
  CREATE TABLE IF NOT EXISTS sixer_results (
    date TEXT NOT NULL,
    player TEXT NOT NULL,
    marks TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (date, player)
  ) WITHOUT ROWID;
`;

/* c right, h right with the hint, w wrong, p passed. */
const MARKS = /^[chwp]{6}$/;
const PLAYER = /^[A-Za-z0-9-]{16,128}$/;

const dayBefore = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return toDateString(d);
};

/** What a run's marks are worth against its clues' values. */
export function scoreFor(marks, values) {
  return [...marks].reduce((sum, mark, i) => {
    if (mark === 'c') return sum + values[i];
    if (mark === 'h') return sum + Math.round(values[i] / 2);
    return sum;
  }, 0);
}

/**
 * A posted result, checked. Only today's Sixer counts, or yesterday's when
 * it was finished after midnight: the archive is played for its own sake and
 * would skew a day nobody else is playing any more.
 */
export function validateSixerResult(body, { today = toDateString() } = {}) {
  const { date, player, marks, values } = body ?? {};
  if (!isValidDateString(date) || (date !== today && date !== dayBefore(today))) {
    return { error: 'Only today\'s Sixer is counted.' };
  }
  if (typeof player !== 'string' || !PLAYER.test(player)) return { error: 'A player id is needed.' };
  if (typeof marks !== 'string' || !MARKS.test(marks)) return { error: 'Six marks are needed.' };

  /* A clue is worth at most its row on the day's climb; less when its
     category was short of that row. Never a value the board does not have. */
  const ceiling = sixerRows(date).map((row) => DOUBLE_ROW_VALUES[row - 1]);
  const fair = Array.isArray(values) && values.length === 6
    && values.every((v, i) => DOUBLE_ROW_VALUES.includes(v) && v <= ceiling[i]);
  if (!fair) return { error: 'Those are not the day\'s clues.' };

  return { entry: { date, player, marks, score: scoreFor(marks, values) } };
}

/** Record a run. A player's first result of the day stands. */
export function recordSixerResult(db, { date, player, marks, score }) {
  const { changes } = db.prepare(
    'INSERT OR IGNORE INTO sixer_results (date, player, marks, score) VALUES (?, ?, ?, ?)'
  ).run(date, player, marks, score);
  return { recorded: changes === 1 };
}

/* ------------------------------------------------------------ the estimate

   A day nobody has played yet still has a spread: its six clues are rows of
   the board, and a row says how hard a clue is. From the chance of getting a
   clue of each row right first time, or with the hint, the whole spread of
   scores the day can pay follows. That stands in for PRIOR_PLAYERS players,
   so the first person to finish is placed against something, and real
   players take over as they come in: ten players are a quarter of the curve,
   three hundred are nine tenths of it.

   The chances start as a guess and learn. Every result from every other day
   feeds them, each guess counting for LEARN_WEIGHT results until the real
   ones outweigh it, so a row that turns out easier than guessed reads easier
   on the days that follow. */

/* Pitched at everybody who plays, not at quiz regulars: a casual player gets
   the easiest row about half the time and the hardest about one time in ten.
   A first guess set for keen players put a midweek day's average near half
   of everything on offer, which ranked an ordinary good day as below par. */
export const DEFAULT_ROW_RATES = {
  1: { right: 0.55, hinted: 0.15 },
  2: { right: 0.40, hinted: 0.15 },
  3: { right: 0.28, hinted: 0.13 },
  4: { right: 0.18, hinted: 0.10 },
  5: { right: 0.10, hinted: 0.08 },
};
export const PRIOR_PLAYERS = 30;
/* Below this many real players the page says its numbers are estimated. */
export const CONFIDENT_PLAYERS = 50;
const LEARN_WEIGHT = 100;

/**
 * The spread a day's clues should give: every score they can pay, with its
 * chance, and the chance of getting each clue. `values` and `rows` are the
 * six clues in order.
 */
export function estimateDay(values, rows, rates) {
  let spread = new Map([[0, 1]]);
  values.forEach((value, i) => {
    const r = rates[rows[i]] ?? rates[3];
    const outcomes = [[value, r.right], [Math.round(value / 2), r.hinted], [0, 1 - r.right - r.hinted]];
    const next = new Map();
    for (const [score, p] of spread) {
      for (const [paid, q] of outcomes) {
        if (q > 0) next.set(score + paid, (next.get(score + paid) ?? 0) + p * q);
      }
    }
    spread = next;
  });
  return {
    scores: [...spread].sort((a, b) => a[0] - b[0]).map(([score, p]) => ({ score, p })),
    clues: rows.map((row) => {
      const r = rates[row] ?? rates[3];
      return r.right + r.hinted;
    }),
  };
}

/** The per-row chances, learned from every result but those of `exclude`. */
export function learnedRowRates(db, { exclude = null } = {}) {
  const seen = Object.fromEntries(Object.keys(DEFAULT_ROW_RATES).map((row) => [row, { n: 0, right: 0, hinted: 0 }]));
  const results = db.prepare('SELECT date, marks FROM sixer_results WHERE date IS NOT ?').all(exclude);
  for (const { date, marks } of results) {
    const rows = sixerRows(date);
    [...marks].forEach((mark, i) => {
      const tally = seen[rows[i]];
      if (!tally) return;
      tally.n += 1;
      if (mark === 'c') tally.right += 1;
      if (mark === 'h') tally.hinted += 1;
    });
  }
  return Object.fromEntries(Object.entries(DEFAULT_ROW_RATES).map(([row, guess]) => {
    const { n, right, hinted } = seen[row];
    return [row, {
      right: (guess.right * LEARN_WEIGHT + right) / (LEARN_WEIGHT + n),
      hinted: (guess.hinted * LEARN_WEIGHT + hinted) / (LEARN_WEIGHT + n),
    }];
  }));
}

/**
 * The day's spread: the estimate and the real players blended, by weight.
 * `players` is the real ones alone; `weight` is what the scores add up to,
 * which is what a percentile is taken over. Each clue keeps its real counts
 * beside the blended share that got it.
 */
export function sixerStats(db, date) {
  const results = db.prepare('SELECT marks, score FROM sixer_results WHERE date = ?').all(date);
  const players = results.length;

  const rows = sixerRows(date);
  const prior = estimateDay(rows.map((row) => DOUBLE_ROW_VALUES[row - 1]), rows, learnedRowRates(db, { exclude: date }));

  const counts = new Map(prior.scores.map(({ score, p }) => [score, PRIOR_PLAYERS * p]));
  const clues = Array.from({ length: 6 }, () => ({ right: 0, hinted: 0 }));
  let total = prior.scores.reduce((sum, { score, p }) => sum + PRIOR_PLAYERS * p * score, 0);
  for (const { marks, score } of results) {
    total += score;
    counts.set(score, (counts.get(score) ?? 0) + 1);
    [...marks].forEach((mark, i) => {
      if (mark === 'c') clues[i].right += 1;
      if (mark === 'h') clues[i].hinted += 1;
    });
  }
  const weight = PRIOR_PLAYERS + players;

  return {
    date,
    players,
    estimated: players < CONFIDENT_PLAYERS,
    weight,
    average: total / weight,
    scores: [...counts].sort((a, b) => a[0] - b[0]).map(([score, count]) => ({ score, count })),
    clues: clues.map((c, i) => ({ ...c, share: (PRIOR_PLAYERS * prior.clues[i] + c.right + c.hinted) / weight })),
  };
}
