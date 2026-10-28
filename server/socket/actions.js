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

import { playerBoard, playerClue } from './GameStateManager.js';

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

/* How long a picker whose connection dropped keeps the pick. Long enough for
   a reload or a phone waking up to come back; short enough that the rest of
   the room is not left looking at a board nobody can choose from. */
export const PICKER_GRACE_MS = 15000;

export function createGameActions({
  gameManager, emitRoom, archiveRoom, setTimeout: schedule = setTimeout,
  /* One player alone, for what only they should see. */
  emitPlayer = () => {},
  /* One event in two versions: the host's, and everyone else's. Without a
     socket layer to tell them apart, everyone gets the players' version. */
  emitSplit = (roomCode, event, _forHost, forPlayers) => emitRoom(roomCode, event, forPlayers),
}) {
  const rooms = gameManager.rooms;

  /* A hosted room's players are judged by the host and never need the
     responses, so they get the board and the clue without them; the host gets
     them as written. Self-judged rooms reveal the response to whoever buzzed,
     so everyone there is sent it as it is. */
  function emitToTable(roomCode, event, payload, forPlayers) {
    if (gameManager.answersAreTyped(rooms.get(roomCode))) emitSplit(roomCode, event, payload, forPlayers(payload));
    else emitRoom(roomCode, event, payload);
  }
  const clueForPlayers = (payload) => ({ ...payload, question: playerClue(payload.question) });
  const boardForPlayers = (payload) => ({ ...payload, questions: playerBoard(payload.questions) });

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

  /* Everyone still here has passed, or the clock ran out: nobody is going to
     buzz, so the clue is over and the room waits on its Continues. */
  function endBuzzing(roomCode) {
    gameManager.clearBuzzTimeout(roomCode);
    const result = gameManager.handleBuzzTimeout(roomCode);
    if (result) emitRoom(roomCode, 'game:buzz-timeout-result', result);
  }

  /* Every Continue is in. */
  function finishContinue(roomCode) {
    gameManager.clearCurrentQuestion(roomCode);
    emitRoom(roomCode, 'game:all-continued', { nextPickerId: gameManager.getCurrentPicker(roomCode) });
    activateLateJoiners(roomCode);
  }

  function showFinalClue(roomCode) {
    const { clue, media } = rooms.get(roomCode).gameState.finalJeopardy;
    emitRoom(roomCode, 'game:fj-show-clue', { clue, media: media ?? null });
  }

  function revealFinal(roomCode) {
    const results = gameManager.getFJResults(roomCode);
    /* The scores are final here, so file the game now rather than at
       game:end, which only arrives if the host goes on to press "See Final
       Standings". A second archive call is a no-op. */
    archiveRoom(roomCode);
    const correctResponse = rooms.get(roomCode).gameState.finalJeopardy.answer;
    emitRoom(roomCode, 'game:fj-reveal', { results, answer: correctResponse });
  }

  /* Whatever the room was waiting on from everyone, asked again without the
     player who has just gone. Each of these used to count them in, so one
     dropped connection held a wager, an answer, a Continue or a pass open for
     good, and with it the whole room. */
  function settleWaits(roomCode) {
    const next = gameManager.finalJeopardyNext(roomCode);
    if (next === 'clue') showFinalClue(roomCode);
    else if (next === 'reveal') revealFinal(roomCode);
    if (gameManager.everyoneContinued(roomCode)) finishContinue(roomCode);
    if (gameManager.everyoneSkipped(roomCode)) endBuzzing(roomCode);
  }

  /* The player holding the buzz has left the room. Their answer clock would
     have docked a player who no longer exists, which did nothing, and the
     clue sat waiting on them. */
  function releaseBuzzOf(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room?.gameState || room.gameState.buzzedPlayerId !== playerId) return;
    gameManager.clearAnswerTimeout(roomCode);
    const result = gameManager.releaseBuzz(roomCode, playerId);
    if (!result) return;

    if (room.type !== 'host') {
      settleAnswer(roomCode, result);
      return;
    }
    /* A hosted room's buzzer is the host's to run, and nothing there is
       timed, so the room is told directly: open again, or the clue is over. */
    if (result.canBuzzAgain) {
      gameManager.startBuzzWindow(roomCode);
      emitRoom(roomCode, 'host:buzzer-opened', { buzzReleased: playerId });
    } else {
      emitRoom(roomCode, 'host:question-skipped', { nextPickerId: room.hostId });
    }
  }

  /* A picker whose connection has dropped keeps the pick for a grace period,
     then it passes to somebody who is here. While a clue is up the pick is
     not in play, so the check waits for it to close; a Daily Double is the
     picker's alone, so one left waiting on them is put away unplayed. The
     socket the player had is how a return is spotted, even one followed by
     another drop. */
  function watchDroppedPicker(roomCode, playerId, socketId) {
    const timer = schedule(() => {
      const room = rooms.get(roomCode);
      const gs = room?.gameState;
      const player = room?.players.get(playerId);
      if (!gs || !player || player.isConnected || player.socketId !== socketId) return;
      if (room.type === 'host' || gs.currentPickerId !== playerId) return;
      if (gs.phase === 'finalJeopardy' || gs.phase === 'finished') return;

      if (gs.isDailyDouble && gs.currentQuestion) {
        const result = gameManager.abandonDailyDouble(roomCode);
        if (result) emitRoom(roomCode, 'game:daily-double-result', result);
      }
      if (gs.currentQuestion || gameManager.getActivePlayerIds(room).length === 0) {
        watchDroppedPicker(roomCode, playerId, socketId);
        return;
      }
      const next = gameManager.reassignPickerIfNeeded(room, playerId);
      if (next) emitRoom(roomCode, 'game:picker-changed', { nextPickerId: next });
    }, PICKER_GRACE_MS);
    /* A watch on a room is not a reason for the process to stay up. */
    timer?.unref?.();
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
      emitToTable(roomCode, 'game:question-selected', result, clueForPlayers);

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
      if (result.allSkipped) endBuzzing(roomCode);
      return result;
    },

    /** Continue after nobody buzzed. The board comes back when everyone has. */
    timeoutContinue(sessionId, roomCode) {
      if (!gameManager.playerContinued(roomCode, sessionId)) return false;
      finishContinue(roomCode);
      return true;
    },

    dailyDoubleWager(sessionId, roomCode, wager) {
      const result = gameManager.handleDailyDoubleWager(roomCode, sessionId, wager);
      // The confirmed wager carries the clue, and in a typed room not its response.
      if (result) emitToTable(roomCode, 'game:daily-double-wager-confirmed', result, clueForPlayers);
      return result;
    },

    /** A hosted Daily Double's wager, entered by the host for a player. */
    hostDailyDoubleWager(hostId, roomCode, playerId, wager) {
      const result = gameManager.hostDailyDoubleWager(roomCode, hostId, playerId, wager);
      if (result) emitToTable(roomCode, 'game:daily-double-wager-confirmed', result, clueForPlayers);
      return result;
    },

    /**
     * A quickplay response, typed by the player holding the buzz or the
     * Daily Double, and graded here. A 'close' one is sent back to that
     * player alone for another go; the room hears the verdict, and what was
     * typed, once there is one.
     */
    submitResponse(sessionId, roomCode, text) {
      const room = rooms.get(roomCode);
      const gs = room?.gameState;
      if (room?.type !== 'quickplay' || !gs?.currentQuestion) return null;
      const dailyDouble = gs.isDailyDouble && gs.phase === 'dailyDoubleQuestion' && gs.currentPickerId === sessionId;
      if (!dailyDouble && gs.buzzedPlayerId !== sessionId) return null;

      const said = String(text ?? '').trim().slice(0, 200);
      const verdict = gameManager.gradeResponse(roomCode, sessionId, said);
      if (verdict === 'close') {
        emitPlayer(roomCode, sessionId, 'game:answer-close', {});
        return { verdict };
      }

      const correct = verdict === 'correct';
      if (dailyDouble) {
        const result = gameManager.handleDailyDoubleAnswer(roomCode, sessionId, correct);
        if (result) emitRoom(roomCode, 'game:daily-double-result', { ...result, said });
        return result;
      }
      gameManager.clearAnswerTimeout(roomCode);
      const result = gameManager.handleAnswer(roomCode, sessionId, correct);
      if (result) settleAnswer(roomCode, result, { said });
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
      emitToTable(roomCode, 'game:questions-ready', { questions, categories, firstPickerId }, boardForPlayers);
    },

    roundEnd(roomCode, round) {
      gameManager.endRound(roomCode);
      emitRoom(roomCode, 'game:round-ended', { round });
    },

    startRound2(roomCode, { questions, categories, firstPickerId, dailyDoubles }) {
      // The server decides who opens the round (the trailing player), so the
      // room is told its choice rather than the one the client sent.
      const picker = gameManager.startRound2(roomCode, questions, categories, firstPickerId, dailyDoubles);
      emitToTable(roomCode, 'game:round-2-started', { questions, categories, firstPickerId: picker }, boardForPlayers);
    },

    /** Final Jeopardy, or straight to the standings if nobody can play it.
        The room hears the category now, the clue once every wager is in, and
        the response at the reveal; sending all three up front let anyone
        reading the socket frames wager on the clue and type the response. */
    startFinalJeopardy(roomCode, written) {
      const fjData = gameManager.startFinalJeopardy(roomCode, written);
      if (!fjData) return null;
      if (fjData.eligibleCount === 0) {
        archiveRoom(roomCode);
        gameManager.finishGame(roomCode);
        emitRoom(roomCode, 'game:ended');
        return fjData;
      }
      emitRoom(roomCode, 'game:final-jeopardy-started', {
        category: fjData.category,
        eligibleCount: fjData.eligibleCount,
      });
      return fjData;
    },

    fjWager(sessionId, roomCode, wager) {
      const allIn = gameManager.submitFJWager(roomCode, sessionId, wager);
      if (allIn) showFinalClue(roomCode);
      return allIn;
    },

    fjAnswer(sessionId, roomCode, answer) {
      const allIn = gameManager.submitFJAnswer(roomCode, sessionId, answer);
      if (!allIn) return false;
      revealFinal(roomCode);
      return true;
    },

    endGame(roomCode) {
      archiveRoom(roomCode);
      gameManager.finishGame(roomCode);
      emitRoom(roomCode, 'game:ended');
    },

    /** A player has left the room for good, by choice or by a kick.
        `nextPickerId` is who leaveRoom handed their pick to, if they had it. */
    playerLeft(roomCode, playerId, { nextPickerId = null } = {}) {
      if (!rooms.get(roomCode)?.gameState) return;
      releaseBuzzOf(roomCode, playerId);
      if (nextPickerId) emitRoom(roomCode, 'game:picker-changed', { nextPickerId });
      settleWaits(roomCode);
    },

    /** A player's connection has dropped. They may well be back. */
    playerDropped(roomCode, playerId) {
      const room = rooms.get(roomCode);
      if (!room?.gameState) return;
      settleWaits(roomCode);
      watchDroppedPicker(roomCode, playerId, room.players.get(playerId)?.socketId);
    },
  };
}
