/**
 * What a player's move does to a room, whoever made the move.
 *
 * These used to live inline in the socket handlers, one body per event. That
 * was fine while every move arrived over a socket. Quickplay's house players
 * make the same moves from a timer, and copying forty lines of buzz-window
 * bookkeeping into a second place is how the two copies drift: a fix to one
 * timeout and not the other, and a bot that freezes a room a person could
 * not. So the handlers call these, and so do the bots, and there is one copy.
 *
 * Every function takes the room code and, where a player is acting, their
 * session id. None of them reads a socket. They talk to the room through
 * `emitRoom`, which is the one door out, so the quickplay director can hear
 * everything the room hears.
 */

// On the show a contestant gets about five seconds to answer once they have
// buzzed in. Reusing the full clue timer here gave them the whole 30 seconds
// and drained the tension out of every buzz. Seven is the default here because
// the buzz window opens as the clue appears, so players are still reading.
export const DEFAULT_ANSWER_MS = 7000;
export const DEFAULT_BUZZ_MS = 30000;

export const buzzWindowMs = (room) => room?.settings?.questionTimeLimit || DEFAULT_BUZZ_MS;
export const answerWindowMs = (room) => room?.settings?.answerTimeLimit || DEFAULT_ANSWER_MS;

/* Half a second is long enough for the clue to be skipped, answered, or the
   room to be torn down, so everything after a buzz re-reads the live room. */
const BUZZ_COLLECT_MS = 500;

export function createGameActions({ gameManager, emitRoom, archiveRoom, setTimeout: schedule = setTimeout }) {
  const rooms = gameManager.rooms;

  /* Late joiners are dealt in when a clue fully resolves. */
  function activateLateJoiners(roomCode) {
    const activated = gameManager.activateWaitingPlayers(roomCode);
    if (activated.length > 0) {
      emitRoom(roomCode, 'game:late-joiners-ready', { playerIds: activated });
    }
  }

  /* Open the buzzer and arm the clock that closes it if nobody rings in. */
  function openBuzzWindow(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    gameManager.startBuzzWindow(roomCode);
    gameManager.clearBuzzTimeout(roomCode);
    room.buzzTimeout = schedule(() => {
      const current = rooms.get(roomCode);
      if (current?.gameState?.buzzReceived) return;
      const result = gameManager.handleBuzzTimeout(roomCode);
      if (result) emitRoom(roomCode, 'game:buzz-timeout-result', result);
    }, buzzWindowMs(room));
  }

  /* The verdict on an answer, and what the room does next. */
  function settleAnswer(roomCode, result, extra = {}) {
    emitRoom(roomCode, 'game:answer-result', { ...result, ...extra });
    if (result.canBuzzAgain) {
      openBuzzWindow(roomCode);
    } else {
      activateLateJoiners(roomCode);
    }
  }

  return {
    /** A picker opens a clue. Returns what the room was told, or null. */
    selectQuestion(sessionId, roomCode, categoryIndex, pointIndex) {
      const room = rooms.get(roomCode);
      if (!room) return null;
      const actor = { sessionId };
      const result = room.type === 'host'
        ? gameManager.selectQuestionHostMode(actor, roomCode, categoryIndex, pointIndex)
        : gameManager.selectQuestion(actor, roomCode, categoryIndex, pointIndex);
      if (!result) return null;

      gameManager.clearSuggestions(roomCode);
      emitRoom(roomCode, 'game:question-selected', result);

      // A Daily Double has no buzz window: only the picker answers.
      if (result.isDailyDouble) return result;

      if (room.type === 'host') {
        /* The buzzer stays shut until the clue has been read aloud, then opens
           on its own unless the host got there first. */
        const answerMode = room.settings?.answerMode || 'verbal';
        if (room.autoOpenTimer) clearTimeout(room.autoOpenTimer);
        room.autoOpenTimer = schedule(() => {
          const current = rooms.get(roomCode);
          if (!current?.gameState?.currentQuestion) return;
          if (answerMode === 'verbal') {
            gameManager.startBuzzWindow(roomCode);
            emitRoom(roomCode, 'host:buzzer-opened');
          } else {
            gameManager.openHostAnswerWindow(roomCode);
            emitRoom(roomCode, 'host:answer-window-opened', { duration: buzzWindowMs(current) });
          }
        }, 3000);
        return result;
      }

      openBuzzWindow(roomCode);
      return result;
    },

    /** A player rings in. Returns false if the buzz was refused. */
    buzz(sessionId, roomCode, reactionTime) {
      const room = rooms.get(roomCode);
      if (!room) return false;
      // The host of a hosted room runs the buzzer; they do not press it.
      if (room.type === 'host' && room.hostId === sessionId) return false;

      // A rejected buzz (window closed, or a player who already had their shot)
      // must not touch the timers: cancelling the buzz timeout for one used to
      // leave the room with no winner and no timer, frozen for good.
      if (!gameManager.recordBuzz(roomCode, sessionId, reactionTime)) return false;
      gameManager.clearBuzzTimeout(roomCode);

      // The first buzz starts a short collection window, then the fastest wins.
      if (Object.keys(room.gameState.buzzes || {}).length !== 1) return true;

      schedule(() => {
        const current = rooms.get(roomCode);
        if (!current?.gameState?.currentQuestion) return;
        const winner = gameManager.determineBuzzerWinner(roomCode);
        if (!winner) return;

        const player = current.players.get(winner.playerId);
        emitRoom(roomCode, 'game:buzzer-winner', {
          playerId: winner.playerId,
          playerName: player?.displayName || 'Unknown',
          reactionTime: winner.reactionTime,
        });
        gameManager.startAnswerWindow(roomCode);

        // In a host-run room the host judges every answer. An auto-incorrect
        // timer here docked the player and cleared the clue out from under
        // the host's judge buttons.
        if (current.type === 'host') return;

        gameManager.clearAnswerTimeout(roomCode);
        current.answerTimeout = schedule(() => {
          const result = gameManager.handleAnswer(roomCode, winner.playerId, false);
          if (result) settleAnswer(roomCode, result, { timeout: true });
        }, answerWindowMs(current));
      }, BUZZ_COLLECT_MS);
      return true;
    },

    /** The buzzer winner says whether they had it. */
    submitAnswer(sessionId, roomCode, correct) {
      gameManager.clearAnswerTimeout(roomCode);
      const result = gameManager.handleAnswer(roomCode, sessionId, correct);
      if (result) settleAnswer(roomCode, result);
      return result;
    },

    /** The buzzer winner shows the room the answer before judging themselves. */
    revealAnswer(sessionId, roomCode) {
      const room = rooms.get(roomCode);
      if (room?.gameState?.buzzedPlayerId !== sessionId) return;
      emitRoom(roomCode, 'game:answer-revealed', {
        playerId: sessionId,
        answer: room.gameState.currentQuestion?.question,
      });
    },

    /** A player passes on a clue. When everyone has, the clue is over. */
    skipQuestion(sessionId, roomCode) {
      const result = gameManager.playerSkipped(roomCode, sessionId);
      if (!result) return null;
      emitRoom(roomCode, 'game:player-skipped', {
        playerId: sessionId,
        skippedCount: result.skippedCount,
        totalEligible: result.totalEligible,
      });
      if (result.allSkipped) {
        gameManager.clearBuzzTimeout(roomCode);
        const timeoutResult = gameManager.handleBuzzTimeout(roomCode);
        if (timeoutResult) emitRoom(roomCode, 'game:buzz-timeout-result', timeoutResult);
      }
      return result;
    },

    /** Continue after nobody buzzed. The board comes back when everyone has. */
    timeoutContinue(sessionId, roomCode) {
      if (!gameManager.playerContinued(roomCode, sessionId)) return false;
      gameManager.clearCurrentQuestion(roomCode);
      emitRoom(roomCode, 'game:all-continued', { nextPickerId: gameManager.getCurrentPicker(roomCode) });
      activateLateJoiners(roomCode);
      return true;
    },

    dailyDoubleWager(sessionId, roomCode, wager) {
      const result = gameManager.handleDailyDoubleWager(roomCode, sessionId, wager);
      if (result) emitRoom(roomCode, 'game:daily-double-wager-confirmed', result);
      return result;
    },

    dailyDoubleAnswer(sessionId, roomCode, correct) {
      const result = gameManager.handleDailyDoubleAnswer(roomCode, sessionId, correct);
      if (result) emitRoom(roomCode, 'game:daily-double-result', result);
      return result;
    },

    /** The board for round one. Everyone moves from the lobby to the game. */
    setQuestions(roomCode, { questions, categories, firstPickerId, dailyDoubles }) {
      gameManager.setQuestions(roomCode, questions, categories, firstPickerId, dailyDoubles);
      emitRoom(roomCode, 'game:questions-ready', { questions, categories, firstPickerId });
    },

    roundEnd(roomCode, round) {
      emitRoom(roomCode, 'game:round-ended', { round });
    },

    startRound2(roomCode, { questions, categories, firstPickerId, dailyDoubles }) {
      gameManager.startRound2(roomCode, questions, categories, firstPickerId, dailyDoubles);
      emitRoom(roomCode, 'game:round-2-started', { questions, categories, firstPickerId });
    },

    /** Final Jeopardy, or straight to the standings if nobody can play it. */
    startFinalJeopardy(roomCode, written) {
      const fjData = gameManager.startFinalJeopardy(roomCode, written);
      if (!fjData) return null;
      if (fjData.eligibleCount === 0) {
        archiveRoom(roomCode);
        emitRoom(roomCode, 'game:ended');
        return fjData;
      }
      emitRoom(roomCode, 'game:final-jeopardy-started', fjData);
      return fjData;
    },

    fjWager(sessionId, roomCode, wager) {
      const allIn = gameManager.submitFJWager(roomCode, sessionId, wager);
      if (allIn) emitRoom(roomCode, 'game:fj-show-clue');
      return allIn;
    },

    fjAnswer(sessionId, roomCode, answer) {
      const allIn = gameManager.submitFJAnswer(roomCode, sessionId, answer);
      if (!allIn) return false;
      const results = gameManager.getFJResults(roomCode);
      /* The scores are final here, so file the game now rather than at
         game:end, which only arrives if the host goes on to press "See Final
         Standings". A second archive call is a no-op. */
      archiveRoom(roomCode);
      emitRoom(roomCode, 'game:fj-reveal', { results });
      return true;
    },

    endGame(roomCode) {
      archiveRoom(roomCode);
      emitRoom(roomCode, 'game:ended');
    },
  };
}
