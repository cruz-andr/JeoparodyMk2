/**
 * A community board lent to a private room: which boards a room may play,
 * and the grid it plays them from.
 * Run with: node server/test/roomBoards.test.js
 */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { findPlayableBoard, roomGrid, boardSummary, countRoomPlay } from '../services/roomBoards.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

const POINTS = [200, 400, 600, 800, 1000];
const board = (columns = 6, { written = true, finalJeopardy = null } = {}) => ({
  version: 1,
  categories: Array.from({ length: columns }, (_, c) => ({
    name: `CAT ${c}`,
    questions: POINTS.map((points, r) => ({
      points,
      answer: written || r ? `Clue ${c}-${points}` : '',
      question: written || r ? `What is ${c}?` : '',
      ...(c === 0 && r === 0 ? { mediaType: 'youtube', mediaData: 'u4YFjksxPg0', youtubeStart: 895, youtubeEnd: 906 } : {}),
    })),
  })),
  finalJeopardy,
});

const db = new Database(':memory:');
db.exec('CREATE TABLE boards (slug TEXT, title TEXT, data TEXT, visibility TEXT, plays INTEGER DEFAULT 0)');
const put = (slug, visibility, data) =>
  db.prepare('INSERT INTO boards (slug, title, data, visibility) VALUES (?, ?, ?, ?)').run(slug, `Title ${slug}`, JSON.stringify(data), visibility);

const FINAL = { category: 'MAPS', answer: 'The longest river', question: 'What is the Nile?' };
put('public6', 'public', board(6, { finalJeopardy: FINAL }));
put('unlisted5', 'unlisted', board(5));
put('private6', 'private', board(6));
put('unfinished', 'public', board(6, { written: false }));
put('halffinal', 'public', board(6, { finalJeopardy: { category: 'MAPS', answer: '', question: '' } }));
db.prepare("INSERT INTO boards (slug, title, data, visibility) VALUES ('broken', 'x', '{not json', 'public')").run();

await test('a published, finished board can be played in a room', () => {
  const found = findPlayableBoard(db, 'public6');
  assert.equal(found.slug, 'public6');
  assert.equal(found.title, 'Title public6');
  assert.deepEqual(found.finalJeopardy, FINAL);
});

await test('so can an unlisted one, and a five-category one', () => {
  // Anyone with the link can already play it solo.
  const found = findPlayableBoard(db, 'unlisted5');
  assert.equal(found.board.categories.length, 5);
  assert.equal(found.finalJeopardy, null);
});

await test('a private, unfinished, unreadable or missing board cannot', () => {
  for (const slug of ['private6', 'unfinished', 'broken', 'nope', null, undefined]) {
    assert.equal(findPlayableBoard(db, slug), null, String(slug));
  }
});

await test('half a Final Jeopardy is no Final at all', () => {
  assert.equal(findPlayableBoard(db, 'halffinal').finalJeopardy, null);
});

await test('the grid carries every clue, its category and its media', () => {
  const { categories, questions } = roomGrid(findPlayableBoard(db, 'unlisted5').board);
  assert.deepEqual(categories, ['CAT 0', 'CAT 1', 'CAT 2', 'CAT 3', 'CAT 4']);
  assert.equal(questions.length, 5);
  assert.equal(questions[0].length, 5);
  assert.equal(questions[3][2].category, 'CAT 3');
  assert.equal(questions[3][2].points, 600);
  assert.equal(questions[3][2].revealed, false);
  assert.deepEqual(
    [questions[0][0].mediaType, questions[0][0].mediaData, questions[0][0].youtubeStart, questions[0][0].youtubeEnd],
    ['youtube', 'u4YFjksxPg0', 895, 906]
  );
  assert.equal(questions[1][0].mediaType, null);
});

await test('the lobby is told what is being played, and whether it has a Final', () => {
  assert.deepEqual(boardSummary(findPlayableBoard(db, 'public6')), {
    slug: 'public6', title: 'Title public6',
    categories: ['CAT 0', 'CAT 1', 'CAT 2', 'CAT 3', 'CAT 4', 'CAT 5'], hasFinal: true,
  });
  assert.equal(boardSummary(null), null);
});

await test('a room playing it counts once', () => {
  countRoomPlay(db, 'public6');
  countRoomPlay(db, 'public6');
  assert.equal(db.prepare("SELECT plays FROM boards WHERE slug = 'public6'").get().plays, 2);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
