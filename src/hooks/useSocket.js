import { useEffect, useState, useCallback, useRef, useReducer } from 'react';
import { socketClient } from '../services/socket/socketClient';
import { useRoomStore, useUserStore } from '../stores';
import { initialWait, needsJoin, waitReducer } from './matchmakingWait';

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

// Hook for quickplay matchmaking. The state rules live in matchmakingWait.js.
export function useMatchmaking() {
  const { isConnected, subscribe } = useSocket();
  const [wait, dispatch] = useReducer(waitReducer, initialWait);
  const { wants, isInQueue } = wait;

  // What the server says about the queue.
  useEffect(() => {
    if (!isConnected) return;

    const unsubs = [
      // The server says when it will settle for two and when it gives up, so
      // the waiting copy never promises something the matchmaker will not do.
      subscribe('quickplay:queue-joined', (data) => dispatch({ type: 'joined', timings: data })),
      subscribe('quickplay:queue-left', () => dispatch({ type: 'left' })),
      subscribe('quickplay:match-found', (match) => dispatch({ type: 'match', match })),
      // The server has already taken us out of the queue; this only tells the
      // screen why the spinner stopped.
      subscribe('quickplay:no-match', (data) => dispatch({ type: 'no-match', message: data?.message })),
    ];
    return () => unsubs.forEach((off) => off());
  }, [isConnected, subscribe]);

  // A dropped transport drops us from the server's queue too (its disconnect
  // handler does that), so believing we are still queued would leave the
  // spinner up for ever with nothing ever coming.
  useEffect(() => {
    if (!isConnected) dispatch({ type: 'dropped' });
  }, [isConnected]);

  // Ask for a place in the queue whenever we want one and do not have one:
  // the first time, and again after every reconnect. The ack restarts the
  // clock, which is honest, because the server's clock restarted too.
  useEffect(() => {
    if (isConnected && needsJoin({ wants, isInQueue })) {
      socketApi.joinMatchmaking(wants.displayName, wants.signature);
    }
  }, [isConnected, wants, isInQueue]);

  // The wait clock runs only while the server has us.
  useEffect(() => {
    if (!isInQueue) return;
    const timer = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(timer);
  }, [isInQueue]);

  const joinQueue = useCallback((displayName, signature) => {
    dispatch({ type: 'request', displayName, signature });
  }, []);

  const leaveQueue = useCallback(() => {
    // Forget the wish first: if the socket is down the leave never reaches
    // the server, and a reconnect must not put us straight back in.
    dispatch({ type: 'cancel' });
    socketApi.leaveMatchmaking();
  }, []);

  return {
    isConnected,
    isInQueue,
    matchFound: wait.matchFound,
    noMatch: wait.noMatch,
    queueTime: wait.queueTime,
    timings: wait.timings,
    joinQueue,
    leaveQueue,
  };
}

export default useSocket;
