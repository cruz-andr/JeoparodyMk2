/**
 * The site's own boards: published from files when the server starts, with
 * no author and nobody's login.
 * Run with: node server/test/houseBoards.test.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DB = join(here, 'tmp-house.sqlite');
const DIR = join(here, 'tmp-house-boards');
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR);

process.env.DATABASE_PATH = DB;
const { initializeDatabase, closeDatabase } = await import('../config/database.js');
const { publishHouseBoards, HOUSE_USER_ID } = await import('../services/houseBoards.js');
const db = await initializeDatabase();

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

const POINTS = [200, 400, 600, 800, 1000];
const board = (columns = 5) => ({
  version: 1,
  categories: Array.from({ length: columns }, (_, c) => ({
    name: `CAT ${c}`,
    questions: POINTS.map((points) => ({ points, answer: `Clue ${c}-${points}`, question: `What is ${c}?` })),
  })),
  finalJeopardy: { category: 'MAPS', answer: 'The longest river', question: 'What is the Nile?' },
});
const file = (over = {}) => ({ title: 'Disney Night 40', description: 'Used with permission.', topic: 'disney', featured: true, board: board(), ...over });
const write = (name, data) => fs.writeFileSync(join(DIR, `${name}.json`), typeof data === 'string' ? data : JSON.stringify(data));
const row = (slug) => db.prepare('SELECT * FROM boards WHERE slug = ?').get(slug);
const results = () => Object.fromEntries(publishHouseBoards(db, DIR).map((r) => [r.slug, r.error ? `error: ${r.error}` : r.action]));

await test('a board file is published at its slug, public, featured, under the house account', () => {
  write('disney-night-40', file());
  assert.equal(results()['disney-night-40'], 'published');
  const b = row('disney-night-40');
  assert.equal(b.owner_id, HOUSE_USER_ID);
  assert.equal(b.visibility, 'public');
  assert.equal(b.featured, 1);
  assert.equal(b.topic, 'disney');
  assert.equal(b.clue_count, 25);
  assert.equal(b.category_count, 5);
  assert.ok(b.published_at);
  assert.equal(JSON.parse(b.data).finalJeopardy.question, 'What is the Nile?');
});

await test('the house account has no name to show and no way to sign in', () => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(HOUSE_USER_ID);
  assert.equal(u.username, null);
  assert.equal(u.email, null);
  assert.equal(u.password_hash, null);
  assert.equal(u.google_id ?? null, null);
});

await test('publishing again with nothing changed changes nothing', () => {
  const before = row('disney-night-40');
  assert.equal(results()['disney-night-40'], 'unchanged');
  assert.equal(row('disney-night-40').version, before.version);
});

await test('an edited file updates the board in place, keeping its plays and its link', () => {
  db.prepare("UPDATE boards SET plays = 12 WHERE slug = 'disney-night-40'").run();
  const before = row('disney-night-40');
  write('disney-night-40', file({ title: 'Disney Night 40, fixed', featured: false }));
  assert.equal(results()['disney-night-40'], 'updated');
  const after = row('disney-night-40');
  assert.equal(after.id, before.id);
  assert.equal(after.title, 'Disney Night 40, fixed');
  assert.equal(after.plays, 12);
  assert.equal(after.featured, 0);
  assert.equal(after.version, before.version + 1);
  assert.equal(after.published_at, before.published_at);
});

await test('a file that would not publish from the editor is skipped, and the rest still go up', () => {
  write('five-not-disney', file({ topic: 'film-tv' }));
  write('no-title', file({ title: '' }));
  write('half-written', file({ board: { ...board(6), categories: board(6).categories.map((c, i) => (i ? c : { ...c, name: '' })) }, topic: null }));
  write('Bad Name', file());
  write('not-json', '{ nope');
  write('six-film', file({ topic: 'film-tv', board: board(6) }));
  const r = results();
  assert.match(r['five-not-disney'], /^error: .*Disney/);
  assert.match(r['no-title'], /^error: .*title/i);
  assert.match(r['half-written'], /^error: .*categor/i);
  assert.match(r['Bad Name'], /^error: .*slug/);
  assert.match(r['not-json'], /^error/);
  assert.equal(r['six-film'], 'published');
  for (const slug of ['five-not-disney', 'no-title', 'half-written', 'Bad Name']) assert.equal(row(slug), undefined, slug);
  for (const name of ['five-not-disney', 'no-title', 'half-written', 'Bad Name', 'not-json']) fs.rmSync(join(DIR, `${name}.json`));
});

await test("a slug that is somebody's own board is never touched", () => {
  db.prepare("INSERT INTO users (id, username, display_name) VALUES ('u-ada', 'ada', 'Ada')").run();
  db.prepare(`INSERT INTO boards (id, slug, owner_id, title, data, visibility)
              VALUES ('b-ada', 'adas-board', 'u-ada', 'Mine', '{}', 'private')`).run();
  write('adas-board', file());
  assert.match(results()['adas-board'], /^error: .*somebody/);
  const b = row('adas-board');
  assert.equal(b.owner_id, 'u-ada');
  assert.equal(b.title, 'Mine');
  assert.equal(b.visibility, 'private');
});

await test('a cover named by the file goes up with it, and changing it is a new version', () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  fs.writeFileSync(join(DIR, 'disney-night-41.jpg'), jpg);
  write('disney-night-41', file({ cover: 'disney-night-41.jpg' }));
  assert.equal(results()['disney-night-41'], 'published');
  assert.equal(row('disney-night-41').cover_image, `data:image/jpeg;base64,${jpg.toString('base64')}`);
  assert.equal(results()['disney-night-41'], 'unchanged');

  fs.writeFileSync(join(DIR, 'disney-night-41.jpg'), Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]));
  assert.equal(results()['disney-night-41'], 'updated');

  // A file that names none leaves the cover as it is.
  write('disney-night-41', file());
  assert.equal(results()['disney-night-41'], 'unchanged');
  assert.ok(row('disney-night-41').cover_image);
  fs.rmSync(join(DIR, 'disney-night-41.json'));
});

await test('a cover that is not an image beside the board, or is too large, stops that board', () => {
  write('disney-night-42', file({ cover: '../secret.jpg' }));
  assert.match(results()['disney-night-42'], /not an image file beside the board/);
  fs.writeFileSync(join(DIR, 'disney-night-42.png'), Buffer.alloc(600 * 1024));
  write('disney-night-42', file({ cover: 'disney-night-42.png' }));
  assert.match(results()['disney-night-42'], /too large/);
  assert.equal(row('disney-night-42'), undefined);
  fs.rmSync(join(DIR, 'disney-night-42.json'));
});

await test('no folder, or an empty one, publishes nothing', () => {
  assert.deepEqual(publishHouseBoards(db, join(here, 'no-such-folder')), []);
  assert.deepEqual(publishHouseBoards(db, null), []);
});

await test('the Episode 40 file that ships with the site would publish', () => {
  // The real one, checked here rather than discovered in the deploy log.
  const shipped = join(here, '..', 'houseBoards');
  const r = publishHouseBoards(db, shipped);
  assert.ok(r.length >= 1);
  for (const x of r) assert.equal(x.error, undefined, `${x.slug}: ${x.error}`);
  const ep40 = row('disney-jeopardy-40');
  assert.equal(ep40.category_count, 5);
  assert.equal(ep40.featured, 0, "the episodes have their own row, not Featured");
  assert.equal(JSON.parse(ep40.data).finalJeopardy.mediaType, 'youtube');
});

closeDatabase();
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(DIR, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
