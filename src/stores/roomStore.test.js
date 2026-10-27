/**
 * The multiplayer room store.
 * Run with: node src/stores/roomStore.test.js
 */
import assert from 'node:assert/strict';
import { useRoomStore } from './roomStore.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    useRoomStore.getState().resetRoom();
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

const ada = { id: 'ada', displayName: 'Ada', score: 0, isConnected: true };

test('a player already in the room is not added a second time', () => {
  const room = useRoomStore.getState();
  room.addPlayer(ada);
  room.updatePlayerScore('ada', 800);
  room.updatePlayer('ada', { isConnected: false });
  useRoomStore.getState().addPlayer({ ...ada });

  const { players } = useRoomStore.getState();
  assert.equal(players.length, 1);
  assert.equal(players[0].score, 800, 'and keeps what they had');
  assert.equal(players[0].isConnected, true);
});

test('a new player is added', () => {
  const room = useRoomStore.getState();
  room.addPlayer(ada);
  room.addPlayer({ ...ada, id: 'grace', displayName: 'Grace' });
  assert.deepEqual(useRoomStore.getState().players.map((p) => p.id), ['ada', 'grace']);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
