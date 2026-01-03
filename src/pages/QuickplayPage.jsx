import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks';
import { useUserStore, useSettingsStore, useRoomStore } from '../stores';
import SignatureCanvas from '../components/common/SignatureCanvas';
import '../components/common/SignatureCanvas.css';
import './QuickplayPage.css';

const QUICKPLAY_PRESETS = [
  {
    id: 'standard',
    label: 'Standard',
    description: '30s timer, all features',
    settings: {
      questionTimeLimit: 30000,
      enableDoubleJeopardy: true,
      enableDailyDouble: true,
      enableFinalJeopardy: true,
    },
  },
  {
    id: 'speed',
    label: 'Speed',
    description: '15s timer, 1 round',
    settings: {
      questionTimeLimit: 15000,
      enableDoubleJeopardy: false,
      enableDailyDouble: true,
      enableFinalJeopardy: false,
    },
  },
];

export default function QuickplayPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [signature, setSignature] = useState(null);
  const [phase, setPhase] = useState('setup'); // 'setup' | 'searching' | 'found'
  const [selectedPreset, setSelectedPreset] = useState('standard');

  const { isConnected, isInQueue, matchFound, queueTime, joinQueue, leaveQueue } = useMatchmaking();
  const { user, isGuest } = useUserStore();
  const { loadPreset } = useSettingsStore();

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
        // Set players in room store before navigating
        const players = matchFound.players.map(p => ({
          id: p.socketId, // Use socketId as player ID for quickplay
          socketId: p.socketId,
          displayName: p.displayName,
          signature: p.signature || null,
          score: 0,
          isReady: true,
          isConnected: true,
          isHost: false,
        }));
        useRoomStore.getState().setPlayers(players);
        useRoomStore.getState().setRoomCode(matchFound.roomCode);

        // Mark as fresh join to prevent reconnection race condition
        sessionStorage.setItem('jeopardy_fresh_join', 'true');

        navigate(`/game/${matchFound.roomCode}`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [matchFound, navigate]);

  const handleJoinQueue = () => {
    if (!signature) return;
    const name = displayName.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    joinQueue(name, signature);
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
            {/* Game Mode Selection */}
            <div className="qp-presets">
              <label className="preset-label">Game Mode</label>
              <div className="preset-buttons">
                {QUICKPLAY_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className={`preset-btn ${selectedPreset === preset.id ? 'active' : ''}`}
                    onClick={() => setSelectedPreset(preset.id)}
                    type="button"
                  >
                    <span className="preset-name">{preset.label}</span>
                    <span className="preset-desc">{preset.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="qp-info">
              <div className="info-item">
                <span className="info-icon">👥</span>
                <span>3 Players</span>
              </div>
              <div className="info-item">
                <span className="info-icon">🎯</span>
                <span>{QUICKPLAY_PRESETS.find(p => p.id === selectedPreset)?.settings.enableDoubleJeopardy ? '2 Rounds' : '1 Round'}</span>
              </div>
              <div className="info-item">
                <span className="info-icon">⏱️</span>
                <span>{QUICKPLAY_PRESETS.find(p => p.id === selectedPreset)?.settings.questionTimeLimit / 1000}s Timer</span>
              </div>
            </div>

            <div className="qp-form">
              <SignatureCanvas
                onSignatureChange={setSignature}
                width={300}
                height={80}
              />

              <button
                className="btn-primary btn-large"
                onClick={handleJoinQueue}
                disabled={!isConnected || !signature}
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
                  <span className="player-name">
                    {player.signature ? (
                      <img src={player.signature} alt={player.displayName} className="player-signature" />
                    ) : (
                      player.displayName
                    )}
                  </span>
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
