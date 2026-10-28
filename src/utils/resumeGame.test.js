/**
 * Rebuilding the game screen from what the server says on a reconnect.
 * Run with: node src/utils/resumeGame.test.js
 */
import assert from 'node:assert/strict';
import { resumeView } from './resumeGame.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push({ name, err }); }
}

const clue = (revealed = false) => ({ category: 'C', points: 200, answer: 'a clue', question: 'a response', revealed });
const board = () => [[clue(true), clue()], [clue(), clue()]];
const playing = (gameState, extra = {}) => ({
  status: 'in_progress',
  gameState: { phase: 'playing', questions: board(), categories: ['A', 'B'], currentPickerId: 'p1', currentRound: 1, you: {}, ...gameState },
  ...extra,
});

test('a room nobody has started is the lobby', () => {
  assert.equal(resumeView({ status: 'waiting', gameState: null }).phase, 'lobby');
});

test('a hosted room with the board handed over but not started is still the lobby', () => {
  const view = resumeView({ status: 'waiting', gameState: { questions: board(), categories: ['A', 'B'] } });
  assert.equal(view.phase, 'lobby');
  assert.equal(view.questions.length, 2, 'the host gets their board back to start with');
});

test('a game in play comes back on the board, with the revealed clues marked', () => {
  const view = resumeView(playing({}));
  assert.equal(view.phase, 'playing');
  assert.deepEqual(view.revealed, ['0-0']);
  assert.equal(view.currentPickerId, 'p1');
  assert.equal(view.canBuzz, false);
});

test('an open buzzer can be rung by a player who has not had their go', () => {
  const live = { currentQuestion: { ...clue(true), categoryIndex: 0, pointIndex: 0 }, phase: 'questionActive', buzzWindowOpen: true };
  assert.equal(resumeView(playing(live)).canBuzz, true);
  const used = resumeView(playing({ ...live, you: { buzzed: true } }));
  assert.equal(used.canBuzz, false);
  assert.equal(used.hasAlreadyBuzzed, true);
  assert.equal(resumeView(playing({ ...live, you: { skipped: true } })).hasSkipped, true);
  assert.equal(resumeView(playing({ ...live, you: { waiting: true } })).canBuzz, false, 'a late joiner sits it out');
  assert.equal(resumeView(playing({ ...live, buzzedPlayerId: 'p2' })).buzzerWinnerId, 'p2');
});

test('a timed-out clue comes back on the Continue screen, remembering a Continue already pressed', () => {
  const out = { currentQuestion: clue(true), awaitingContinue: true, buzzWindowOpen: false };
  const view = resumeView(playing({ ...out, you: { continued: true } }));
  assert.equal(view.buzzTimedOut, true);
  assert.equal(view.hasContinued, true);
  assert.equal(resumeView(playing(out)).hasContinued, false);
});

test('a Daily Double comes back at the wager, or at the clue once the wager is in', () => {
  const dd = { currentQuestion: clue(true), isDailyDouble: true };
  assert.deepEqual(resumeView(playing({ ...dd, phase: 'dailyDouble' })).dailyDouble, { phase: 'wager', wager: 0, ownerId: null });
  assert.deepEqual(
    resumeView(playing({ ...dd, phase: 'dailyDoubleQuestion', dailyDoubleWager: 800, dailyDoubleOwnerId: 'p2' })).dailyDouble,
    { phase: 'question', wager: 800, ownerId: 'p2' }
  );
  assert.equal(resumeView(playing({})).dailyDouble.phase, null);
});

test('Final Jeopardy comes back at the wager, with a wager already locked in kept', () => {
  const view = resumeView(playing({
    phase: 'finalJeopardy',
    finalJeopardy: { category: 'POETS' },
    you: { fj: { eligible: true, wager: 300, answered: false } },
  }));
  assert.equal(view.phase, 'finalJeopardy');
  assert.equal(view.finalJeopardy.phase, 'wager');
  assert.equal(view.finalJeopardy.wagerSubmitted, true);
  assert.equal(view.finalJeopardy.wager, 300);
  assert.deepEqual(view.finalJeopardy.data, { category: 'POETS', clue: null, answer: null, media: null });
});

test('Final Jeopardy comes back at the clue once every wager is in', () => {
  const view = resumeView(playing({
    phase: 'finalJeopardy',
    finalJeopardy: { category: 'POETS', clue: 'He wrote it' },
    you: { fj: { eligible: true, wager: 300, answered: true } },
  }));
  assert.equal(view.finalJeopardy.phase, 'clue');
  assert.equal(view.finalJeopardy.answerSubmitted, true);
  assert.equal(view.finalJeopardy.data.clue, 'He wrote it');
});

test('Final Jeopardy comes back at the reveal once it has been scored', () => {
  const results = [{ playerId: 'p1', wager: 100, answer: 'x', correct: false, finalScore: 900 }];
  const view = resumeView(playing({
    phase: 'finalJeopardy',
    finalJeopardy: { category: 'POETS', clue: 'He wrote it', answer: 'Who is Keats?', results },
  }));
  assert.equal(view.finalJeopardy.phase, 'reveal');
  assert.deepEqual(view.finalJeopardy.results, results);
});

test("Final Jeopardy's picture comes back with its clue, and not before", () => {
  const media = { mediaType: 'image', mediaData: 'data:image/webp;base64,AAAA', youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: 'A moustache' };
  const up = resumeView(playing({ phase: 'finalJeopardy', finalJeopardy: { category: 'POETS', clue: 'He wrote it', media } }));
  assert.deepEqual(up.finalJeopardy.data.media, media);
  // The host's own copy has the picture all along; it waits for the clue.
  const host = resumeView(playing({ phase: 'finalJeopardy', finalJeopardy: { category: 'POETS', clue: 'He wrote it', media, clueShown: false } }));
  assert.equal(host.finalJeopardy.data.media, null);
});

test('the break between rounds, and the end of the game, come back as themselves', () => {
  assert.equal(resumeView(playing({ phase: 'roundEnd' })).phase, 'roundEnd');
  assert.equal(resumeView(playing({ phase: 'finished' })).phase, 'finished');
  assert.equal(resumeView({ status: 'finished', gameState: null }).phase, 'finished');
});

test('Final Jeopardy is read the same way when the viewer is the host and sees it all', () => {
  /* The host of a hosted room is sent the room's own record, which says
     whether the clue is up rather than leaving it out. */
  const view = resumeView(playing({
    phase: 'finalJeopardy',
    finalJeopardy: { category: 'POETS', clue: 'He wrote it', answer: 'Who is Keats?', clueShown: false },
  }));
  assert.equal(view.finalJeopardy.phase, 'wager');
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
