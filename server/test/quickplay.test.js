/**
 * Quickplay run by the house: the director, the board source, the bots.
 * Run with: node server/test/quickplay.test.js
 *
 * Every timer here is fake and every roll of the dice is scripted, so a whole
 * game plays out in milliseconds and the same way every time.
 */
import assert from 'node:assert/strict';
import { GameStateManager } from '../socket/GameStateManager.js';
import { createGameActions } from '../socket/actions.js';
import { createBoardSource, createQuickplayDirector, gameFromEpisode, toGrid, DEAL_AFTER_MS } from '../socket/quickplay.js';
import {
  ROSTER, seatBots, knows, buzzDelayMs, readingMs, pickCell, finalWager, dailyDoubleWager,
} from '../socket/bots.js';
import { FALLBACK_GAME } from '../data/quickplayBoards.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push({ name, err }); }
}
const atest = async (name, fn) => {
  try { await fn(); passed += 1; } catch (err) { failures.push({ name, err }); }
};

// --- a clock we own -------------------------------------------------------

function mkClock() {
  let now = 0;
  let seq = 0;
  const due = new Map(); // id -> { at, fn }
  const setTimeout = (fn, ms) => { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; };
  const clearTimeout = (id) => { due.delete(id); };
  /* Advance, firing timers in order. Timers a timer schedules fire too if
     they fall inside the window. */
  async function advance(ms) {
    const until = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of due) if (t.at <= until && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      due.delete(next.id);
      now = next.t.at;
      next.t.fn();
      await Promise.resolve(); // let a resolved await (the deal) settle
      await Promise.resolve();
    }
    now = until;
  }
  return { setTimeout, clearTimeout, advance, now: () => now, pending: () => due.size };
}

/* Dice that always land the same way: 0.01 knows everything and buzzes at
   once; 0.99 knows nothing and never guesses. */
const always = (v) => () => v;

/** A seated quickplay table: one person, two bots, everything wired. */
function mkTable({ random = always(0.5), people = 1, preset = 'standard', game = FALLBACK_GAME } = {}) {
  const clock = mkClock();
  /* No jitter here: these tests are about what the director does once a game
     is filled, not about the window it is filled in. */
  const gm = new GameStateManager({ now: clock.now, fillWithBots: true, botFillJitterMs: 0, random });
  const heard = []; // every event the room was told
  const emitRoom = (code, event, payload) => {
    heard.push({ code, event, payload });
    director.onRoomEvent(code, event, payload);
  };
  const actions = createGameActions({ gameManager: gm, emitRoom, archiveRoom: () => {}, setTimeout: clock.setTimeout });
  const boardSource = { take: async () => JSON.parse(JSON.stringify(game)), prepare: async () => {} };
  const director = createQuickplayDirector({
    gameManager: gm, actions, boardSource, random,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });

  const humans = Array.from({ length: people }, (_, i) => ({ id: `s-${i}`, sessionId: `person-${i}` }));
  humans.forEach((s, i) => gm.joinMatchmakingQueue(s, `Person ${i}`, null, preset));
  clock.advance(20_000);
  const { match } = gm.tryCreateMatch();
  director.onMatch(match);
  const room = gm.rooms.get(match.roomCode);
  const bots = [...room.players.values()].filter((p) => p.isBot).map((p) => p.id);
  const events = (name) => heard.filter((h) => h.event === name);
  return { clock, gm, actions, director, heard, events, room, code: match.roomCode, humans, bots, match };
}

// =========================================================================
// the bots, on their own
// =========================================================================

test('the roster seats distinct people, avoiding names already at the table', () => {
  const seats = seatBots(2, { taken: ['priya', 'Marcus'], random: always(0) });
  assert.equal(seats.length, 2);
  assert.notEqual(seats[0].displayName, seats[1].displayName);
  assert.ok(!seats.some((s) => ['Priya', 'Marcus'].includes(s.displayName)));
  assert.ok(seats.every((s) => s.socket.sessionId.startsWith('bot-')));
  assert.ok(seats.every((s) => s.isBot && s.profile && s.signature === null));
});

test('every regular knows the cheap rows better than the expensive ones', () => {
  for (const profile of ROSTER) {
    assert.ok(profile.skill > 0.5 && profile.skill < 0.9, `${profile.name} is neither hopeless nor perfect`);
    const p0 = knows(profile, 0, always(profile.skill - 0.01));
    const p4 = knows(profile, 4, always(profile.skill - 0.01));
    assert.equal(p0, true);
    assert.equal(p4, false, `${profile.name}: the same roll fails on the bottom row`);
  }
});

test('a bot reads before it buzzes, and a long clue takes longer', () => {
  const short = 'Capital of France';
  const long = 'This 1994 film follows a slow-witted man through Vietnam, a ping-pong career and a shrimp business';
  assert.ok(readingMs(long) > readingMs(short));
  const quick = ROSTER.find((b) => b.speed >= 0.8);
  assert.ok(buzzDelayMs(quick, short, { random: always(0) }) >= 1000, 'never inside a second');
  assert.ok(buzzDelayMs(quick, long, { random: always(0) }) > buzzDelayMs(quick, short, { random: always(0) }));
});

test('picks stay on the board and never land on a revealed clue', () => {
  const questions = FALLBACK_GAME.round1.questions;
  const revealed = new Set(['0-0', '0-1', '0-2', '0-3', '0-4', '1-0']);
  for (const profile of ROSTER) {
    for (const r of [0, 0.19, 0.21, 0.5, 0.99]) {
      const cell = pickCell(profile, questions, (c, p) => revealed.has(`${c}-${p}`), { categoryIndex: 0, pointIndex: 4 }, always(r));
      assert.ok(cell, `${profile.name} picks something`);
      assert.ok(!revealed.has(`${cell.categoryIndex}-${cell.pointIndex}`), `${profile.name} at ${r} picks a live clue`);
    }
  }
  const all = new Set();
  questions.forEach((col, c) => col.forEach((_, p) => all.add(`${c}-${p}`)));
  assert.equal(pickCell(ROSTER[0], questions, (c, p) => all.has(`${c}-${p}`), null, always(0.5)), null, 'a cleared board has no pick');
});

test('a column player works down the category it is in', () => {
  const column = ROSTER.find((b) => b.style === 'column');
  const cell = pickCell(column, FALLBACK_GAME.round1.questions, (c, p) => c === 3 && p < 2, { categoryIndex: 3, pointIndex: 1 }, always(0.5));
  assert.deepEqual(cell, { categoryIndex: 3, pointIndex: 2 });
});

test('final wagers follow the show: a leader covers, a trailer goes big, a zero sits out', () => {
  assert.equal(finalWager(0, [5000], always(0.5)), 0);
  const lead = finalWager(10000, [6000, 2000], always(0));
  assert.equal(lead, 2001, 'enough to beat second place doubled');
  const trail = finalWager(4000, [10000], always(0.5));
  assert.ok(trail >= 2400 && trail <= 4000, `most of what they have: ${trail}`);
});

test('daily double wagers are at least $5 and never absurd', () => {
  for (const profile of ROSTER) {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const w = dailyDoubleWager(profile, 1800, 1, always(r));
      assert.ok(w >= 5 && w <= 1800, `${profile.name}: ${w}`);
    }
  }
});

// =========================================================================
// the board source
// =========================================================================

test('an episode becomes two grids and a final', () => {
  const clues = [];
  for (const round of ['jeopardy', 'double_jeopardy']) {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
      clues.push({ round, category: `${round}-cat${c}`, clue: `clue ${c}${r}`, answer: `ans ${c}${r}`, value: 200 });
    }
  }
  const game = gameFromEpisode({ gameId: 42, clues, final: { category: 'F', clue: 'the clue', answer: 'the answer' } });
  assert.equal(game.source, 'j-archive:42');
  assert.equal(game.round1.questions.length, 6);
  assert.equal(game.round1.questions[2].length, 5);
  assert.equal(game.round1.questions[2][4].points, 1000);
  assert.equal(game.round2.questions[2][4].points, 2000);
  assert.equal(game.round1.questions[1][3].answer, 'clue 13', 'the shown text is the clue');
  assert.equal(game.round1.questions[1][3].question, 'ans 13', 'the response is the answer');
  assert.deepEqual(game.final, { category: 'F', answer: 'the clue', question: 'the answer' });
  assert.equal(gameFromEpisode({ gameId: 1, clues: clues.slice(0, 30) }), null, 'one round is not a game');
});

test('the house board is a complete game', () => {
  for (const round of [FALLBACK_GAME.round1, FALLBACK_GAME.round2]) {
    assert.equal(round.categories.length, 6);
    assert.equal(round.questions.length, 6);
    for (const column of round.questions) {
      assert.equal(column.length, 5);
      for (const q of column) assert.ok(q.answer && q.question && q.points && q.revealed === false);
    }
  }
  assert.ok(FALLBACK_GAME.final.category && FALLBACK_GAME.final.answer && FALLBACK_GAME.final.question);
  assert.equal(toGrid({ categories: ['a'], questions: [1, 2, 3, 4, 5] })[0].length, 5);
});

await atest('the static source never fetches; the archive source falls back to the house board', async () => {
  let fetched = 0;
  const still = createBoardSource({ mode: 'static', fetchGame: async () => { fetched++; throw new Error('no'); } });
  const a = await still.take();
  assert.equal(a.source, 'house');
  assert.equal(fetched, 0);

  const archive = createBoardSource({ mode: 'archive', attempts: 2, fetchGame: async () => { fetched++; throw new Error('offline'); } });
  const b = await archive.take();
  assert.equal(b.source, 'house', 'offline, the written board is dealt');
  assert.ok(fetched >= 2);

  b.round1.questions[0][0].revealed = true;
  const c = await archive.take();
  assert.equal(c.round1.questions[0][0].revealed, false, 'each table gets its own copy');
});

// =========================================================================
// the director
// =========================================================================

await atest('the board is dealt a few seconds after the table is seated, to a random picker', async () => {
  const t = mkTable();
  assert.equal(t.events('game:questions-ready').length, 0);
  await t.clock.advance(DEAL_AFTER_MS - 1);
  assert.equal(t.events('game:questions-ready').length, 0, 'not yet');
  await t.clock.advance(1);
  const [ready] = t.events('game:questions-ready');
  assert.ok(ready, 'dealt');
  assert.equal(ready.payload.categories.length, 6);
  assert.ok(t.room.players.has(ready.payload.firstPickerId));
  assert.equal(t.room.status, 'in_progress');
  assert.equal(t.room.settings.questionTimeLimit, 30000);
});

await atest('a bot holding the pick opens a clue, rings in, answers, and the next pick follows', async () => {
  /* Dice at 0.01: the bot knows everything and answers correctly. */
  const t = mkTable({ random: always(0.01) });
  await t.clock.advance(DEAL_AFTER_MS);
  const picker = t.events('game:questions-ready')[0].payload.firstPickerId;
  /* With rolls at 0.01 the person is seated first and the random picker is
     index 0: the person. Hand the pick to a bot to watch it move. */
  t.room.gameState.currentPickerId = t.bots[0];
  t.director.onRoomEvent(t.code, 'game:all-continued', { nextPickerId: t.bots[0] });
  assert.ok(picker, 'sanity');

  /* Dice at 0.01 look for about 1.8s, plus the 1.2s the board takes to draw. */
  await t.clock.advance(3200);
  const [selected] = t.events('game:question-selected');
  assert.ok(selected, 'the bot picked a clue');
  assert.equal(selected.payload.pickerId, t.bots[0]);
  assert.ok(t.room.gameState.buzzWindowOpen, 'the buzzer opened');
  assert.equal(t.events('game:buzzer-winner').length, 0, 'and nobody has rung in inside a second of it');

  await t.clock.advance(9000);
  const [winner] = t.events('game:buzzer-winner');
  assert.ok(winner, 'a bot rang in');
  assert.ok(t.bots.includes(winner.payload.playerId));

  await t.clock.advance(5000);
  const [answered] = t.events('game:answer-result');
  assert.ok(answered, 'and answered');
  assert.equal(answered.payload.correct, true);
  assert.ok(answered.payload.newScore > 0);
  assert.equal(t.room.gameState.currentQuestion, null, 'the clue closed');

  await t.clock.advance(12000);
  assert.ok(t.events('game:question-selected').length >= 2, 'the winner picks again');
  assert.ok(t.events('game:question-selected').slice(1).every((e) => e.payload.pickerId === winner.payload.playerId),
    'and it is the winner who holds the pick');
});

await atest('bots that know nothing pass, and the clue ends before the clock runs out', async () => {
  const t = mkTable({ random: always(0.99) });
  await t.clock.advance(DEAL_AFTER_MS);
  /* The person picks. */
  t.room.gameState.currentPickerId = t.humans[0].sessionId;
  t.actions.selectQuestion(t.humans[0].sessionId, t.code, 0, 0);
  await t.clock.advance(15000);
  assert.equal(t.events('game:buzzer-winner').length, 0, 'nobody rang in');
  /* Dice at 0.99: nobody guesses and nobody passes either, so the clock runs. */
  assert.equal(t.events('game:buzz-timeout-result').length, 0);
  await t.clock.advance(16000);
  assert.equal(t.events('game:buzz-timeout-result').length, 1, 'the buzzer clock closes the clue');
  await t.clock.advance(3000);
  /* The bots press Continue; the person has not, so the board waits for them. */
  assert.equal(t.events('game:all-continued').length, 0);
  t.actions.timeoutContinue(t.humans[0].sessionId, t.code);
  assert.equal(t.events('game:all-continued').length, 1);
});

await atest('a bot that does not know says so, and everyone passing ends the clue early', async () => {
  /* 0.5: skill about 0.7 at row 0 means the bot knows; row 4 it does not. Nerve
     is under 0.5 for every bot, so none guesses; 0.5 < 0.75 so they pass. */
  const t = mkTable({ random: always(0.5) });
  await t.clock.advance(DEAL_AFTER_MS);
  t.room.gameState.currentPickerId = t.humans[0].sessionId;
  t.actions.selectQuestion(t.humans[0].sessionId, t.code, 0, 4);
  await t.clock.advance(12000);
  assert.equal(t.events('game:player-skipped').length, 2, 'both bots passed');
  assert.equal(t.events('game:buzz-timeout-result').length, 0, 'the person has not passed yet');
  t.actions.skipQuestion(t.humans[0].sessionId, t.code);
  assert.equal(t.events('game:buzz-timeout-result').length, 1, 'all passed: the clue is over');
});

await atest('when a person answers wrong, a bot that knows takes the rebound', async () => {
  const t = mkTable({ random: always(0.01) });
  await t.clock.advance(DEAL_AFTER_MS);
  t.room.gameState.currentPickerId = t.humans[0].sessionId;
  t.actions.selectQuestion(t.humans[0].sessionId, t.code, 2, 0);
  /* The person is quicker than any bot's reading time. */
  t.actions.buzz(t.humans[0].sessionId, t.code, 100);
  await t.clock.advance(600);
  assert.equal(t.events('game:buzzer-winner')[0].payload.playerId, t.humans[0].sessionId);
  t.actions.submitAnswer(t.humans[0].sessionId, t.code, false);
  const [wrong] = t.events('game:answer-result');
  assert.equal(wrong.payload.canBuzzAgain, true);
  await t.clock.advance(4000);
  const winners = t.events('game:buzzer-winner');
  assert.equal(winners.length, 2, 'a bot rang in on the rebound');
  assert.ok(t.bots.includes(winners[1].payload.playerId));
});

await atest('a cleared board moves the table to Double Jeopardy, the trailer picking first', async () => {
  const t = mkTable({ random: always(0.01) });
  await t.clock.advance(DEAL_AFTER_MS);
  const gs = t.room.gameState;
  /* Reveal everything but one clue by hand, then have the person answer it. */
  gs.questions.forEach((col) => col.forEach((q) => { q.revealed = true; }));
  gs.questions[5][4].revealed = false;
  t.room.players.get(t.bots[1]).score = -600;
  gs.currentPickerId = t.humans[0].sessionId;
  t.actions.selectQuestion(t.humans[0].sessionId, t.code, 5, 4);
  t.actions.buzz(t.humans[0].sessionId, t.code, 50);
  await t.clock.advance(600);
  t.actions.submitAnswer(t.humans[0].sessionId, t.code, true);
  await t.clock.advance(4000);
  assert.equal(t.events('game:round-ended').length, 1, 'round one is over');
  assert.equal(t.events('game:round-2-started').length, 0, 'the standings get a moment');
  await t.clock.advance(7000);
  const [r2] = t.events('game:round-2-started');
  assert.ok(r2, 'Double Jeopardy dealt');
  assert.equal(r2.payload.firstPickerId, t.bots[1], 'the trailing player picks first');
  assert.equal(r2.payload.questions[0][4].points, 2000);
  assert.equal(t.room.gameState.currentRound, 2);
});

await atest('after Double Jeopardy the house runs Final Jeopardy and closes the game', async () => {
  const t = mkTable({ random: always(0.01) });
  await t.clock.advance(DEAL_AFTER_MS);
  const gs = t.room.gameState;
  gs.currentRound = 2;
  gs.questions.forEach((col) => col.forEach((q) => { q.revealed = true; }));
  gs.questions[0][0].revealed = false;
  for (const id of t.bots) t.room.players.get(id).score = 3000;
  t.room.players.get(t.humans[0].sessionId).score = 5000;
  gs.currentPickerId = t.humans[0].sessionId;
  t.actions.selectQuestion(t.humans[0].sessionId, t.code, 0, 0);
  t.actions.buzz(t.humans[0].sessionId, t.code, 50);
  await t.clock.advance(600);
  t.actions.submitAnswer(t.humans[0].sessionId, t.code, true);
  await t.clock.advance(4000);
  const [fj] = t.events('game:final-jeopardy-started');
  assert.ok(fj, 'Final Jeopardy started');
  assert.equal(fj.payload.category, FALLBACK_GAME.final.category, 'the game\'s own final, not a stock one');
  assert.equal(fj.payload.eligibleCount, 3);

  await t.clock.advance(10000);
  assert.equal(t.events('game:fj-show-clue').length, 0, 'the person has not wagered');
  t.actions.fjWager(t.humans[0].sessionId, t.code, 1000);
  assert.equal(t.events('game:fj-show-clue').length, 1, 'both bots had');

  await t.clock.advance(18000);
  assert.equal(t.events('game:fj-reveal').length, 0, 'waiting on the person\'s answer');
  t.actions.fjAnswer(t.humans[0].sessionId, t.code, 'what is neptune');
  const [reveal] = t.events('game:fj-reveal');
  assert.ok(reveal);
  const mine = reveal.payload.results.find((r) => r.playerId === t.humans[0].sessionId);
  assert.equal(mine.correct, true);
  assert.equal(mine.finalScore, 5000 + 200 + 1000, 'the last clue (a $200 cell on this grid), then the wager');
  const theirs = reveal.payload.results.filter((r) => r.playerId !== t.humans[0].sessionId);
  assert.ok(theirs.every((r) => r.correct), 'bots that know it answer with the real response');

  assert.equal(t.events('game:ended').length, 0);
  await t.clock.advance(14000);
  assert.equal(t.events('game:ended').length, 1, 'the standings, then the end');
  assert.equal(t.director.isRunning(t.code), false, 'and the table is put away');
});

await atest('the speed table skips Double Jeopardy and Final Jeopardy', async () => {
  const t = mkTable({ random: always(0.01), preset: 'speed' });
  await t.clock.advance(DEAL_AFTER_MS);
  assert.equal(t.room.settings.questionTimeLimit, 15000);
  const gs = t.room.gameState;
  gs.questions.forEach((col) => col.forEach((q) => { q.revealed = true; }));
  gs.questions[0][0].revealed = false;
  gs.currentPickerId = t.humans[0].sessionId;
  t.actions.selectQuestion(t.humans[0].sessionId, t.code, 0, 0);
  t.actions.buzz(t.humans[0].sessionId, t.code, 50);
  await t.clock.advance(600);
  t.actions.submitAnswer(t.humans[0].sessionId, t.code, true);
  await t.clock.advance(4000);
  assert.equal(t.events('game:round-ended').length, 0);
  assert.equal(t.events('game:final-jeopardy-started').length, 0);
  assert.equal(t.events('game:ended').length, 1, 'one round, then the standings');
});

await atest('a bot picking a Daily Double wagers and answers on its own', async () => {
  const t = mkTable({ random: always(0.01) });
  await t.clock.advance(DEAL_AFTER_MS);
  const gs = t.room.gameState;
  gs.dailyDoubles = [{ categoryIndex: 1, pointIndex: 1 }];
  gs.currentPickerId = t.bots[0];
  const bot = t.director; // the director watches the pick land
  assert.ok(bot);
  t.actions.selectQuestion(t.bots[0], t.code, 1, 1);
  assert.equal(t.events('game:question-selected')[0].payload.isDailyDouble, true);
  await t.clock.advance(6000);
  assert.equal(t.events('game:daily-double-wager-confirmed').length, 1, 'wagered');
  await t.clock.advance(8000);
  const [result] = t.events('game:daily-double-result');
  assert.ok(result, 'answered');
  assert.equal(result.payload.playerId, t.bots[0]);
  assert.equal(result.payload.correct, true);
  assert.ok(result.payload.newScore >= 5);
});

await atest('a table nobody is left at is cleared after a minute, not played by bots', async () => {
  const t = mkTable();
  await t.clock.advance(DEAL_AFTER_MS);
  t.gm.handleDisconnect(t.humans[0]);
  t.director.onPlayerGone(t.code);
  await t.clock.advance(59_000);
  assert.ok(t.gm.rooms.has(t.code), 'a reload has time to come back');
  await t.clock.advance(2_000);
  assert.equal(t.gm.rooms.has(t.code), false, 'gone');
  assert.equal(t.director.isRunning(t.code), false);
});

await atest('a person who comes back within the minute keeps the table', async () => {
  const t = mkTable();
  await t.clock.advance(DEAL_AFTER_MS);
  t.gm.handleDisconnect(t.humans[0]);
  t.director.onPlayerGone(t.code);
  await t.clock.advance(30_000);
  t.gm.reconnectPlayer({ id: 's-9', sessionId: t.humans[0].sessionId }, t.code);
  await t.clock.advance(40_000);
  assert.ok(t.gm.rooms.has(t.code), 'still here');
});

await atest('the match payload carries the settings and marks the house seats', async () => {
  const t = mkTable({ preset: 'speed' });
  assert.equal(t.match.settings.questionTimeLimit, 15000);
  assert.deepEqual(t.match.players.map((p) => p.isBot), [false, true, true]);
  assert.ok(t.match.players.slice(1).every((p) => p.signature === null && p.displayName));
});

// --- report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n').slice(0, 3).join('\n        ')}`);
}
process.exit(failures.length ? 1 : 0);
