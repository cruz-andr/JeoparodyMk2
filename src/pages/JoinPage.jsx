import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useSocket } from '../hooks';
import { useRoomStore, useUserStore } from '../stores';
import SignatureCanvas from '../components/common/SignatureCanvas';
import '../components/common/SignatureCanvas.css';
import './JoinPage.css';

export default function JoinPage() {
  const navigate = useNavigate();
  const { roomCode: urlRoomCode } = useParams();
  const [roomCode, setRoomCode] = useState(urlRoomCode || '');
  const [displayName, setDisplayName] = useState('');
  const [signature, setSignature] = useState(null);
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

    if (!signature) {
      setError('Please draw your name');
      return;
    }

    // Generate a display name for fallback/logging
    const name = displayName.trim() || `Player${Math.floor(Math.random() * 1000)}`;

    setIsJoining(true);
    setError('');

    try {
      const result = await joinRoom(code, name, signature);

      // Update store with room data
      setStoreRoomCode(code);
      // Set room type so players know if it's host mode
      if (result.type) {
        useRoomStore.getState().setRoomType(result.type);
      }
      if (result.players) {
        setPlayers(result.players);
      }
      // Sync room settings from host
      if (result.settings) {
        useRoomStore.getState().updateSettings(result.settings);
      }

      // Mark as fresh join to prevent reconnection race condition
      sessionStorage.setItem('jeopardy_fresh_join', 'true');

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
          <SignatureCanvas
            onSignatureChange={setSignature}
            width={300}
            height={80}
          />

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
            disabled={roomCode.length !== 6 || !signature || !isConnected || isJoining}
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
