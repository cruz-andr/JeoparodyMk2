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
