import { verifyToken } from '../middleware/auth.js';
import { GameStateManager } from './GameStateManager.js';

const gameManager = new GameStateManager();

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
      const result = gameManager.selectQuestion(socket, roomCode, categoryIndex, pointIndex);
      if (result) {
        io.to(roomCode).emit('game:question-selected', result);
        // Start buzz collection window
        gameManager.startBuzzWindow(roomCode);
      }
    });

    // Player buzzes in with reaction time
    socket.on('game:buzz-in', ({ roomCode, reactionTime }) => {
      const playerId = socket.userId || socket.id;
      console.log(`Player ${playerId} buzzed with reaction time ${reactionTime}ms`);
      gameManager.recordBuzz(roomCode, playerId, reactionTime);

      // Check if this is the first buzz (announce winner immediately for responsiveness)
      // In a production system, you'd wait for buzz window to close
      const room = gameManager.rooms.get(roomCode);
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
          }
        }, 500); // Small delay to collect other buzzes
      }
    });

    // Player submits answer
    socket.on('game:submit-answer', ({ roomCode, correct, points }) => {
      const playerId = socket.userId || socket.id;
      const result = gameManager.handleAnswer(roomCode, playerId, correct, points);
      if (result) {
        io.to(roomCode).emit('game:answer-result', result);
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
