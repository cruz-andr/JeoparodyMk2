/**
 * The seam between a stored board and the editors.
 * Run with: node src/stores/boardShape.test.js
 */
import assert from 'node:assert/strict';
import { boardToHost, hostToBoard, writtenGrid } from './boardShape.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

const POINTS = [200, 400, 600, 800, 1000];

function board({ written = 0 } = {}) {
  let left = written;
  return {
    version: 1,
    categories: Array.from({ length: 6 }, (_, c) => ({
      name: `CATEGORY ${c + 1}`,
      questions: POINTS.map((points) => {
        const fill = left > 0;
        if (fill) left -= 1;
        return {
          points,
          answer: fill ? `Clue ${c}` : '',
          question: fill ? `What is ${c}?` : '',
          options: null,
          mediaType: null,
          mediaData: null,
          youtubeStart: null,
          youtubeEnd: null,
          audioOnly: false,
          altText: null,
        };
      }),
    })),
    finalJeopardy: null,
  };
}

test('a board becomes six names and a 6x5 grid', () => {
  const { categories, questions } = boardToHost(board());
  assert.equal(categories.length, 6);
  assert.equal(categories[0], 'CATEGORY 1');
  assert.equal(questions.length, 6);
  assert.equal(questions[0].length, 5);
  assert.deepEqual(questions[0].map((q) => q.points), POINTS);
});

test('every clue carries its category name for the game to display', () => {
  const { questions } = boardToHost(board());
  assert.ok(questions[3].every((q) => q.category === 'CATEGORY 4'));
});

test('clues come back unrevealed, whatever was stored', () => {
  const { questions } = boardToHost(board({ written: 30 }));
  assert.ok(questions.flat().every((q) => q.revealed === false));
});

test('a round trip changes nothing that matters', () => {
  const before = board({ written: 12 });
  const { categories, questions } = boardToHost(before);
  const after = hostToBoard(categories, questions);
  assert.deepEqual(after, before);
});

test('renaming a category wins over the stale copy on each clue', () => {
  const { categories, questions } = boardToHost(board());
  categories[0] = 'RENAMED';
  // questions[0][*].category is still the old name, as it would be mid-edit.
  const after = hostToBoard(categories, questions);
  assert.equal(after.categories[0].name, 'RENAMED');
});

test('media survives the round trip', () => {
  const before = board({ written: 1 });
  before.categories[0].questions[0].mediaType = 'youtube';
  before.categories[0].questions[0].mediaData = 'dQw4w9WgXcQ';
  before.categories[0].questions[0].youtubeStart = 5;
  before.categories[0].questions[0].youtubeEnd = 30;

  const { categories, questions } = boardToHost(before);
  const after = hostToBoard(categories, questions);
  assert.deepEqual(after.categories[0].questions[0], before.categories[0].questions[0]);
});

test('an empty or missing board does not throw', () => {
  assert.deepEqual(boardToHost(null), { categories: [], questions: [] });
  assert.deepEqual(boardToHost({}), { categories: [], questions: [] });
  assert.deepEqual(hostToBoard(null, null).categories, []);
});

test('the written grid marks exactly the written cells', () => {
  const grid = writtenGrid(board({ written: 7 }));
  assert.equal(grid.flat().filter(Boolean).length, 7);
  assert.equal(grid[0][0], true);
  assert.equal(grid[5][4], false);
});

test('the written grid agrees with the server: half a clue is not written', () => {
  const half = board();
  half.categories[0].questions[0].answer = 'Only the clue';
  assert.equal(writtenGrid(half)[0][0], false);
  half.categories[0].questions[0].question = 'What is the response?';
  assert.equal(writtenGrid(half)[0][0], true);
});

test('whitespace is not written', () => {
  const blank = board();
  blank.categories[0].questions[0].answer = '  ';
  blank.categories[0].questions[0].question = '\n';
  assert.equal(writtenGrid(blank)[0][0], false);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
