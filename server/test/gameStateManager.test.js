/**
 * Verification harness for GameStateManager.
 * Run with: node server/test/gameStateManager.test.js
 *
 * No framework — plain assertions so it runs anywhere with zero install.
 */
import assert from 'node:assert/strict';
import { GameStateManager, placeDailyDoubles } from '../socket/GameStateManager.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

// --- helpers -------------------------------------------------------------

let socketSeq = 0;
const mkSocket = (sessionId) => ({
  id: `socket-${socketSeq++}`,
  sessionId: sessionId || `session-${socketSeq}`,
});

// Builds a 6x5 board where every clue is worth (pointIndex+1)*200.
const mkBoard = (categories = 6, rows = 5) =>
  Array.from({ length: categories }, (_, c) =>
    Array.from({ length: rows }, (_, r) => ({
      category: `CAT${c}`,
      points: (r + 1) * 200,
      answer: `clue ${c}-${r}`,
      question: `What is answer ${c}-${r}?`,
      revealed: false,
    }))
  );

/** Room with `count` players mid-game, first player holding the pick. */
function mkGame({ count = 3, type = 'multiplayer', settings = {} } = {}) {
  const gm = new GameStateManager();
  const sockets = Array.from({ length: count }, () => mkSocket());
  const room = gm.createRoom(type, sockets[0], { enableDailyDouble: false, ...settings });
  sockets.forEach((s, i) => gm.joinRoom(s, room.code, `Player${i}`));
  gm.setQuestions(room.code, mkBoard(), ['A', 'B', 'C', 'D', 'E', 'F'], sockets[0].sessionId);
  return { gm, room, sockets, code: room.code };
}

// =========================================================================
// 1. Buzzer deadlock
// =========================================================================

test('recordBuzz rejects a buzz when no window is open', () => {
  const { gm, code, sockets } = mkGame();
  gm.selectQuestion(sockets[0], code, 0, 0);
  // selectQuestion does not open the window; the handler does.
  assert.equal(gm.recordBuzz(code, sockets[1].sessionId, 10), false);
});

test('recordBuzz accepts the first eligible buzz and marks buzzReceived', () => {
  const { gm, code, sockets, room } = mkGame();
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);
  assert.equal(gm.recordBuzz(code, sockets[1].sessionId, 10), true);
  assert.equal(room.gameState.buzzReceived, true);
});

test('a re-buzz from a player who already answered is rejected and leaves buzzReceived false', () => {
  const { gm, code, sockets, room } = mkGame();
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);

  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);
  const result = gm.handleAnswer(code, sockets[1].sessionId, false);
  assert.equal(result.canBuzzAgain, true, 'two other players remain');

  // New window for the remaining players.
  gm.startBuzzWindow(code);
  assert.equal(room.gameState.buzzReceived, false, 'window resets the flag');

  // The player who already had their shot buzzes again.
  assert.equal(gm.recordBuzz(code, sockets[1].sessionId, 5), false, 'rejected');
  assert.equal(
    room.gameState.buzzReceived,
    false,
    'a rejected buzz must not suppress the timeout — this was the deadlock'
  );
});

test('a second buzz after a winner is locked in is rejected', () => {
  const { gm, code, sockets } = mkGame();
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);
  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);
  assert.equal(gm.recordBuzz(code, sockets[2].sessionId, 20), false);
});

// =========================================================================
// 2. Server-authoritative scoring
// =========================================================================

test('handleAnswer scores from the board, ignoring any client value', () => {
  const { gm, code, sockets, room } = mkGame();
  gm.selectQuestion(sockets[0], code, 2, 3); // (3+1)*200 = 800
  gm.startBuzzWindow(code);
  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);

  const res = gm.handleAnswer(code, sockets[1].sessionId, true, 999999);
  assert.equal(res.newScore, 800);
  assert.equal(room.players.get(sockets[1].sessionId).score, 800);
});

test('a wrong answer deducts the board value', () => {
  const { gm, code, sockets } = mkGame();
  gm.selectQuestion(sockets[0], code, 0, 0); // 200
  gm.startBuzzWindow(code);
  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);
  assert.equal(gm.handleAnswer(code, sockets[1].sessionId, false).newScore, -200);
});

test('a player who did not buzz cannot submit an answer', () => {
  const { gm, code, sockets } = mkGame();
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);
  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);
  assert.equal(gm.handleAnswer(code, sockets[2].sessionId, true), null);
});

// =========================================================================
// 3. Wager clamping
// =========================================================================

test('a Daily Double wager is capped at the board maximum when the score is low', () => {
  const { gm, code, sockets, room } = mkGame({ settings: { enableDailyDouble: true } });
  room.gameState.dailyDoubles = [{ categoryIndex: 0, pointIndex: 0 }];
  gm.selectQuestion(sockets[0], code, 0, 0);
  // Round 1 board max is 1000 and the picker has $0.
  assert.equal(gm.handleDailyDoubleWager(code, sockets[0].sessionId, 999999).wager, 1000);
});

test('a Daily Double wager is capped at the score when the score is high', () => {
  const { gm, code, sockets, room } = mkGame({ settings: { enableDailyDouble: true } });
  room.players.get(sockets[0].sessionId).score = 5000;
  room.gameState.dailyDoubles = [{ categoryIndex: 0, pointIndex: 0 }];
  gm.selectQuestion(sockets[0], code, 0, 0);
  assert.equal(gm.handleDailyDoubleWager(code, sockets[0].sessionId, 99999).wager, 5000);
});

test('a negative Daily Double wager is floored at $5', () => {
  const { gm, code, sockets, room } = mkGame({ settings: { enableDailyDouble: true } });
  room.gameState.dailyDoubles = [{ categoryIndex: 0, pointIndex: 0 }];
  gm.selectQuestion(sockets[0], code, 0, 0);
  assert.equal(gm.handleDailyDoubleWager(code, sockets[0].sessionId, -5000).wager, 5);
});

test('only the picker may wager on a Daily Double', () => {
  const { gm, code, sockets, room } = mkGame({ settings: { enableDailyDouble: true } });
  room.gameState.dailyDoubles = [{ categoryIndex: 0, pointIndex: 0 }];
  gm.selectQuestion(sockets[0], code, 0, 0);
  assert.equal(gm.handleDailyDoubleWager(code, sockets[1].sessionId, 500), null);
});

test('a Final Jeopardy wager cannot exceed the player score', () => {
  const { gm, code, sockets, room } = mkGame();
  room.players.get(sockets[0].sessionId).score = 1200;
  gm.startFinalJeopardy(code);
  gm.submitFJWager(code, sockets[0].sessionId, 99999);
  assert.equal(room.gameState.finalJeopardy.wagers.get(sockets[0].sessionId), 1200);
});

test('a negative Final Jeopardy wager is floored at zero', () => {
  const { gm, code, sockets, room } = mkGame();
  room.players.get(sockets[0].sessionId).score = 1200;
  gm.startFinalJeopardy(code);
  gm.submitFJWager(code, sockets[0].sessionId, -500);
  assert.equal(room.gameState.finalJeopardy.wagers.get(sockets[0].sessionId), 0);
});

// =========================================================================
// 4. Multiple choice
// =========================================================================

test('multiple-choice options are shuffled and the correct index tracked', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const room = gm.createRoom('host', host, {});
  const board = mkBoard(1, 1);
  board[0][0].options = ['RIGHT', 'wrong1', 'wrong2', 'wrong3'];
  gm.setHostQuestions(room.code, board, ['A'], host.sessionId);

  // Over many deals the answer must not always land on A.
  const positions = new Set();
  for (let i = 0; i < 60; i++) {
    board[0][0].revealed = false;
    const res = gm.selectQuestionHostMode(host, room.code, 0, 0);
    assert.equal(res.question.options[room.gameState.mcCorrectIndex], 'RIGHT');
    assert.equal(res.question.options.length, 4);
    positions.add(room.gameState.mcCorrectIndex);
  }
  assert.ok(positions.size > 1, 'correct answer must move around, not always be A');
});

test('MC scoring uses the shuffled index and reports it', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const player = mkSocket();
  const room = gm.createRoom('host', host, {});
  gm.joinRoom(host, room.code, 'Host');
  gm.joinRoom(player, room.code, 'Player');

  const board = mkBoard(1, 1);
  board[0][0].options = ['RIGHT', 'w1', 'w2', 'w3'];
  gm.setHostQuestions(room.code, board, ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  const correct = room.gameState.mcCorrectIndex;
  gm.submitMCSelection(room.code, player.sessionId, correct);
  const out = gm.scoreMCAnswers(room.code);

  assert.equal(out.correctIndex, correct);
  assert.equal(out.nextPickerId, host.sessionId);
  assert.equal(out.results[0].correct, true);
  assert.equal(out.results[0].newScore, 200);
});

test('a wrong MC pick scores zero, not negative', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const player = mkSocket();
  const room = gm.createRoom('host', host, {});
  gm.joinRoom(host, room.code, 'Host');
  gm.joinRoom(player, room.code, 'Player');
  const board = mkBoard(1, 1);
  board[0][0].options = ['RIGHT', 'w1', 'w2', 'w3'];
  gm.setHostQuestions(room.code, board, ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  const wrong = (room.gameState.mcCorrectIndex + 1) % 4;
  gm.submitMCSelection(room.code, player.sessionId, wrong);
  const out = gm.scoreMCAnswers(room.code);
  assert.equal(out.results[0].correct, false);
  assert.equal(out.results[0].newScore, 0);
});

// =========================================================================
// 5. Disconnected / ineligible players must not stall the board
// =========================================================================

test('canBuzzAgain ignores disconnected players', () => {
  const { gm, code, sockets, room } = mkGame({ count: 3 });
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);

  // Two of three drop out; the third buzzes and misses.
  room.players.get(sockets[0].sessionId).isConnected = false;
  room.players.get(sockets[2].sessionId).isConnected = false;

  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);
  const res = gm.handleAnswer(code, sockets[1].sessionId, false);
  assert.equal(res.canBuzzAgain, false, 'nobody left who can actually buzz');
  assert.ok(res.correctAnswer, 'the answer is revealed when the clue closes');
});

test('canBuzzAgain ignores players who already skipped', () => {
  const { gm, code, sockets } = mkGame({ count: 3 });
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);
  gm.playerSkipped(code, sockets[0].sessionId);
  gm.playerSkipped(code, sockets[2].sessionId);

  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);
  assert.equal(gm.handleAnswer(code, sockets[1].sessionId, false).canBuzzAgain, false);
});

test('canBuzzAgain stays true while an eligible player remains', () => {
  const { gm, code, sockets } = mkGame({ count: 3 });
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);
  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);
  assert.equal(gm.handleAnswer(code, sockets[1].sessionId, false).canBuzzAgain, true);
});

test('playerContinued does not wait on a disconnected player', () => {
  const { gm, code, sockets, room } = mkGame({ count: 3 });
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.handleBuzzTimeout(code);
  room.players.get(sockets[2].sessionId).isConnected = false;

  assert.equal(gm.playerContinued(code, sockets[0].sessionId), false);
  assert.equal(
    gm.playerContinued(code, sockets[1].sessionId),
    true,
    'the two connected players are enough to advance'
  );
});

test('playerContinued does not wait on a late joiner still queued', () => {
  const { gm, code, sockets, room } = mkGame({ count: 2 });
  gm.selectQuestion(sockets[0], code, 0, 0);
  const latecomer = mkSocket();
  gm.joinRoom(latecomer, code, 'Late');
  assert.equal(room.players.get(latecomer.sessionId).waitingToJoin, true);

  gm.handleBuzzTimeout(code);
  gm.playerContinued(code, sockets[0].sessionId);
  assert.equal(gm.playerContinued(code, sockets[1].sessionId), true);
});

test('the host of a hosted room is not counted as a buzzing player', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, { enableDailyDouble: false });
  gm.joinRoom(host, room.code, 'Host');
  gm.joinRoom(p1, room.code, 'P1');
  gm.setQuestions(room.code, mkBoard(), ['A'], host.sessionId);

  gm.selectQuestionHostMode(host, room.code, 0, 0);
  gm.startBuzzWindow(room.code);
  gm.recordBuzz(room.code, p1.sessionId, 10);
  gm.determineBuzzerWinner(room.code);

  assert.equal(
    gm.handleAnswer(room.code, p1.sessionId, false).canBuzzAgain,
    false,
    'the host never buzzes, so the clue is over'
  );
});

test('playerSkipped counts only eligible active players', () => {
  const { gm, code, sockets, room } = mkGame({ count: 3 });
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);
  room.players.get(sockets[2].sessionId).isConnected = false;

  assert.deepEqual(gm.playerSkipped(code, sockets[0].sessionId), {
    allSkipped: false, skippedCount: 1, totalEligible: 2,
  });
  assert.deepEqual(gm.playerSkipped(code, sockets[1].sessionId), {
    allSkipped: true, skippedCount: 2, totalEligible: 2,
  });
});

test('a clue closes when the last eligible player skips after a wrong answer', () => {
  // Ordering matters here: handleAnswer reads skippedPlayers, and the handler
  // only calls startBuzzWindow (which clears that set) afterwards.
  const { gm, code, sockets } = mkGame({ count: 3 });
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);

  gm.playerSkipped(code, sockets[0].sessionId);
  gm.playerSkipped(code, sockets[2].sessionId);

  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);
  const res = gm.handleAnswer(code, sockets[1].sessionId, false);

  assert.equal(res.canBuzzAgain, false, 'everyone else already passed');
  assert.ok(res.correctAnswer, 'so the answer is revealed');
});

test('skips reset for each new buzz window', () => {
  const { gm, code, sockets, room } = mkGame({ count: 3 });
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);

  gm.playerSkipped(code, sockets[0].sessionId);

  // Someone buzzes and misses, reopening the window for the rest.
  gm.recordBuzz(code, sockets[1].sessionId, 10);
  gm.determineBuzzerWinner(code);
  assert.equal(gm.handleAnswer(code, sockets[1].sessionId, false).canBuzzAgain, true);
  gm.startBuzzWindow(code);

  assert.equal(room.gameState.skippedPlayers.size, 0, 'a fresh window, a fresh pass');

  // The two who have not answered can now each pass, which ends the clue.
  assert.equal(gm.playerSkipped(code, sockets[0].sessionId).allSkipped, false);
  const last = gm.playerSkipped(code, sockets[2].sessionId);
  assert.equal(last.totalEligible, 2, 'the player who already buzzed is excluded');
  assert.equal(last.allSkipped, true);
});

test('a player cannot skip twice', () => {
  const { gm, code, sockets } = mkGame({ count: 3 });
  gm.selectQuestion(sockets[0], code, 0, 0);
  gm.startBuzzWindow(code);
  gm.playerSkipped(code, sockets[0].sessionId);
  assert.equal(gm.playerSkipped(code, sockets[0].sessionId), null);
});

test('typed answers wait only on connected non-host players', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const p2 = mkSocket();
  const room = gm.createRoom('host', host, {});
  [host, p1, p2].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  // The host never types an answer, so two submissions must be enough.
  assert.equal(gm.submitTypedAnswer(room.code, p1.sessionId, 'a').allAnswered, false);
  assert.equal(gm.submitTypedAnswer(room.code, p2.sessionId, 'b').allAnswered, true);
});

test('a disconnected player does not block the typed-answer round', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const p2 = mkSocket();
  const room = gm.createRoom('host', host, {});
  [host, p1, p2].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);
  room.players.get(p2.sessionId).isConnected = false;

  assert.equal(gm.submitTypedAnswer(room.code, p1.sessionId, 'a').allAnswered, true);
});

test('MC selection waits only on connected non-host players', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, {});
  [host, p1].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  const board = mkBoard(1, 1);
  board[0][0].options = ['RIGHT', 'w1', 'w2', 'w3'];
  gm.setHostQuestions(room.code, board, ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  assert.equal(gm.submitMCSelection(room.code, p1.sessionId, 0).allSelected, true);
});

test('a late joiner still queued does not block the typed-answer round', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, {});
  [host, p1].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  room.status = 'in_progress';
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  const latecomer = mkSocket();
  gm.joinRoom(latecomer, room.code, 'Late');
  assert.equal(room.players.get(latecomer.sessionId).waitingToJoin, true);

  assert.equal(
    gm.submitTypedAnswer(room.code, p1.sessionId, 'a').allAnswered,
    true,
    'the latecomer never saw this clue, so must not be waited on'
  );
});

test('getTypedAnswers returns every answer with its grade attached', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const p2 = mkSocket();
  const room = gm.createRoom('host', host, {});
  [host, p1, p2].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));

  const board = mkBoard(1, 1);
  board[0][0].question = 'What is Mars?';
  gm.setHostQuestions(room.code, board, ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  gm.submitTypedAnswer(room.code, p1.sessionId, 'Mars');
  gm.submitTypedAnswer(room.code, p2.sessionId, 'Venus');
  gm.autoGradeAnswers(room.code);

  const answers = gm.getTypedAnswers(room.code);
  assert.equal(answers.length, 2);

  const byId = Object.fromEntries(answers.map(a => [a.playerId, a]));
  assert.equal(byId[p1.sessionId].answer, 'Mars');
  assert.equal(byId[p1.sessionId].autoGradeResult.isCorrect, true);
  assert.equal(byId[p2.sessionId].autoGradeResult.isCorrect, false);
  assert.ok(byId[p1.sessionId].playerName, 'the host needs a name to judge against');
});

test('answering before any clue is selected is refused, not fatal', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, { answerMode: 'typed' });
  [host, p1].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  // Board set through the ordinary path, which never builds the host-mode maps.
  gm.setQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);

  // A client can emit these at any time; they must not take the server down.
  assert.doesNotThrow(() => gm.submitTypedAnswer(room.code, p1.sessionId, 'early'));
  assert.doesNotThrow(() => gm.submitMCSelection(room.code, p1.sessionId, 0));
  assert.doesNotThrow(() => gm.getTypedAnswers(room.code));
  assert.doesNotThrow(() => gm.autoGradeAnswers(room.code));
  assert.doesNotThrow(() => gm.hostJudgeAnswer(room.code, host.sessionId, p1.sessionId, true));
});

test('a player cannot submit a typed answer twice', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, {});
  [host, p1].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  assert.equal(gm.submitTypedAnswer(room.code, p1.sessionId, 'a').success, true);
  assert.equal(gm.submitTypedAnswer(room.code, p1.sessionId, 'b').success, false);
});

test('judging a second player still awards the full clue value', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const p2 = mkSocket();
  const room = gm.createRoom('host', host, { answerMode: 'typed' });
  [host, p1, p2].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));

  const board = mkBoard(1, 1); // single clue worth 200
  gm.setHostQuestions(room.code, board, ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);
  gm.submitTypedAnswer(room.code, p1.sessionId, 'a');
  gm.submitTypedAnswer(room.code, p2.sessionId, 'b');

  assert.equal(gm.hostJudgeAnswer(room.code, host.sessionId, p1.sessionId, true).newScore, 200);
  assert.equal(
    gm.hostJudgeAnswer(room.code, host.sessionId, p2.sessionId, true).newScore,
    200,
    'the clue must not evaporate after the first judgement'
  );
});

test('judging ignores a client-supplied point value', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, { answerMode: 'verbal' });
  [host, p1].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  assert.equal(
    gm.hostJudgeAnswer(room.code, host.sessionId, p1.sessionId, true, 999999).newScore,
    200
  );
});

test('a wrong judgement deducts the clue value', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, { answerMode: 'verbal' });
  [host, p1].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  assert.equal(gm.hostJudgeAnswer(room.code, host.sessionId, p1.sessionId, false).newScore, -200);
});

test('verbal mode closes the clue as soon as the buzzer winner is judged', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, { answerMode: 'verbal' });
  [host, p1].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  const res = gm.hostJudgeAnswer(room.code, host.sessionId, p1.sessionId, true);
  assert.equal(res.questionClosed, true);
  assert.equal(room.gameState.currentQuestion, null);
});

test('typed mode closes the clue once every answer has been judged', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const p2 = mkSocket();
  const room = gm.createRoom('host', host, { answerMode: 'typed' });
  [host, p1, p2].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);
  gm.submitTypedAnswer(room.code, p1.sessionId, 'a');
  gm.submitTypedAnswer(room.code, p2.sessionId, 'b');

  assert.equal(gm.hostJudgeAnswer(room.code, host.sessionId, p1.sessionId, true).questionClosed, false);
  assert.ok(room.gameState.currentQuestion, 'still judging');

  const last = gm.hostJudgeAnswer(room.code, host.sessionId, p2.sessionId, false);
  assert.equal(last.questionClosed, true);
  assert.equal(room.gameState.currentQuestion, null);
});

test('the same player cannot be judged twice for one clue', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, { answerMode: 'typed' });
  [host, p1].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);
  gm.submitTypedAnswer(room.code, p1.sessionId, 'a');

  assert.equal(gm.hostJudgeAnswer(room.code, host.sessionId, p1.sessionId, true).newScore, 200);
  assert.equal(
    gm.hostJudgeAnswer(room.code, host.sessionId, p1.sessionId, true),
    null,
    'a double-click must not pay out twice'
  );
});

test('only the host may judge', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('host', host, { answerMode: 'verbal' });
  [host, p1].forEach((s, i) => gm.joinRoom(s, room.code, `N${i}`));
  gm.setHostQuestions(room.code, mkBoard(1, 1), ['A'], host.sessionId);
  gm.selectQuestionHostMode(host, room.code, 0, 0);

  assert.equal(gm.hostJudgeAnswer(room.code, p1.sessionId, p1.sessionId, true), null);
});

// =========================================================================
// 6. Final Jeopardy rules
// =========================================================================

test('only players with a positive score are eligible for Final Jeopardy', () => {
  const { gm, code, sockets, room } = mkGame({ count: 3 });
  room.players.get(sockets[0].sessionId).score = 1000;
  room.players.get(sockets[1].sessionId).score = 0;
  room.players.get(sockets[2].sessionId).score = -400;

  gm.startFinalJeopardy(code);
  const eligible = room.gameState.finalJeopardy.eligiblePlayers;
  assert.equal(eligible.size, 1);
  assert.ok(eligible.has(sockets[0].sessionId));
});

test('getFJResults is idempotent and does not double-apply wagers', () => {
  const { gm, code, sockets, room } = mkGame({ count: 2 });
  room.players.get(sockets[0].sessionId).score = 1000;
  room.players.get(sockets[1].sessionId).score = 1000;

  gm.startFinalJeopardy(code);
  const answer = room.gameState.finalJeopardy.answer;
  gm.submitFJWager(code, sockets[0].sessionId, 500);
  gm.submitFJWager(code, sockets[1].sessionId, 500);
  gm.submitFJAnswer(code, sockets[0].sessionId, answer);
  gm.submitFJAnswer(code, sockets[1].sessionId, 'nonsense');

  const first = gm.getFJResults(code);
  const second = gm.getFJResults(code);
  assert.deepEqual(first, second);
  assert.equal(room.players.get(sockets[0].sessionId).score, 1500);
  assert.equal(room.players.get(sockets[1].sessionId).score, 500);
});

test('an ineligible player cannot wager or answer in Final Jeopardy', () => {
  const { gm, code, sockets, room } = mkGame({ count: 2 });
  room.players.get(sockets[0].sessionId).score = 1000;
  room.players.get(sockets[1].sessionId).score = -100;
  gm.startFinalJeopardy(code);
  assert.equal(gm.submitFJWager(code, sockets[1].sessionId, 50), false);
  assert.equal(gm.submitFJAnswer(code, sockets[1].sessionId, 'x'), false);
});

// =========================================================================
// 6b. Answer grading
// =========================================================================

const grader = new GameStateManager();
const grade = (given, correct) => grader.fuzzyMatchAnswer(given, correct).isCorrect;

test('an exact answer is correct', () => {
  assert.equal(grade('Mars', 'Mars'), true);
});

test('the Jeopardy question form is accepted', () => {
  assert.equal(grade('What is Mars?', 'Mars'), true);
  assert.equal(grade('Mars', 'What is Mars?'), true);
  assert.equal(grade('who was Beethoven', 'Beethoven'), true);
});

test('a small typo is forgiven', () => {
  assert.equal(grade('Beethovan', 'Beethoven'), true);
  assert.equal(grade('Missisippi', 'Mississippi'), true);
});

test('a leading article is ignored', () => {
  assert.equal(grade('Colossus of Rhodes', 'The Colossus of Rhodes'), true);
});

test('a single stray letter is NOT correct', () => {
  assert.equal(grade('e', 'Beethoven'), false, 'substring matching used to pass this');
  assert.equal(grade('a', 'Mars'), false);
});

test('a fragment of a long answer is NOT correct', () => {
  assert.equal(grade('Rhodes', 'The Colossus of Rhodes'), false);
});

test('an empty answer is NOT correct', () => {
  assert.equal(grade('', 'Mars'), false);
  assert.equal(grade('   ', 'Mars'), false);
});

test('a different answer is NOT correct', () => {
  assert.equal(grade('Venus', 'Mars'), false);
  assert.equal(grade('Mozart', 'Beethoven'), false);
});

test('grading is case and punctuation insensitive', () => {
  assert.equal(grade('MOBY-DICK!', 'Moby Dick'), true);
});

test('Final Jeopardy grading tolerates the question form and typos', () => {
  const { gm, code, sockets, room } = mkGame({ count: 1 });
  room.players.get(sockets[0].sessionId).score = 1000;
  gm.startFinalJeopardy(code);
  const answer = room.gameState.finalJeopardy.answer;

  gm.submitFJWager(code, sockets[0].sessionId, 1000);
  gm.submitFJAnswer(code, sockets[0].sessionId, `What is ${answer}?`);
  assert.equal(gm.getFJResults(code)[0].correct, true);
});

// =========================================================================
// 7. Daily Double placement
// =========================================================================

test('Double Jeopardy places two Daily Doubles in different categories', () => {
  for (let i = 0; i < 200; i++) {
    const dds = placeDailyDoubles(6, 2);
    assert.equal(dds.length, 2);
    assert.notEqual(dds[0].categoryIndex, dds[1].categoryIndex);
  }
});

test('Daily Doubles never land on the top (cheapest) row', () => {
  for (let i = 0; i < 200; i++) {
    for (const dd of placeDailyDoubles(6, 2)) {
      assert.ok(dd.pointIndex >= 1 && dd.pointIndex <= 4);
    }
  }
});

test('round 1 places exactly one Daily Double', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(placeDailyDoubles(6, 1).length, 1);
  }
});

test('Daily Doubles stay on the board when it has fewer than five rows', () => {
  // An imported or hand-built board can be any height; a Daily Double placed on
  // a row that does not exist simply never triggers.
  for (const rows of [1, 2, 3, 4, 6]) {
    for (let i = 0; i < 60; i++) {
      for (const dd of placeDailyDoubles(6, 2, rows)) {
        assert.ok(
          dd.pointIndex >= 0 && dd.pointIndex < rows,
          `row ${dd.pointIndex} is off a ${rows}-row board`
        );
      }
    }
  }
});

test('a single-row board still gets its Daily Double', () => {
  const dds = placeDailyDoubles(6, 1, 1);
  assert.equal(dds.length, 1);
  assert.equal(dds[0].pointIndex, 0);
});

test('placement terminates on a board narrower than the Daily Double count', () => {
  assert.equal(placeDailyDoubles(1, 2).length, 1, 'must not loop forever');
});

test('a quickplay match identifies players the way every other event does', () => {
  const gm = new GameStateManager();
  const sockets = [mkSocket(), mkSocket(), mkSocket()];
  sockets.forEach((s, i) => gm.joinMatchmakingQueue(s, `P${i}`));

  const match = gm.tryCreateMatch();
  assert.ok(match, 'three players is a match');

  const room = gm.rooms.get(match.roomCode);
  for (const player of match.players) {
    assert.ok(
      room.players.has(player.id),
      'the id in the payload must be the key the room stores'
    );
  }
});

// =========================================================================
// 8. Room lifecycle
// =========================================================================

test('rejoining with the same session keeps the score', () => {
  const { gm, code, sockets, room } = mkGame({ count: 2 });
  room.players.get(sockets[1].sessionId).score = 2400;

  const rejoinSocket = { id: 'new-socket', sessionId: sockets[1].sessionId };
  gm.joinRoom(rejoinSocket, code, 'Player1');
  assert.equal(room.players.get(sockets[1].sessionId).score, 2400);
});

test('a full room still admits a player who is already in it', () => {
  const gm = new GameStateManager();
  const a = mkSocket();
  const b = mkSocket();
  const room = gm.createRoom('multiplayer', a, { maxPlayers: 2 });
  gm.joinRoom(a, room.code, 'A');
  gm.joinRoom(b, room.code, 'B');
  assert.throws(() => gm.joinRoom(mkSocket(), room.code, 'C'), /full/);
  assert.doesNotThrow(() => gm.joinRoom({ id: 'x', sessionId: a.sessionId }, room.code, 'A'));
});

test('the pick passes on when the current picker leaves', () => {
  const { gm, code, sockets, room } = mkGame({ count: 3 });
  assert.equal(room.gameState.currentPickerId, sockets[0].sessionId);
  gm.leaveRoom(sockets[0], code);
  assert.ok(room.gameState.currentPickerId);
  assert.notEqual(room.gameState.currentPickerId, sockets[0].sessionId);
});

test('kicking the current picker hands the pick to someone else', () => {
  const gm = new GameStateManager();
  const host = mkSocket();
  const p1 = mkSocket();
  const room = gm.createRoom('multiplayer', host, {});
  gm.joinRoom(host, room.code, 'Host');
  gm.joinRoom(p1, room.code, 'P1');
  gm.setQuestions(room.code, mkBoard(), ['A'], p1.sessionId);

  const res = gm.kickPlayer(room.code, host.sessionId, p1.sessionId);
  assert.equal(res.nextPickerId, host.sessionId);
  assert.equal(room.gameState.currentPickerId, host.sessionId);
});

test('an abandoned in-progress room is eventually reaped', () => {
  const { gm, code, room } = mkGame({ count: 2 });
  for (const p of room.players.values()) p.isConnected = false;

  gm.cleanupStaleRooms();
  assert.ok(gm.rooms.has(code), 'still inside the grace period');

  room.lastActiveAt = Date.now() - 31 * 60 * 1000;
  gm.cleanupStaleRooms();
  assert.equal(gm.rooms.has(code), false, 'reaped after the grace period');
  assert.equal(gm.sessionRooms.size, 0, 'session mappings released too');
});

test('a room with someone connected is never reaped', () => {
  const { gm, code, room } = mkGame({ count: 2 });
  room.createdAt = Date.now() - 48 * 60 * 60 * 1000;
  gm.cleanupStaleRooms();
  assert.ok(gm.rooms.has(code));
});

// --- report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
