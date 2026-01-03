import { verifyToken } from '../middleware/auth.js';
import { GameStateManager } from './GameStateManager.js';

const gameManager = new GameStateManager();

// Debug flag - set DEBUG_GAME=true in .env to enable game debugging
const DEBUG_GAME = process.env.DEBUG_GAME === 'true';

export function initializeSocketHandlers(io) {
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
    console.log(`Socket connected: ${socket.id}, Session: ${socket.sessionId}, User: ${socket.userId || 'anonymous'}`);

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
      console.log(`Game setup started for room ${roomCode}`);
      io.to(roomCode).emit('game:setup-started');
    });

    // Host sets categories
    socket.on('game:set-categories', ({ roomCode, categories }) => {
      console.log(`Categories set for room ${roomCode}:`, categories);
      gameManager.setCategories(roomCode, categories);
      io.to(roomCode).emit('game:categories-set', { categories });
    });

    // Host selected a genre (sync to other players for viewing)
    socket.on('game:genre-selected', ({ roomCode, genre }) => {
      console.log(`Genre selected for room ${roomCode}: ${genre}`);
      io.to(roomCode).emit('game:genre-selected', { genre });
    });

    // Host edits a category in real-time (sync to other players)
    socket.on('game:category-edited', ({ roomCode, index, value }) => {
      // Broadcast to others (not back to sender)
      socket.to(roomCode).emit('game:category-edited', { index, value });
    });

    // Host sets questions and starts game
    socket.on('game:set-questions', ({ roomCode, questions, categories, firstPickerId }) => {
      console.log(`Questions set for room ${roomCode}, first picker: ${firstPickerId}`);
      gameManager.setQuestions(roomCode, questions, categories, firstPickerId);
      io.to(roomCode).emit('game:questions-ready', { questions, categories, firstPickerId });
    });

    // Player selects a question (handled in HOST MODE EVENTS section for host mode support)

    // Player buzzes in with reaction time
    socket.on('game:buzz-in', ({ roomCode, reactionTime }) => {
      const playerId = socket.sessionId;
      console.log(`Player ${playerId} buzzed with reaction time ${reactionTime}ms`);

      const room = gameManager.rooms.get(roomCode);

      // Prevent host from buzzing in host mode
      if (room?.type === 'host' && room?.hostId === playerId) {
        console.log(`Host ${playerId} tried to buzz - ignoring`);
        return;
      }

      // Clear the server-side buzz timeout since someone buzzed
      gameManager.clearBuzzTimeout(roomCode);

      gameManager.recordBuzz(roomCode, playerId, reactionTime);

      // Check if this is the first buzz (announce winner immediately for responsiveness)
      if (room && room.gameState.buzzes && Object.keys(room.gameState.buzzes).length === 1) {
        // First buzzer - announce them as winner after a brief delay
        setTimeout(() => {
          const winner = gameManager.determineBuzzerWinner(roomCode);
          if (winner) {
            const player = room.players.get(winner.playerId);
            io.to(roomCode).emit('game:buzzer-winner', {
              playerId: winner.playerId,
              playerName: player?.displayName || 'Unknown',
              reactionTime: winner.reactionTime,
            });

            // Start answer window and server-side answer timeout
            gameManager.startAnswerWindow(roomCode);
            const answerDuration = room?.settings?.questionTimeLimit || 30000;

            gameManager.clearAnswerTimeout(roomCode);
            room.answerTimeout = setTimeout(() => {
              // Answer timeout - mark as incorrect automatically
              const timeoutResult = gameManager.handleAnswer(roomCode, winner.playerId, false, room.gameState.currentQuestion?.points || 0);
              if (timeoutResult) {
                io.to(roomCode).emit('game:answer-result', {
                  ...timeoutResult,
                  timeout: true,
                });
              }
            }, answerDuration);
          }
        }, 500); // Small delay to collect other buzzes
      }
    });

    // Player submits answer
    socket.on('game:submit-answer', ({ roomCode, correct, points, timeout }) => {
      const playerId = socket.sessionId;

      // Clear the server-side answer timeout since they answered
      gameManager.clearAnswerTimeout(roomCode);

      const result = gameManager.handleAnswer(roomCode, playerId, correct, points);
      if (result) {
        io.to(roomCode).emit('game:answer-result', result);
      }
    });

    // Player reveals the answer (broadcast to all)
    socket.on('game:reveal-answer', ({ roomCode }) => {
      const playerId = socket.sessionId;
      const room = gameManager.rooms.get(roomCode);

      // Verify this player is the buzzer winner (the one who should reveal)
      if (room?.gameState?.buzzedPlayerId === playerId) {
        // Broadcast to ALL players that answer was revealed
        io.to(roomCode).emit('game:answer-revealed', {
          playerId,
          answer: room.gameState.currentQuestion?.question,
        });
      }
    });

    // Buzz timer expired - no one buzzed in time (legacy client event - server now handles this)
    socket.on('game:buzz-timeout', ({ roomCode, points }) => {
      console.log(`Buzz timeout for room ${roomCode} (client-triggered, server handles this now)`);
      const result = gameManager.handleBuzzTimeout(roomCode);
      if (result) {
        io.to(roomCode).emit('game:buzz-timeout-result', result);
      }
    });

    // Player clicks Continue after timeout - wait for all players
    socket.on('game:timeout-continue', ({ roomCode }) => {
      const playerId = socket.sessionId;
      if (DEBUG_GAME) {
        console.log(`[GAME] Player ${playerId} clicked Continue in room ${roomCode}`);
      }

      const allContinued = gameManager.playerContinued(roomCode, playerId);

      if (allContinued) {
        // All players have clicked Continue - clear question and return to board
        gameManager.clearCurrentQuestion(roomCode);
        const nextPickerId = gameManager.getCurrentPicker(roomCode);

        if (DEBUG_GAME) {
          console.log(`[GAME] All players continued in room ${roomCode}, next picker: ${nextPickerId}`);
        }

        io.to(roomCode).emit('game:all-continued', { nextPickerId });
      }
    });

    // Daily Double wager submitted
    socket.on('game:daily-double-wager', ({ roomCode, wager }) => {
      const playerId = socket.sessionId;
      console.log(`Daily Double wager ${wager} from ${playerId} in room ${roomCode}`);
      const result = gameManager.handleDailyDoubleWager(roomCode, playerId, wager);
      if (result) {
        io.to(roomCode).emit('game:daily-double-wager-confirmed', result);
      }
    });

    // Daily Double answer submitted
    socket.on('game:daily-double-answer', ({ roomCode, correct }) => {
      const playerId = socket.sessionId;
      console.log(`Daily Double answer (correct: ${correct}) from ${playerId} in room ${roomCode}`);
      const result = gameManager.handleDailyDoubleAnswer(roomCode, playerId, correct);
      if (result) {
        io.to(roomCode).emit('game:daily-double-result', result);
      }
    });

    // Round 1 ended - transition to Double Jeopardy
    socket.on('game:round-end', ({ roomCode, round }) => {
      console.log(`Round ${round} ended for room ${roomCode}`);
      io.to(roomCode).emit('game:round-ended', { round });
    });

    // Start Round 2 (Double Jeopardy)
    socket.on('game:start-round-2', ({ roomCode, questions, categories, firstPickerId }) => {
      console.log(`Starting Round 2 for room ${roomCode}`);
      gameManager.startRound2(roomCode, questions, categories, firstPickerId);
      io.to(roomCode).emit('game:round-2-started', { questions, categories, firstPickerId });
    });

    // Start Final Jeopardy
    socket.on('game:start-final-jeopardy', async ({ roomCode }) => {
      console.log(`Starting Final Jeopardy for room ${roomCode}`);
      const fjData = gameManager.startFinalJeopardy(roomCode);
      if (fjData) {
        io.to(roomCode).emit('game:final-jeopardy-started', fjData);
      }
    });

    // Final Jeopardy wager submitted
    socket.on('game:fj-wager', ({ roomCode, wager }) => {
      const playerId = socket.sessionId;
      console.log(`FJ wager ${wager} from ${playerId} in room ${roomCode}`);
      const allIn = gameManager.submitFJWager(roomCode, playerId, wager);
      if (allIn) {
        // All wagers are in, show clue
        io.to(roomCode).emit('game:fj-show-clue');
      }
    });

    // Final Jeopardy answer submitted
    socket.on('game:fj-answer', ({ roomCode, answer }) => {
      const playerId = socket.sessionId;
      console.log(`FJ answer from ${playerId} in room ${roomCode}`);
      const allIn = gameManager.submitFJAnswer(roomCode, playerId, answer);
      if (allIn) {
        // All answers are in, reveal results
        const results = gameManager.getFJResults(roomCode);
        io.to(roomCode).emit('game:fj-reveal', { results });
      }
    });

    // Game ends
    socket.on('game:end', ({ roomCode }) => {
      console.log(`Game ended for room ${roomCode}`);
      io.to(roomCode).emit('game:ended');
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
    socket.on('quickplay:join-queue', ({ displayName, signature }) => {
      gameManager.joinMatchmakingQueue(socket, displayName, signature);
      socket.emit('quickplay:queue-joined');

      // Check if we can make a match
      const match = gameManager.tryCreateMatch();
      if (match) {
        match.players.forEach(player => {
          io.to(player.socketId).emit('quickplay:match-found', {
            roomCode: match.roomCode,
            players: match.players,
          });
        });
      }
    });

    socket.on('quickplay:leave-queue', () => {
      gameManager.leaveMatchmakingQueue(socket);
      socket.emit('quickplay:queue-left');
    });

    // =====================
    // HOST MODE EVENTS
    // =====================

    // Host sets custom questions
    socket.on('host:set-custom-questions', ({ roomCode, questions, categories }, callback) => {
      const result = gameManager.setHostQuestions(roomCode, questions, categories, socket.sessionId);

      if (result?.success) {
        io.to(roomCode).emit('host:questions-set', { questions, categories });
        if (callback) callback({ success: true });
      } else {
        if (callback) callback({ success: false, error: 'Failed to set questions' });
      }
    });

    // Host-only question selection (for host mode rooms)
    socket.on('game:select-question', ({ roomCode, categoryIndex, pointIndex }) => {
      const room = gameManager.rooms.get(roomCode);

      // Use host mode selection if applicable
      let result;
      if (room?.type === 'host') {
        result = gameManager.selectQuestionHostMode(socket, roomCode, categoryIndex, pointIndex);
      } else {
        result = gameManager.selectQuestion(socket, roomCode, categoryIndex, pointIndex);
      }

      if (result) {
        io.to(roomCode).emit('game:question-selected', result);

        // Skip buzz window for Daily Double (only picker answers)
        if (result.isDailyDouble) {
          return;
        }

        // Start buzz collection window
        gameManager.startBuzzWindow(roomCode);

        // Start server-side buzz timeout
        const duration = room?.settings?.questionTimeLimit || 30000;

        // Clear any existing timeout
        gameManager.clearBuzzTimeout(roomCode);

        room.buzzTimeout = setTimeout(() => {
          const timeoutResult = gameManager.handleBuzzTimeout(roomCode);
          if (timeoutResult) {
            io.to(roomCode).emit('game:buzz-timeout-result', timeoutResult);
          }
        }, duration);
      }
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

        // If all answered, notify host
        if (result.allAnswered) {
          io.to(roomCode).emit('game:all-answers-in');

          // Auto-grade if in auto_grade mode
          if (room?.settings?.answerMode === 'auto_grade') {
            const gradeResults = gameManager.autoGradeAnswers(roomCode);
            io.to(roomCode).emit('game:auto-grade-results', { results: gradeResults });
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
          // Auto-score MC answers
          const mcResults = gameManager.scoreMCAnswers(roomCode);
          io.to(roomCode).emit('game:mc-results', { results: mcResults });
        }
      }
    });

    // Host judges answer
    socket.on('host:judge-answer', ({ roomCode, playerId, correct, points }) => {
      const result = gameManager.hostJudgeAnswer(roomCode, socket.sessionId, playerId, correct, points);

      if (result) {
        io.to(roomCode).emit('host:answer-judged', result);
      }
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
      io.to(roomCode).emit('host:answers-revealed', { answers });
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

    // Host opens buzzer (verbal mode)
    socket.on('host:open-buzzer', ({ roomCode }) => {
      const room = gameManager.rooms.get(roomCode);
      if (room?.hostId !== socket.sessionId) return;

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

    // Host opens answer window (typed/MC mode)
    socket.on('host:open-answer-window', ({ roomCode }) => {
      const room = gameManager.rooms.get(roomCode);
      if (room?.hostId !== socket.sessionId) return;

      gameManager.openHostAnswerWindow(roomCode);
      io.to(roomCode).emit('host:answer-window-opened', {
        duration: room.settings?.questionTimeLimit || 30000,
      });
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
      console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
      gameManager.handleDisconnect(socket);
    });
  });

  // Periodic tasks
  setInterval(() => {
    // Clean up stale rooms
    gameManager.cleanupStaleRooms();

    // Update matchmaking queue
    const match = gameManager.tryCreateMatch();
    if (match) {
      match.players.forEach(player => {
        io.to(player.socketId).emit('quickplay:match-found', {
          roomCode: match.roomCode,
          players: match.players,
        });
      });
    }
  }, 5000);
}
