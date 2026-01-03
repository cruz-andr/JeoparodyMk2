import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

class SocketClient {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.connectionPromise = null;
  }

  // Connect to the socket server
  connect(authToken = null, sessionId = null) {
    if (this.socket?.connected) {
      return Promise.resolve(this.socket);
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      this.socket = io(SOCKET_URL, {
        auth: {
          token: authToken,
          sessionId: sessionId,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      this.socket.on('connect', () => {
        console.log('Socket connected:', this.socket.id);
        this.connectionPromise = null;
        resolve(this.socket);
      });

      this.socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error.message);
        this.connectionPromise = null;
        reject(error);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log('Socket reconnected after', attemptNumber, 'attempts');
      });

      this.socket.on('reconnect_error', (error) => {
        console.error('Socket reconnection error:', error.message);
      });
    });

    return this.connectionPromise;
  }

  // Disconnect from the socket server
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connectionPromise = null;
    }
  }

  // Check if connected
  isConnected() {
    return this.socket?.connected || false;
  }

  // Emit an event with optional callback
  emit(event, data, callback) {
    if (!this.socket?.connected) {
      console.warn('Socket not connected. Cannot emit:', event);
      return;
    }

    if (callback) {
      this.socket.emit(event, data, callback);
    } else {
      this.socket.emit(event, data);
    }
  }

  // Listen to an event
  on(event, callback) {
    if (!this.socket) {
      console.warn('Socket not initialized. Cannot add listener for:', event);
      return;
    }

    this.socket.on(event, callback);

    // Track listener for cleanup
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  // Remove a specific listener
  off(event, callback) {
    if (!this.socket) return;

    this.socket.off(event, callback);

    // Remove from tracked listeners
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(callback);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  // Remove all listeners for an event
  removeAllListeners(event) {
    if (!this.socket) return;

    this.socket.removeAllListeners(event);
    this.listeners.delete(event);
  }

  // Get socket ID
  getSocketId() {
    return this.socket?.id;
  }

  // Room methods
  createRoom(type = 'multiplayer', settings = {}) {
    return new Promise((resolve, reject) => {
      this.emit('room:create', { type, settings }, (response) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  joinRoom(roomCode, displayName) {
    return new Promise((resolve, reject) => {
      this.emit('room:join', { roomCode, displayName }, (response) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  leaveRoom(roomCode) {
    this.emit('room:leave', { roomCode });
  }

  reconnectToRoom(roomCode) {
    return new Promise((resolve, reject) => {
      this.emit('room:reconnect', { roomCode }, (response) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || 'Reconnection failed'));
        }
      });
    });
  }

  setReady(roomCode, ready) {
    this.emit('room:ready', { roomCode, ready });
  }

  // Game methods
  startGame(roomCode) {
    this.emit('game:start', { roomCode });
  }

  selectQuestion(roomCode, categoryIndex, pointIndex) {
    this.emit('game:select-question', { roomCode, categoryIndex, pointIndex });
  }

  buzz(roomCode) {
    this.emit('game:buzz', { roomCode });
  }

  submitAnswer(roomCode, answer) {
    this.emit('game:answer', { roomCode, answer });
  }

  // Quickplay methods
  joinMatchmaking(displayName) {
    this.emit('quickplay:join-queue', { displayName });
  }

  leaveMatchmaking() {
    this.emit('quickplay:leave-queue');
  }
}

// Export singleton instance
export const socketClient = new SocketClient();
export default socketClient;
