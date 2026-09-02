/**
 * Verification harness for the record helpers.
 * Run with: node src/utils/gameRecord.test.js
 *
 * No framework, so it runs anywhere with zero install.
 */
import assert from 'node:assert/strict';
import {
  accuracyOf,
  apiRecord,
  describeGame,
  localRecord,
  modeLabel,
  money,
  parsePlayedAt,
  whenPlayed,
} from './gameRecord.js';

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

// ---------------------------------------------------------------- money

test('money formats a score with a dollar sign and commas', () => {
  assert.equal(money(1200), '$1,200');
  assert.equal(money(12000), '$12,000');
});

test('money puts the sign before the dollar', () => {
  assert.equal(money(-400), '-$400');
});

test('money shows nothing as zero rather than a dash', () => {
  assert.equal(money(null), '$0');
  assert.equal(money(undefined), '$0');
  assert.equal(money(NaN), '$0');
});

// ------------------------------------------------------------- accuracy

test('accuracy is a rounded percentage and zero with no answers', () => {
  assert.equal(accuracyOf(0, 0), 0);
  assert.equal(accuracyOf(2, 3), 67);
  assert.equal(accuracyOf(10, 10), 100);
});

// ----------------------------------------------------------------- mode

test('every mode has a label and an unknown one is just a game', () => {
  assert.equal(modeLabel('single'), 'Solo');
  assert.equal(modeLabel('multiplayer'), 'Multiplayer');
  assert.equal(modeLabel('quickplay'), 'Quickplay');
  assert.equal(modeLabel('host'), 'Hosted');
  assert.equal(modeLabel(undefined), 'Game');
});

// ----------------------------------------------------------------- when

test('a SQLite timestamp is read as UTC, not local time', () => {
  const date = parsePlayedAt('2026-03-04 15:06:07');
  assert.equal(date.toISOString(), '2026-03-04T15:06:07.000Z');
});

test('an ISO string passes through and rubbish is null', () => {
  assert.equal(parsePlayedAt('2026-03-04T15:06:07.000Z').toISOString(), '2026-03-04T15:06:07.000Z');
  assert.equal(parsePlayedAt('not a date'), null);
  assert.equal(parsePlayedAt(null), null);
});

test('whenPlayed says today, yesterday, then counts days', () => {
  const now = new Date(2026, 8, 10, 12, 0, 0);
  const at = (d) => new Date(2026, 8, d, 9, 30, 0).toISOString();
  assert.equal(whenPlayed(at(10), now), 'Today');
  assert.equal(whenPlayed(at(9), now), 'Yesterday');
  assert.equal(whenPlayed(at(7), now), '3 days ago');
});

test('whenPlayed uses a date past a week and adds the year when it differs', () => {
  const now = new Date(2026, 8, 10, 12, 0, 0);
  assert.equal(whenPlayed(new Date(2026, 7, 1).toISOString(), now), 'Aug 1');
  assert.equal(whenPlayed(new Date(2025, 11, 25).toISOString(), now), 'Dec 25, 2025');
});

test('whenPlayed is empty for nothing', () => {
  assert.equal(whenPlayed(null), '');
  assert.equal(whenPlayed(''), '');
});

// ------------------------------------------------------------- describe

test('a game is described by its genre first', () => {
  assert.equal(describeGame({ genre: 'Space', categories: ['A', 'B'] }), 'Space');
});

test('without a genre the categories are listed, with a count for the rest', () => {
  assert.equal(describeGame({ categories: ['Science', 'History'] }), 'Science, History');
  assert.equal(
    describeGame({ categories: ['Science', 'History', 'Art', 'Film', 'Music', 'Sport'] }),
    'Science, History, Art and 3 more'
  );
});

test('with neither the mode has to do', () => {
  assert.equal(describeGame({ mode: 'quickplay', categories: [] }), 'Quickplay');
  assert.equal(describeGame({ mode: 'single', categories: ['  '] }), 'Solo');
});

// ----------------------------------------------------------- localRecord

const localStats = {
  gamesPlayed: 3, gamesWon: 3, totalScore: 6000, highestScore: 4000,
  averageScore: 2000, correctAnswers: 12, totalAnswers: 16,
};
const localHighscores = [
  { id: 'hs-1', score: 4000, genre: 'Space', questionsCorrect: 5, questionsTotal: 6, date: '2026-09-01T10:00:00.000Z' },
  { id: 'hs-2', score: 1500, genre: 'Cinema', questionsCorrect: 3, questionsTotal: 5, date: '2026-09-03T10:00:00.000Z' },
  { id: 'hs-3', score: 500, genre: 'Rivers', questionsCorrect: 4, questionsTotal: 5, date: '2026-09-02T10:00:00.000Z', mode: 'quickplay' },
];

test('the local record is the store, renamed', () => {
  const { stats } = localRecord({ stats: localStats, localHighscores });
  assert.equal(stats.gamesPlayed, 3);
  assert.equal(stats.bestScore, 4000);
  assert.equal(stats.avgScore, 2000);
  assert.equal(stats.correct, 12);
  assert.equal(stats.total, 16);
  assert.equal(stats.accuracy, 75);
});

test('local games come back newest first, not highest first', () => {
  const { games } = localRecord({ stats: localStats, localHighscores });
  assert.deepEqual(games.map((g) => g.id), ['hs-2', 'hs-3', 'hs-1']);
});

test('a local entry without a mode was a solo game', () => {
  const { games } = localRecord({ stats: localStats, localHighscores });
  assert.equal(games.find((g) => g.id === 'hs-1').mode, 'single');
  assert.equal(games.find((g) => g.id === 'hs-3').mode, 'quickplay');
});

test('an empty store is an empty record, not a crash', () => {
  const record = localRecord({});
  assert.equal(record.stats.gamesPlayed, 0);
  assert.equal(record.stats.bestScore, 0);
  assert.equal(record.stats.accuracy, 0);
  assert.deepEqual(record.games, []);
});

// ------------------------------------------------------------- apiRecord

test('the server record fills in whatever it left out', () => {
  const record = apiRecord({
    stats: { gamesPlayed: 2, bestScore: 900 },
    games: [{ id: 'g1', score: 900, playedAt: '2026-09-01 10:00:00' }],
  });
  assert.equal(record.stats.gamesPlayed, 2);
  assert.equal(record.stats.bestScore, 900);
  assert.equal(record.stats.accuracy, 0);
  assert.equal(record.games[0].mode, 'single');
  assert.deepEqual(record.games[0].categories, []);
});

test('the two records have the same keys', () => {
  const a = localRecord({ stats: localStats, localHighscores });
  const b = apiRecord({ stats: {}, games: [{ id: 'x' }] });
  assert.deepEqual(Object.keys(a.stats).sort(), Object.keys(b.stats).sort());
  assert.deepEqual(Object.keys(a.games[0]).sort(), Object.keys(b.games[0]).sort());
});

// ---------------------------------------------------------------- report

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.error(`  FAIL  ${name}\n    ${err.message}`);
}
if (failures.length) process.exit(1);
