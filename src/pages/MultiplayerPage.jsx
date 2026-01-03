import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks';
import { useRoomStore, useUserStore } from '../stores';
import { socketClient } from '../services/socket/socketClient';
import './MultiplayerPage.css';

export default function MultiplayerPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('menu'); // 'menu' | 'creating' | 'lobby'
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);

  const { isConnected, isConnecting, error: socketError, joinRoom, leaveRoom, setReady, startGame } = useSocket();
  const { roomCode, players, isHost, createRoom, resetRoom, settings } = useRoomStore();
  const { user, isGuest } = useUserStore();

  // Set default display name from user
  useEffect(() => {
    if (user?.displayName) {
      setDisplayName(user.displayName);
    } else if (isGuest) {
      setDisplayName(`Player${Math.floor(Math.random() * 1000)}`);
    }
  }, [user, isGuest]);

  const handleCreateRoom = async () => {
    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }

    setPhase('creating');
    setError(null);

    try {
      // First create room on backend
      const { roomCode: newRoomCode } = await socketClient.createRoom('multiplayer');

      // Update local store
      useRoomStore.getState().setRoomCode(newRoomCode);
      useRoomStore.getState().setIsHost(true);

      // Then join the room via socket
      const result = await joinRoom(newRoomCode, displayName);

      // Set players from result (includes self as host)
      if (result.players) {
        useRoomStore.getState().setPlayers(result.players);
      }
      // Sync room settings from server
      if (result.settings) {
        useRoomStore.getState().updateSettings(result.settings);
      }

      // Navigate to GamePage (shared lobby for all players)
      navigate(`/game/${newRoomCode}`);
    } catch (err) {
      setError(err.message || 'Failed to create room');
      setPhase('menu');
      resetRoom();
    }
  };

  const handleLeaveRoom = () => {
    if (roomCode) {
      leaveRoom(roomCode);
    }
    resetRoom();
    setPhase('menu');
  };

  const handleToggleReady = () => {
    const currentPlayer = players.find(p => p.isHost === false);
    if (currentPlayer && roomCode) {
      setReady(roomCode, !currentPlayer.isReady);
    }
  };

  const handleStartGame = () => {
    if (roomCode && isHost) {
      startGame(roomCode);
      navigate(`/game/${roomCode}`);
    }
  };

  const allPlayersReady = players.length >= 2 && players.every(p => p.isReady || p.isHost);

  return (
    <div className="multiplayer-page">
      <header className="mp-header">
        <h1>Multiplayer</h1>
        {!isConnected && !isConnecting && (
          <span className="connection-status offline">Not Connected</span>
        )}
        {isConnecting && (
          <span className="connection-status connecting">Connecting...</span>
        )}
        {isConnected && (
          <span className="connection-status online">Connected</span>
        )}
      </header>

      <AnimatePresence mode="wait">
        {/* Menu Phase */}
        {phase === 'menu' && (
          <motion.div
            key="menu"
            className="mp-content"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="mp-form">
              <div className="form-group">
                <label>Your Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your name"
                  maxLength={20}
                />
              </div>

              {error && <p className="error-message">{error}</p>}
              {socketError && <p className="error-message">{socketError}</p>}

              <div className="mp-actions">
                <button
                  className="btn-primary btn-large"
                  onClick={handleCreateRoom}
                  disabled={!isConnected || !displayName.trim()}
                >
                  Create Room
                </button>
                <button
                  className="btn-secondary btn-large"
                  onClick={() => navigate('/join')}
                >
                  Join Room
                </button>
              </div>
            </div>

            <button className="btn-ghost" onClick={() => navigate('/menu')}>
              Back to Menu
            </button>
          </motion.div>
        )}

        {/* Creating Phase */}
        {phase === 'creating' && (
          <motion.div
            key="creating"
            className="mp-content mp-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="spinner" />
            <p>Creating room...</p>
          </motion.div>
        )}

        {/* Lobby Phase */}
        {phase === 'lobby' && (
          <motion.div
            key="lobby"
            className="mp-content mp-lobby"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="room-code-display">
              <span className="room-code-label">Room Code</span>
              <span className="room-code">{roomCode}</span>
              <button
                className="copy-btn"
                onClick={() => navigator.clipboard.writeText(roomCode)}
              >
                Copy
              </button>
            </div>

            <p className="share-hint">
              Share this code with your friends to let them join!
            </p>

            <div className="players-list">
              <h3>Players ({players.length}/6)</h3>
              {players.length === 0 ? (
                <p className="no-players">Waiting for players to join...</p>
              ) : (
                <ul>
                  {players.map((player) => (
                    <li key={player.id} className="player-item">
                      <span className="player-name">
                        {player.displayName || player.name}
                        {player.isHost && <span className="host-badge">Host</span>}
                      </span>
                      <span className={`ready-status ${player.isReady ? 'ready' : 'not-ready'}`}>
                        {player.isHost ? 'Host' : player.isReady ? 'Ready' : 'Not Ready'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="lobby-actions">
              {isHost ? (
                <button
                  className="btn-primary btn-large"
                  onClick={handleStartGame}
                  disabled={!allPlayersReady}
                >
                  {allPlayersReady ? 'Start Game' : 'Waiting for players...'}
                </button>
              ) : (
                <button
                  className="btn-primary btn-large"
                  onClick={handleToggleReady}
                >
                  Toggle Ready
                </button>
              )}
              <button className="btn-ghost" onClick={handleLeaveRoom}>
                Leave Room
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
