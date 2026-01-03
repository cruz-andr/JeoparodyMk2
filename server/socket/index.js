import { verifyToken } from '../middleware/auth.js';
import { GameStateManager } from './GameStateManager.js';

const gameManager = new GameStateManager();

// Debug flag - set DEBUG_GAME=true in .env to enable game debugging
const DEBUG_GAME = process.env.DEBUG_GAME === 'true';

export function initializeSocketHandlers(io) {
  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;

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
    console.log(`Socket connected: ${socket.id}, User: ${socket.userId || 'anonymous'}`);

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

    socket.on('room:join', async ({ roomCode, displayName }, callback) => {
      try {
        const result = await gameManager.joinRoom(socket, roomCode, displayName);
        socket.join(roomCode);
        callback({ success: true, ...result });

        // Notify others in room
        socket.to(roomCode).emit('room:player-joined', {
          playerId: socket.userId || socket.id,
          displayName,
        });
      } catch (error) {
        callback({ success: false, error: error.message });
      }
    });

    socket.on('room:leave', ({ roomCode }) => {
      socket.leave(roomCode);
      gameManager.leaveRoom(socket, roomCode);

      socket.to(roomCode).emit('room:player-left', {
        playerId: socket.userId || socket.id,
      });
    });

    socket.on('room:ready', ({ roomCode, ready }) => {
      gameManager.setPlayerReady(socket, roomCode, ready);

      io.to(roomCode).emit('room:player-ready', {
        playerId: socket.userId || socket.id,
        ready,
      });
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

    // Host sets questions and starts game
    socket.on('game:set-questions', ({ roomCode, questions, categories, firstPickerId }) => {
      console.log(`Questions set for room ${roomCode}, first picker: ${firstPickerId}`);
      gameManager.setQuestions(roomCode, questions, categories, firstPickerId);
      io.to(roomCode).emit('game:questions-ready', { questions, categories, firstPickerId });
    });

    // Player selects a question
    socket.on('game:select-question', ({ roomCode, categoryIndex, pointIndex }) => {
      if (DEBUG_GAME) {
        const room = gameManager.rooms.get(roomCode);
        console.log(`[GAME] Question select: room=${roomCode}, player=${socket.userId || socket.id}, cat=${categoryIndex}, pt=${pointIndex}`);
        console.log(`[GAME] Current picker: ${room?.gameState?.currentPickerId}, Questions loaded: ${!!room?.gameState?.questions}`);
      }

      const result = gameManager.selectQuestion(socket, roomCode, categoryIndex, pointIndex);

      if (DEBUG_GAME) {
        console.log(`[GAME] Question select result:`, result ? 'success' : 'FAILED (validation)');
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
        const room = gameManager.rooms.get(roomCode);
        const duration = room?.settings?.questionTimeLimit || 30000;

        // Clear any existing timeout
        gameManager.clearBuzzTimeout(roomCode);

        room.buzzTimeout = setTimeout(() => {
          // Server enforces timeout - emit to ALL clients simultaneously
          const timeoutResult = gameManager.handleBuzzTimeout(roomCode);
          if (timeoutResult) {
            io.to(roomCode).emit('game:buzz-timeout-result', timeoutResult);
          }
        }, duration);
      }
    });

    // Player buzzes in with reaction time
    socket.on('game:buzz-in', ({ roomCode, reactionTime }) => {
      const playerId = socket.userId || socket.id;
      console.log(`Player ${playerId} buzzed with reaction time ${reactionTime}ms`);

      const room = gameManager.rooms.get(roomCode);

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
      const playerId = socket.userId || socket.id;

      // Clear the server-side answer timeout since they answered
      gameManager.clearAnswerTimeout(roomCode);

      const result = gameManager.handleAnswer(roomCode, playerId, correct, points);
      if (result) {
        io.to(roomCode).emit('game:answer-result', result);
      }
    });

    // Player reveals the answer (broadcast to all)
    socket.on('game:reveal-answer', ({ roomCode }) => {
      const playerId = socket.userId || socket.id;
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
      const playerId = socket.userId || socket.id;
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
      const playerId = socket.userId || socket.id;
      console.log(`Daily Double wager ${wager} from ${playerId} in room ${roomCode}`);
      const result = gameManager.handleDailyDoubleWager(roomCode, playerId, wager);
      if (result) {
        io.to(roomCode).emit('game:daily-double-wager-confirmed', result);
      }
    });

    // Daily Double answer submitted
    socket.on('game:daily-double-answer', ({ roomCode, correct }) => {
      const playerId = socket.userId || socket.id;
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
      const playerId = socket.userId || socket.id;
      console.log(`FJ wager ${wager} from ${playerId} in room ${roomCode}`);
      const allIn = gameManager.submitFJWager(roomCode, playerId, wager);
      if (allIn) {
        // All wagers are in, show clue
        io.to(roomCode).emit('game:fj-show-clue');
      }
    });

    // Final Jeopardy answer submitted
    socket.on('game:fj-answer', ({ roomCode, answer }) => {
      const playerId = socket.userId || socket.id;
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
          playerId: socket.userId || socket.id,
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
    socket.on('quickplay:join-queue', ({ displayName }) => {
      gameManager.joinMatchmakingQueue(socket, displayName);
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
