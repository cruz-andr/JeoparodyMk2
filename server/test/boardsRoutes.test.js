/**
 * Community Boards, over real HTTP against a real database.
 * Run with: node server/test/boardsRoutes.test.js
 *
 * Boots the actual server on a spare port with a throwaway SQLite file, so the
 * routing, the body-size fork, the migrations and the queries under test are
 * the ones that run in production.
 *
 * The assertions that matter here are the ones about who can see what. A test
 * that only ever asks as the owner will pass against a board with no
 * permission checks in it at all.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';

import {
  CLUE_COUNT, POINT_VALUES, countClues, emptyBoard,
  normalizeBoard, publishProblem, validateBoardStructure,
} from '../shared/boardFormat.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 3997;
const DB = join(here, 'tmp-boards.sqlite');
const base = `http://127.0.0.1:${PORT}`;

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
  try { fs.unlinkSync(f); } catch { /* not there */ }
}

const server = spawn('node', [join(here, '..', 'index.js')], {
  env: {
    ...process.env,
    SERVER_PORT: String(PORT),
    DATABASE_PATH: DB,
    JWT_SECRET: 'test-secret-not-a-real-one',
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

async function api(path, { method = 'GET', body, token, headers } = {}) {
  const res = await fetch(`${base}/api/boards${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function signUp(email) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password: 'hunter2hunter2', displayName: email.split('@')[0],
      username: email.split('@')[0],
    }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`could not register ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

/** A complete, playable board. */
function fullBoard() {
  const board = emptyBoard();
  board.categories.forEach((cat, c) => {
    cat.name = `CATEGORY ${c + 1}`;
    cat.questions.forEach((q, r) => {
      q.answer = `Clue ${c}-${r}`;
      q.question = `What is ${c}-${r}?`;
    });
  });
  return board;
}

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server never started:\n${serverLog}`);
}

// ============================================================ the format

await test('an empty board is the full 6x5 with nothing written', () => {
  const board = emptyBoard();
  assert.equal(board.categories.length, 6);
  assert.ok(board.categories.every((c) => c.questions.length === 5));
  assert.equal(countClues(board), 0);
});

await test('a clue counts only when both halves are written', () => {
  const board = emptyBoard();
  board.categories[0].questions[0].answer = 'Half a clue';
  assert.equal(countClues(board), 0, 'a clue with no response is not a clue');
  board.categories[0].questions[0].question = 'What is the other half?';
  assert.equal(countClues(board), 1);
});

await test('whitespace is not a clue', () => {
  const board = emptyBoard();
  board.categories[0].questions[0].answer = '   ';
  board.categories[0].questions[0].question = '\n\t ';
  assert.equal(countClues(board), 0);
});

await test('structure check passes an empty draft', () => {
  assert.equal(validateBoardStructure(emptyBoard()).valid, true);
});

await test('structure check refuses the wrong number of categories', () => {
  const board = emptyBoard();
  board.categories.pop();
  assert.equal(validateBoardStructure(board).valid, false);
});

await test('structure check refuses points that disagree with the row', () => {
  const board = emptyBoard();
  board.categories[0].questions[0].points = 1000;
  const check = validateBoardStructure(board);
  assert.equal(check.valid, false);
  assert.match(check.errors[0], /\$1000/);
});

await test('normalize rebuilds rows in board order', () => {
  const scrambled = emptyBoard();
  scrambled.categories[0].questions.reverse();
  scrambled.categories[0].questions[0].answer = 'was the $1000';
  const board = normalizeBoard(scrambled);
  assert.deepEqual(board.categories[0].questions.map((q) => q.points), POINT_VALUES);
  assert.equal(board.categories[0].questions[0].answer, 'was the $1000');
  assert.equal(board.categories[0].questions[0].points, 200, 'row position wins over the old value');
});

await test('normalize drops an all-blank options array', () => {
  const board = emptyBoard();
  board.categories[0].questions[0].options = ['', '', '', ''];
  assert.equal(normalizeBoard(board).categories[0].questions[0].options, null);
});

await test('normalize derives option zero from the response', () => {
  // GameStateManager expects the correct answer at index 0 and shuffles from
  // there. Storing it separately means editing the response later leaves a
  // stale index 0, and the game marks a right answer wrong at play time.
  const board = emptyBoard();
  const q = board.categories[0].questions[0];
  q.answer = 'The longest river in Africa';
  q.question = 'What is the Nile?';
  q.options = ['SOMETHING STALE', 'What is the Amazon?', 'What is the Congo?', 'What is the Volga?'];

  const options = normalizeBoard(board).categories[0].questions[0].options;
  assert.equal(options[0], 'What is the Nile?', 'index zero is the response, always');
  assert.deepEqual(options.slice(1), [
    'What is the Amazon?', 'What is the Congo?', 'What is the Volga?',
  ]);
});

await test('editing the response cannot leave a stale correct answer', () => {
  const board = emptyBoard();
  const q = board.categories[0].questions[0];
  q.answer = 'clue';
  q.question = 'What is the Nile?';
  q.options = ['What is the Nile?', 'What is the Amazon?', 'What is the Congo?'];

  // Somebody changes their mind about the answer after setting the options.
  q.question = 'What is the Blue Nile?';
  const options = normalizeBoard(board).categories[0].questions[0].options;
  assert.equal(options[0], 'What is the Blue Nile?');
  assert.equal(options.includes('What is the Nile?'), false, 'the old answer is gone');
});

await test('normalize drops blank distractors', () => {
  const board = emptyBoard();
  const q = board.categories[0].questions[0];
  q.answer = 'clue';
  q.question = 'What is right?';
  q.options = ['', 'What is wrong?', '  ', ''];
  assert.deepEqual(
    normalizeBoard(board).categories[0].questions[0].options,
    ['What is right?', 'What is wrong?']
  );
});

await test('options with no distractors are not options at all', () => {
  const board = emptyBoard();
  const q = board.categories[0].questions[0];
  q.answer = 'clue';
  q.question = 'What is right?';
  q.options = ['What is right?', '', '', ''];
  assert.equal(normalizeBoard(board).categories[0].questions[0].options, null);
});

await test('distractors with no response are not options either', () => {
  const board = emptyBoard();
  board.categories[0].questions[0].options = ['', 'a', 'b', 'c'];
  assert.equal(normalizeBoard(board).categories[0].questions[0].options, null);
});

await test('publish gate asks for a title first', () => {
  assert.match(publishProblem({ title: '', board: fullBoard() }), /title/i);
});

await test('publish gate counts unnamed categories', () => {
  const board = fullBoard();
  board.categories[3].name = '';
  board.categories[4].name = '';
  assert.match(publishProblem({ title: 'Fine', board }), /2 categories/);
});

await test('publish gate counts empty clues, singular', () => {
  const board = fullBoard();
  board.categories[2].questions[1].question = '';
  assert.match(publishProblem({ title: 'Fine', board }), /^One clue/);
});

await test('publish gate passes a finished board', () => {
  assert.equal(publishProblem({ title: 'Finished', board: fullBoard() }), null);
});

await test('a board with no Final Jeopardy still publishes', () => {
  // Optional: plenty of boards will not want one, and the player can turn the
  // round off anyway.
  const board = fullBoard();
  board.finalJeopardy = null;
  assert.equal(publishProblem({ title: 'Fine', board }), null);
});

await test('a complete Final Jeopardy publishes', () => {
  const board = fullBoard();
  board.finalJeopardy = { category: 'RIVERS', answer: 'The longest', question: 'What is the Nile?' };
  assert.equal(publishProblem({ title: 'Fine', board }), null);
});

await test('a half-written Final Jeopardy does not', () => {
  // A clue with no answer waiting at the end of a game is worse than none.
  const board = fullBoard();
  board.finalJeopardy = { category: 'RIVERS', answer: '', question: '' };
  assert.match(publishProblem({ title: 'Fine', board }), /Final Jeopardy is half written/);
});


// ============================================================ over HTTP

await waitForServer();

const ada = await signUp('ada@example.com');
const bob = await signUp('bob@example.com');

let mine;

await test('creating a board returns a slug and an empty grid', async () => {
  const { status, data } = await api('/', { method: 'POST', token: ada, body: { title: 'Draft one' } });
  assert.equal(status, 201);
  assert.ok(data.slug && data.slug.length >= 8, 'slug should be long enough to not be guessed');
  assert.equal(countClues(data.board), 0);
  mine = data.slug;
});

await test('a new board is private', async () => {
  const { data } = await api(`/${mine}`, { token: ada });
  assert.equal(data.visibility, 'private');
  assert.equal(data.isOwner, true);
});

await test('someone else cannot see a private board, and gets 404 not 403', async () => {
  const { status, data } = await api(`/${mine}`, { token: bob });
  assert.equal(status, 404, '403 would confirm the board exists');
  assert.match(data.error?.message ?? '', /does not exist/);
});

await test('a signed-out visitor cannot see a private board either', async () => {
  const { status } = await api(`/${mine}`);
  assert.equal(status, 404);
});

await test('a half-written board saves without complaint', async () => {
  const board = emptyBoard();
  board.categories[0].name = 'RIVERS';
  board.categories[0].questions[0].answer = 'The longest river in Africa';
  board.categories[0].questions[0].question = 'What is the Nile?';
  const { status, data } = await api(`/${mine}`, { method: 'PUT', token: ada, body: { board } });
  assert.equal(status, 200, 'losing work to a validation error is the worst bug in here');
  assert.equal(data.clueCount, 1);
});

await test('a malformed board is refused with a sentence, not a stack trace', async () => {
  const board = emptyBoard();
  board.categories = board.categories.slice(0, 4);
  const { status, data } = await api(`/${mine}`, { method: 'PUT', token: ada, body: { board } });
  assert.equal(status, 400);
  assert.match(data.error.message, /6 categories/);
});

await test('someone else cannot save over my board', async () => {
  const { status } = await api(`/${mine}`, { method: 'PUT', token: bob, body: { title: 'mine now' } });
  assert.equal(status, 404);
});

await test('an unfinished board is refused from Community Boards, and told why', async () => {
  // Five categories are still unnamed here, and that is what it should say:
  // one reason at a time, in the order a person would fix them. Naming the
  // categories comes before writing the clues.
  const { status, data } = await api(`/${mine}/visibility`, {
    method: 'PUT', token: ada, body: { visibility: 'public' },
  });
  assert.equal(status, 400);
  assert.match(data.error.message, /5 categories still need names/);
});

await test('once the categories are named, the gate moves on to the clues', async () => {
  const board = emptyBoard();
  board.categories.forEach((cat, c) => { cat.name = `CATEGORY ${c + 1}`; });
  board.categories[0].questions[0].answer = 'One clue';
  board.categories[0].questions[0].question = 'What is one clue?';
  await api(`/${mine}`, { method: 'PUT', token: ada, body: { board } });

  const { data } = await api(`/${mine}/visibility`, {
    method: 'PUT', token: ada, body: { visibility: 'public' },
  });
  assert.match(data.error.message, /29 clues are still empty/);
});

await test('unlisted needs nothing but the dial', async () => {
  const { status, data } = await api(`/${mine}/visibility`, {
    method: 'PUT', token: ada, body: { visibility: 'unlisted' },
  });
  assert.equal(status, 200);
  assert.equal(data.visibility, 'unlisted');
});

await test('an unlisted board opens for anyone holding the slug', async () => {
  const { status, data } = await api(`/${mine}`);
  assert.equal(status, 200);
  assert.equal(data.isOwner, false);
  assert.equal(data.title, 'Draft one');
});

await test('an unlisted board is not in Community Boards', async () => {
  const { data } = await api('/?row=new');
  assert.equal(data.boards.some((b) => b.slug === mine), false);
});

await test('an unlisted board cannot be copied by someone else', async () => {
  const { status } = await api(`/${mine}/copy`, { method: 'POST', token: bob });
  assert.equal(status, 403);
});

let published;

await test('a finished board goes public', async () => {
  const create = await api('/', { method: 'POST', token: ada, body: { title: 'The Cold War' } });
  published = create.data.slug;

  await api(`/${published}`, {
    method: 'PUT', token: ada,
    body: { board: fullBoard(), topic: 'history', description: 'Nineteen forty-five onwards.' },
  });
  const { status, data } = await api(`/${published}/visibility`, {
    method: 'PUT', token: ada, body: { visibility: 'public' },
  });
  assert.equal(status, 200);
  assert.equal(data.visibility, 'public');
});

await test('a public board is in Community Boards with its author', async () => {
  const { data } = await api('/?row=new');
  const card = data.boards.find((b) => b.slug === published);
  assert.ok(card, 'should be listed');
  assert.equal(card.author.username, 'ada');
  assert.equal(card.clueCount, CLUE_COUNT);
});

await test('list responses do not carry the board or the cover', async () => {
  const { data } = await api('/?row=new');
  const card = data.boards.find((b) => b.slug === published);
  assert.equal(card.board, undefined, 'a list of 24 boards must not ship 24 boards');
  assert.equal(card.coverImage, undefined);
  assert.equal(card.hasCover, false);
});

await test('search finds a board by title and by author', async () => {
  const byTitle = await api('/?q=cold');
  assert.ok(byTitle.data.boards.some((b) => b.slug === published));
  const byAuthor = await api('/?q=ada');
  assert.ok(byAuthor.data.boards.some((b) => b.slug === published));
});

await test('the topic filter excludes other topics', async () => {
  const hit = await api('/?topic=history');
  assert.ok(hit.data.boards.some((b) => b.slug === published));
  const miss = await api('/?topic=music');
  assert.equal(miss.data.boards.some((b) => b.slug === published), false);
});

await test('an unknown topic is ignored rather than erroring', async () => {
  const { status } = await api('/?topic=; DROP TABLE boards');
  assert.equal(status, 200);
});

await test('editing a public board back below 30 clues drops it to unlisted', async () => {
  const board = fullBoard();
  board.categories[5].questions[4].question = '';
  const { data } = await api(`/${published}`, { method: 'PUT', token: ada, body: { board } });
  assert.equal(data.visibility, 'unlisted');
  assert.equal(data.unpublished, true);

  const listed = await api('/?row=new');
  assert.equal(listed.data.boards.some((b) => b.slug === published), false);

  // put it back for the tests below
  await api(`/${published}`, { method: 'PUT', token: ada, body: { board: fullBoard() } });
  await api(`/${published}/visibility`, { method: 'PUT', token: ada, body: { visibility: 'public' } });
});

await test('published_at does not move when a board is republished', async () => {
  const before = (await api(`/${published}`)).data.publishedAt;
  await api(`/${published}/visibility`, { method: 'PUT', token: ada, body: { visibility: 'unlisted' } });
  await api(`/${published}/visibility`, { method: 'PUT', token: ada, body: { visibility: 'public' } });
  const after = (await api(`/${published}`)).data.publishedAt;
  assert.equal(after, before, 'a republish should not jump back to the top of New');
});

let copy;

await test('copying a public board keeps the attribution', async () => {
  const { status, data } = await api(`/${published}/copy`, { method: 'POST', token: bob });
  assert.equal(status, 201);
  copy = data.slug;

  const opened = await api(`/${copy}`, { token: bob });
  assert.equal(opened.data.adaptedFrom.username, 'ada');
  assert.equal(opened.data.visibility, 'private', 'a copy starts private, like any draft');
  assert.equal(countClues(opened.data.board), CLUE_COUNT);
});

await test('editing a copy does not touch the original', async () => {
  const board = fullBoard();
  board.categories[0].name = 'BOBS CATEGORY';
  await api(`/${copy}`, { method: 'PUT', token: bob, body: { board } });

  const original = await api(`/${published}`);
  assert.equal(original.data.board.categories[0].name, 'CATEGORY 1');
});

await test('a copy of a copy credits the original author', async () => {
  await api(`/${copy}/visibility`, { method: 'PUT', token: bob, body: { visibility: 'public' } });
  const second = await api(`/${copy}/copy`, { method: 'POST', token: ada });
  const opened = await api(`/${second.data.slug}`, { token: ada });
  assert.equal(opened.data.adaptedFrom.username, 'ada', 'not the middleman');
});

await test('a Final Jeopardy survives a save and comes back', async () => {
  const create = await api('/', { method: 'POST', token: ada, body: { title: 'With a final' } });
  const board = fullBoard();
  board.finalJeopardy = { category: 'RIVERS', answer: 'The longest in Africa', question: 'What is the Nile?' };
  await api(`/${create.data.slug}`, { method: 'PUT', token: ada, body: { board } });

  const read = await api(`/${create.data.slug}`, { token: ada });
  assert.deepEqual(read.data.board.finalJeopardy, {
    category: 'RIVERS', answer: 'The longest in Africa', question: 'What is the Nile?',
  });
});

await test('a half-written Final Jeopardy is refused from Community Boards', async () => {
  const create = await api('/', { method: 'POST', token: ada, body: { title: 'Half a final' } });
  const board = fullBoard();
  board.finalJeopardy = { category: 'RIVERS', answer: 'A clue with no answer', question: '' };
  await api(`/${create.data.slug}`, { method: 'PUT', token: ada, body: { board } });

  const { status, data } = await api(`/${create.data.slug}/visibility`, {
    method: 'PUT', token: ada, body: { visibility: 'public' },
  });
  assert.equal(status, 400);
  assert.match(data.error.message, /Final Jeopardy is half written/);
});

// ============================================================ conflicts

await test('a board carries a version that goes up when it is saved', async () => {
  const create = await api('/', { method: 'POST', token: ada, body: { title: 'Versioned' } });
  const first = await api(`/${create.data.slug}`, { token: ada });
  assert.equal(first.data.version, 1);

  const saved = await api(`/${create.data.slug}`, {
    method: 'PUT', token: ada, body: { title: 'Versioned twice' },
  });
  assert.equal(saved.data.version, 2);
});

await test('saving against a stale version is refused', async () => {
  // One person with the editor open in two tabs, which is the actual case.
  const create = await api('/', { method: 'POST', token: ada, body: { title: 'Two tabs' } });
  const slug = create.data.slug;

  await api(`/${slug}`, { method: 'PUT', token: ada, body: { title: 'From tab one', baseVersion: 1 } });
  const { status, data } = await api(`/${slug}`, {
    method: 'PUT', token: ada, body: { title: 'From tab two', baseVersion: 1 },
  });

  assert.equal(status, 409);
  assert.equal(data.error.code, 'STALE_BOARD');
});

await test('the refusal carries the board that is actually there', async () => {
  // So the client can offer a choice without a second request at the moment
  // the network is already unhappy.
  const create = await api('/', { method: 'POST', token: ada, body: { title: 'Carries it' } });
  const slug = create.data.slug;
  const board = fullBoard();
  board.categories[0].name = 'THE WINNER';

  await api(`/${slug}`, { method: 'PUT', token: ada, body: { title: 'Theirs', board, baseVersion: 1 } });
  const { data } = await api(`/${slug}`, {
    method: 'PUT', token: ada, body: { title: 'Mine', baseVersion: 1 },
  });

  assert.equal(data.error.details.title, 'Theirs');
  assert.equal(data.error.details.version, 2);
  assert.equal(data.error.details.board.categories[0].name, 'THE WINNER');
});

await test('a stale save changes nothing', async () => {
  const create = await api('/', { method: 'POST', token: ada, body: { title: 'Untouched' } });
  const slug = create.data.slug;
  await api(`/${slug}`, { method: 'PUT', token: ada, body: { title: 'Kept', baseVersion: 1 } });
  await api(`/${slug}`, { method: 'PUT', token: ada, body: { title: 'Lost', baseVersion: 1 } });

  const read = await api(`/${slug}`, { token: ada });
  assert.equal(read.data.title, 'Kept');
  assert.equal(read.data.version, 2, 'a refused save does not bump the version either');
});

await test('leaving out baseVersion still saves, for a deliberate overwrite', async () => {
  const create = await api('/', { method: 'POST', token: ada, body: { title: 'Forced' } });
  const slug = create.data.slug;
  await api(`/${slug}`, { method: 'PUT', token: ada, body: { title: 'One', baseVersion: 1 } });
  const { status } = await api(`/${slug}`, { method: 'PUT', token: ada, body: { title: 'Two' } });
  assert.equal(status, 200);
});

await test('sending only a title leaves the board alone', async () => {
  // The saving that makes editing a title stop re-uploading every image.
  const create = await api('/', { method: 'POST', token: ada, body: { title: 'Partial' } });
  const slug = create.data.slug;
  await api(`/${slug}`, { method: 'PUT', token: ada, body: { board: fullBoard() } });

  await api(`/${slug}`, { method: 'PUT', token: ada, body: { title: 'Renamed only' } });
  const read = await api(`/${slug}`, { token: ada });
  assert.equal(read.data.title, 'Renamed only');
  assert.equal(read.data.clueCount, CLUE_COUNT, 'the board survived a title-only save');
});

// ============================================================ plays

const play = (slug, { token, key } = {}) =>
  api(`/${slug}/played`, {
    method: 'POST', token,
    headers: key ? { 'X-Player-Key': key } : undefined,
  });

const playsOn = async (slug) => (await api(`/${slug}`)).data.plays;

await test('a play counts', async () => {
  const before = await playsOn(published);
  const { data } = await play(published, { token: bob });
  assert.equal(data.plays, before + 1);
  assert.equal(data.counted, true);
});

await test('the same person playing again does not count again', async () => {
  // This is the whole point. A bare counter is a reload button, and the number
  // it produces answers a question nobody asked.
  const before = await playsOn(published);
  for (let i = 0; i < 5; i += 1) await play(published, { token: bob });
  assert.equal(await playsOn(published), before);
});

await test('a repeat play says so rather than lying about the total', async () => {
  const { data } = await play(published, { token: bob });
  assert.equal(data.counted, false);
  assert.equal(data.plays, await playsOn(published));
});

await test('the owner cannot run up their own count', async () => {
  const before = await playsOn(published);
  await play(published, { token: ada });
  await play(published, { token: ada });
  assert.equal(await playsOn(published), before);
});

await test('a signed-out player counts once, however many reloads', async () => {
  const before = await playsOn(published);
  const key = 'anonymous-browser-key-0001';
  await play(published, { key });
  const afterFirst = await playsOn(published);
  assert.equal(afterFirst, before + 1);

  for (let i = 0; i < 4; i += 1) await play(published, { key });
  assert.equal(await playsOn(published), afterFirst, 'refreshing is not playing again');
});

await test('a different signed-out player is a different play', async () => {
  const before = await playsOn(published);
  await play(published, { key: 'anonymous-browser-key-0002' });
  assert.equal(await playsOn(published), before + 1);
});

await test('a nonsense player key is ignored rather than trusted', async () => {
  const before = await playsOn(published);
  // Too short to be one of ours, so it falls back to address plus user agent,
  // which the previous test already used up.
  await play(published, { key: 'x' });
  await play(published, { key: '../../etc/passwd' });
  assert.equal(await playsOn(published), before + 1, 'both fell back to the same fingerprint');
});

await test('the count survives a play by someone who then signs in', async () => {
  // Signed out and signed in are different rows on purpose: we cannot know
  // they are the same person, and guessing wrong loses a real play.
  const before = await playsOn(published);
  const carol = await signUp('dave@example.com');
  await play(published, { token: carol });
  assert.equal(await playsOn(published), before + 1);
});

await test('plays are per board, not per person', async () => {
  const second = await api('/', { method: 'POST', token: ada, body: { title: 'Another board' } });
  await api(`/${second.data.slug}`, { method: 'PUT', token: ada, body: { board: fullBoard() } });
  await api(`/${second.data.slug}/visibility`, { method: 'PUT', token: ada, body: { visibility: 'public' } });

  const { data } = await play(second.data.slug, { token: bob });
  assert.equal(data.counted, true, 'bob has played the other board, not this one');
});

await test('deleting a board takes its plays with it', async () => {
  const temp = await api('/', { method: 'POST', token: ada, body: { title: 'Briefly' } });
  await api(`/${temp.data.slug}/visibility`, { method: 'PUT', token: ada, body: { visibility: 'unlisted' } });
  await play(temp.data.slug, { token: bob });
  await api(`/${temp.data.slug}`, { method: 'DELETE', token: ada });
  assert.equal((await api(`/${temp.data.slug}`)).status, 404);
});

await test('my shelf lists my boards and nobody else\'s', async () => {
  const { data } = await api('/mine', { token: ada });
  const slugs = data.boards.map((b) => b.slug);
  assert.ok(slugs.includes(mine));
  assert.ok(slugs.includes(published));
  assert.equal(slugs.includes(copy), false, "bob's copy is not on ada's shelf");
});

await test('a board carrying an image saves, so the 100KB cap is really lifted', async () => {
  // ~250KB of base64, comfortably past the default limit and past what one
  // compressed 800px WebP would be.
  const fatImage = `data:image/webp;base64,${'A'.repeat(250_000)}`;
  const board = fullBoard();
  board.categories[0].questions[0].mediaType = 'image';
  board.categories[0].questions[0].mediaData = fatImage;

  const { status } = await api(`/${mine}`, { method: 'PUT', token: ada, body: { board } });
  assert.equal(status, 200, 'a bare 413 here is the bug this fork exists to prevent');

  const read = await api(`/${mine}`, { token: ada });
  assert.equal(read.data.board.categories[0].questions[0].mediaData.length, fatImage.length);
});

await test('deleting a board removes it', async () => {
  const create = await api('/', { method: 'POST', token: bob, body: { title: 'Temporary' } });
  const { status } = await api(`/${create.data.slug}`, { method: 'DELETE', token: bob });
  assert.equal(status, 200);
  assert.equal((await api(`/${create.data.slug}`, { token: bob })).status, 404);
});

await test('someone else cannot delete my board', async () => {
  const { status } = await api(`/${published}`, { method: 'DELETE', token: bob });
  assert.equal(status, 404);
  assert.equal((await api(`/${published}`)).status, 200, 'still there');
});

await test('a slug that does not exist is a 404, not a 500', async () => {
  const { status } = await api('/nosuchboardanywhere');
  assert.equal(status, 404);
});

await test('deleting an account takes its boards with it', async () => {
  const token = await signUp('carol@example.com');
  const create = await api('/', { method: 'POST', token, body: { title: 'Carols board' } });
  await api(`/${create.data.slug}/visibility`, { method: 'PUT', token, body: { visibility: 'unlisted' } });
  assert.equal((await api(`/${create.data.slug}`)).status, 200);

  await fetch(`${base}/api/auth/account`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal((await api(`/${create.data.slug}`)).status, 404, 'ON DELETE CASCADE');
});

await test('a guest is told to make an account rather than building an orphan', async () => {
  const res = await fetch(`${base}/api/auth/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Passer By' }),
  });
  const { token } = await res.json();
  assert.ok(token, 'guest sign-in should work');

  const { status, data } = await api('/', { method: 'POST', token, body: { title: 'Ghost' } });
  assert.equal(status, 403);
  assert.match(data.error.message, /Create an account/);
});

await test('browsing with no matches returns an empty list, not an error', async () => {
  const { status, data } = await api('/?topic=food-drink');
  assert.equal(status, 200, 'the empty state is the one I am least likely to look at');
  assert.deepEqual(data.boards, []);
});

// ============================================================ report

server.kill();

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  console.error(`\nserver output:\n${serverLog}`);
  process.exit(1);
}
