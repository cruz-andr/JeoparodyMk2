import { useEffect, useState, useCallback, useRef } from 'react';
import { socketClient } from '../services/socket/socketClient';
import { useRoomStore, useUserStore } from '../stores';

// socketClient is a singleton, so these bindings never change. Creating them
// per render made the object returned by useSocket unstable, which forced every
// consumer to leave it out of their dependency lists.
const socketApi = {
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
    ...socketApi,
  };
}

// Hook for room-specific functionality
export function useRoom(roomCode) {
  const socket = useSocket();
  const { subscribe, isConnected } = socket;
  const { addPlayer, removePlayer } = useRoomStore();
  const [roomState, setRoomState] = useState(null);

  useEffect(() => {
    if (!isConnected || !roomCode) return;

    // Subscribe to room events
    const unsubPlayerJoined = subscribe('room:player-joined', (data) => {
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

    const unsubPlayerLeft = subscribe('room:player-left', (data) => {
      removePlayer(data.playerId);
    });

    const unsubPlayerReady = subscribe('room:player-ready', (data) => {
      // Update player ready status in store
      useRoomStore.getState().updatePlayerReady(data.playerId, data.ready);
    });

    const unsubGameStarted = subscribe('game:started', (data) => {
      setRoomState(data);
    });

    return () => {
      unsubPlayerJoined();
      unsubPlayerLeft();
      unsubPlayerReady();
      unsubGameStarted();
    };
  }, [isConnected, roomCode, subscribe, addPlayer, removePlayer]);

  return {
    ...socket,
    roomState,
    roomCode,
  };
}

// Hook for quickplay matchmaking
const DEFAULT_TIMINGS = { pairAfterMs: 20000, giveUpAfterMs: 45000 };

export function useMatchmaking() {
  const { isConnected, subscribe } = useSocket();
  const [isInQueue, setIsInQueue] = useState(false);
  const [matchFound, setMatchFound] = useState(null);
  const [noMatch, setNoMatch] = useState(null);
  const [queueTime, setQueueTime] = useState(0);
  const [timings, setTimings] = useState(DEFAULT_TIMINGS);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!isConnected) return;

    const stopTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const unsubQueueJoined = subscribe('quickplay:queue-joined', (data) => {
      setIsInQueue(true);
      setNoMatch(null);
      setQueueTime(0);
      // The server says when it will settle for two and when it gives up, so
      // the waiting copy never promises something the matchmaker will not do.
      if (data?.pairAfterMs && data?.giveUpAfterMs) {
        setTimings({ pairAfterMs: data.pairAfterMs, giveUpAfterMs: data.giveUpAfterMs });
      }

      // Start queue timer
      stopTimer();
      timerRef.current = setInterval(() => {
        setQueueTime((prev) => prev + 1);
      }, 1000);
    });

    const unsubQueueLeft = subscribe('quickplay:queue-left', () => {
      setIsInQueue(false);
      setQueueTime(0);
      stopTimer();
    });

    const unsubMatchFound = subscribe('quickplay:match-found', (data) => {
      setMatchFound(data);
      setIsInQueue(false);
      stopTimer();
    });

    // The server has already taken us out of the queue; this only tells the
    // screen why the spinner stopped.
    const unsubNoMatch = subscribe('quickplay:no-match', (data) => {
      setNoMatch({ message: data?.message || 'Nobody else is looking right now.' });
      setIsInQueue(false);
      stopTimer();
    });

    return () => {
      unsubQueueJoined();
      unsubQueueLeft();
      unsubMatchFound();
      unsubNoMatch();
      stopTimer();
    };
  }, [isConnected, subscribe]);

  const joinQueue = useCallback((displayName, signature) => {
    setNoMatch(null);
    socketApi.joinMatchmaking(displayName, signature);
  }, []);

  const leaveQueue = useCallback(() => {
    socketApi.leaveMatchmaking();
  }, []);

  return {
    isConnected,
    isInQueue,
    matchFound,
    noMatch,
    queueTime,
    timings,
    joinQueue,
    leaveQueue,
  };
}

export default useSocket;
