/**
 * Watching an episode together: one clock for the room, a stop at each clue
 * for everyone, and on again when all are in or the time is up.
 * Run with: node server/test/watchRooms.test.js
 */
import assert from 'node:assert/strict';
import { createWatchRooms } from '../socket/watchRooms.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; } catch (err) { failures.push(`${name}\n    ${err.stack}`); }
}

const board = {
  categories: [
    { name: 'PIRATES', questions: [{ points: 200, answer: 'The item', question: "What is Poseidon's Trident?" }, { points: 400, answer: 'b', question: 'What is Paprika?' }] },
    { name: 'BANDS', questions: [{ points: 200, answer: 'c', question: 'Who is Scat Cat?' }, { points: 400, answer: 'd', question: 'What is the Electric Mayhem?' }] },
  ],
  finalJeopardy: { category: 'FANTASIA 2000', answer: 'e', question: 'What is IMAX?' },
};
const watch = {
  youtube: 'aMS9UidTUUY',
  clues: [
    { column: 0, row: 0, at: 10, pause: 20 },
    { column: 1, row: 0, at: 30, pause: 40 },
    { column: 0, row: 1, at: 60, pause: 70 },
    { column: 1, row: 1, at: 90, pause: 100 },
  ],
  final: { at: 150, pause: 170 },
};

/** A room on a clock wound by hand: timers fire when the clock passes them. */
function harness() {
  let clock = 1_000_000;
  let timers = [];
  const states = [];
  const rooms = createWatchRooms({
    loadBoard: async (slug) => (slug === 'ep' ? { board, watch } : { board, watch: null }),
    emitState: (code, state) => states.push(state),
    now: () => clock,
    setTimer: (fn, ms) => { const t = { at: clock + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { timers = timers.filter((x) => x !== t); },
    random: () => 0,
  });
  const advance = (ms) => {
    const until = clock + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      clock = due.at;
      due.fn();
    }
    clock = until;
  };
  return { rooms, states, advance, last: () => states.at(-1) };
}

const ada = { id: 'ada', name: 'Ada' };
const bo = { id: 'bo', name: 'Bo' };

await test('a room is only for a board with an episode', async () => {
  const { rooms } = harness();
  await assert.rejects(rooms.create({ slug: 'plain', player: ada }), /no episode/);
});

await test('the creator drives; the clock waits for them to start it', async () => {
  const { rooms, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.join({ code, player: bo });
  assert.equal(last().hostId, 'ada');
  assert.equal(last().clock.playing, false);
  rooms.control({ code, playerId: 'bo', action: 'play' });
  assert.equal(last().clock.playing, false, 'only the driver plays it');
  rooms.control({ code, playerId: 'ada', action: 'play' });
  assert.equal(last().clock.playing, true);
});

await test('the clock stops everyone at a clue and opens the buzzer; first in answers, right goes on', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.join({ code, player: bo });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(19_000);
  assert.equal(last().current, null);
  advance(1_000);
  assert.equal(last().current.key, '0:0');
  assert.equal(last().current.phase, 'buzz');
  assert.equal(last().clock.playing, false);
  assert.equal(last().clock.position, 20);

  assert.equal(rooms.answer({ code, playerId: 'bo', key: '0:0', given: 'trident' }), null, 'no answering without ringing in');
  assert.equal(rooms.buzz({ code, playerId: 'bo', key: '0:0' }), true);
  assert.equal(rooms.buzz({ code, playerId: 'ada', key: '0:0' }), false, 'Bo was first');
  assert.equal(last().current.answering, 'bo');
  assert.deepEqual(rooms.answer({ code, playerId: 'bo', key: '0:0', given: 'trident' }), { correct: true, points: 200 });
  assert.equal(last().current, null);
  assert.equal(last().clock.playing, true);
  assert.equal(last().players.find((p) => p.id === 'bo').score, 200);
  assert.ok(last().asked.includes('0:0'));
});

await test('wrong costs the clue, and the others may ring in; nobody left and it goes on', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.join({ code, player: bo });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(20_000);
  rooms.buzz({ code, playerId: 'ada', key: '0:0' });
  assert.deepEqual(rooms.answer({ code, playerId: 'ada', key: '0:0', given: 'a spear' }), { correct: false, points: -200 });
  assert.equal(last().current.phase, 'buzz', 'open again');
  assert.equal(rooms.buzz({ code, playerId: 'ada', key: '0:0' }), false, 'not twice');
  assert.equal(rooms.buzz({ code, playerId: 'bo', key: '0:0' }), true);
  rooms.answer({ code, playerId: 'bo', key: '0:0', given: 'a net' });
  assert.equal(last().current, null, 'both tried: on with the video');
  assert.deepEqual(last().players.map((p) => p.score), [-200, -200]);
});

await test('silence on the clock is a wrong answer', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(20_000);
  rooms.buzz({ code, playerId: 'ada', key: '0:0' });
  advance(12_000);
  assert.equal(last().players[0].score, -200);
  assert.equal(last().current, null);
});

await test('a close spelling gets one more go, then counts as given', async () => {
  const { rooms, advance } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(20_000);
  rooms.buzz({ code, playerId: 'ada', key: '0:0' });
  assert.deepEqual(rooms.answer({ code, playerId: 'ada', key: '0:0', given: 'Posiedon Tridnet' }), { retry: true });
  assert.equal(rooms.answer({ code, playerId: 'ada', key: '0:0', given: 'Posiedon Tridnet' }).correct, false);
});

await test('nobody rings in: the buzzer closes and the video goes on', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(20_000);
  assert.equal(last().current.key, '0:0');
  advance(15_000);
  assert.equal(last().current, null);
  assert.equal(last().clock.playing, true);
  assert.equal(last().players[0].score, 0, 'not ringing in costs nothing');
  advance(20_000);
  assert.equal(last().current.key, '1:0', 'and stops at the next one');
});

await test('the driver playing with the buzzer open moves on from the clue', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(20_000);
  rooms.control({ code, playerId: 'ada', action: 'play' });
  assert.equal(last().current, null);
  assert.equal(last().clock.playing, true);
});

await test('a square sends everyone to that clue as it comes up', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.control({ code, playerId: 'ada', action: 'clue', column: 1, row: 1 });
  assert.equal(last().clock.position, 89);
  assert.equal(last().clock.playing, true);
  advance(11_000);
  assert.equal(last().current.key, '1:1', 'the clues it went past are not asked');
});

await test('Final is everyone\'s: a wager no bigger than the score, and a player at zero sits it out', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.join({ code, player: bo });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(20_000);
  rooms.buzz({ code, playerId: 'ada', key: '0:0' });
  rooms.answer({ code, playerId: 'ada', key: '0:0', given: 'trident' });
  rooms.control({ code, playerId: 'ada', action: 'seek', t: 165 });
  advance(5_000);
  assert.equal(last().current.key, 'final');
  assert.equal(last().current.phase, 'final');
  assert.deepEqual(last().current.answered, ['bo'], 'Bo has nothing to wager');
  assert.deepEqual(rooms.answer({ code, playerId: 'ada', key: 'final', given: 'imax', wager: 5000 }), { correct: true, points: 200 });
  assert.equal(last().players.find((p) => p.id === 'ada').score, 400);
});

await test('right takes the board: the last one right drives, as in multiplayer', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.join({ code, player: bo });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(20_000);
  rooms.buzz({ code, playerId: 'bo', key: '0:0' });
  rooms.answer({ code, playerId: 'bo', key: '0:0', given: 'trident' });
  assert.equal(last().hostId, 'bo');
  rooms.control({ code, playerId: 'ada', action: 'clue', column: 1, row: 1 });
  assert.notEqual(last().clock.position, 89, 'Ada no longer picks');
  rooms.control({ code, playerId: 'bo', action: 'clue', column: 1, row: 1 });
  assert.equal(last().clock.position, 89, 'Bo picks the next clue');
  advance(11_000);
  rooms.buzz({ code, playerId: 'ada', key: '1:1' });
  rooms.answer({ code, playerId: 'ada', key: '1:1', given: 'a muppet band' });
  assert.equal(last().hostId, 'bo', 'wrong does not take it');
  rooms.buzz({ code, playerId: 'bo', key: '1:1' });
  rooms.answer({ code, playerId: 'bo', key: '1:1', given: 'nobody' });
  rooms.overrule({ code, playerId: 'ada', key: '1:1' });
  assert.equal(last().hostId, 'ada', '"I had it" with nobody else right takes it');
});

await test('"I had it" turns a wrong right, once', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(20_000);
  rooms.buzz({ code, playerId: 'ada', key: '0:0' });
  rooms.answer({ code, playerId: 'ada', key: '0:0', given: 'a spear' });
  assert.equal(last().players[0].score, -200);
  rooms.overrule({ code, playerId: 'ada', key: '0:0' });
  rooms.overrule({ code, playerId: 'ada', key: '0:0' });
  assert.equal(last().players[0].score, 200);
});

await test('a player who drops while answering lets the buzzer go, the next one drives, and back in keeps the score', async () => {
  const { rooms, advance, last } = harness();
  const code = await rooms.create({ slug: 'ep', player: ada });
  rooms.join({ code, player: bo });
  rooms.control({ code, playerId: 'ada', action: 'play' });
  advance(20_000);
  rooms.buzz({ code, playerId: 'bo', key: '0:0' });
  rooms.answer({ code, playerId: 'bo', key: '0:0', given: 'trident' });
  advance(20_000);
  rooms.buzz({ code, playerId: 'ada', key: '1:0' });
  rooms.leave({ code, playerId: 'ada' });
  assert.equal(last().current.phase, 'buzz', 'open again for Bo');
  assert.equal(last().current.answering, null);
  assert.equal(last().hostId, 'bo');
  rooms.join({ code, player: ada });
  assert.equal(last().hostId, 'bo', 'Bo keeps driving');
  rooms.join({ code, player: { id: 'bo', name: 'Bo' } });
  assert.equal(last().players.find((p) => p.id === 'bo').score, 200);
  assert.equal(last().players.find((p) => p.id === 'ada').score, 0, 'leaving costs nothing');
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
