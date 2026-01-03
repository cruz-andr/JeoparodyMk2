import { v4 as uuidv4 } from 'uuid';

export class GameStateManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> GameRoom
    this.playerRooms = new Map(); // socketId -> roomCode (legacy, kept for cleanup)
    this.sessionRooms = new Map(); // sessionId -> roomCode (for reconnection)
    this.matchmakingQueue = []; // Array of { socket, displayName, joinedAt }
  }

  // Room Management
  createRoom(type, creatorSocket, settings = {}) {
    const roomCode = this.generateRoomCode();
    const room = {
      id: uuidv4(),
      code: roomCode,
      type,
      hostId: creatorSocket.sessionId,
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

  joinRoom(socket, roomCode, displayName, signature = null) {
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

    const playerId = socket.sessionId;
    const player = {
      id: playerId,
      socketId: socket.id,
      displayName,
      signature,
      score: 0,
      isReady: false,
      isConnected: true,
      isHost: playerId === room.hostId,
    };

    room.players.set(playerId, player);
    this.playerRooms.set(socket.id, roomCode);
    this.sessionRooms.set(socket.sessionId, roomCode);

    return {
      roomId: room.id,
      roomCode: room.code,
      type: room.type,  // Include room type so players know if it's host mode
      players: Array.from(room.players.values()),
      settings: room.settings,
      isHost: player.isHost,
    };
  }

  leaveRoom(socket, roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const playerId = socket.sessionId;
    room.players.delete(playerId);
    this.playerRooms.delete(socket.id);
    this.sessionRooms.delete(socket.sessionId);

    // If room is empty, delete it
    if (room.players.size === 0) {
      this.rooms.delete(roomCode);
    }
  }

  setPlayerReady(socket, roomCode, ready) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const playerId = socket.sessionId;
    const player = room.players.get(playerId);
    if (player) {
      player.isReady = ready;
    }
  }

  updateRoomSettings(socket, roomCode, settings) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Only host can update settings
    const playerId = socket.sessionId;
    if (playerId !== room.hostId) {
      return null;
    }

    // Only update while waiting (not during game)
    if (room.status !== 'waiting') {
      return null;
    }

    room.settings = { ...room.settings, ...settings };
    return room.settings;
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
      room.gameState.currentRound = 1;

      // Place Daily Doubles if setting enabled
      if (room.settings.enableDailyDouble) {
        room.gameState.dailyDoubles = this.placeDailyDoubles(questions.length, 1);
      } else {
        room.gameState.dailyDoubles = [];
      }

      // Daily Double state
      room.gameState.isDailyDouble = false;
      room.gameState.dailyDoubleWager = 0;
    }
  }

  placeDailyDoubles(categoryCount, round) {
    const count = round === 1 ? 1 : 2;
    const dailyDoubles = [];
    const weights = [0, 0.1, 0.2, 0.3, 0.4]; // Row weights - favor harder questions

    while (dailyDoubles.length < count) {
      // Weighted random row selection (skip row 0 - easiest)
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let random = Math.random() * totalWeight;
      let pointIndex = 0;

      for (let i = 0; i < weights.length; i++) {
        random -= weights[i];
        if (random <= 0) {
          pointIndex = i;
          break;
        }
      }

      const categoryIndex = Math.floor(Math.random() * categoryCount);

      // Check if this position is already taken
      const exists = dailyDoubles.some(
        dd => dd.categoryIndex === categoryIndex && dd.pointIndex === pointIndex
      );

      if (!exists && pointIndex > 0) {
        dailyDoubles.push({ categoryIndex, pointIndex });
      }
    }

    return dailyDoubles;
  }

  selectQuestion(socket, roomCode, categoryIndex, pointIndex) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    const playerId = socket.sessionId;
    // Allow selection if they are the current picker
    if (room.gameState.currentPickerId !== playerId) {
      return null; // Not their turn
    }

    const question = room.gameState.questions[categoryIndex]?.[pointIndex];
    if (!question || question.revealed) return null;

    question.revealed = true;
    room.gameState.currentQuestion = { ...question, categoryIndex, pointIndex };
    room.gameState.buzzes = {};
    room.gameState.playersWhoBuzzed = new Set();

    // Check if this is a Daily Double
    const isDailyDouble = room.gameState.dailyDoubles?.some(
      dd => dd.categoryIndex === categoryIndex && dd.pointIndex === pointIndex
    );

    if (isDailyDouble) {
      room.gameState.phase = 'dailyDouble';
      room.gameState.isDailyDouble = true;
    } else {
      room.gameState.phase = 'questionActive';
      room.gameState.isDailyDouble = false;
    }

    return {
      categoryIndex,
      pointIndex,
      question: {
        category: question.category,
        points: question.points,
        answer: question.answer,
        question: question.question,
      },
      isDailyDouble,
      pickerId: playerId,
    };
  }

  startBuzzWindow(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room && room.gameState) {
      room.gameState.buzzes = {};
      room.gameState.buzzWindowOpen = true;
      room.gameState.playersWhoBuzzed = new Set();
      room.gameState.buzzWindowStartTime = Date.now();
    }
  }

  clearBuzzTimeout(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room?.buzzTimeout) {
      clearTimeout(room.buzzTimeout);
      room.buzzTimeout = null;
    }
  }

  clearAnswerTimeout(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room?.answerTimeout) {
      clearTimeout(room.answerTimeout);
      room.answerTimeout = null;
    }
  }

  startAnswerWindow(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room && room.gameState) {
      room.gameState.answerWindowStartTime = Date.now();
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

  handleBuzzTimeout(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    // Close buzz window - but DON'T clear currentQuestion yet
    // Keep it visible so all players can see the answer
    room.gameState.buzzedPlayerId = null;
    room.gameState.buzzes = {};
    room.gameState.buzzWindowOpen = false;
    room.gameState.playersWhoBuzzed = new Set();
    room.gameState.continuedPlayers = new Set(); // Reset for this question

    // Keep the same picker (they get to pick again since no one answered)
    return {
      nextPickerId: room.gameState.currentPickerId,
      question: room.gameState.currentQuestion, // Include question so clients can show answer
    };
  }

  // Track when a player clicks Continue after timeout
  playerContinued(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return false;

    room.gameState.continuedPlayers = room.gameState.continuedPlayers || new Set();
    room.gameState.continuedPlayers.add(playerId);

    // Check if all players have continued
    const allPlayers = Array.from(room.players.keys());
    return allPlayers.every(id => room.gameState.continuedPlayers.has(id));
  }

  // Reset continue tracking (called when new question is selected)
  resetContinuedPlayers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room && room.gameState) {
      room.gameState.continuedPlayers = new Set();
    }
  }

  // Get current picker ID
  getCurrentPicker(roomCode) {
    const room = this.rooms.get(roomCode);
    return room?.gameState?.currentPickerId || null;
  }

  // Clear question after all players continued
  clearCurrentQuestion(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room && room.gameState) {
      room.gameState.currentQuestion = null;
    }
  }

  handleDailyDoubleWager(roomCode, playerId, wager) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    // Verify this is the picker and we're in Daily Double phase
    if (room.gameState.currentPickerId !== playerId) return null;
    if (!room.gameState.isDailyDouble) return null;

    room.gameState.dailyDoubleWager = wager;
    room.gameState.phase = 'dailyDoubleQuestion';

    return {
      playerId,
      wager,
      question: room.gameState.currentQuestion,
    };
  }

  handleDailyDoubleAnswer(roomCode, playerId, correct) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    // Verify this is the picker
    if (room.gameState.currentPickerId !== playerId) return null;

    const player = room.players.get(playerId);
    if (!player) return null;

    const wager = room.gameState.dailyDoubleWager || 0;

    if (correct) {
      player.score = (player.score || 0) + wager;
    } else {
      player.score = (player.score || 0) - wager;
    }

    // Reset Daily Double state
    room.gameState.isDailyDouble = false;
    room.gameState.dailyDoubleWager = 0;
    room.gameState.currentQuestion = null;
    room.gameState.phase = 'playing';

    // Picker keeps control regardless of answer
    return {
      playerId,
      correct,
      wager,
      newScore: player.score,
      nextPickerId: playerId,
    };
  }

  startRound2(roomCode, questions, categories, firstPickerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    room.gameState = room.gameState || {};
    room.gameState.questions = questions;
    room.gameState.categories = categories;
    room.gameState.currentPickerId = firstPickerId;
    room.gameState.phase = 'playing';
    room.gameState.buzzes = {};
    room.gameState.buzzedPlayerId = null;
    room.gameState.currentQuestion = null;
    room.gameState.playersWhoBuzzed = new Set();
    room.gameState.currentRound = 2;

    // Place Daily Doubles for round 2 if setting enabled (2 for Double Jeopardy)
    if (room.settings.enableDailyDouble) {
      room.gameState.dailyDoubles = this.placeDailyDoubles(questions.length, 2);
    } else {
      room.gameState.dailyDoubles = [];
    }

    room.gameState.isDailyDouble = false;
    room.gameState.dailyDoubleWager = 0;
  }

  // Final Jeopardy methods
  startFinalJeopardy(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Generate a simple Final Jeopardy question (in production, use AI)
    // For now, use placeholder data - the frontend will generate the actual question
    const fjCategories = [
      { category: 'WORLD HISTORY', clue: 'This ancient wonder was completed around 280 BC on the island of Rhodes.', answer: 'The Colossus of Rhodes' },
      { category: 'SCIENCE', clue: 'This element, with atomic number 79, has been prized by humans for millennia.', answer: 'Gold' },
      { category: 'LITERATURE', clue: 'This 1851 novel begins with the words "Call me Ishmael."', answer: 'Moby Dick' },
      { category: 'GEOGRAPHY', clue: 'This is the only country that borders both the Atlantic and Indian Oceans.', answer: 'South Africa' },
      { category: 'MUSIC', clue: 'This composer wrote his Ninth Symphony while completely deaf.', answer: 'Beethoven' },
    ];

    const randomFJ = fjCategories[Math.floor(Math.random() * fjCategories.length)];

    room.gameState = room.gameState || {};
    room.gameState.phase = 'finalJeopardy';
    room.gameState.finalJeopardy = {
      category: randomFJ.category,
      clue: randomFJ.clue,
      answer: randomFJ.answer,
      wagers: new Map(),
      answers: new Map(),
      eligiblePlayers: new Set(),
    };

    // Only players with score >= 0 can participate
    for (const [playerId, player] of room.players) {
      if ((player.score || 0) >= 0) {
        room.gameState.finalJeopardy.eligiblePlayers.add(playerId);
      }
    }

    return {
      category: randomFJ.category,
      clue: randomFJ.clue,
      answer: randomFJ.answer,
    };
  }

  submitFJWager(roomCode, playerId, wager) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState?.finalJeopardy) return false;

    const fj = room.gameState.finalJeopardy;

    // Only eligible players can wager
    if (!fj.eligiblePlayers.has(playerId)) return false;

    fj.wagers.set(playerId, wager);

    // Check if all eligible players have wagered
    return fj.wagers.size >= fj.eligiblePlayers.size;
  }

  submitFJAnswer(roomCode, playerId, answer) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState?.finalJeopardy) return false;

    const fj = room.gameState.finalJeopardy;

    // Only eligible players can answer
    if (!fj.eligiblePlayers.has(playerId)) return false;

    fj.answers.set(playerId, answer);

    // Check if all eligible players have answered
    return fj.answers.size >= fj.eligiblePlayers.size;
  }

  getFJResults(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState?.finalJeopardy) return [];

    const fj = room.gameState.finalJeopardy;
    const results = [];

    for (const playerId of fj.eligiblePlayers) {
      const player = room.players.get(playerId);
      if (!player) continue;

      const wager = fj.wagers.get(playerId) || 0;
      const answer = fj.answers.get(playerId) || '';

      // Simple answer validation (normalize and compare)
      const normalize = (s) => s.toLowerCase()
        .replace(/^(what|who|where|when|why|how)\s+(is|are|was|were)\s+/i, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();

      const correct = normalize(answer) === normalize(fj.answer);

      // Calculate final score
      const previousScore = player.score || 0;
      const finalScore = correct ? previousScore + wager : previousScore - wager;

      // Update player score
      player.score = finalScore;

      results.push({
        playerId,
        playerName: player.displayName || player.name,
        wager,
        answer,
        correct,
        finalScore,
      });
    }

    // Sort by final score (highest first)
    results.sort((a, b) => b.finalScore - a.finalScore);

    return results;
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

    const playerId = socket.sessionId;
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

    const playerId = socket.sessionId;
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
  joinMatchmakingQueue(socket, displayName, signature = null) {
    // Remove if already in queue
    this.leaveMatchmakingQueue(socket);

    this.matchmakingQueue.push({
      socket,
      displayName,
      signature,
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
    matchedPlayers.forEach(({ socket, displayName, signature }) => {
      const playerId = socket.sessionId;
      room.players.set(playerId, {
        id: playerId,
        socketId: socket.id,
        displayName,
        signature,
        score: 0,
        isReady: false,
        isConnected: true,
        isHost: false,
      });
      this.playerRooms.set(socket.id, roomCode);
      this.sessionRooms.set(socket.sessionId, roomCode);
    });

    this.rooms.set(roomCode, room);

    return {
      roomCode,
      players: matchedPlayers.map(p => ({
        socketId: p.socket.id,
        displayName: p.displayName,
        signature: p.signature,
      })),
    };
  }

  // Disconnection
  handleDisconnect(socket) {
    // Remove from matchmaking queue
    this.leaveMatchmakingQueue(socket);

    // Handle room disconnection - mark as disconnected but keep in room for reconnection
    const roomCode = this.sessionRooms.get(socket.sessionId);
    if (roomCode) {
      const room = this.rooms.get(roomCode);
      if (room) {
        const playerId = socket.sessionId;
        const player = room.players.get(playerId);
        if (player) {
          player.isConnected = false;
          // Keep sessionRooms mapping so player can reconnect
          // Only remove playerRooms (socket.id mapping)
        }
      }
      this.playerRooms.delete(socket.id);
    }
  }

  // Reconnect a player to their room
  reconnectPlayer(socket, roomCode) {
    const sessionId = socket.sessionId;
    const room = this.rooms.get(roomCode);

    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    const player = room.players.get(sessionId);
    if (!player) {
      return { success: false, error: 'Player not found in room' };
    }

    // Restore player connection
    player.isConnected = true;
    player.socketId = socket.id;

    // Update mappings
    this.playerRooms.set(socket.id, roomCode);
    this.sessionRooms.set(sessionId, roomCode);

    return {
      success: true,
      roomCode,
      players: Array.from(room.players.values()),
      settings: room.settings,
      gameState: room.gameState,
      isHost: player.isHost,
      displayName: player.displayName,
    };
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

  // =====================
  // HOST MODE METHODS
  // =====================

  // Set custom questions from host
  setHostQuestions(roomCode, questions, categories, hostId) {
    const room = this.rooms.get(roomCode);
    if (!room || room.hostId !== hostId) return null;

    room.gameState = room.gameState || {};
    room.gameState.questions = questions;
    room.gameState.categories = categories;
    room.gameState.customQuestions = true;

    // Initialize host mode tracking
    room.gameState.typedAnswers = new Map();
    room.gameState.mcSelections = new Map();
    room.gameState.autoGradeResults = new Map();
    room.gameState.answerWindowOpen = false;

    return { success: true };
  }

  // Host-only question selection
  selectQuestionHostMode(socket, roomCode, categoryIndex, pointIndex) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    const playerId = socket.sessionId;

    // Only host can select in host mode
    if (room.type === 'host' && playerId !== room.hostId) {
      return null;
    }

    const question = room.gameState.questions[categoryIndex]?.[pointIndex];
    if (!question || question.revealed) return null;

    question.revealed = true;
    room.gameState.currentQuestion = { ...question, categoryIndex, pointIndex };

    // Clear previous answer tracking
    room.gameState.typedAnswers = new Map();
    room.gameState.mcSelections = new Map();
    room.gameState.autoGradeResults = new Map();
    room.gameState.buzzes = {};
    room.gameState.playersWhoBuzzed = new Set();

    // Check if this is a Daily Double
    const isDailyDouble = room.gameState.dailyDoubles?.some(
      dd => dd.categoryIndex === categoryIndex && dd.pointIndex === pointIndex
    );

    if (isDailyDouble) {
      room.gameState.phase = 'dailyDouble';
      room.gameState.isDailyDouble = true;
    } else {
      room.gameState.phase = 'questionActive';
      room.gameState.isDailyDouble = false;
    }

    return {
      categoryIndex,
      pointIndex,
      question: {
        category: question.category,
        points: question.points,
        answer: question.answer,
        question: question.question,
        options: question.options,
      },
      isDailyDouble,
      pickerId: playerId,
    };
  }

  // Record typed answer from player
  submitTypedAnswer(roomCode, playerId, answer) {
    const room = this.rooms.get(roomCode);
    if (!room?.gameState) return null;

    // Prevent duplicate submissions
    if (room.gameState.typedAnswers.has(playerId)) {
      return { success: false, error: 'Already submitted' };
    }

    room.gameState.typedAnswers.set(playerId, {
      answer,
      submittedAt: Date.now(),
    });

    // Check if all non-host players have answered
    const nonHostPlayers = Array.from(room.players.values())
      .filter(p => !p.isHost && p.isConnected);
    const allAnswered = room.gameState.typedAnswers.size >= nonHostPlayers.length;

    return { success: true, allAnswered };
  }

  // Record MC selection from player
  submitMCSelection(roomCode, playerId, optionIndex) {
    const room = this.rooms.get(roomCode);
    if (!room?.gameState) return null;

    if (room.gameState.mcSelections.has(playerId)) {
      return { success: false, error: 'Already selected' };
    }

    room.gameState.mcSelections.set(playerId, optionIndex);

    // Check if all non-host players have selected
    const nonHostPlayers = Array.from(room.players.values())
      .filter(p => !p.isHost && p.isConnected);
    const allSelected = room.gameState.mcSelections.size >= nonHostPlayers.length;

    return { success: true, allSelected };
  }

  // Auto-score MC answers
  scoreMCAnswers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room?.gameState) return [];

    const question = room.gameState.currentQuestion;
    const correctIndex = 0; // First option is always correct
    const points = question?.points || 0;
    const results = [];

    for (const [playerId, selectedIndex] of room.gameState.mcSelections) {
      const correct = selectedIndex === correctIndex;
      const player = room.players.get(playerId);

      if (player) {
        player.score = (player.score || 0) + (correct ? points : 0);
        results.push({
          playerId,
          playerName: player.displayName || player.name,
          selectedIndex,
          correct,
          points: correct ? points : 0,
          newScore: player.score,
        });
      }
    }

    return results;
  }

  // Auto-grade typed answers using fuzzy matching
  autoGradeAnswers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room?.gameState) return [];

    const question = room.gameState.currentQuestion;
    const correctAnswer = question?.question || '';
    const results = [];

    for (const [playerId, { answer }] of room.gameState.typedAnswers) {
      const gradeResult = this.fuzzyMatchAnswer(answer, correctAnswer);
      room.gameState.autoGradeResults.set(playerId, gradeResult);

      const player = room.players.get(playerId);
      results.push({
        playerId,
        playerName: player?.displayName || player?.name || 'Unknown',
        answer,
        ...gradeResult,
      });
    }

    return results;
  }

  // Fuzzy match answer against correct answer
  fuzzyMatchAnswer(playerAnswer, correctAnswer) {
    const normalize = (s) => s.toLowerCase()
      .replace(/^(what|who|where|when|why|how)\s+(is|are|was|were)\s+/i, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim();

    const normalizedPlayer = normalize(playerAnswer);
    const normalizedCorrect = normalize(correctAnswer);

    // Exact match
    if (normalizedPlayer === normalizedCorrect) {
      return { isCorrect: true, confidence: 1.0, reason: 'Exact match' };
    }

    // Contains match
    if (normalizedPlayer.includes(normalizedCorrect) ||
        normalizedCorrect.includes(normalizedPlayer)) {
      return { isCorrect: true, confidence: 0.8, reason: 'Partial match' };
    }

    // Levenshtein distance for typos
    const distance = this.levenshteinDistance(normalizedPlayer, normalizedCorrect);
    const maxLen = Math.max(normalizedPlayer.length, normalizedCorrect.length);
    const similarity = maxLen > 0 ? 1 - (distance / maxLen) : 0;

    if (similarity >= 0.85) {
      return { isCorrect: true, confidence: similarity, reason: 'Fuzzy match' };
    }

    return { isCorrect: false, confidence: 0, reason: 'No match found' };
  }

  // Levenshtein distance for fuzzy matching
  levenshteinDistance(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  // Host judges an answer
  hostJudgeAnswer(roomCode, hostId, playerId, correct, points) {
    const room = this.rooms.get(roomCode);
    if (!room || room.hostId !== hostId) return null;

    const player = room.players.get(playerId);
    if (!player) return null;

    const pointsToApply = correct ? points : -points;
    player.score = (player.score || 0) + pointsToApply;

    return {
      playerId,
      playerName: player.displayName || player.name,
      correct,
      points: pointsToApply,
      newScore: player.score,
      // Host always picks next in host mode
      nextPickerId: hostId,
    };
  }

  // Host overrides player score
  overridePlayerScore(roomCode, hostId, playerId, newScore, reason) {
    const room = this.rooms.get(roomCode);
    if (!room || room.hostId !== hostId) return null;

    const player = room.players.get(playerId);
    if (!player) return null;

    const oldScore = player.score || 0;
    player.score = newScore;

    // Log override
    room.gameState = room.gameState || {};
    room.gameState.scoreOverrides = room.gameState.scoreOverrides || [];
    room.gameState.scoreOverrides.push({
      playerId,
      oldScore,
      newScore,
      reason,
      timestamp: Date.now(),
    });

    return { playerId, oldScore, newScore, reason };
  }

  // Host skips current question
  skipQuestion(roomCode, hostId) {
    const room = this.rooms.get(roomCode);
    if (!room || room.hostId !== hostId) return null;

    // Clear current question state
    room.gameState.currentQuestion = null;
    room.gameState.typedAnswers = new Map();
    room.gameState.mcSelections = new Map();
    room.gameState.autoGradeResults = new Map();
    room.gameState.phase = 'playing';
    room.gameState.isDailyDouble = false;

    return { success: true };
  }

  // Host kicks a player
  kickPlayer(roomCode, hostId, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room || room.hostId !== hostId) return null;
    if (playerId === hostId) return null; // Can't kick self

    const player = room.players.get(playerId);
    if (!player) return null;

    const socketId = player.socketId;
    room.players.delete(playerId);
    this.sessionRooms.delete(playerId);
    if (socketId) {
      this.playerRooms.delete(socketId);
    }

    return { playerId, socketId };
  }

  // Get all typed answers for host view
  getTypedAnswers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room?.gameState) return [];

    const results = [];
    for (const [playerId, data] of room.gameState.typedAnswers) {
      const player = room.players.get(playerId);
      results.push({
        playerId,
        playerName: player?.displayName || player?.name || 'Unknown',
        answer: data.answer,
        submittedAt: data.submittedAt,
        autoGradeResult: room.gameState.autoGradeResults.get(playerId),
      });
    }

    return results;
  }

  // Open answer window for host mode
  openHostAnswerWindow(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room && room.gameState) {
      room.gameState.answerWindowOpen = true;
      room.gameState.answerWindowStartTime = Date.now();
      room.gameState.typedAnswers = new Map();
      room.gameState.mcSelections = new Map();
    }
  }

  // Close answer window
  closeHostAnswerWindow(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room && room.gameState) {
      room.gameState.answerWindowOpen = false;
    }
  }
}
