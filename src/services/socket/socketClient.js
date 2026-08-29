import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

class SocketClient {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.connectionPromise = null;
    this.authKey = null;
  }

  // Connect to the socket server
  connect(authToken = null, sessionId = null) {
    if (this.socket?.connected) {
      return Promise.resolve(this.socket);
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    const auth = { token: authToken, sessionId };
    const authKey = JSON.stringify(auth);

    // A socket built for a different identity can never become the right one,
    // so tear it down. Previously a disconnected socket was simply abandoned:
    // its listeners and retry timers lived on and, once it reconnected, every
    // event arrived twice.
    if (this.socket && this.authKey !== authKey) {
      this.destroySocket();
    }
    this.authKey = authKey;

    this.connectionPromise = new Promise((resolve, reject) => {
      if (!this.socket) {
        this.socket = io(SOCKET_URL, {
          auth,
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000,
          // A game in progress should keep trying rather than stranding the
          // player after a handful of attempts.
          reconnectionAttempts: Infinity,
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
      } else if (this.socket.disconnected) {
        // Reuse the existing socket so subscribers keep their listeners.
        // (If it is merely mid-handshake, wait for the outcome below.)
        this.socket.connect();
      }

      // `once` so repeated connect() calls cannot stack up settle handlers.
      const onConnect = () => {
        this.socket.off('connect_error', onError);
        console.log('Socket connected:', this.socket.id);
        this.connectionPromise = null;
        resolve(this.socket);
      };
      const onError = (error) => {
        this.socket.off('connect', onConnect);
        console.error('Socket connection error:', error.message);
        this.connectionPromise = null;
        reject(error);
      };

      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onError);
    });

    return this.connectionPromise;
  }

  // Drop the underlying socket and every listener attached to it.
  destroySocket() {
    if (!this.socket) return;

    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
    this.listeners.clear();
    this.connectionPromise = null;
  }

  // Disconnect from the socket server
  disconnect() {
    this.destroySocket();
    this.authKey = null;
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

  joinRoom(roomCode, displayName, signature = null) {
    return new Promise((resolve, reject) => {
      this.emit('room:join', { roomCode, displayName, signature }, (response) => {
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
  joinMatchmaking(displayName, signature = null) {
    this.emit('quickplay:join-queue', { displayName, signature });
  }

  leaveMatchmaking() {
    this.emit('quickplay:leave-queue');
  }
}

// Export singleton instance
export const socketClient = new SocketClient();
export default socketClient;
