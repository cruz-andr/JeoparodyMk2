/**
 * Verification harness for the settings that travel with a room.
 * Run with: node src/stores/settingsStore.test.js
 *
 * No framework, so it runs anywhere with zero install.
 */
import assert from 'node:assert/strict';
import {
  roomRulesFromSettings,
  PRESETS,
  QUESTION_TIME_LIMITS,
  ANSWER_TIME_LIMITS,
} from './settingsStore.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (err) { failures.push({ name, err }); }
}

const settings = {
  questionTimeLimit: 15000,
  answerTimeLimit: 5000,
  finalJeopardyTimeLimit: 45000,
  enableDoubleJeopardy: false,
  enableDailyDouble: false,
  enableFinalJeopardy: false,
  // personal, not a room rule
  soundEnabled: false,
  musicEnabled: false,
  volume: 0.1,
  showTimer: false,
  difficulty: 'hard',
};

test('every rule a room needs travels with it', () => {
  const rules = roomRulesFromSettings(settings);
  assert.equal(rules.questionTimeLimit, 15000);
  assert.equal(rules.answerTimeLimit, 5000);
  assert.equal(rules.finalJeopardyTimeLimit, 45000);
  assert.equal(rules.enableDoubleJeopardy, false);
  assert.equal(rules.enableDailyDouble, false);
  assert.equal(rules.enableFinalJeopardy, false);
});

test('turning a round off is carried, not lost to a default', () => {
  // The bug this guards: the room was built from hardcoded defaults where all
  // three were true, so switching them off in Settings did nothing.
  const rules = roomRulesFromSettings(settings, {
    enableDoubleJeopardy: true,
    enableDailyDouble: true,
    enableFinalJeopardy: true,
  });
  assert.equal(rules.enableDoubleJeopardy, false);
  assert.equal(rules.enableDailyDouble, false);
  assert.equal(rules.enableFinalJeopardy, false);
});

test('personal preferences stay with the player', () => {
  const rules = roomRulesFromSettings(settings);
  for (const key of ['soundEnabled', 'musicEnabled', 'volume', 'showTimer', 'difficulty']) {
    assert.equal(key in rules, false, `${key} is not a room rule`);
  }
});

test('room-only fields the settings do not own are preserved', () => {
  const rules = roomRulesFromSettings(settings, { maxPlayers: 6, answerMode: 'typed' });
  assert.equal(rules.maxPlayers, 6);
  assert.equal(rules.answerMode, 'typed');
});

test('an unlimited timer survives, rather than reading as missing', () => {
  const rules = roomRulesFromSettings({ ...settings, questionTimeLimit: null });
  assert.equal(rules.questionTimeLimit, null);
  assert.equal('questionTimeLimit' in rules, true);
});

// --- a preset must never set a value the screen cannot show ------------

test('every timer a preset sets is offered by the settings screen', () => {
  // The bug this guards: Speed Round set a 10 second limit that the screen did
  // not list, so picking it left the group with nothing selected. The preset
  // looked like it had done nothing and the timer was unreadable.
  const offered = QUESTION_TIME_LIMITS.map((o) => o.value);
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.ok(
      offered.includes(preset.questionTimeLimit),
      `${name} sets questionTimeLimit ${preset.questionTimeLimit}, which the screen does not offer`
    );
  }
});

test('every buzz-in window a preset sets is offered too', () => {
  const offered = ANSWER_TIME_LIMITS.map((o) => o.value);
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.ok(
      offered.includes(preset.answerTimeLimit),
      `${name} sets answerTimeLimit ${preset.answerTimeLimit}, which the screen does not offer`
    );
  }
});

test('every option is distinct and labelled', () => {
  for (const list of [QUESTION_TIME_LIMITS, ANSWER_TIME_LIMITS]) {
    const values = list.map((o) => o.value);
    assert.equal(new Set(values).size, values.length, 'no duplicate options');
    assert.ok(list.every((o) => typeof o.label === 'string' && o.label), 'every option is labelled');
  }
});

test('a preset that turns rounds off still reaches a room', () => {
  const rules = roomRulesFromSettings(PRESETS.casual, {
    enableDoubleJeopardy: true, enableDailyDouble: true, enableFinalJeopardy: true,
  });
  assert.equal(rules.enableDoubleJeopardy, false);
  assert.equal(rules.enableDailyDouble, false);
  assert.equal(rules.questionTimeLimit, null);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
