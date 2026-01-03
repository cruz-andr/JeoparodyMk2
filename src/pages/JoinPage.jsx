import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useSocket } from '../hooks';
import { useRoomStore, useUserStore } from '../stores';
import './JoinPage.css';

export default function JoinPage() {
  const navigate = useNavigate();
  const { roomCode: urlRoomCode } = useParams();
  const [roomCode, setRoomCode] = useState(urlRoomCode || '');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const { isConnected, joinRoom } = useSocket();
  const { setRoomCode: setStoreRoomCode, setPlayers } = useRoomStore();
  const { user, isGuest } = useUserStore();

  // Set default display name
  useEffect(() => {
    if (user?.displayName) {
      setDisplayName(user.displayName);
    } else if (isGuest) {
      setDisplayName(`Player${Math.floor(Math.random() * 1000)}`);
    }
  }, [user, isGuest]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const code = roomCode.toUpperCase().trim();

    if (code.length !== 6) {
      setError('Room code must be 6 characters');
      return;
    }

    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }

    setIsJoining(true);
    setError('');

    try {
      const result = await joinRoom(code, displayName.trim());

      // Update store with room data
      setStoreRoomCode(code);
      if (result.players) {
        setPlayers(result.players);
      }
      // Sync room settings from host
      if (result.settings) {
        useRoomStore.getState().updateSettings(result.settings);
      }

      // Navigate to game/lobby
      navigate(`/game/${code}`);
    } catch (err) {
      setError(err.message || 'Failed to join room');
      setIsJoining(false);
    }
  };

  return (
    <div className="join-page">
      <motion.div
        className="join-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="join-icon">🚪</span>
        <h1>Join Room</h1>
        <p className="join-subtitle">Enter a 6-character room code to join a game</p>

        <form onSubmit={handleSubmit} className="join-form">
          <div className="form-group">
            <label>Your Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name"
              maxLength={20}
              disabled={isJoining}
            />
          </div>

          <div className="form-group">
            <label>Room Code</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => {
                setRoomCode(e.target.value.toUpperCase());
                setError('');
              }}
              placeholder="XXXXXX"
              maxLength={6}
              className="room-code-input"
              disabled={isJoining}
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={roomCode.length !== 6 || !displayName.trim() || !isConnected || isJoining}
          >
            {isJoining ? 'Joining...' : isConnected ? 'Join Game' : 'Connecting...'}
          </button>
        </form>

        {error && (
          <motion.p
            className="error-message"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {error}
          </motion.p>
        )}

        <button onClick={() => navigate('/menu')} className="btn-back" disabled={isJoining}>
          Back to Menu
        </button>
      </motion.div>
    </div>
  );
}
