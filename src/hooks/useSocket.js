import { useEffect, useState, useCallback, useRef } from 'react';
import { socketClient } from '../services/socket/socketClient';
import { useRoomStore, useUserStore } from '../stores';

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const { user, isGuest, sessionId } = useUserStore();
  const mountedRef = useRef(true);

  // Connect on mount
  useEffect(() => {
    mountedRef.current = true;

    const connect = async () => {
      setIsConnecting(true);
      setError(null);

      try {
        // Get auth token if available
        const token = user?.token || null;
        await socketClient.connect(token, sessionId);

        if (mountedRef.current) {
          setIsConnected(true);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err.message);
          setIsConnected(false);
        }
      } finally {
        if (mountedRef.current) {
          setIsConnecting(false);
        }
      }
    };

    connect();

    // Set up connection status listeners
    const handleConnect = () => {
      if (mountedRef.current) {
        setIsConnected(true);
        setError(null);
      }
    };

    const handleDisconnect = () => {
      if (mountedRef.current) {
        setIsConnected(false);
      }
    };

    const handleError = (err) => {
      if (mountedRef.current) {
        setError(err.message);
      }
    };

    socketClient.on('connect', handleConnect);
    socketClient.on('disconnect', handleDisconnect);
    socketClient.on('connect_error', handleError);

    return () => {
      mountedRef.current = false;
      socketClient.off('connect', handleConnect);
      socketClient.off('disconnect', handleDisconnect);
      socketClient.off('connect_error', handleError);
    };
  }, [user?.token, sessionId]);

  // Disconnect helper
  const disconnect = useCallback(() => {
    socketClient.disconnect();
    setIsConnected(false);
  }, []);

  // Reconnect helper
  const reconnect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const token = user?.token || null;
      await socketClient.connect(token, sessionId);
      setIsConnected(true);
    } catch (err) {
      setError(err.message);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [user?.token, sessionId]);

  // Subscribe to an event
  const subscribe = useCallback((event, callback) => {
    socketClient.on(event, callback);

    // Return unsubscribe function
    return () => {
      socketClient.off(event, callback);
    };
  }, []);

  // Emit an event
  const emit = useCallback((event, data, callback) => {
    socketClient.emit(event, data, callback);
  }, []);

  return {
    isConnected,
    isConnecting,
    error,
    disconnect,
    reconnect,
    subscribe,
    emit,
    socketId: socketClient.getSocketId(),

    // Room actions
    joinRoom: socketClient.joinRoom.bind(socketClient),
    leaveRoom: socketClient.leaveRoom.bind(socketClient),
    reconnectToRoom: socketClient.reconnectToRoom.bind(socketClient),
    setReady: socketClient.setReady.bind(socketClient),

    // Game actions
    startGame: socketClient.startGame.bind(socketClient),
    selectQuestion: socketClient.selectQuestion.bind(socketClient),
    buzz: socketClient.buzz.bind(socketClient),
    submitAnswer: socketClient.submitAnswer.bind(socketClient),

    // Quickplay actions
    joinMatchmaking: socketClient.joinMatchmaking.bind(socketClient),
    leaveMatchmaking: socketClient.leaveMatchmaking.bind(socketClient),
  };
}

// Hook for room-specific functionality
export function useRoom(roomCode) {
  const socket = useSocket();
  const { setPlayers, addPlayer, removePlayer, setConnectionStatus } = useRoomStore();
  const [roomState, setRoomState] = useState(null);

  useEffect(() => {
    if (!socket.isConnected || !roomCode) return;

    // Subscribe to room events
    const unsubPlayerJoined = socket.subscribe('room:player-joined', (data) => {
      // Transform socket data to store format
      addPlayer({
        id: data.playerId,
        name: data.displayName,
        displayName: data.displayName,
        signature: data.signature || null,
        score: 0,
        isReady: false,
        isConnected: true,
        isHost: false,
      });
    });

    const unsubPlayerLeft = socket.subscribe('room:player-left', (data) => {
      removePlayer(data.playerId);
    });

    const unsubPlayerReady = socket.subscribe('room:player-ready', (data) => {
      // Update player ready status in store
      useRoomStore.getState().updatePlayerReady(data.playerId, data.ready);
    });

    const unsubGameStarted = socket.subscribe('game:started', (data) => {
      setRoomState(data);
    });

    return () => {
      unsubPlayerJoined();
      unsubPlayerLeft();
      unsubPlayerReady();
      unsubGameStarted();
    };
  }, [socket.isConnected, roomCode]);

  return {
    ...socket,
    roomState,
    roomCode,
  };
}

// Hook for quickplay matchmaking
export function useMatchmaking() {
  const socket = useSocket();
  const [isInQueue, setIsInQueue] = useState(false);
  const [matchFound, setMatchFound] = useState(null);
  const [queueTime, setQueueTime] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!socket.isConnected) return;

    const unsubQueueJoined = socket.subscribe('quickplay:queue-joined', () => {
      setIsInQueue(true);
      setQueueTime(0);

      // Start queue timer
      timerRef.current = setInterval(() => {
        setQueueTime((prev) => prev + 1);
      }, 1000);
    });

    const unsubQueueLeft = socket.subscribe('quickplay:queue-left', () => {
      setIsInQueue(false);
      setQueueTime(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    });

    const unsubMatchFound = socket.subscribe('quickplay:match-found', (data) => {
      setMatchFound(data);
      setIsInQueue(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    });

    return () => {
      unsubQueueJoined();
      unsubQueueLeft();
      unsubMatchFound();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [socket.isConnected]);

  const joinQueue = useCallback((displayName, signature) => {
    socket.joinMatchmaking(displayName, signature);
  }, [socket]);

  const leaveQueue = useCallback(() => {
    socket.leaveMatchmaking();
  }, [socket]);

  return {
    isConnected: socket.isConnected,
    isInQueue,
    matchFound,
    queueTime,
    joinQueue,
    leaveQueue,
  };
}

export default useSocket;
