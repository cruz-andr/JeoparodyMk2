/**
 * Verification harness for the daily challenge builder.
 * Run with: node server/test/dailyBuilder.test.js
 */
import assert from 'node:assert/strict';
import {
  candidateGameIds,
  getDailyChallenge,
  _clearDailyCache,
} from '../services/jarchiveScraper.js';
import {
  orderCategoryMajor,
  buildBoard,
  buildSixer,
  buildDailyChallenge,
  ROW_VALUES,
  sixerTargetRow,
  SIXER_WEEK_ROWS,
} from '../services/dailyBuilder.js';

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

/** A round as J-Archive emits it: row-major, six categories wide. */
function mkRound(round, categoryPrefix, { rows = 5, categories = 6 } = {}) {
  const clues = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < categories; c++) {
      clues.push({
        category: `${categoryPrefix}${c}`,
        clue: `${categoryPrefix}${c} clue row ${r}`,
        answer: `${categoryPrefix}${c} answer row ${r}`,
        value: (r + 1) * 200,
        round,
      });
    }
  }
  return clues;
}

const fullGame = () => [...mkRound('jeopardy', 'J'), ...mkRound('double_jeopardy', 'D')];

// =========================================================================
// Ordering
// =========================================================================

test('row-major clues are re-ordered into contiguous columns', () => {
  const round = mkRound('jeopardy', 'J');
  const ordered = orderCategoryMajor(round);

  assert.equal(ordered.length, 30);
  assert.equal(ordered[0].category, 'J0');
  assert.equal(ordered[4].category, 'J0', 'first five are all one category');
  assert.equal(ordered[5].category, 'J1', 'then the next category begins');
  assert.equal(ordered[0].clue, 'J0 clue row 0', 'cheapest clue first');
  assert.equal(ordered[4].clue, 'J0 clue row 4', 'dearest clue last');
});

// =========================================================================
// The Board
// =========================================================================

test('a complete round produces a six by five board', () => {
  const board = buildBoard(mkRound('jeopardy', 'J'));
  assert.equal(board.categories.length, 6);
  assert.equal(board.questions.length, 30);
  assert.deepEqual(board.categories, ['J0', 'J1', 'J2', 'J3', 'J4', 'J5']);
});

test('board questions use the component convention, not the scraper one', () => {
  // This mapping is inverted between the two and silently breaks the modal.
  const board = buildBoard(mkRound('jeopardy', 'J'));
  const first = board.questions[0];

  assert.equal(first.answer, 'J0 clue row 0', 'answer holds the text shown to the player');
  assert.equal(first.question, 'J0 answer row 0', 'question holds the correct response');
  assert.equal(first.revealed, false);
});

test('board row values are normalised to 200 through 1000', () => {
  const board = buildBoard(mkRound('jeopardy', 'J'));
  assert.deepEqual(board.questions.slice(0, 5).map((q) => q.points), ROW_VALUES);
  assert.deepEqual(board.questions.slice(5, 10).map((q) => q.points), ROW_VALUES,
    'every column restarts at 200');
});

test('an incomplete round yields no board at all', () => {
  const short = mkRound('jeopardy', 'J').slice(0, 29);
  assert.equal(buildBoard(short), null, 'better no board than a board with a hole');
  assert.equal(buildBoard([]), null);
  assert.equal(buildBoard(null), null);
});

test('a round with a missing answer yields no board', () => {
  const round = mkRound('jeopardy', 'J');
  round[17].answer = '';
  assert.equal(buildBoard(round), null);
});

// =========================================================================
// The Sixer
// =========================================================================

test('the sixer takes one clue from each of six categories', () => {
  const sixer = buildSixer(mkRound('double_jeopardy', 'D'), 0);
  assert.equal(sixer.questions.length, 6);
  assert.equal(new Set(sixer.questions.map((q) => q.category)).size, 6, 'no category twice');
});

test('the sixer keeps the scraper convention DailyPage reads', () => {
  const sixer = buildSixer(mkRound('double_jeopardy', 'D'), 0);
  const first = sixer.questions[0];
  assert.ok(first.clue, 'clue holds the text shown');
  assert.ok(first.answer, 'answer holds the response');
  assert.ok(Object.prototype.hasOwnProperty.call(first, 'value'));
});

test('the same seed always picks the same six', () => {
  const round = mkRound('double_jeopardy', 'D');
  assert.deepEqual(buildSixer(round, 7), buildSixer(round, 7), 'every player gets one board');
});

test('a different seed picks a different set', () => {
  const round = mkRound('double_jeopardy', 'D');
  assert.notDeepEqual(buildSixer(round, 1), buildSixer(round, 2));
});

test('too few usable clues yields no sixer', () => {
  assert.equal(buildSixer(mkRound('double_jeopardy', 'D').slice(0, 5), 0), null);
  assert.equal(buildSixer([], 0), null);
});

// =========================================================================
// The pair
// =========================================================================

test('a full game produces both formats', () => {
  const out = buildDailyChallenge(fullGame(), { seed: 42, date: '2026-08-29', gameId: 1234 });
  assert.equal(out.board.questions.length, 30);
  assert.equal(out.sixer.questions.length, 6);
  assert.equal(out.date, '2026-08-29');
  assert.equal(out.gameId, 1234);
});

test('the two formats never share a clue or a category', () => {
  const out = buildDailyChallenge(fullGame(), { seed: 3, date: '2026-08-29', gameId: 1 });

  const boardCategories = new Set(out.board.categories);
  for (const q of out.sixer.questions) {
    assert.ok(!boardCategories.has(q.category),
      `sixer category ${q.category} also appears on the board`);
  }

  const boardClues = new Set(out.board.questions.map((q) => q.answer));
  for (const q of out.sixer.questions) {
    assert.ok(!boardClues.has(q.clue), 'a sixer clue also appears on the board');
  }
});

test('a game with no Double Jeopardy round is rejected outright', () => {
  const out = buildDailyChallenge(mkRound('jeopardy', 'J'), { seed: 1, date: 'x', gameId: 1 });
  assert.equal(out, null, 'without a second round the sixer would have to spoil the board');
});

test('a game with an incomplete first round is rejected outright', () => {
  const clues = [...mkRound('jeopardy', 'J').slice(0, 20), ...mkRound('double_jeopardy', 'D')];
  assert.equal(buildDailyChallenge(clues, { seed: 1, date: 'x', gameId: 1 }), null);
});

test('junk input does not throw', () => {
  assert.equal(buildDailyChallenge(null, {}), null);
  assert.doesNotThrow(() => buildDailyChallenge([], {}));
});

// =========================================================================
// Candidate game ids
// =========================================================================

test('a day gets several distinct games to try', () => {
  const ids = candidateGameIds(20260829);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6, 'retrying the same game would be pointless');
});

test('every candidate lands inside the archive range', () => {
  for (const seed of [0, 1, 20260829, 99999999]) {
    for (const id of candidateGameIds(seed)) {
      assert.ok(id >= 1000 && id < 9000, `${id} is outside the range`);
    }
  }
});

test('the same day always tries the same games', () => {
  assert.deepEqual(candidateGameIds(20260829), candidateGameIds(20260829));
});

// =========================================================================
// Caching: the board is the same all day, so it is scraped once
// =========================================================================

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

const stubFetcher = () => {
  let calls = 0;
  const fetchGame = async () => {
    calls++;
    return { clues: fullGame() };
  };
  return { fetchGame, calls: () => calls };
};

export async function runAsyncTests() {
  await asyncTest('the day is scraped once, not once per visitor', async () => {
    _clearDailyCache();
    const stub = stubFetcher();

    await getDailyChallenge({ fetchGame: stub.fetchGame });
    await getDailyChallenge({ fetchGame: stub.fetchGame });
    await getDailyChallenge({ fetchGame: stub.fetchGame });

    assert.equal(stub.calls(), 1, 'three visitors must not mean three scrapes');
  });

  await asyncTest('a burst of visitors shares one build', async () => {
    _clearDailyCache();
    const stub = stubFetcher();

    const all = await Promise.all(
      Array.from({ length: 25 }, () => getDailyChallenge({ fetchGame: stub.fetchGame }))
    );

    assert.equal(stub.calls(), 1, 'concurrent requests must not each scrape');
    assert.equal(new Set(all).size, 1, 'and they all get the same board');
  });

  await asyncTest('a failure is not cached, so the next request retries', async () => {
    _clearDailyCache();
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error('archive down');
    };

    await assert.rejects(() => getDailyChallenge({ fetchGame: failing }));
    const afterFirst = calls;
    await assert.rejects(() => getDailyChallenge({ fetchGame: failing }));

    assert.ok(calls > afterFirst, 'a bad day must not be remembered as the answer');
    _clearDailyCache();
  });

  await asyncTest('a cached day is returned without touching the network', async () => {
    _clearDailyCache();
    const stub = stubFetcher();
    const first = await getDailyChallenge({ fetchGame: stub.fetchGame });

    const second = await getDailyChallenge({
      fetchGame: () => { throw new Error('must not be called'); },
    });

    assert.equal(second, first);
    _clearDailyCache();
  });
}

// --- report --------------------------------------------------------------

await runAsyncTests();

// --- the Sixer gets harder across the week -----------------------------

// Mon 31 Aug 2026 through Sun 6 Sep 2026.
const WEEK = ['2026-08-31','2026-09-01','2026-09-02','2026-09-03',
              '2026-09-04','2026-09-05','2026-09-06'];

test('the week climbs and never drops back', () => {
  const values = WEEK.map(sixerTargetRow);
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] >= values[i - 1], `${WEEK[i]} is not easier than the day before`);
  }
});

test('Monday is the easiest row and Sunday the hardest', () => {
  assert.equal(sixerTargetRow('2026-08-31'), 1);
  assert.equal(sixerTargetRow('2026-09-06'), 5);
});

test('the two repeated rows fall mid week, not at either end', () => {
  const rows = WEEK.map(sixerTargetRow);
  const repeated = rows.filter((v, i) => i && v === rows[i - 1]);
  assert.equal(repeated.length, 2, 'seven days over five rows repeats exactly twice');
  assert.notEqual(rows[0], rows[1], 'Monday stands alone');
  assert.notEqual(rows[5], rows[6], 'Sunday stands alone');
});

test('the week starts on Monday, as the weekly best reset does', () => {
  assert.equal(sixerTargetRow('2026-09-06'), SIXER_WEEK_ROWS[6]);
  assert.equal(sixerTargetRow('2026-09-07'), SIXER_WEEK_ROWS[0]);
});

test('a missing or unparsable date falls back to the easiest row', () => {
  assert.equal(sixerTargetRow(null), 1);
  assert.equal(sixerTargetRow('not-a-date'), 1);
});

const columnsWorth = (values) => {
  const clues = [];
  for (const category of ['A', 'B', 'C', 'D', 'E', 'F']) {
    for (const value of values) {
      clues.push({ category, value, clue: `${category} ${value}`, answer: `${category}${value}` });
    }
  }
  return clues;
};

const MODERN = [400, 800, 1200, 1600, 2000];   // Double Jeopardy since Nov 2001
const VINTAGE = [200, 400, 600, 800, 1000];    // Double Jeopardy before it

test('the Sixer takes the day\'s row out of each category', () => {
  const clues = columnsWorth(MODERN);
  assert.deepEqual(
    buildSixer(clues, 0, sixerTargetRow('2026-08-31')).questions.map((q) => q.value),
    [400, 400, 400, 400, 400, 400]
  );
  assert.deepEqual(
    buildSixer(clues, 0, sixerTargetRow('2026-09-06')).questions.map((q) => q.value),
    [2000, 2000, 2000, 2000, 2000, 2000]
  );
});

test('a pre-2001 game ramps just as well, at its own values', () => {
  // The bug this guards: the ramp used to target dollar amounts, so on a game
  // whose Double Jeopardy topped out at $1000 every day from Thursday on
  // picked the same $1000 clue and four days of the week were identical.
  const clues = columnsWorth(VINTAGE);
  const aired = WEEK.map(
    (d) => buildSixer(clues, 0, sixerTargetRow(d)).questions[0].airedValue
  );
  assert.deepEqual(aired, [200, 400, 400, 600, 600, 800, 1000]);
  assert.equal(new Set(aired).size, 5, 'all five rows are still reachable');
});

test('the week reads the same whichever era the game is from', () => {
  // The Board shows its rows as $200 to $1000 whatever year its game aired,
  // so a Sixer passing through 1995 values made the same number mean two
  // different difficulties depending on which format you were playing.
  const shown = (values) =>
    WEEK.map((d) => buildSixer(columnsWorth(values), 0, sixerTargetRow(d)).questions[0].value);

  assert.deepEqual(shown(VINTAGE), [400, 800, 800, 1200, 1200, 1600, 2000]);
  assert.deepEqual(shown(MODERN), shown(VINTAGE));
});

test('what it was worth on the night is not thrown away', () => {
  const sunday = buildSixer(columnsWorth(VINTAGE), 0, sixerTargetRow('2026-09-06')).questions[0];
  assert.equal(sunday.value, 2000, 'shown in today\'s money');
  assert.equal(sunday.airedValue, 1000, 'and what it actually paid in 1995');
});

test('the hardest day is the hardest clue in either era', () => {
  for (const values of [MODERN, VINTAGE]) {
    const sunday = buildSixer(columnsWorth(values), 0, sixerTargetRow('2026-09-06'));
    assert.equal(sunday.questions[0].airedValue, Math.max(...values));
    assert.equal(sunday.questions[0].value, 2000, 'always the top row in modern money');
  }
});

test('a category short of a full column gives up its hardest clue', () => {
  const clues = [];
  for (const category of ['A', 'B', 'C', 'D', 'E', 'F']) {
    for (const value of [400, 800]) {
      clues.push({ category, value, clue: `${category} ${value}`, answer: `${category}${value}` });
    }
  }
  const sunday = buildSixer(clues, 0, sixerTargetRow('2026-09-06'));
  assert.deepEqual(sunday.questions.map((q) => q.airedValue), [800, 800, 800, 800, 800, 800]);
  // Row 2 of what it has, not row 5, and labelled honestly as such.
  assert.deepEqual(sunday.questions.map((q) => q.value), [800, 800, 800, 800, 800, 800]);
});

test('a clue with no usable value does not sink the pick', () => {
  const clues = [];
  for (const category of ['A', 'B', 'C', 'D', 'E', 'F']) {
    clues.push({ category, value: null, clue: `${category} dd`, answer: 'dd' });
    for (const value of [400, 800, 1200, 1600, 2000]) {
      clues.push({ category, value, clue: `${category} ${value}`, answer: `${category}${value}` });
    }
  }
  const sunday = buildSixer(clues, 0, sixerTargetRow('2026-09-06'));
  assert.deepEqual(sunday.questions.map((q) => q.value), [2000, 2000, 2000, 2000, 2000, 2000]);
});

test('the same day gives every player the same six', () => {
  const clues = columnsWorth(MODERN);
  const a = buildSixer(clues, 3, sixerTargetRow('2026-09-03'));
  const b = buildSixer(clues, 3, sixerTargetRow('2026-09-03'));
  assert.deepEqual(a.questions, b.questions);
});

test('no target given keeps the old behaviour', () => {
  const clues = [];
  for (const category of ['A', 'B', 'C', 'D', 'E', 'F']) {
    for (const value of [400, 2000]) {
      clues.push({ category, value, clue: `${category} ${value}`, answer: `${category}${value}` });
    }
  }
  const sixer = buildSixer(clues, 0);
  assert.equal(sixer.questions.length, 6);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  
console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
