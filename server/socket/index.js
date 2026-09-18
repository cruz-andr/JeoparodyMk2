import { verifyToken } from '../middleware/auth.js';
import { getDatabase } from '../config/database.js';
import { recordRoomGame } from '../services/gameHistory.js';
import { GameStateManager } from './GameStateManager.js';
import { createGameActions, buzzWindowMs } from './actions.js';
import { createBoardSource, createQuickplayDirector } from './quickplay.js';
import { info as logInfo } from '../utils/log.js';

const NO_MATCH_MESSAGE = 'Nobody else is looking right now.';

// Debug flag - set DEBUG_GAME=true in .env to enable game debugging logs
const DEBUG_GAME = process.env.DEBUG_GAME === 'true';

/**
 * Quickplay's knobs, from the environment.
 *
 * QUICKPLAY_BOTS=false turns the house players off and brings back the older
 * pair-or-give-up wait. QUICKPLAY_FILL_AFTER_MS moves the fill threshold.
 * QUICKPLAY_BOARDS=static deals the written board instead of scraping an
 * episode, which is what the test runs want: nothing they do should reach
 * another site.
 */
export function quickplayOptions(env = process.env) {
  const fill = Number(env.QUICKPLAY_FILL_AFTER_MS);
  return {
    fillWithBots: env.QUICKPLAY_BOTS !== 'false',
    botFillAfterMs: Number.isFinite(fill) && fill > 0 ? fill : undefined,
    boardMode: env.QUICKPLAY_BOARDS === 'static' || env.NODE_ENV === 'test' ? 'static' : 'archive',
  };
}

export function initializeSocketHandlers(io, { env = process.env } = {}) {
  const knobs = quickplayOptions(env);
  const gameManager = new GameStateManager({
    fillWithBots: knobs.fillWithBots,
    ...(knobs.botFillAfterMs ? { botFillAfterMs: knobs.botFillAfterMs } : {}),
  });

  /* Write the finished room to every signed-in player's archive. Never throws:
     a game that was played but could not be filed is a log line, not a reason
     to hold back the standings from the people who just played it. */
  function archiveRoom(roomCode) {
    const room = gameManager.rooms.get(roomCode);
    if (!room) return;
    try {
      const written = recordRoomGame(getDatabase(), room);
      if (written.length) console.log(`Archived room ${roomCode} for ${written.length} player(s)`);
    } catch (err) {
      console.error(`Could not archive room ${roomCode}:`, err.message);
    }
  }

  /* The one door out to a room. Everything the room is told goes through
     here, so the quickplay director hears it too and can play the house seats. */
  let director = null;
  function emitRoom(roomCode, event, payload) {
    if (payload === undefined) io.to(roomCode).emit(event);
    else io.to(roomCode).emit(event, payload);
    director?.onRoomEvent(roomCode, event, payload);
  }

  const actions = createGameActions({ gameManager, emitRoom, archiveRoom });

  const boardSource = createBoardSource({ mode: knobs.boardMode, log: (m) => logInfo({ msg: m }) });
  director = createQuickplayDirector({
    gameManager, actions, boardSource, log: (m) => logInfo({ msg: m }),
  });

  // One place for what the matchmaker decided, whether a join or the tick asked.
  // A match goes to everyone seated; a player released after waiting alone is
  // told so once, and only here: the manager never touches a socket itself.
  function settleMatchmaking() {
    const { match, noMatchFor } = gameManager.tryCreateMatch();
    if (match) {
      const seated = match.players.map(({ id, socketId, displayName, signature, isBot }) =>
        ({ id, socketId, displayName, signature, isBot }));
      match.players.forEach(player => {
        if (player.isBot) return;
        /* Into the socket.io room now, not when the game page loads: the
           board is dealt a few seconds from here and a socket that is not in
           the room does not hear it. */
        io.sockets.sockets.get(player.socketId)?.join(match.roomCode);
        io.to(player.socketId).emit('quickplay:match-found', {
          roomCode: match.roomCode,
          players: seated,
          settings: match.settings,
        });
      });
      director.onMatch(match);
    }
    if (noMatchFor) {
      io.to(noMatchFor.id).emit('quickplay:no-match', { message: NO_MATCH_MESSAGE });
    }
  }

  // Lifecycle events (setting the board, ending rounds, starting Final Jeopardy)
  // change the game for everyone, so only the room's host may fire them. In
  // quickplay rooms there is no host and the server runs the game itself.
  function isRoomController(roomCode, sessionId) {
    const room = gameManager.rooms.get(roomCode);
    if (!room) return false;
    if (room.hostId) return room.hostId === sessionId;
    return room.type !== 'quickplay' && room.players.has(sessionId);
  }

  // Push the current typed answers to the host alone. Answers must never be
  // broadcast to the room — the other players have not answered yet.
  function sendTypedAnswersToHost(roomCode) {
    const room = gameManager.rooms.get(roomCode);
    const hostSocketId = room?.players.get(room.hostId)?.socketId;
    if (!hostSocketId) return;

    io.to(hostSocketId).emit('host:typed-answers-update', {
      answers: gameManager.getTypedAnswers(roomCode),
    });
  }

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    const sessionId = socket.handshake.auth.sessionId;

    // Session ID is the primary identifier for reconnection
    socket.sessionId = sessionId || socket.id;

    if (token) {
      try {
        const decoded = verifyToken(token);
        socket.userId = decoded.userId;
        socket.isGuest = decoded.isGuest;
        next();
      } catch (err) {
        // Allow connection without auth for initial connection
        socket.userId = null;
        socket.isGuest = true;
        next();
      }
    } else {
      socket.userId = null;
      socket.isGuest = true;
      next();
    }
  });

  io.on('connection', (socket) => {
    logInfo({
      msg: 'Socket connected',
      socketId: socket.id,
      sessionId: socket.sessionId,
      userId: socket.userId || 'anonymous',
    });

    // Send connection confirmation
    socket.emit('connected', {
      socketId: socket.id,
      userId: socket.userId,
      isGuest: socket.isGuest,
    });

    // Room events
    socket.on('room:create', async ({ type, settings }, callback) => {
      try {
        const room = gameManager.createRoom(type, socket, settings);
        console.log(`Room created: ${room.code} by ${socket.id}`);
        callback({ success: true, roomCode: room.code, roomId: room.id });
      } catch (error) {
        callback({ success: false, error: error.message });
      }
    });

    socket.on('room:join', async ({ roomCode, displayName, signature }, callback) => {
      try {
        const result = await gameManager.joinRoom(socket, roomCode, displayName, signature);
        socket.join(roomCode);
        callback({ success: true, ...result });

        // Notify others in room (include signature)
        socket.to(roomCode).emit('room:player-joined', {
          playerId: socket.sessionId,
          displayName,
          signature,
        });
      } catch (error) {
        callback({ success: false, error: error.message });
      }
    });

    socket.on('room:leave', ({ roomCode }) => {
      socket.leave(roomCode);
      gameManager.leaveRoom(socket, roomCode);

      socket.to(roomCode).emit('room:player-left', {
        playerId: socket.sessionId,
      });
      director.onPlayerGone(roomCode);
    });

    socket.on('room:ready', ({ roomCode, ready }) => {
      gameManager.setPlayerReady(socket, roomCode, ready);

      io.to(roomCode).emit('room:player-ready', {
        playerId: socket.sessionId,
        ready,
      });
    });

    // Player reconnects to room after page reload
    socket.on('room:reconnect', ({ roomCode }, callback) => {
      console.log(`Reconnect attempt: session ${socket.sessionId} to room ${roomCode}`);

      const result = gameManager.reconnectPlayer(socket, roomCode);

      if (result.success) {
        // Rejoin socket to room
        socket.join(roomCode);

        console.log(`Player ${result.displayName} reconnected to room ${roomCode}`);

        // Notify others
        socket.to(roomCode).emit('room:player-reconnected', {
          playerId: socket.sessionId,
          displayName: result.displayName,
        });

        callback(result);
      } else {
        console.log(`Reconnect failed: ${result.error}`);
        callback(result);
      }
    });

    // Host updates room settings
    socket.on('room:update-settings', ({ roomCode, settings }) => {
      const result = gameManager.updateRoomSettings(socket, roomCode, settings);
      if (result) {
        // Broadcast to all players in the room (including sender)
        io.to(roomCode).emit('room:settings-updated', { settings });
        console.log(`Room ${roomCode} settings updated:`, settings);
      }
    });

    // Game events

    // Host starts game setup
    socket.on('game:start-setup', ({ roomCode }) => {
      if (!isRoomController(roomCode, socket.sessionId)) return;
      console.log(`Game setup started for room ${roomCode}`);
      io.to(roomCode).emit('game:setup-started');
    });

    // Host sets categories
    socket.on('game:set-categories', ({ roomCode, categories }) => {
      if (!isRoomController(roomCode, socket.sessionId)) return;
      console.log(`Categories set for room ${roomCode}:`, categories);
      gameManager.setCategories(roomCode, categories);
      io.to(roomCode).emit('game:categories-set', { categories });
    });

    // Host selected a genre (sync to other players for viewing)
    socket.on('game:genre-selected', ({ roomCode, genre }) => {
      if (!isRoomController(roomCode, socket.sessionId)) return;
      console.log(`Genre selected for room ${roomCode}: ${genre}`);
      io.to(roomCode).emit('game:genre-selected', { genre });
    });

    // Host edits a category in real-time (sync to other players)
    socket.on('game:category-edited', ({ roomCode, index, value }) => {
      if (!isRoomController(roomCode, socket.sessionId)) return;
      // Broadcast to others (not back to sender)
      socket.to(roomCode).emit('game:category-edited', { index, value });
    });

    // Host sets questions and starts game
    socket.on('game:set-questions', ({ roomCode, questions, categories, firstPickerId, dailyDoubles }) => {
      if (!isRoomController(roomCode, socket.sessionId)) return;
      console.log(`Questions set for room ${roomCode}, first picker: ${firstPickerId}`);
      actions.setQuestions(roomCode, { questions, categories, firstPickerId, dailyDoubles });
    });

    // Player buzzes in with reaction time
    socket.on('game:buzz-in', ({ roomCode, reactionTime }) => {
      console.log(`Player ${socket.sessionId} buzzed with reaction time ${reactionTime}ms`);
      actions.buzz(socket.sessionId, roomCode, reactionTime);
    });

    // Player submits answer
    socket.on('game:submit-answer', ({ roomCode, correct }) => {
      // `points` deliberately ignored if sent — the board is the only source.
      actions.submitAnswer(socket.sessionId, roomCode, correct);
    });

    // Player reveals the answer (broadcast to all)
    socket.on('game:reveal-answer', ({ roomCode }) => {
      actions.revealAnswer(socket.sessionId, roomCode);
    });

    // Buzz timer expired - no one buzzed in time (legacy client event - server now handles this)
    socket.on('game:buzz-timeout', ({ roomCode }) => {
      // The server owns the buzz timer. This legacy client event is kept only
      // so old clients do not error; honouring it let any player kill a live
      // clue for everyone.
      if (DEBUG_GAME) {
        console.log(`Ignoring client-triggered buzz timeout for room ${roomCode}`);
      }
    });

    // Player clicks Continue after timeout - wait for all players
    socket.on('game:timeout-continue', ({ roomCode }) => {
      if (DEBUG_GAME) {
        console.log(`[GAME] Player ${socket.sessionId} clicked Continue in room ${roomCode}`);
      }
      actions.timeoutContinue(socket.sessionId, roomCode);
    });

    // Daily Double wager submitted
    socket.on('game:daily-double-wager', ({ roomCode, wager }) => {
      console.log(`Daily Double wager ${wager} from ${socket.sessionId} in room ${roomCode}`);
      actions.dailyDoubleWager(socket.sessionId, roomCode, wager);
    });

    // Daily Double answer submitted
    socket.on('game:daily-double-answer', ({ roomCode, correct }) => {
      console.log(`Daily Double answer (correct: ${correct}) from ${socket.sessionId} in room ${roomCode}`);
      actions.dailyDoubleAnswer(socket.sessionId, roomCode, correct);
    });

    // Round 1 ended - transition to Double Jeopardy
    socket.on('game:round-end', ({ roomCode, round }) => {
      if (!isRoomController(roomCode, socket.sessionId)) return;
      console.log(`Round ${round} ended for room ${roomCode}`);
      actions.roundEnd(roomCode, round);
    });

    // Start Round 2 (Double Jeopardy)
    socket.on('game:start-round-2', ({ roomCode, questions, categories, firstPickerId, dailyDoubles }) => {
      if (!isRoomController(roomCode, socket.sessionId)) return;
      console.log(`Starting Round 2 for room ${roomCode}`);
      actions.startRound2(roomCode, { questions, categories, firstPickerId, dailyDoubles });
    });

    // Start Final Jeopardy
    socket.on('game:start-final-jeopardy', ({ roomCode, finalJeopardy }) => {
      if (!isRoomController(roomCode, socket.sessionId)) return;
      console.log(`Starting Final Jeopardy for room ${roomCode}`);
      const fjData = actions.startFinalJeopardy(roomCode, finalJeopardy);
      if (fjData?.eligibleCount === 0) {
        console.log(`No eligible players for Final Jeopardy in ${roomCode}, ending game`);
      }
    });

    // Final Jeopardy wager submitted
    socket.on('game:fj-wager', ({ roomCode, wager }) => {
      console.log(`FJ wager ${wager} from ${socket.sessionId} in room ${roomCode}`);
      actions.fjWager(socket.sessionId, roomCode, wager);
    });

    // Final Jeopardy answer submitted
    socket.on('game:fj-answer', ({ roomCode, answer }) => {
      console.log(`FJ answer from ${socket.sessionId} in room ${roomCode}`);
      actions.fjAnswer(socket.sessionId, roomCode, answer);
    });

    // Game ends
    socket.on('game:end', ({ roomCode }) => {
      if (!isRoomController(roomCode, socket.sessionId)) return;
      console.log(`Game ended for room ${roomCode}`);
      actions.endGame(roomCode);
    });

    // Legacy game events (keep for backward compatibility)
    socket.on('game:start', ({ roomCode }) => {
      const gameState = gameManager.startGame(roomCode);
      if (gameState) {
        io.to(roomCode).emit('game:started', gameState);
      }
    });

    socket.on('game:buzz', ({ roomCode }) => {
      const result = gameManager.playerBuzz(socket, roomCode);
      if (result.success) {
        io.to(roomCode).emit('game:player-buzzed', {
          playerId: socket.sessionId,
        });
      }
    });

    socket.on('game:answer', ({ roomCode, answer }) => {
      const result = gameManager.submitAnswer(socket, roomCode, answer);
      if (result) {
        io.to(roomCode).emit('game:answer-result', result);
      }
    });

    // Quickplay matchmaking
    socket.on('quickplay:join-queue', ({ displayName, signature, preset }) => {
      gameManager.joinMatchmakingQueue(socket, displayName, signature, preset);
      // The thresholds travel with the ack so the waiting screen and the
      // matchmaker never disagree about when the table fills.
      socket.emit('quickplay:queue-joined', gameManager.matchmakingTimings());
      // Somebody is about to need a board. Start fetching one now so the table
      // is not kept waiting on another site when it is seated.
      boardSource.prepare().catch(() => {});

      // Check if we can make a match
      settleMatchmaking();
    });

    socket.on('quickplay:leave-queue', () => {
      gameManager.leaveMatchmakingQueue(socket);
      socket.emit('quickplay:queue-left');
    });

    // =====================
    // HOST MODE EVENTS
    // =====================

    // Host sets custom questions
    socket.on('host:set-custom-questions', ({ roomCode, questions, categories, dailyDoubles }, callback) => {
      const result = gameManager.setHostQuestions(roomCode, questions, categories, socket.sessionId, dailyDoubles);

      if (result?.success) {
        io.to(roomCode).emit('host:questions-set', { questions, categories });
        if (callback) callback({ success: true });
      } else {
        if (callback) callback({ success: false, error: 'Failed to set questions' });
      }
    });

    // Question selection, for host-run rooms and player-run ones alike
    socket.on('game:select-question', ({ roomCode, categoryIndex, pointIndex }) => {
      actions.selectQuestion(socket.sessionId, roomCode, categoryIndex, pointIndex);
    });

    // Non-picker suggests a question
    socket.on('game:suggest-question', ({ roomCode, categoryIndex, pointIndex }) => {
      const playerId = socket.sessionId;
      const suggestions = gameManager.handleSuggestion(roomCode, playerId, categoryIndex, pointIndex);
      if (suggestions) {
        io.to(roomCode).emit('game:question-suggested', { suggestions });
      }
    });

    // Player skips question (I don't know)
    socket.on('game:skip-question', ({ roomCode }) => {
      actions.skipQuestion(socket.sessionId, roomCode);
    });

    // Player submits typed answer (host mode)
    socket.on('player:submit-typed-answer', ({ roomCode, answer }) => {
      const playerId = socket.sessionId;
      const result = gameManager.submitTypedAnswer(roomCode, playerId, answer);

      if (result?.success) {
        const room = gameManager.rooms.get(roomCode);
        const player = room?.players.get(playerId);

        // Notify all that player submitted (without revealing answer)
        io.to(roomCode).emit('player:answer-submitted', {
          playerId,
          playerName: player?.displayName || player?.name,
        });

        // Feed the answer through to the host's control panel as it lands.
        sendTypedAnswersToHost(roomCode);

        // If all answered, notify host
        if (result.allAnswered) {
          io.to(roomCode).emit('game:all-answers-in');

          // Auto-grade if in auto_grade mode
          if (room?.settings?.answerMode === 'auto_grade') {
            const gradeResults = gameManager.autoGradeAnswers(roomCode);
            io.to(roomCode).emit('game:auto-grade-results', { results: gradeResults });
            // Refresh so the panel shows each answer with its grade attached.
            sendTypedAnswersToHost(roomCode);
          }
        }
      }
    });

    // Player selects MC option (host mode)
    socket.on('player:select-mc-option', ({ roomCode, optionIndex }) => {
      const playerId = socket.sessionId;
      const result = gameManager.submitMCSelection(roomCode, playerId, optionIndex);

      if (result?.success) {
        io.to(roomCode).emit('player:mc-selected', {
          playerId,
          hasSelected: true,
        });

        if (result.allSelected) {
          // Auto-score MC answers. The payload carries correctIndex and
          // nextPickerId — the client needs both to highlight the right option
          // and to keep the host holding the pick.
          io.to(roomCode).emit('game:mc-results', gameManager.scoreMCAnswers(roomCode));
        }
      }
    });

    // Host judges answer
    socket.on('host:judge-answer', ({ roomCode, playerId, correct }) => {
      // `points` deliberately ignored if sent — the board is the only source.
      const result = gameManager.hostJudgeAnswer(roomCode, socket.sessionId, playerId, correct);

      if (result) {
        io.to(roomCode).emit('host:answer-judged', result);

        /* Wrong, and somebody else has not had a go: the clue stays up and the
           buzzer reopens for them. hostJudgeAnswer has already reopened the
           window on the server, so this only tells the room. */
        if (result.canBuzzAgain) {
          io.to(roomCode).emit('host:buzzer-opened');
        }
      }
    });

    /* A Daily Double in a hosted room. The host names the player it belongs to
       and enters their wager, because the host picked the clue and has no score
       of their own for the usual rule to land on. */
    socket.on('host:daily-double-wager', ({ roomCode, playerId, wager }) => {
      const result = gameManager.hostDailyDoubleWager(roomCode, socket.sessionId, playerId, wager);
      if (result) io.to(roomCode).emit('game:daily-double-wager-confirmed', result);
    });

    socket.on('host:daily-double-answer', ({ roomCode, correct }) => {
      const result = gameManager.hostDailyDoubleAnswer(roomCode, socket.sessionId, correct);
      if (result) io.to(roomCode).emit('game:daily-double-result', result);
    });

    // Host overrides score
    socket.on('host:override-score', ({ roomCode, playerId, newScore, reason }) => {
      const result = gameManager.overridePlayerScore(roomCode, socket.sessionId, playerId, newScore, reason);

      if (result) {
        io.to(roomCode).emit('host:score-overridden', result);
      }
    });

    // Host skips question
    socket.on('host:skip-question', ({ roomCode }) => {
      const room = gameManager.rooms.get(roomCode);

      // Abandoning a clue must also abandon its timers, or a stale one fires
      // against whatever clue happens to be open when it lands.
      gameManager.clearBuzzTimeout(roomCode);
      gameManager.clearAnswerTimeout(roomCode);
      if (room?.autoOpenTimer) { clearTimeout(room.autoOpenTimer); room.autoOpenTimer = null; }

      const result = gameManager.skipQuestion(roomCode, socket.sessionId);

      if (result) {
        // Host always picks next in host mode
        io.to(roomCode).emit('host:question-skipped', {
          nextPickerId: room?.hostId,
        });
      }
    });

    // Host reveals typed answers
    socket.on('host:reveal-answers', ({ roomCode }) => {
      const room = gameManager.rooms.get(roomCode);
      if (room?.hostId !== socket.sessionId) return;

      const answers = gameManager.getTypedAnswers(roomCode);
      // Revealing is deliberate, so this one does go to the whole room.
      io.to(roomCode).emit('host:answers-revealed', { answers });
      sendTypedAnswersToHost(roomCode);
    });

    // Host kicks player
    socket.on('host:kick-player', ({ roomCode, playerId }) => {
      const result = gameManager.kickPlayer(roomCode, socket.sessionId, playerId);

      if (result) {
        io.to(roomCode).emit('host:player-kicked', { playerId: result.playerId });

        // Disconnect the kicked player's socket
        if (result.socketId) {
          io.to(result.socketId).emit('kicked', { reason: 'Removed by host' });
        }
      }
    });

    // Host opens buzzer (verbal mode) — manual override
    socket.on('host:open-buzzer', ({ roomCode }) => {
      const room = gameManager.rooms.get(roomCode);
      if (room?.hostId !== socket.sessionId) return;

      // Clear auto-open timer since host is manually controlling
      if (room.autoOpenTimer) { clearTimeout(room.autoOpenTimer); room.autoOpenTimer = null; }

      gameManager.startBuzzWindow(roomCode);
      io.to(roomCode).emit('host:buzzer-opened');
    });

    // Host closes buzzer
    socket.on('host:close-buzzer', ({ roomCode }) => {
      const room = gameManager.rooms.get(roomCode);
      if (room?.hostId !== socket.sessionId) return;

      gameManager.clearBuzzTimeout(roomCode);
      if (room.gameState) {
        room.gameState.buzzWindowOpen = false;
      }
      io.to(roomCode).emit('host:buzzer-closed');
    });

    // Host opens answer window (typed/MC mode) — manual override
    socket.on('host:open-answer-window', ({ roomCode }) => {
      const room = gameManager.rooms.get(roomCode);
      if (room?.hostId !== socket.sessionId) return;

      // Clear auto-open timer since host is manually controlling
      if (room.autoOpenTimer) { clearTimeout(room.autoOpenTimer); room.autoOpenTimer = null; }

      gameManager.openHostAnswerWindow(roomCode);
      io.to(roomCode).emit('host:answer-window-opened', {
        duration: buzzWindowMs(room),
      });
    });

    // Host controls media playback (synced to all players)
    socket.on('host:media-control', ({ roomCode, action }) => {
      const room = gameManager.rooms.get(roomCode);
      if (room?.hostId !== socket.sessionId) return;
      // action: 'play' | 'pause' | 'replay'
      socket.to(roomCode).emit('host:media-control', { action });
    });

    // Host closes answer window
    socket.on('host:close-answer-window', ({ roomCode }) => {
      const room = gameManager.rooms.get(roomCode);
      if (room?.hostId !== socket.sessionId) return;

      gameManager.closeHostAnswerWindow(roomCode);
      io.to(roomCode).emit('host:answer-window-closed');
    });

    // Disconnect handling
    socket.on('disconnect', (reason) => {
      logInfo({ msg: 'Socket disconnected', socketId: socket.id, reason });
      const roomCode = gameManager.sessionRooms.get(socket.sessionId);
      gameManager.handleDisconnect(socket);
      if (roomCode) director.onPlayerGone(roomCode);
    });
  });

  // Periodic tasks
  const tick = setInterval(() => {
    // Clean up stale rooms
    gameManager.cleanupStaleRooms();

    // Update matchmaking queue
    settleMatchmaking();
  }, 5000);
  /* A timer that keeps the process alive is a timer a test run cannot exit
     past. The server does not care; the suites do. */
  tick.unref?.();

  return { gameManager, actions, director };
}
