import { v4 as uuidv4 } from 'uuid';

export class GameStateManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> GameRoom
    this.playerRooms = new Map(); // socketId -> roomCode
    this.matchmakingQueue = []; // Array of { socket, displayName, joinedAt }
  }

  // Room Management
  createRoom(type, creatorSocket, settings = {}) {
    const roomCode = this.generateRoomCode();
    const room = {
      id: uuidv4(),
      code: roomCode,
      type,
      hostId: creatorSocket.userId || creatorSocket.id,
      status: 'waiting',
      players: new Map(),
      settings: {
        maxPlayers: type === 'host' ? 30 : 6,
        questionTimeLimit: 30000,
        ...settings,
      },
      gameState: null,
      createdAt: Date.now(),
    };

    this.rooms.set(roomCode, room);
    return room;
  }

  joinRoom(socket, roomCode, displayName) {
    const room = this.rooms.get(roomCode.toUpperCase());

    if (!room) {
      throw new Error('Room not found');
    }

    if (room.status !== 'waiting') {
      throw new Error('Game already in progress');
    }

    if (room.players.size >= room.settings.maxPlayers) {
      throw new Error('Room is full');
    }

    const playerId = socket.userId || socket.id;
    const player = {
      id: playerId,
      socketId: socket.id,
      displayName,
      score: 0,
      isReady: false,
      isConnected: true,
      isHost: playerId === room.hostId,
    };

    room.players.set(playerId, player);
    this.playerRooms.set(socket.id, roomCode);

    return {
      roomId: room.id,
      roomCode: room.code,
      players: Array.from(room.players.values()),
      settings: room.settings,
      isHost: player.isHost,
    };
  }

  leaveRoom(socket, roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const playerId = socket.userId || socket.id;
    room.players.delete(playerId);
    this.playerRooms.delete(socket.id);

    // If room is empty, delete it
    if (room.players.size === 0) {
      this.rooms.delete(roomCode);
    }
  }

  setPlayerReady(socket, roomCode, ready) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const playerId = socket.userId || socket.id;
    const player = room.players.get(playerId);
    if (player) {
      player.isReady = ready;
    }
  }

  // Game Logic - Multiplayer Setup

  setCategories(roomCode, categories) {
    const room = this.rooms.get(roomCode);
    if (room) {
      room.gameState = room.gameState || {};
      room.gameState.categories = categories;
    }
  }

  setQuestions(roomCode, questions, categories, firstPickerId) {
    const room = this.rooms.get(roomCode);
    if (room) {
      room.status = 'in_progress';
      room.gameState = room.gameState || {};
      room.gameState.questions = questions;
      room.gameState.categories = categories;
      room.gameState.currentPickerId = firstPickerId;
      room.gameState.phase = 'playing';
      room.gameState.buzzes = {};
      room.gameState.buzzedPlayerId = null;
      room.gameState.currentQuestion = null;
      room.gameState.playersWhoBuzzed = new Set();
    }
  }

  selectQuestion(socket, roomCode, categoryIndex, pointIndex) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    const playerId = socket.userId || socket.id;
    // Allow selection if they are the current picker
    if (room.gameState.currentPickerId !== playerId) {
      return null; // Not their turn
    }

    const question = room.gameState.questions[categoryIndex]?.[pointIndex];
    if (!question || question.revealed) return null;

    question.revealed = true;
    room.gameState.currentQuestion = { ...question, categoryIndex, pointIndex };
    room.gameState.phase = 'questionActive';
    room.gameState.buzzes = {};
    room.gameState.playersWhoBuzzed = new Set();

    return {
      categoryIndex,
      pointIndex,
      question: {
        category: question.category,
        points: question.points,
        answer: question.answer,
        question: question.question,
      },
    };
  }

  startBuzzWindow(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room && room.gameState) {
      room.gameState.buzzes = {};
      room.gameState.buzzWindowOpen = true;
      room.gameState.playersWhoBuzzed = new Set();
    }
  }

  recordBuzz(roomCode, playerId, reactionTime) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return;

    // Only record if they haven't already buzzed for this question
    if (!room.gameState.playersWhoBuzzed.has(playerId)) {
      room.gameState.buzzes[playerId] = reactionTime;
      room.gameState.playersWhoBuzzed.add(playerId);
    }
  }

  determineBuzzerWinner(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    const buzzes = room.gameState.buzzes;
    if (!buzzes || Object.keys(buzzes).length === 0) return null;

    // Find fastest reaction time (lowest ms)
    const sorted = Object.entries(buzzes).sort((a, b) => a[1] - b[1]);
    const winner = sorted[0];

    room.gameState.buzzedPlayerId = winner[0];
    room.gameState.buzzWindowOpen = false;

    return {
      playerId: winner[0],
      reactionTime: winner[1],
    };
  }

  handleAnswer(roomCode, playerId, correct, points) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    // Verify this player buzzed
    if (room.gameState.buzzedPlayerId !== playerId) {
      return null;
    }

    const player = room.players.get(playerId);
    if (!player) return null;

    if (correct) {
      player.score = (player.score || 0) + points;
      // Correct answer - they get to pick next
      room.gameState.currentPickerId = playerId;
      room.gameState.currentQuestion = null;
      room.gameState.buzzedPlayerId = null;
      room.gameState.buzzes = {};
      room.gameState.playersWhoBuzzed = new Set();

      return {
        playerId,
        correct: true,
        newScore: player.score,
        nextPickerId: playerId,
        canBuzzAgain: false,
      };
    } else {
      player.score = (player.score || 0) - points;

      // Check if others can still buzz
      const totalPlayers = room.players.size;
      const playersBuzzed = room.gameState.playersWhoBuzzed?.size || 0;
      const canBuzzAgain = playersBuzzed < totalPlayers;

      if (!canBuzzAgain) {
        // No one left to buzz - move on, keep same picker
        room.gameState.currentQuestion = null;
        room.gameState.buzzedPlayerId = null;
        room.gameState.buzzes = {};
        room.gameState.playersWhoBuzzed = new Set();
      } else {
        // Others can try
        room.gameState.buzzedPlayerId = null;
        room.gameState.buzzes = {};
      }

      return {
        playerId,
        correct: false,
        newScore: player.score,
        nextPickerId: room.gameState.currentPickerId,
        canBuzzAgain,
      };
    }
  }

  // Legacy Game Logic (keep for backward compatibility)
  startGame(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'waiting') return null;

    room.status = 'in_progress';
    room.gameState = {
      round: 1,
      phase: 'playing',
      currentTurnPlayerId: this.getRandomPlayer(room),
      categories: [],
      questions: [],
      buzzerActive: false,
      buzzedPlayerId: null,
      currentQuestion: null,
    };

    return {
      status: room.status,
      gameState: room.gameState,
      players: Array.from(room.players.values()),
    };
  }

  playerBuzz(socket, roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState || !room.gameState.buzzerActive) {
      return { success: false };
    }

    const playerId = socket.userId || socket.id;
    if (room.gameState.buzzedPlayerId) {
      return { success: false }; // Someone already buzzed
    }

    room.gameState.buzzedPlayerId = playerId;
    room.gameState.buzzerActive = false;

    return {
      success: true,
      playerId,
    };
  }

  submitAnswer(socket, roomCode, answer) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    const playerId = socket.userId || socket.id;
    if (room.gameState.buzzedPlayerId !== playerId) {
      return null; // They didn't buzz
    }

    const question = room.gameState.currentQuestion;
    // Simple answer validation (in production, use AI validation)
    const isCorrect = this.validateAnswer(answer, question.question);

    const player = room.players.get(playerId);
    if (isCorrect) {
      player.score += question.points;
      room.gameState.currentTurnPlayerId = playerId;
    } else {
      player.score -= question.points;
    }

    room.gameState.currentQuestion = null;
    room.gameState.buzzedPlayerId = null;
    room.gameState.phase = 'playing';

    return {
      playerId,
      isCorrect,
      correctAnswer: question.question,
      newScore: player.score,
      nextTurnPlayerId: room.gameState.currentTurnPlayerId,
    };
  }

  validateAnswer(playerAnswer, correctAnswer) {
    // Simple validation - in production, use AI
    const normalize = (s) => s.toLowerCase()
      .replace(/^(what|who|where|when|why|how)\s+(is|are|was|were)\s+/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

    return normalize(playerAnswer) === normalize(correctAnswer);
  }

  // Matchmaking
  joinMatchmakingQueue(socket, displayName) {
    // Remove if already in queue
    this.leaveMatchmakingQueue(socket);

    this.matchmakingQueue.push({
      socket,
      displayName,
      joinedAt: Date.now(),
    });
  }

  leaveMatchmakingQueue(socket) {
    this.matchmakingQueue = this.matchmakingQueue.filter(
      p => p.socket.id !== socket.id
    );
  }

  tryCreateMatch() {
    if (this.matchmakingQueue.length < 3) {
      return null;
    }

    // Take first 3 players
    const matchedPlayers = this.matchmakingQueue.splice(0, 3);

    // Create room
    const roomCode = this.generateRoomCode();
    const room = {
      id: uuidv4(),
      code: roomCode,
      type: 'quickplay',
      hostId: null,
      status: 'waiting',
      players: new Map(),
      settings: {
        maxPlayers: 3,
        questionTimeLimit: 30000,
      },
      gameState: null,
      createdAt: Date.now(),
    };

    // Add players to room
    matchedPlayers.forEach(({ socket, displayName }) => {
      const playerId = socket.userId || socket.id;
      room.players.set(playerId, {
        id: playerId,
        socketId: socket.id,
        displayName,
        score: 0,
        isReady: false,
        isConnected: true,
        isHost: false,
      });
      this.playerRooms.set(socket.id, roomCode);
    });

    this.rooms.set(roomCode, room);

    return {
      roomCode,
      players: matchedPlayers.map(p => ({
        socketId: p.socket.id,
        displayName: p.displayName,
      })),
    };
  }

  // Disconnection
  handleDisconnect(socket) {
    // Remove from matchmaking queue
    this.leaveMatchmakingQueue(socket);

    // Handle room disconnection
    const roomCode = this.playerRooms.get(socket.id);
    if (roomCode) {
      const room = this.rooms.get(roomCode);
      if (room) {
        const playerId = socket.userId || socket.id;
        const player = room.players.get(playerId);
        if (player) {
          player.isConnected = false;
        }
      }
      this.playerRooms.delete(socket.id);
    }
  }

  // Utilities
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  getRandomPlayer(room) {
    const players = Array.from(room.players.keys());
    return players[Math.floor(Math.random() * players.length)];
  }

  cleanupStaleRooms() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [code, room] of this.rooms) {
      if (now - room.createdAt > maxAge && room.status !== 'in_progress') {
        this.rooms.delete(code);
      }
    }
  }
}
