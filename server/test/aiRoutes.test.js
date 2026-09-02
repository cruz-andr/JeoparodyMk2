/**
 * The model routes, over real HTTP with the model itself swapped out.
 * Run with: node server/test/aiRoutes.test.js
 *
 * The routes are mounted in this process, on a spare port, the way index.js
 * mounts them: behind the limiter, with the same body parser and the same
 * error handler. The one call that would leave the machine is replaced with
 * `useGenerateContent`, so nothing here needs a key, a quota or a network,
 * and every answer the model could give can be arranged.
 *
 * What matters here is the contract the pages rely on: the shapes coming
 * back, and the words in the refusals, because src/pages/HostPage.jsx reads
 * "not set up" and "quota" out of them to tell a host what to do next.
 */
import assert from 'node:assert/strict';
import express from 'express';

process.env.JWT_SECRET = 'test-secret-not-a-real-one';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key-that-unlocks-nothing';

const { generateToken } = await import('../middleware/auth.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { aiLimiter } = await import('../middleware/rateLimit.js');
const model = await import('../services/gemini.js');
const { default: aiRoutes } = await import('../routes/ai.js');

const PORT = 3996;
const base = `http://127.0.0.1:${PORT}/api/ai`;

const app = express();
app.use(express.json());
app.use('/api/ai', aiLimiter, aiRoutes);
app.use(errorHandler);
const server = await new Promise((resolve) => {
  const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
});

/* The limiter counts by account, so every test that is not about the limiter
   asks as its own person and never runs into it. */
let people = 0;
const someone = () => generateToken({ userId: `user-${people += 1}`, email: 'x@x.com' });

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

async function post(path, body, token = someone()) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

/** A model that answers every prompt with the same text. */
const says = (text) => model.useGenerateContent(async () => text);

/** A model that answers by what the prompt asked for, the way the real one would. */
const answering = () => {
  const calls = [];
  model.useGenerateContent(async (prompt) => {
    calls.push(prompt);
    if (prompt.includes('Generate 6 unique')) return JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F']);
    if (prompt.includes('Generate 1 unique')) return '```json\n{"category": "SOMETHING NEW"}\n```';
    if (prompt.includes('Final Jeopardy question')) {
      return JSON.stringify({ category: 'ENDINGS', answer: 'The last clue', question: 'What is the end?' });
    }
    if (prompt.includes('3 plausible but incorrect')) {
      return JSON.stringify({ options: ['Wrong 1', 'Wrong 2', 'Wrong 3', 'Wrong 4'] });
    }
    if (prompt.includes('answer judge')) {
      return JSON.stringify({ isCorrect: true, confidence: 0.9, reason: 'close enough' });
    }
    if (prompt.includes('Generate Jeopardy-style questions')) {
      const names = prompt.match(/for these categories: (.*)\./)[1].split(', ');
      const values = prompt.match(/point values: (.*)\./)[1].split(', ').map(Number);
      return JSON.stringify({
        categories: names.map((name) => ({
          name,
          questions: values.map((points) => ({
            points, answer: `Clue for ${points}`, question: 'What is Ada (or Bo)?',
          })),
        })),
      });
    }
    return 'not json at all';
  });
  return calls;
};

/** What the real transport throws when Google refuses. */
const refusing = (status, message) => model.useGenerateContent(async () => {
  const err = new Error(message);
  err.status = status;
  throw err;
});

// ============================================================ who may ask

await test('a guest may ask, because single player never needed an account', async () => {
  answering();
  const { status } = await post('/categories', { topic: 'Rivers' }, null);
  assert.equal(status, 200);
});

await test('a forged token is treated as no token, not refused', async () => {
  /* optionalAuth drops a token it cannot verify and carries on as a guest.
     Refusing would let a stale token in a browser turn the AI off entirely. */
  answering();
  const { status } = await post('/categories', { topic: 'Rivers' }, 'not-a-token');
  assert.equal(status, 200);
});

// ============================================================ the shapes

await test('categories: six names, as a bare array', async () => {
  const calls = answering();
  const { status, data } = await post('/categories', { topic: 'Rivers of Europe' });
  assert.equal(status, 200);
  assert.deepEqual(data, ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.match(calls[0], /genre: Rivers of Europe/, 'the topic reaches the prompt');
});

await test('category: one replacement, different from the rest', async () => {
  const calls = answering();
  const { status, data } = await post('/category', { topic: 'Rivers', existing: ['A', 'B', 'C'], index: 1 });
  assert.equal(status, 200);
  assert.deepEqual(data, { category: 'SOMETHING NEW' });
  assert.match(calls[0], /DIFFERENT from these existing categories: A, C/);
});

await test('category: a header the host has cleared is not an error, and not in the prompt', async () => {
  const calls = answering();
  const { status, data } = await post('/category', {
    topic: 'Rivers', existing: ['A', 'B', '', 'D', 'E', 'F'], index: 4,
  });
  assert.equal(status, 200);
  assert.deepEqual(data, { category: 'SOMETHING NEW' });
  assert.match(calls[0], /DIFFERENT from these existing categories: A, B, D, F\n/);
});

await test('category: an empty board is still a board to reroll on', async () => {
  answering();
  const { status } = await post('/category', { topic: 'Rivers', existing: [], index: 0 });
  assert.equal(status, 200);
});

await test('category: an index off the end of the list is refused', async () => {
  answering();
  const { status, data } = await post('/category', { topic: 'Rivers', existing: ['A', 'B'], index: 2 });
  assert.equal(status, 400);
  assert.match(data.error.message, /index/);
});

await test('categories: a seventh name from the model is dropped, so the board that follows fits', async () => {
  says(JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G']));
  const { status, data } = await post('/categories', { topic: 'Rivers' });
  assert.equal(status, 200);
  assert.deepEqual(data, ['A', 'B', 'C', 'D', 'E', 'F']);
});

await test('questions: five clues per category, tidied to one answer each', async () => {
  const calls = answering();
  const values = [200, 400, 600, 800, 1000];
  const { status, data } = await post('/questions', {
    categories: ['A', 'B'], pointValues: values, round: 1, difficulty: 'hard',
  });
  assert.equal(status, 200);
  assert.equal(data.categories.length, 2);
  assert.deepEqual(data.categories[0].questions.map((q) => q.points), values);
  assert.equal(data.categories[0].questions[0].answer, 'Clue for 200');
  assert.equal(data.categories[1].questions[4].question, 'What is Ada?', 'the hedge is cut');
  assert.match(calls[0], /competitive quiz player/, 'the difficulty reaches the prompt');
  assert.doesNotMatch(calls[0], /Double Jeopardy/);
});

await test('questions: round two is asked for harder', async () => {
  const calls = answering();
  await post('/questions', { categories: ['A'], pointValues: [400, 800, 1200, 1600, 2000], round: 2 });
  assert.match(calls[0], /Double Jeopardy/);
  assert.match(calls[0], /point values: 400, 800, 1200, 1600, 2000/);
});

await test('final: a category, a clue and a response', async () => {
  answering();
  const { status, data } = await post('/final', { genre: 'Endings' });
  assert.equal(status, 200);
  assert.deepEqual(data, { category: 'ENDINGS', answer: 'The last clue', question: 'What is the end?' });
});

await test('mc-options: the right answer first, then exactly three wrong ones', async () => {
  answering();
  const { status, data } = await post('/mc-options', {
    response: 'What is Right?', category: 'THINGS', clue: 'A clue',
  });
  assert.equal(status, 200);
  assert.deepEqual(data, { options: ['What is Right?', 'Wrong 1', 'Wrong 2', 'Wrong 3'] });
});

await test('validate: a verdict', async () => {
  answering();
  const { status, data } = await post('/validate', { playerAnswer: 'Mars', correctAnswer: 'What is Mars?' });
  assert.equal(status, 200);
  assert.deepEqual(data, { isCorrect: true, confidence: 0.9, reason: 'close enough' });
});

// ============================================================ bad input

await test('a missing topic is a 400 that names the field, and never asks the model', async () => {
  const calls = answering();
  const { status, data } = await post('/categories', {});
  assert.equal(status, 400);
  assert.match(data.error.message, /topic/);
  assert.equal(calls.length, 0);
});

await test('the wrong number of point values is refused', async () => {
  answering();
  const { status } = await post('/questions', { categories: ['A'], pointValues: [200, 400] });
  assert.equal(status, 400);
});

await test('more than a board of categories is refused', async () => {
  answering();
  const { status } = await post('/questions', {
    categories: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], pointValues: [200, 400, 600, 800, 1000],
  });
  assert.equal(status, 400);
});

await test('a made up difficulty falls back to mixed rather than failing', async () => {
  const calls = answering();
  const { status } = await post('/questions', {
    categories: ['A'], pointValues: [200, 400, 600, 800, 1000], difficulty: 'impossible',
  });
  assert.equal(status, 200);
  assert.match(calls[0], /Scale difficulty with the point values/);
});

// ============================================================ when the model cannot

await test('no key: 503, and it says the site is not set up', async () => {
  const calls = answering();
  const key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    const { status, data } = await post('/categories', { topic: 'Rivers' });
    assert.equal(status, 503);
    assert.match(data.error.message, /not set up/);
    assert.equal(calls.length, 0, 'nothing was asked');
  } finally {
    process.env.GEMINI_API_KEY = key;
  }
});

await test('a key Google refuses is the same as no key', async () => {
  refusing(400, 'API key not valid. Please pass a valid API key.');
  const { status, data } = await post('/categories', { topic: 'Rivers' });
  assert.equal(status, 503);
  assert.match(data.error.message, /not set up/);
});

await test('a model name Google no longer serves is not set up, not something to retry', async () => {
  refusing(404, 'models/gemini-3-flash-preview is not found for API version v1beta');
  const { status, data } = await post('/categories', { topic: 'Rivers' });
  assert.equal(status, 503);
  assert.match(data.error.message, /not set up/);
});

await test('429 from the model: 429, and it says quota', async () => {
  refusing(429, 'Resource has been exhausted (e.g. check quota).');
  const { status, data } = await post('/categories', { topic: 'Rivers' });
  assert.equal(status, 429);
  assert.match(data.error.message, /quota/i);
});

await test('the model being down is a 502, not a 500 with a stack in it', async () => {
  refusing(0, 'network: fetch failed');
  const { status, data } = await post('/categories', { topic: 'Rivers' });
  assert.equal(status, 502);
  assert.equal(data.error.code, 'AI_UNREACHABLE', 'the client tells the road being down apart from a bad answer by this code');
  assert.doesNotMatch(data.error.message, /fetch|stack|undefined/i);
});

await test('an answer that is not JSON is a 502 that says so', async () => {
  says('Sure! Here are some categories: rivers, lakes, seas.');
  const { status, data } = await post('/categories', { topic: 'Rivers' });
  assert.equal(status, 502);
  assert.match(data.error.message, /unusable/i);
});

await test('JSON of the wrong shape is a 502, not a page crash later', async () => {
  says('{"categories": "six of them"}');
  const { status } = await post('/categories', { topic: 'Rivers' });
  assert.equal(status, 502);
});

await test('markdown fences around the JSON are fine', async () => {
  says('```json\n["A","B","C","D","E","F"]\n```');
  const { status, data } = await post('/categories', { topic: 'Rivers' });
  assert.equal(status, 200);
  assert.equal(data.length, 6);
});

// ============================================================ the budget

await test('the thirty first ask in an hour is refused, and only for that account', async () => {
  answering();
  const spender = someone();
  let last;
  for (let i = 0; i < 30; i += 1) {
    last = await post('/categories', { topic: 'Rivers' }, spender);
    assert.equal(last.status, 200, `ask ${i + 1} should still be allowed`);
  }
  const refused = await post('/categories', { topic: 'Rivers' }, spender);
  assert.equal(refused.status, 429);
  assert.match(refused.data.error.message, /quota/i);
  assert.ok(refused.headers.get('ratelimit') || refused.headers.get('ratelimit-policy'),
    'the budget is announced in headers');

  const other = await post('/categories', { topic: 'Rivers' });
  assert.equal(other.status, 200, 'somebody else is not paying for it');
});

await test('a bad request still spends the budget, so guessing is not free', async () => {
  answering();
  const spender = someone();
  const before = Number((await post('/categories', {}, spender)).headers.get('ratelimit')?.match(/remaining=(\d+)/)?.[1]);
  const after = Number((await post('/categories', {}, spender)).headers.get('ratelimit')?.match(/remaining=(\d+)/)?.[1]);
  assert.ok(Number.isFinite(before) && Number.isFinite(after), 'the RateLimit header is readable');
  assert.equal(after, before - 1);
});

// ============================================================ report

model.useGenerateContent(null);
server.close();

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
