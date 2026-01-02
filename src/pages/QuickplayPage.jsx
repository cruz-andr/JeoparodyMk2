import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks';
import { useUserStore } from '../stores';
import './QuickplayPage.css';

export default function QuickplayPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [phase, setPhase] = useState('setup'); // 'setup' | 'searching' | 'found'

  const { isConnected, isInQueue, matchFound, queueTime, joinQueue, leaveQueue } = useMatchmaking();
  const { user, isGuest } = useUserStore();

  // Set default display name
  useEffect(() => {
    if (user?.displayName) {
      setDisplayName(user.displayName);
    } else if (isGuest) {
      setDisplayName(`Player${Math.floor(Math.random() * 1000)}`);
    }
  }, [user, isGuest]);

  // Handle phase changes based on matchmaking state
  useEffect(() => {
    if (isInQueue && phase !== 'searching') {
      setPhase('searching');
    }
  }, [isInQueue, phase]);

  useEffect(() => {
    if (matchFound) {
      setPhase('found');
      // Navigate to game after brief delay
      const timer = setTimeout(() => {
        navigate(`/game/${matchFound.roomCode}`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [matchFound, navigate]);

  const handleJoinQueue = () => {
    if (!displayName.trim()) return;
    joinQueue(displayName);
    setPhase('searching');
  };

  const handleLeaveQueue = () => {
    leaveQueue();
    setPhase('setup');
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="quickplay-page">
      <header className="qp-header">
        <h1>Quickplay</h1>
        <p className="qp-subtitle">Match with random players</p>
      </header>

      <AnimatePresence mode="wait">
        {/* Setup Phase */}
        {phase === 'setup' && (
          <motion.div
            key="setup"
            className="qp-content"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="qp-info">
              <div className="info-item">
                <span className="info-icon">👥</span>
                <span>3 Players</span>
              </div>
              <div className="info-item">
                <span className="info-icon">🎯</span>
                <span>2 Rounds</span>
              </div>
              <div className="info-item">
                <span className="info-icon">⏱️</span>
                <span>30s Timer</span>
              </div>
            </div>

            <div className="qp-form">
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

              <button
                className="btn-primary btn-large"
                onClick={handleJoinQueue}
                disabled={!isConnected || !displayName.trim()}
              >
                {isConnected ? 'Find Match' : 'Connecting...'}
              </button>
            </div>

            <button className="btn-ghost" onClick={() => navigate('/menu')}>
              Back to Menu
            </button>
          </motion.div>
        )}

        {/* Searching Phase */}
        {phase === 'searching' && (
          <motion.div
            key="searching"
            className="qp-content qp-searching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="searching-animation">
              <motion.div
                className="search-ring"
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              />
              <motion.div
                className="search-ring ring-2"
                animate={{ rotate: -360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              />
              <div className="search-center">
                <span className="search-icon">🎲</span>
              </div>
            </div>

            <h2>Finding Players...</h2>
            <p className="queue-time">{formatTime(queueTime)}</p>

            <p className="search-hint">
              Looking for 2 more players to start a match
            </p>

            <button className="btn-ghost" onClick={handleLeaveQueue}>
              Cancel
            </button>
          </motion.div>
        )}

        {/* Match Found Phase */}
        {phase === 'found' && matchFound && (
          <motion.div
            key="found"
            className="qp-content qp-found"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <motion.div
              className="match-badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 10 }}
            >
              Match Found!
            </motion.div>

            <div className="match-players">
              {matchFound.players.map((player, index) => (
                <motion.div
                  key={player.socketId}
                  className="match-player"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <span className="player-avatar">👤</span>
                  <span className="player-name">{player.displayName}</span>
                </motion.div>
              ))}
            </div>

            <p className="loading-game">Starting game...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
