import { v4 as uuidv4 } from 'uuid';

/* How long the matchmaker holds out for a full table before it settles.

   Three players is the game as designed. A queue that insisted on three at the
   same instant, with no clock, left a lone player on the spinner forever: the
   second person to arrive had usually given up before the third existed. So
   after PAIR_AFTER_MS with two waiting the match starts with two, and after
   GIVE_UP_AFTER_MS alone the player is told so and released. */
export const PAIR_AFTER_MS = 20000;
export const GIVE_UP_AFTER_MS = 45000;

export class GameStateManager {
  constructor({ now = () => Date.now(), pairAfterMs = PAIR_AFTER_MS, giveUpAfterMs = GIVE_UP_AFTER_MS } = {}) {
    this.rooms = new Map(); // roomCode -> GameRoom
    this.playerRooms = new Map(); // socketId -> roomCode (legacy, kept for cleanup)
    this.sessionRooms = new Map(); // sessionId -> roomCode (for reconnection)
    this.matchmakingQueue = []; // Array of { socket, displayName, signature, queuedAt }
    /* Injectable so a test can move the clock instead of waiting on it. */
    this.now = now;
    this.pairAfterMs = pairAfterMs;
    this.giveUpAfterMs = giveUpAfterMs;
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
      lastActiveAt: Date.now(),
    };

    this.rooms.set(roomCode, room);
    return room;
  }

  joinRoom(socket, roomCode, displayName, signature = null) {
    const room = this.rooms.get(roomCode.toUpperCase());

    if (!room) {
      throw new Error('Room not found');
    }

    // Block joins during Final Jeopardy
    if (room.status === 'in_progress' && room.gameState?.phase === 'finalJeopardy') {
      throw new Error('Game is in Final Jeopardy, cannot join');
    }

    if (!room.players.has(socket.sessionId) &&
        room.players.size >= room.settings.maxPlayers) {
      throw new Error('Room is full');
    }

    const playerId = socket.sessionId;
    const existing = room.players.get(playerId);
    const isLateJoin = room.status === 'in_progress' && !existing;
    const player = {
      id: playerId,
      socketId: socket.id,
      displayName,
      signature,
      // Someone rejoining with the same session keeps what they earned —
      // re-joining used to silently reset their score to zero.
      score: existing?.score || 0,
      isReady: existing?.isReady ?? (isLateJoin ? true : false),
      isConnected: true,
      isHost: playerId === room.hostId,
      waitingToJoin: isLateJoin && !!room.gameState?.currentQuestion,
    };

    room.players.set(playerId, player);
    this.playerRooms.set(socket.id, roomCode);
    this.sessionRooms.set(socket.sessionId, roomCode);

    const result = {
      roomId: room.id,
      roomCode: room.code,
      type: room.type,
      players: Array.from(room.players.values()),
      settings: room.settings,
      isHost: player.isHost,
      isLateJoin,
    };

    // Late joiners need the full game state to render the board
    if (isLateJoin) {
      result.gameState = room.gameState;
    }

    return result;
  }

  leaveRoom(socket, roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const playerId = socket.sessionId;
    room.players.delete(playerId);
    this.playerRooms.delete(socket.id);
    this.sessionRooms.delete(socket.sessionId);

    // If the leaver held the pick, hand it to someone who is still here so the
    // board does not sit waiting on a player who has gone.
    this.reassignPickerIfNeeded(room, playerId);

    // If room is empty, delete it
    if (room.players.size === 0) {
      this.destroyRoom(roomCode);
    }
  }

  // If the player who left/was removed was the current picker, pass control on.
  reassignPickerIfNeeded(room, departedId) {
    if (!room.gameState || room.gameState.currentPickerId !== departedId) return null;

    const next = room.type === 'host'
      ? room.hostId
      : this.getActivePlayerIds(room)[0] || null;

    room.gameState.currentPickerId = next;
    return next;
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

  /**
   * Daily Doubles a host chose, checked before they are trusted.
   *
   * They arrive from a client, so they are filtered to cells that exist and
   * de-duplicated: a pair pointing at the same cell would place one Daily
   * Double and silently lose the other. Anything short of what the round wants
   * is topped up at random, so a host who marked one of two still gets two.
   */
  resolveDailyDoubles(chosen, categoryCount, rowCount, round) {
    const wanted = round === 2 ? 2 : 1;
    const seen = new Set();
    const kept = [];

    for (const spot of Array.isArray(chosen) ? chosen : []) {
      const c = Number(spot?.categoryIndex);
      const r = Number(spot?.pointIndex);
      if (!Number.isInteger(c) || !Number.isInteger(r)) continue;
      if (c < 0 || c >= categoryCount || r < 0 || r >= rowCount) continue;
      const key = `${c}:${r}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push({ categoryIndex: c, pointIndex: r });
      if (kept.length === wanted) break;
    }

    if (kept.length === wanted) return kept;

    /* Top up from a random placement, skipping anything already taken. */
    for (const spot of placeDailyDoubles(categoryCount, round, rowCount)) {
      const key = `${spot.categoryIndex}:${spot.pointIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(spot);
      if (kept.length === wanted) break;
    }
    return kept;
  }

  setQuestions(roomCode, questions, categories, firstPickerId, dailyDoubles = null) {
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

      // Placed by the host if they chose to, at random if they did not.
      if (room.settings.enableDailyDouble) {
        room.gameState.dailyDoubles = this.resolveDailyDoubles(
          dailyDoubles, questions.length, questions[0]?.length || 5, 1
        );
      } else {
        room.gameState.dailyDoubles = [];
      }

      // Daily Double state
      room.gameState.isDailyDouble = false;
      room.gameState.dailyDoubleWager = 0;

      // Suggestion state
      room.gameState.suggestions = {};
    }
  }

  placeDailyDoubles(categoryCount, round, rowCount) {
    return placeDailyDoubles(categoryCount, round, rowCount);
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
    this.resetBuzzState(room.gameState);

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
        ...question,
        revealed: undefined,
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
      room.gameState.buzzReceived = false;
      // Preserve playersWhoBuzzed across re-buzz windows so wrong-answer
      // players can't buzz again. Only initialize if not already set.
      room.gameState.playersWhoBuzzed = room.gameState.playersWhoBuzzed || new Set();
      room.gameState.skippedPlayers = new Set();
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

  // Players who can actually act on a question: connected, not the host of a
  // hosted room, and not a late joiner still waiting to be dealt in. Anything
  // that waits on "everyone" must use this, otherwise a disconnected or
  // waiting player stalls the room forever.
  getActivePlayerIds(room) {
    if (!room) return [];
    const ids = [];
    for (const [id, player] of room.players) {
      if (!player.isConnected) continue;
      if (player.waitingToJoin) continue;
      if (room.type === 'host' && id === room.hostId) continue;
      ids.push(id);
    }
    return ids;
  }

  countActivePlayers(roomCode) {
    return this.getActivePlayerIds(this.rooms.get(roomCode)).length;
  }

  recordBuzz(roomCode, playerId, reactionTime) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return false;

    // Reject buzzes that arrive outside an open window, or from a player who
    // already had their shot at this clue. Rejected buzzes must NOT mark the
    // question as answered — doing so used to suppress the buzz timeout and
    // freeze the room with no winner and no timer.
    if (!room.gameState.buzzWindowOpen) return false;
    if (room.gameState.buzzedPlayerId) return false;
    if (room.gameState.playersWhoBuzzed?.has(playerId)) return false;

    // Calculate reaction time server-side (more accurate, cheat-proof)
    const serverReactionTime = room.gameState.buzzWindowStartTime
      ? Date.now() - room.gameState.buzzWindowStartTime
      : reactionTime;

    room.gameState.buzzes[playerId] = serverReactionTime;
    room.gameState.playersWhoBuzzed.add(playerId);

    // Mark that a valid buzz was received (guards against stale timeout callbacks)
    room.gameState.buzzReceived = true;
    return true;
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

  handleAnswer(roomCode, playerId, correct) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    // Verify this player buzzed
    if (room.gameState.buzzedPlayerId !== playerId) {
      return null;
    }

    const player = room.players.get(playerId);
    if (!player) return null;

    // Points come from the board, never from the client — a client-supplied
    // value let any player award themselves an arbitrary score.
    const points = room.gameState.currentQuestion?.points || 0;

    // Capture correct answer before potentially clearing state
    const correctAnswer = room.gameState.currentQuestion?.question;

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
        correctAnswer,
      };
    } else {
      player.score = (player.score || 0) - points;

      // Check if others can still buzz. Only players who can actually act count:
      // counting disconnected players (or the host of a hosted room) here left
      // the clue open forever waiting on a buzz that could never arrive.
      const activeIds = this.getActivePlayerIds(room);
      const buzzed = room.gameState.playersWhoBuzzed || new Set();
      const skipped = room.gameState.skippedPlayers || new Set();
      const canBuzzAgain = activeIds.some(
        id => !buzzed.has(id) && !skipped.has(id)
      );

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
        correctAnswer: canBuzzAgain ? null : correctAnswer,
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

    // Check if all players who can act have continued (a disconnected player
    // will never click Continue, so waiting on them hangs the board)
    const activeIds = this.getActivePlayerIds(room);
    if (activeIds.length === 0) return true;
    return activeIds.every(id => room.gameState.continuedPlayers.has(id));
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

    const clamped = this.clampDailyDoubleWager(room, playerId, wager);
    room.gameState.dailyDoubleWager = clamped;
    room.gameState.phase = 'dailyDoubleQuestion';

    return {
      playerId,
      wager: clamped,
      question: room.gameState.currentQuestion,
    };
  }

  /**
   * A Daily Double in a host-run room.
   *
   * Every other path ties a Daily Double to whoever picked the clue and scores
   * them. In a hosted room the host picks every clue and has no score, so there
   * is nobody for that rule to land on: the host names the player it belongs
   * to, and that player is the one who is scored.
   */
  hostDailyDoubleWager(roomCode, hostId, playerId, wager) {
    const room = this.rooms.get(roomCode);
    if (room?.hostId !== hostId) return null;
    if (!room.gameState?.isDailyDouble) return null;

    const player = room.players.get(playerId);
    if (!player || playerId === hostId) return null;

    const clamped = this.clampDailyDoubleWager(room, playerId, wager);
    room.gameState.dailyDoubleOwnerId = playerId;
    room.gameState.dailyDoubleWager = clamped;
    room.gameState.phase = 'dailyDoubleQuestion';

    return {
      playerId,
      playerName: player.displayName || player.name,
      wager: clamped,
      question: room.gameState.currentQuestion,
    };
  }

  /** The verdict on a Daily Double, which pays the wager rather than the clue. */
  hostDailyDoubleAnswer(roomCode, hostId, correct) {
    const room = this.rooms.get(roomCode);
    if (room?.hostId !== hostId) return null;
    if (!room.gameState?.isDailyDouble) return null;

    const playerId = room.gameState.dailyDoubleOwnerId;
    const player = playerId && room.players.get(playerId);
    if (!player) return null;

    const wager = room.gameState.dailyDoubleWager || 0;
    player.score = (player.score || 0) + (correct ? wager : -wager);

    room.gameState.isDailyDouble = false;
    room.gameState.dailyDoubleWager = 0;
    room.gameState.dailyDoubleOwnerId = null;
    room.gameState.currentQuestion = null;
    room.gameState.phase = 'playing';
    this.resetBuzzState(room.gameState);

    return {
      playerId,
      playerName: player.displayName || player.name,
      correct,
      wager,
      newScore: player.score,
      // The host picks next in a hosted room, as they do after every clue.
      nextPickerId: hostId,
    };
  }

  // Jeopardy rule: a Daily Double wager is at least $5 and at most the greater
  // of the player's score and the highest clue value on the current board.
  clampDailyDoubleWager(room, playerId, wager) {
    const player = room.players.get(playerId);
    const score = player?.score || 0;
    const maxBoardValue = (room.gameState?.currentRound || 1) === 1 ? 1000 : 2000;
    const max = Math.max(score, maxBoardValue, 5);
    const requested = Number.isFinite(Number(wager)) ? Math.floor(Number(wager)) : 5;
    return Math.min(Math.max(requested, 5), max);
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

  startRound2(roomCode, questions, categories, firstPickerId, dailyDoubles = null) {
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

    // Two in Double Jeopardy, placed by the host if they chose to.
    if (room.settings.enableDailyDouble) {
      room.gameState.dailyDoubles = this.resolveDailyDoubles(
        dailyDoubles, questions.length, questions[0]?.length || 5, 2
      );
    } else {
      room.gameState.dailyDoubles = [];
    }

    room.gameState.isDailyDouble = false;
    room.gameState.dailyDoubleWager = 0;
  }

  /**
   * Final Jeopardy.
   *
   * A host writes their own now and hands it over when the game starts, so the
   * last round is about the game that was just played. The list below is only
   * reached when nobody wrote one: a room made before hosts could, or a mode
   * that has no author. It used to be the only path, which meant a game about
   * the Cold War ended with a question about Moby Dick.
   */
  startFinalJeopardy(roomCode, written = null) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const fjCategories = [
      { category: 'WORLD HISTORY', clue: 'This ancient wonder was completed around 280 BC on the island of Rhodes.', answer: 'The Colossus of Rhodes' },
      { category: 'SCIENCE', clue: 'This element, with atomic number 79, has been prized by humans for millennia.', answer: 'Gold' },
      { category: 'LITERATURE', clue: 'This 1851 novel begins with the words "Call me Ishmael."', answer: 'Moby Dick' },
      { category: 'GEOGRAPHY', clue: 'This is the only country that borders both the Atlantic and Indian Oceans.', answer: 'South Africa' },
      { category: 'MUSIC', clue: 'This composer wrote his Ninth Symphony while completely deaf.', answer: 'Beethoven' },
    ];

    /* Written by the host, in the board format: `answer` is the clue shown and
       `question` is the correct response, which is the show's convention and
       the one the whole codebase uses. */
    const usable = written
      && String(written.category ?? '').trim()
      && String(written.answer ?? '').trim()
      && String(written.question ?? '').trim();

    const randomFJ = usable
      ? {
          category: String(written.category).trim(),
          clue: String(written.answer).trim(),
          answer: String(written.question).trim(),
        }
      : fjCategories[Math.floor(Math.random() * fjCategories.length)];

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

    // Jeopardy rule: you need a positive score to play Final Jeopardy.
    // Only players who can actually answer are counted, so a disconnected
    // player never blocks the reveal.
    for (const playerId of this.getActivePlayerIds(room)) {
      const player = room.players.get(playerId);
      if ((player.score || 0) > 0) {
        room.gameState.finalJeopardy.eligiblePlayers.add(playerId);
      }
    }

    return {
      category: randomFJ.category,
      clue: randomFJ.clue,
      answer: randomFJ.answer,
      // Zero means nobody can play, and the round must be skipped rather than
      // left waiting on wagers that can never arrive.
      eligibleCount: room.gameState.finalJeopardy.eligiblePlayers.size,
    };
  }

  // Eligible players who are still here. A player who drops out after the
  // eligibility snapshot must not hold the round open for everyone else.
  getFJParticipants(room) {
    const fj = room.gameState?.finalJeopardy;
    if (!fj) return [];
    return Array.from(fj.eligiblePlayers).filter(
      id => room.players.get(id)?.isConnected
    );
  }

  submitFJWager(roomCode, playerId, wager) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState?.finalJeopardy) return false;

    const fj = room.gameState.finalJeopardy;

    // Only eligible players can wager
    if (!fj.eligiblePlayers.has(playerId)) return false;

    // Jeopardy rule: you can wager anything from $0 up to your own score.
    const score = room.players.get(playerId)?.score || 0;
    const requested = Number.isFinite(Number(wager)) ? Math.floor(Number(wager)) : 0;
    fj.wagers.set(playerId, Math.min(Math.max(requested, 0), Math.max(score, 0)));

    // Check if everyone still playing has wagered
    const participants = this.getFJParticipants(room);
    return participants.length > 0 && participants.every(id => fj.wagers.has(id));
  }

  submitFJAnswer(roomCode, playerId, answer) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState?.finalJeopardy) return false;

    const fj = room.gameState.finalJeopardy;

    // Only eligible players can answer
    if (!fj.eligiblePlayers.has(playerId)) return false;

    fj.answers.set(playerId, answer);

    // Check if everyone still playing has answered
    const participants = this.getFJParticipants(room);
    return participants.length > 0 && participants.every(id => fj.answers.has(id));
  }

  getFJResults(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState?.finalJeopardy) return [];

    const fj = room.gameState.finalJeopardy;

    // Scoring mutates player totals, so only ever run it once per game.
    if (fj.results) return fj.results;

    const results = [];

    for (const playerId of fj.eligiblePlayers) {
      const player = room.players.get(playerId);
      if (!player) continue;

      const wager = fj.wagers.get(playerId) || 0;
      const answer = fj.answers.get(playerId) || '';

      // Graded the same way as every other answer, so a typo or the question
      // form ("What is ...?") does not cost someone the game.
      const correct = this.fuzzyMatchAnswer(answer, fj.answer).isCorrect;

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

    fj.results = results;
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
    return this.fuzzyMatchAnswer(playerAnswer, correctAnswer).isCorrect;
  }

  // Matchmaking
  joinMatchmakingQueue(socket, displayName, signature = null) {
    // Remove if already in queue
    this.leaveMatchmakingQueue(socket);

    this.matchmakingQueue.push({
      socket,
      displayName,
      signature,
      queuedAt: this.now(),
    });
  }

  leaveMatchmakingQueue(socket) {
    this.matchmakingQueue = this.matchmakingQueue.filter(
      p => p.socket.id !== socket.id
    );
  }

  /** The thresholds a waiting client shows, so its copy and the server agree. */
  matchmakingTimings() {
    return { pairAfterMs: this.pairAfterMs, giveUpAfterMs: this.giveUpAfterMs };
  }

  /* Three if three are here. Two once the longest wait has passed the pairing
     threshold. Nobody once the one person left has waited alone past the
     give-up threshold: they leave the queue, so the next tick does not name
     them again. Returns what happened rather than telling anyone; the socket
     layer does the talking, the way it does for every other event here. */
  tryCreateMatch() {
    const queue = this.matchmakingQueue;
    const result = { match: null, noMatchFor: null };
    if (queue.length === 0) return result;

    if (queue.length >= 3) {
      result.match = this.buildMatch(queue.splice(0, 3));
      return result;
    }

    const waited = this.now() - queue[0].queuedAt;

    if (queue.length === 2) {
      if (waited >= this.pairAfterMs) result.match = this.buildMatch(queue.splice(0, 2));
      return result;
    }

    if (waited >= this.giveUpAfterMs) {
      result.noMatchFor = queue.shift().socket;
    }
    return result;
  }

  buildMatch(matchedPlayers) {
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
        // The session id is how the server keys players everywhere else, so it
        // has to travel with the match. Clients that keyed off socketId never
        // matched a score update or a turn.
        id: p.socket.sessionId,
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
      type: room.type,  // Include room type for host mode detection
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
    const emptyRoomGrace = 30 * 60 * 1000; // 30 minutes with nobody connected

    for (const [code, room] of this.rooms) {
      const anyoneConnected = Array.from(room.players.values()).some(p => p.isConnected);

      if (anyoneConnected) {
        room.lastActiveAt = now;
        continue;
      }

      // An abandoned in-progress game used to live forever, holding its
      // players, questions and pending timers in memory.
      const idleSince = room.lastActiveAt || room.createdAt;
      const expired = now - room.createdAt > maxAge || now - idleSince > emptyRoomGrace;
      if (expired) this.destroyRoom(code);
    }
  }

  destroyRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    if (room.buzzTimeout) clearTimeout(room.buzzTimeout);
    if (room.answerTimeout) clearTimeout(room.answerTimeout);
    if (room.autoOpenTimer) clearTimeout(room.autoOpenTimer);

    for (const [playerId, player] of room.players) {
      if (this.sessionRooms.get(playerId) === roomCode) {
        this.sessionRooms.delete(playerId);
      }
      if (player.socketId) this.playerRooms.delete(player.socketId);
    }

    this.rooms.delete(roomCode);
  }

  // =====================
  // HOST MODE METHODS
  // =====================

  // Set custom questions from host
  setHostQuestions(roomCode, questions, categories, hostId, dailyDoubles = null) {
    const room = this.rooms.get(roomCode);
    if (!room || room.hostId !== hostId) return null;

    room.gameState = room.gameState || {};
    room.gameState.questions = questions;
    room.gameState.categories = categories;
    room.gameState.customQuestions = true;

    /* A host who marked their own Daily Doubles. setQuestions places them for
       every other path; this one hands the board over separately, so it has to
       place them too or a hosted game would quietly get random ones. */
    if (room.settings.enableDailyDouble) {
      room.gameState.dailyDoubles = this.resolveDailyDoubles(
        dailyDoubles, questions.length, questions[0]?.length || 5, 1
      );
    } else {
      /* Emptied rather than left alone, the way the other two paths do it. A
         host who turned Daily Doubles off after a board was already handed
         over would otherwise keep the placements from the first one. */
      room.gameState.dailyDoubles = [];
    }

    // Initialize host mode tracking
    room.gameState.typedAnswers = new Map();
    room.gameState.mcSelections = new Map();
    room.gameState.autoGradeResults = new Map();
    room.gameState.answerWindowOpen = false;

    return { success: true };
  }

  // Everything that must not survive from one clue to the next. recordBuzz
  // refuses a buzz while buzzedPlayerId is set, so leaving it behind used to
  // kill the buzzer for the rest of the game.
  resetBuzzState(gameState) {
    gameState.buzzedPlayerId = null;
    gameState.buzzes = {};
    gameState.buzzWindowOpen = false;
    gameState.buzzReceived = false;
    gameState.playersWhoBuzzed = new Set();
    gameState.skippedPlayers = new Set();
  }

  // Host-mode answer tracking is created when a clue is dealt, but clients can
  // emit an answer at any moment. Touching these maps before they exist threw a
  // TypeError inside the socket handler, which took the whole server down.
  ensureAnswerState(room) {
    const gs = room.gameState;
    if (!gs) return null;

    gs.typedAnswers = gs.typedAnswers || new Map();
    gs.mcSelections = gs.mcSelections || new Map();
    gs.autoGradeResults = gs.autoGradeResults || new Map();
    gs.judgedPlayers = gs.judgedPlayers || new Set();
    return gs;
  }

  // Multiple-choice options are authored with the correct answer first, so they
  // must be shuffled before players ever see them — otherwise the answer is
  // always "A". The shuffled index is kept server-side for scoring.
  prepareMultipleChoice(room, question) {
    if (!Array.isArray(question?.options) || question.options.length === 0) {
      room.gameState.mcCorrectIndex = null;
      return question;
    }

    const options = question.options.slice(0, 4);
    const correct = options[0];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    room.gameState.mcCorrectIndex = options.indexOf(correct);
    return { ...question, options };
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
    const served = this.prepareMultipleChoice(room, question);
    room.gameState.currentQuestion = { ...served, categoryIndex, pointIndex };

    // Clear previous answer tracking
    room.gameState.typedAnswers = new Map();
    room.gameState.mcSelections = new Map();
    room.gameState.autoGradeResults = new Map();
    room.gameState.judgedPlayers = new Set();
    this.resetBuzzState(room.gameState);

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
        ...served,
        revealed: undefined,
      },
      isDailyDouble,
      pickerId: playerId,
    };
  }

  // Record typed answer from player
  submitTypedAnswer(roomCode, playerId, answer) {
    const room = this.rooms.get(roomCode);
    if (!this.ensureAnswerState(room)) return null;

    // Prevent duplicate submissions
    if (room.gameState.typedAnswers.has(playerId)) {
      return { success: false, error: 'Already submitted' };
    }

    room.gameState.typedAnswers.set(playerId, {
      answer,
      submittedAt: Date.now(),
    });

    // Wait only on players who can actually answer this clue — a disconnected
    // player or a late joiner still queued would otherwise never submit.
    const expected = this.countActivePlayers(roomCode);
    const allAnswered = room.gameState.typedAnswers.size >= expected;

    return { success: true, allAnswered };
  }

  // Record MC selection from player
  submitMCSelection(roomCode, playerId, optionIndex) {
    const room = this.rooms.get(roomCode);
    if (!this.ensureAnswerState(room)) return null;

    if (room.gameState.mcSelections.has(playerId)) {
      return { success: false, error: 'Already selected' };
    }

    room.gameState.mcSelections.set(playerId, optionIndex);

    // Same eligibility rule as typed answers: only players who can act count.
    const expected = this.countActivePlayers(roomCode);
    const allSelected = room.gameState.mcSelections.size >= expected;

    return { success: true, allSelected };
  }

  // Auto-score MC answers
  scoreMCAnswers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room?.gameState) return [];

    const question = room.gameState.currentQuestion;
    const correctIndex = room.gameState.mcCorrectIndex ?? 0;
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

    // The clue is done; clear it so a reconnect lands back on the board.
    room.gameState.currentQuestion = null;
    room.gameState.phase = 'playing';

    return { results, correctIndex, nextPickerId: room.hostId };
  }

  // Auto-grade typed answers using fuzzy matching
  autoGradeAnswers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!this.ensureAnswerState(room)) return [];

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
    const player = normalizeAnswer(playerAnswer);
    const correct = normalizeAnswer(correctAnswer);

    if (!player || !correct) {
      return { isCorrect: false, confidence: 0, reason: 'No answer given' };
    }

    // Exact match
    if (player === correct) {
      return { isCorrect: true, confidence: 1.0, reason: 'Exact match' };
    }

    // Saying more than the answer is fine — "the novel Moby Dick" for
    // "Moby Dick" is how people actually answer.
    if (correct.length >= MIN_CONTAINMENT_LENGTH && player.includes(correct)) {
      return { isCorrect: true, confidence: 0.9, reason: 'Answer included' };
    }

    // Saying less is only accepted when it covers most of the answer. An
    // unguarded substring test marked a single stray letter correct, because
    // "e" is contained in "Beethoven".
    if (player.length >= MIN_CONTAINMENT_LENGTH && correct.includes(player)) {
      const coverage = player.length / correct.length;
      if (coverage >= MIN_COVERAGE) {
        return { isCorrect: true, confidence: 0.8, reason: 'Partial match' };
      }
    }

    // Levenshtein distance for typos
    const distance = this.levenshteinDistance(player, correct);
    const maxLen = Math.max(player.length, correct.length);
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
  hostJudgeAnswer(roomCode, hostId, playerId, correct) {
    const room = this.rooms.get(roomCode);
    if (room?.hostId !== hostId) return null;
    if (!this.ensureAnswerState(room)) return null;

    const player = room.players.get(playerId);
    if (!player) return null;

    // One payout per player per clue — a double-clicked judge button used to
    // award the points twice.
    const judged = room.gameState.judgedPlayers;
    if (judged.has(playerId)) return null;
    judged.add(playerId);

    // Value comes from the board, not the client (see handleAnswer).
    const points = room.gameState.currentQuestion?.points || 0;
    const pointsToApply = correct ? points : -points;
    player.score = (player.score || 0) + pointsToApply;

    /* In typed and multiple-choice modes the host works through every
       submission, and clearing the clue after the first judgement dropped its
       point value to zero for everyone judged afterwards. */
    const answerMode = room.settings?.answerMode || 'verbal';
    const windowed = answerMode !== 'verbal';

    /* Verbal, and they were wrong: the clue is not over. Whoever has not had a
       shot at it yet gets one, the way the show works. Only players who can
       actually act count, so a disconnected player cannot leave the clue open
       forever waiting on a buzz that will never arrive. */
    let canBuzzAgain = false;
    if (!windowed && !correct) {
      const activeIds = this.getActivePlayerIds(room);
      const buzzed = room.gameState.playersWhoBuzzed || new Set();
      const skipped = room.gameState.skippedPlayers || new Set();
      canBuzzAgain = activeIds.some((id) => !buzzed.has(id) && !skipped.has(id));
    }

    const submitted = windowed
      ? new Set([
          ...room.gameState.typedAnswers.keys(),
          ...room.gameState.mcSelections.keys(),
        ])
      : null;
    const questionClosed = canBuzzAgain
      ? false
      : (submitted === null || Array.from(submitted).every(id => judged.has(id)));

    if (questionClosed) {
      room.gameState.currentQuestion = null;
      room.gameState.phase = 'playing';
      this.resetBuzzState(room.gameState);
    } else if (canBuzzAgain) {
      /* The window reopens for the others. playersWhoBuzzed deliberately
         survives, so the person who just got it wrong cannot buzz again, and
         a fresh judgement is allowed for whoever comes next. */
      room.gameState.buzzedPlayerId = null;
      room.gameState.buzzes = {};
      room.gameState.buzzWindowOpen = true;
      room.gameState.buzzReceived = false;
      room.gameState.buzzWindowStartTime = Date.now();
    }

    return {
      playerId,
      playerName: player.displayName || player.name,
      correct,
      points: pointsToApply,
      newScore: player.score,
      questionClosed,
      canBuzzAgain,
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
    if (room?.hostId !== hostId) return null;
    if (!this.ensureAnswerState(room)) return null;

    // Clear current question state
    room.gameState.currentQuestion = null;
    room.gameState.typedAnswers = new Map();
    room.gameState.mcSelections = new Map();
    room.gameState.autoGradeResults = new Map();
    room.gameState.judgedPlayers = new Set();
    room.gameState.phase = 'playing';
    room.gameState.isDailyDouble = false;
    this.resetBuzzState(room.gameState);

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

    const nextPickerId = this.reassignPickerIfNeeded(room, playerId);

    return { playerId, socketId, nextPickerId };
  }

  // Get all typed answers for host view
  getTypedAnswers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!this.ensureAnswerState(room)) return [];

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
    if (!this.ensureAnswerState(room)) return;

    room.gameState.answerWindowOpen = true;
    room.gameState.answerWindowStartTime = Date.now();
    room.gameState.typedAnswers = new Map();
    room.gameState.mcSelections = new Map();
  }

  // Close answer window
  closeHostAnswerWindow(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room && room.gameState) {
      room.gameState.answerWindowOpen = false;
    }
  }

  // Handle question suggestion from non-picker
  handleSuggestion(roomCode, playerId, categoryIndex, pointIndex) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    // Don't allow current picker to suggest
    if (room.gameState.currentPickerId === playerId) return null;

    // Don't allow suggesting revealed questions
    const question = room.gameState.questions[categoryIndex]?.[pointIndex];
    if (!question || question.revealed) return null;

    // Toggle off if same suggestion
    const existing = room.gameState.suggestions[playerId];
    if (existing && existing.categoryIndex === categoryIndex && existing.pointIndex === pointIndex) {
      delete room.gameState.suggestions[playerId];
    } else {
      // Set or replace suggestion (one per player)
      room.gameState.suggestions[playerId] = { categoryIndex, pointIndex };
    }

    return { ...room.gameState.suggestions };
  }

  clearSuggestions(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room && room.gameState) {
      room.gameState.suggestions = {};
    }
  }

  playerSkipped(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    // Can't skip if already buzzed (they had their chance)
    if (room.gameState.playersWhoBuzzed?.has(playerId)) return null;
    // Can't skip if already skipped
    if (room.gameState.skippedPlayers?.has(playerId)) return null;

    room.gameState.skippedPlayers = room.gameState.skippedPlayers || new Set();
    room.gameState.skippedPlayers.add(playerId);

    // Players who already buzzed are excluded from skip eligibility
    const buzzed = room.gameState.playersWhoBuzzed || new Set();
    const eligibleIds = this.getActivePlayerIds(room).filter(id => !buzzed.has(id));
    const skippedSet = room.gameState.skippedPlayers;
    const skipped = eligibleIds.filter(id => skippedSet.has(id)).length;
    const allSkipped = eligibleIds.length > 0 && skipped >= eligibleIds.length;

    return {
      allSkipped,
      skippedCount: skipped,
      totalEligible: eligibleIds.length,
    };
  }

  // Clear waitingToJoin flag for late joiners when a question resolves
  activateWaitingPlayers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    const activated = [];
    for (const [id, player] of room.players) {
      if (player.waitingToJoin) {
        player.waitingToJoin = false;
        activated.push(id);
      }
    }
    return activated;
  }
}

// Shortest answer that may be matched by containment rather than in full.
const MIN_CONTAINMENT_LENGTH = 4;
// How much of the real answer a shorter response must cover to count.
const MIN_COVERAGE = 0.6;

// Strips everything that should not decide whether an answer is right: the
// "What is ...?" wrapper, punctuation, casing, a leading article, and any
// irregular spacing.
export function normalizeAnswer(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^\s*(what|who|where|when|why|how)\s+(is|are|was|were)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Weighted Daily Double placement. Rows are weighted toward the harder (higher
// value) clues, and — as on the show — Double Jeopardy's two Daily Doubles
// never land in the same category.
//
// rowCount is taken from the board rather than assumed to be five: an imported
// or hand-built board with fewer rows used to have its Daily Double placed on a
// row that does not exist, so it never triggered.
export function placeDailyDoubles(categoryCount, round, rowCount = 5) {
  const count = round === 1 ? 1 : 2;
  if (categoryCount < 1 || rowCount < 1) return [];

  // Weight by row index, so the cheapest row is skipped and the dearest row is
  // likeliest. On a standard five-row board that is 10/20/30/40%.
  const weights = Array.from({ length: rowCount }, (_, i) => i);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const pickRow = () => {
    if (totalWeight === 0) return 0; // single-row board
    let random = Math.random() * totalWeight;
    for (let i = 0; i < rowCount; i++) {
      random -= weights[i];
      if (random <= 0 && weights[i] > 0) return i;
    }
    return rowCount - 1;
  };

  const available = Array.from({ length: categoryCount }, (_, i) => i);
  const dailyDoubles = [];

  while (dailyDoubles.length < count && available.length > 0) {
    const pick = Math.floor(Math.random() * available.length);
    const [categoryIndex] = available.splice(pick, 1);
    dailyDoubles.push({ categoryIndex, pointIndex: pickRow() });
  }

  return dailyDoubles;
}
