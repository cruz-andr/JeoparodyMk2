import { create } from 'zustand';

const initialState = {
  // Room Info
  roomCode: null,
  roomId: null,
  hostId: null,
  isHost: false,
  roomType: null, // 'quickplay' | 'multiplayer' | 'host'

  // Players
  players: [], // [{ id, name, avatar, score, isReady, isConnected, isHost }]
  maxPlayers: 6,

  // Connection State
  connectionStatus: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'error'
  connectionError: null,

  // Turn Management
  currentTurnPlayerId: null,
  buzzerActive: false,
  buzzedPlayerId: null,
  buzzerQueue: [], // Array of player IDs in buzz order

  // Matchmaking (for quickplay)
  isSearching: false,
  queuePosition: null,
  estimatedWaitTime: null,

  // Room Settings
  settings: {
    maxPlayers: 6,
    questionTimeLimit: 30000,
    enableDoubleJeopardy: true,
    enableDailyDouble: true,
    enableFinalJeopardy: true,
    // Host mode specific
    answerMode: null, // 'verbal' | 'typed' | 'multiple_choice' | 'auto_grade'
  },

  // Host Mode State
  hostModeState: {
    currentPhase: 'idle', // 'idle' | 'questionDisplayed' | 'buzzOpen' | 'playerAnswering' | 'hostJudging' | 'answerRevealed'
    typedAnswers: {}, // playerId -> { answer, submittedAt }
    mcSelections: {}, // playerId -> optionIndex
    autoGradeResults: {}, // playerId -> { isCorrect, confidence }
    answersRevealed: false,
  },
};

export const useRoomStore = create((set, get) => ({
  ...initialState,

  // Connection Actions
  setConnectionStatus: (status, error = null) => set({
    connectionStatus: status,
    connectionError: error
  }),

  // Simple setters
  setRoomCode: (roomCode) => set({ roomCode }),
  setIsHost: (isHost) => set({ isHost }),
  setRoomType: (roomType) => set({ roomType }),

  // Room Actions
  createRoom: (type, settings = {}) => {
    const roomCode = generateRoomCode();
    const roomId = 'room-' + Date.now();

    set({
      roomCode,
      roomId,
      roomType: type,
      isHost: true,
      settings: { ...get().settings, ...settings },
      connectionStatus: 'connected',
    });

    return { roomCode, roomId };
  },

  setRoom: (roomData) => {
    set({
      roomCode: roomData.code,
      roomId: roomData.id,
      roomType: roomData.type,
      hostId: roomData.hostId,
      isHost: roomData.isHost || false,
      players: roomData.players || [],
      settings: roomData.settings || get().settings,
    });
  },

  joinRoom: (roomCode, playerData) => {
    // This will be called after socket confirms join
    set({
      roomCode,
      connectionStatus: 'connected',
    });
  },

  leaveRoom: () => {
    set({
      ...initialState,
      connectionStatus: 'disconnected',
    });
  },

  // Player Actions
  addPlayer: (player) => {
    set(state => ({
      players: [...state.players, player]
    }));
  },

  removePlayer: (playerId) => {
    set(state => ({
      players: state.players.filter(p => p.id !== playerId)
    }));
  },

  updatePlayer: (playerId, updates) => {
    set(state => ({
      players: state.players.map(p =>
        p.id === playerId ? { ...p, ...updates } : p
      )
    }));
  },

  setPlayerReady: (playerId, isReady) => {
    set(state => ({
      players: state.players.map(p =>
        p.id === playerId ? { ...p, isReady } : p
      )
    }));
  },

  updatePlayerReady: (playerId, isReady) => {
    set(state => ({
      players: state.players.map(p =>
        p.id === playerId ? { ...p, isReady } : p
      )
    }));
  },

  setPlayers: (players) => set({ players }),

  // Turn Management
  setCurrentTurn: (playerId) => set({ currentTurnPlayerId: playerId }),

  // Buzzer Actions
  openBuzzer: () => set({ buzzerActive: true, buzzerQueue: [] }),

  closeBuzzer: () => set({ buzzerActive: false }),

  playerBuzzed: (playerId) => {
    const { buzzerQueue, buzzerActive } = get();
    if (!buzzerActive) return false;

    // Only first buzzer wins
    if (buzzerQueue.length === 0) {
      set({
        buzzedPlayerId: playerId,
        buzzerQueue: [playerId],
        buzzerActive: false,
      });
      return true;
    }
    return false;
  },

  clearBuzzer: () => set({
    buzzedPlayerId: null,
    buzzerQueue: [],
    buzzerActive: false,
  }),

  // Matchmaking Actions
  startMatchmaking: () => {
    set({
      isSearching: true,
      connectionStatus: 'connecting',
    });
  },

  updateQueueStatus: (position, estimatedWait) => {
    set({
      queuePosition: position,
      estimatedWaitTime: estimatedWait,
    });
  },

  cancelMatchmaking: () => {
    set({
      isSearching: false,
      queuePosition: null,
      estimatedWaitTime: null,
      connectionStatus: 'disconnected',
    });
  },

  matchFound: (roomData) => {
    set({
      isSearching: false,
      queuePosition: null,
      estimatedWaitTime: null,
      ...roomData,
      connectionStatus: 'connected',
    });
  },

  // Settings Actions
  updateSettings: (newSettings) => {
    set(state => ({
      settings: { ...state.settings, ...newSettings }
    }));
  },

  // Score Actions (for multiplayer)
  updatePlayerScore: (playerId, score) => {
    set(state => ({
      players: state.players.map(p =>
        p.id === playerId ? { ...p, score } : p
      )
    }));
  },

  addPlayerScore: (playerId, points) => {
    set(state => ({
      players: state.players.map(p =>
        p.id === playerId ? { ...p, score: (p.score || 0) + points } : p
      )
    }));
  },

  // Host Mode Actions
  setHostModePhase: (phase) => set(state => ({
    hostModeState: { ...state.hostModeState, currentPhase: phase }
  })),

  addTypedAnswer: (playerId, answer) => set(state => ({
    hostModeState: {
      ...state.hostModeState,
      typedAnswers: {
        ...state.hostModeState.typedAnswers,
        [playerId]: { answer, submittedAt: Date.now() }
      }
    }
  })),

  addMCSelection: (playerId, optionIndex) => set(state => ({
    hostModeState: {
      ...state.hostModeState,
      mcSelections: {
        ...state.hostModeState.mcSelections,
        [playerId]: optionIndex
      }
    }
  })),

  setAutoGradeResult: (playerId, result) => set(state => ({
    hostModeState: {
      ...state.hostModeState,
      autoGradeResults: {
        ...state.hostModeState.autoGradeResults,
        [playerId]: result
      }
    }
  })),

  setAnswersRevealed: (revealed) => set(state => ({
    hostModeState: { ...state.hostModeState, answersRevealed: revealed }
  })),

  clearHostModeAnswers: () => set(state => ({
    hostModeState: {
      ...state.hostModeState,
      typedAnswers: {},
      mcSelections: {},
      autoGradeResults: {},
      answersRevealed: false,
      currentPhase: 'idle',
    }
  })),

  // Get all typed answers for host view
  getTypedAnswers: () => {
    const { hostModeState, players } = get();
    return Object.entries(hostModeState.typedAnswers).map(([playerId, data]) => {
      const player = players.find(p => p.id === playerId);
      return {
        playerId,
        playerName: player?.displayName || player?.name || 'Unknown',
        answer: data.answer,
        submittedAt: data.submittedAt,
        autoGradeResult: hostModeState.autoGradeResults[playerId],
      };
    });
  },

  // Check if all players have answered
  allPlayersAnswered: () => {
    const { hostModeState, players } = get();
    const nonHostPlayers = players.filter(p => !p.isHost && p.isConnected);
    const answeredCount = Object.keys(hostModeState.typedAnswers).length;
    return answeredCount >= nonHostPlayers.length;
  },

  // Reset
  resetRoom: () => set(initialState),

  // Getters
  getPlayer: (playerId) => get().players.find(p => p.id === playerId),

  getHost: () => get().players.find(p => p.isHost),

  getAllReady: () => {
    const { players } = get();
    return players.length >= 2 && players.every(p => p.isReady || p.isHost);
  },

  getPlayerCount: () => get().players.length,
}));

// Helper function to generate room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default useRoomStore;
