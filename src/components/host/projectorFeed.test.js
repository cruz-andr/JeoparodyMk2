/**
 * What the projector is allowed to know.
 * Run with: node src/components/host/projectorFeed.test.js
 */
import assert from 'node:assert/strict';
import { CHANNEL, clueForRoom, forProjector } from './projectorFeed.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

const CLUE = {
  category: 'RIVERS',
  points: 600,
  answer: 'At 6,650km it is the longest river in Africa',
  question: 'What is the Nile?',
  mediaType: null,
  options: null,
};

/** Everything in the payload, flattened, so nothing can hide in a nested field. */
const wholeThing = (payload) => JSON.stringify(payload);

// ------------------------------------------------------- the whole point

test('the response never reaches the projector', () => {
  const out = forProjector({ currentQuestion: CLUE });
  assert.equal(out.clue.text, CLUE.answer, 'the clue itself is projected');
  assert.ok(!wholeThing(out).includes('What is the Nile?'), 'the response is not');
  assert.equal(out.response, null);
});

test('a clue copied for the room carries no response field at all', () => {
  // Not merely empty: absent, so nothing downstream can read it back.
  assert.equal('question' in clueForRoom(CLUE), false);
});

test('an unrelated field added to a clue is not carried through', () => {
  /* The guard against this file rotting: a clue grows a field one day and the
     projector must not start showing it by default. */
  const out = clueForRoom({ ...CLUE, hostNote: 'accept Nile River too' });
  assert.equal('hostNote' in out, false);
  assert.ok(!wholeThing(out).includes('accept Nile River'));
});

test('the response is projected only when it is revealed on purpose', () => {
  const shut = forProjector({ currentQuestion: CLUE, showAnswer: false });
  assert.equal(shut.response, null);
  const shown = forProjector({ currentQuestion: CLUE, showAnswer: true });
  assert.equal(shown.response, 'What is the Nile?');
});

test('revealing with no clue open reveals nothing', () => {
  assert.equal(forProjector({ currentQuestion: null, showAnswer: true }).response, null);
});

test('the unplayed board carries values, not clues', () => {
  const questions = [[{ points: 200, answer: 'secret clue', question: 'secret response' }]];
  const out = forProjector({ questions });
  assert.deepEqual(out.grid, [[{ points: 200 }]]);
  assert.ok(!wholeThing(out).includes('secret'));
});

// ------------------------------------------------------------ the rest

test('categories come through as names either way they are held', () => {
  assert.deepEqual(forProjector({ categories: ['RIVERS'] }).categories, ['RIVERS']);
  assert.deepEqual(forProjector({ categories: [{ name: 'RIVERS' }] }).categories, ['RIVERS']);
});

test('multiple choice options are projected, because the room already has them', () => {
  const out = clueForRoom({ ...CLUE, options: ['Nile', 'Congo', 'Niger'] });
  assert.deepEqual(out.options, ['Nile', 'Congo', 'Niger']);
});

test('the options array is copied, not shared', () => {
  const options = ['Nile', 'Congo'];
  const out = clueForRoom({ ...CLUE, options });
  out.options.push('Niger');
  assert.equal(options.length, 2, 'the game state was not reached through the payload');
});

test('media travels so the wall can show it', () => {
  const out = clueForRoom({ ...CLUE, mediaType: 'image', mediaData: 'data:image/png;base64,xx' });
  assert.equal(out.mediaType, 'image');
  assert.equal(out.mediaData, 'data:image/png;base64,xx');
});

test('the host is not a score on the wall', () => {
  const out = forProjector({
    players: [{ id: 'h', isHost: true, name: 'Host' }, { id: 'a', displayName: 'Ada', score: 400 }],
  });
  assert.deepEqual(out.scores.map((s) => s.name), ['Ada']);
});

test('a missing score projects as nothing, not undefined', () => {
  assert.equal(forProjector({ players: [{ id: 'a', displayName: 'Ada' }] }).scores[0].score, 0);
});

test('who buzzed is a name, because an id means nothing on a wall', () => {
  const players = [{ id: 'a', displayName: 'Ada', score: 0 }];
  assert.equal(forProjector({ players, buzzedPlayerId: 'a' }).buzzedName, 'Ada');
  assert.equal(forProjector({ players, buzzedPlayerId: null }).buzzedName, null);
  assert.equal(forProjector({ players, buzzedPlayerId: 'gone' }).buzzedName, null);
});

test('an empty game is a payload, not a crash', () => {
  const out = forProjector();
  assert.deepEqual(out.categories, []);
  assert.deepEqual(out.grid, []);
  assert.equal(out.clue, null);
});

test('the channel is per room, so two games never cross', () => {
  assert.notEqual(CHANNEL('AAAA'), CHANNEL('BBBB'));
  assert.ok(CHANNEL('3PV3A2').includes('3PV3A2'));
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
