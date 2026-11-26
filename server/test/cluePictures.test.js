/**
 * Stand-in pictures for the archive's picture clues.
 * Run with: node server/test/cluePictures.test.js
 *
 * Nothing here reaches another site: the model and Wikipedia are stubs.
 */
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { readClue } from '../services/jarchiveScraper.js';
import {
  createCluePictures, planFrom, picturePrompt, wikipediaPicture, cluePictureStore, authorOf,
} from '../services/cluePictures.js';
import { buildBoard } from '../services/dailyBuilder.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.stack}`); }
}

const cell = (html) => { const $ = cheerio.load(`<table><tr><td class="clue_text">${html}</td></tr></table>`); return readClue($, $('td.clue_text')); };
const memoryStore = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : undefined), set: (k, v) => m.set(k, v), m }; };

// ------------------------------------------------------------ reading a clue

await test('a picture clue keeps its words, spaced, and says what the link was', () => {
  const read = cell('Check out the 130-foot <a href="https://www.j-archive.com/media/2019-12-18_J_07.jpg" target="_blank">Rain Vortex</a> at Changi Airport');
  assert.equal(read.text, 'Check out the 130-foot Rain Vortex at Changi Airport');
  assert.deepEqual(read.media, { kind: 'image', link: 'Rain Vortex' });
});

await test('a link run into its neighbours is read with spaces, and an apostrophe stays put', () => {
  assert.equal(cell('The Faberge egg<a href="/media/x.jpg">seen here</a>was made').text, 'The Faberge egg seen here was made');
  assert.equal(cell('<a href="/media/x.jpg">Here</a>\'s a building').text, "Here's a building");
});

await test('a Clue Crew stage direction is dropped, and a clip is a video', () => {
  const read = cell('(<a href="https://www.j-archive.com/media/2010-11-10_DJ_23.mp4">Jimmy of the Clue Crew shows a film.</a>) The speed needed to break free');
  assert.equal(read.text, 'The speed needed to break free');
  assert.equal(read.media.kind, 'video');
  assert.equal(cell('Song <a href="/media/a.mp3">here</a>').media.kind, 'audio');
});

await test('a clue with no media link has none, and other links do not count', () => {
  assert.equal(cell('Plain clue').media, null);
  assert.equal(cell('See <a href="https://en.wikipedia.org/wiki/X">X</a>').media, null);
});

await test('the builder carries the marker to the question it makes', () => {
  const clues = Array.from({ length: 30 }, (_, i) => ({ category: `C${i % 6}`, clue: `clue ${i}`, answer: `a${i}`, value: 200, round: 'jeopardy' }));
  clues[7].media = { kind: 'image', link: 'here' };
  const board = buildBoard(clues);
  const marked = board.questions.filter((q) => q.sourceMedia);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].answer, 'clue 7');
});

// ------------------------------------------------------------ the model's plan

await test('the plan is read from a reply, fences, thinking and all', () => {
  assert.deepEqual(planFrom('<think>hm</think>```json\n{"article": "Jewel Changi Airport", "spoils": false}\n```'), { article: 'Jewel Changi Airport', spoils: false });
  assert.deepEqual(planFrom('{"article": null, "spoils": false}'), { article: null, spoils: false });
  assert.equal(planFrom('no idea'), null);
  assert.match(picturePrompt({ category: 'C', clue: 'x', link: 'Rain Vortex', response: 'Singapore' }), /Rain Vortex[\s\S]*Singapore/);
});

// ------------------------------------------------------------ the whole

const RAIN = { category: 'CITIES', answer: 'Check out the Rain Vortex', question: 'Singapore', sourceMedia: { kind: 'image', link: 'Rain Vortex' } };
const PIC = { url: 'https://upload.wikimedia.org/x.jpg', credit: { author: 'A. Photographer', license: 'CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:X.jpg' } };

await test('a picture clue gets the picture, with its credit, and loses the marker', async () => {
  const asked = [];
  const pictures = createCluePictures({
    plan: async (item) => { asked.push(item); return { article: 'Jewel Changi Airport', spoils: false }; },
    picture: async (article) => (article === 'Jewel Changi Airport' ? PIC : null),
    store: memoryStore(),
  });
  const qs = [{ ...RAIN }, { category: 'CITIES', answer: 'plain', question: 'x' }];
  await pictures.attach(qs);
  assert.equal(qs[0].mediaType, 'image');
  assert.equal(qs[0].mediaData, PIC.url);
  assert.deepEqual(qs[0].mediaCredit, PIC.credit);
  assert.equal(qs[0].sourceMedia, undefined);
  assert.equal(qs[1].mediaType, undefined);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], { kind: 'image', link: 'Rain Vortex', category: 'CITIES', clue: 'Check out the Rain Vortex', response: 'Singapore' });
});

await test('the Sixer shape is read through clueOf and responseOf', async () => {
  let seen = null;
  const pictures = createCluePictures({ plan: async (item) => { seen = item; return { article: 'A', spoils: false }; }, picture: async () => PIC, store: memoryStore() });
  const q = { category: 'C', clue: 'the clue', answer: 'the response', sourceMedia: { kind: 'image', link: 'this' } };
  await pictures.attach([q], { clueOf: (x) => x.clue, responseOf: (x) => x.answer });
  assert.equal(seen.clue, 'the clue');
  assert.equal(seen.response, 'the response');
  assert.equal(q.mediaData, PIC.url);
});

await test('a spoiler, no article, or no free picture leaves the clue as text', async () => {
  for (const decided of [{ article: 'Nicholas II', spoils: true }, { article: null, spoils: false }, { article: 'ALF', spoils: false }]) {
    const pictures = createCluePictures({ plan: async () => decided, picture: async (a) => (a === 'ALF' ? null : PIC), store: memoryStore() });
    const q = { ...RAIN };
    await pictures.attach([q]);
    assert.equal(q.mediaType, undefined, JSON.stringify(decided));
    assert.equal(q.sourceMedia, undefined);
  }
});

await test('a video or audio clue is never asked about', async () => {
  let asked = 0;
  const pictures = createCluePictures({ plan: async () => { asked++; return { article: 'A', spoils: false }; }, picture: async () => PIC, store: memoryStore() });
  await pictures.attach([{ ...RAIN, sourceMedia: { kind: 'video', link: 'Clue Crew' } }, { ...RAIN, sourceMedia: { kind: 'audio', link: 'song' } }]);
  assert.equal(asked, 0);
});

await test('a decision is remembered, a failure is not', async () => {
  const store = memoryStore();
  let calls = 0;
  let fail = true;
  const pictures = createCluePictures({
    plan: async () => { calls++; if (fail) throw new Error('slow'); return { article: 'A', spoils: false }; },
    picture: async () => PIC, store,
  });
  await pictures.attach([{ ...RAIN }]);
  assert.equal(store.m.size, 0, 'a failure is not remembered');
  fail = false;
  await pictures.attach([{ ...RAIN }]);
  await pictures.attach([{ ...RAIN }]);
  assert.equal(calls, 2, 'asked again after the failure, then answered from memory');
});

await test('off (no model) it only takes the marker off', async () => {
  const pictures = createCluePictures({ plan: null, store: memoryStore() });
  const q = { ...RAIN };
  await pictures.attach([q]);
  assert.equal(q.sourceMedia, undefined);
  assert.equal(q.mediaType, undefined);
  assert.equal(pictures.enabled, false);
});

await test('the SQLite store keeps a decision across instances, and copes without a database', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE clue_pictures (key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT)');
  cluePictureStore(() => db).set('k', PIC);
  assert.deepEqual(cluePictureStore(() => db).get('k'), PIC);
  cluePictureStore(() => db).set('none', null);
  assert.equal(cluePictureStore(() => db).get('none'), null);
  const broken = cluePictureStore(() => { throw new Error('no db'); });
  broken.set('k', PIC);
  assert.deepEqual(broken.get('k'), PIC);
});

// ------------------------------------------------------------ Wikipedia

await test('Wikipedia: the lead free image, and Commons for its author and licence', async () => {
  const calls = [];
  const stub = async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    if (u.hostname === 'en.wikipedia.org') {
      assert.equal(u.searchParams.get('pilicense'), 'free');
      return { ok: true, json: async () => ({ query: { pages: { 1: { title: 'Jewel Changi Airport', pageimage: 'Rain_Vortex.jpg' } } } }) };
    }
    return {
      ok: true,
      json: async () => ({ query: { pages: { '-1': { imageinfo: [{
        thumburl: 'https://upload.wikimedia.org/thumb/800px-Rain_Vortex.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Rain_Vortex.jpg',
        extmetadata: { Artist: { value: '<a href="/wiki/User:Someone">Someone</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
      }] } } } }),
    };
  };
  const found = await wikipediaPicture('Jewel Changi Airport', { fetch: stub });
  assert.deepEqual(found, {
    url: 'https://upload.wikimedia.org/thumb/800px-Rain_Vortex.jpg',
    credit: { author: 'Someone', license: 'CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:Rain_Vortex.jpg' },
  });
  assert.equal(calls.length, 2);
});

await test('a credit gets a short name out of whatever Commons says', () => {
  assert.equal(authorOf('<a href="/wiki/User:Someone">Someone</a>'), 'Someone');
  assert.equal(authorOf('<span>Unknown author</span><span>Unknown author</span>'), 'Unknown author');
  assert.equal(authorOf('Gage Skidmore'), 'Gage Skidmore');
  const long = authorOf('Original work: ancient Greek sculptor Original photographer: Met museum Uploader of original image and of cropped version');
  assert.ok(long.length <= 61 && long.endsWith('…') && !/\s…$/.test(long), long);
  assert.equal(authorOf(''), 'Unknown author');
});

await test('Wikipedia: no free lead image is no picture', async () => {
  const stub = async () => ({ ok: true, json: async () => ({ query: { pages: { 1: { title: 'ALF (TV series)' } } } }) });
  assert.equal(await wikipediaPicture('ALF', { fetch: stub }), null);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
