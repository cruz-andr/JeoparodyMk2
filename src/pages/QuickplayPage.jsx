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
  const [phase, setPhase] = useState('setup'); // 'setup' | 'searching' | 'found' | 'nomatch'
  const [selectedPreset, setSelectedPreset] = useState('standard');

  const {
    isConnected, isInQueue, matchFound, noMatch, queueTime, timings, joinQueue, leaveQueue,
  } = useMatchmaking();
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

  // The server gave up on finding anyone: say so, and offer a way forward.
  useEffect(() => {
    if (noMatch) setPhase('nomatch');
  }, [noMatch]);

  useEffect(() => {
    if (matchFound) {
      setPhase('found');
      // Navigate to game after brief delay
      const timer = setTimeout(() => {
        // Set players in room store before navigating
        const players = matchFound.players.map(p => ({
          // Session id, not socket id: it is what every server event uses, and
          // it survives a reconnect.
          id: p.id,
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

  /* Before the pairing threshold the matchmaker wants three; after it, the
     next person to arrive is enough. The screen says which, in the server's
     own numbers, so nobody is promised a third who will never be waited for. */
  const pairAfterSec = Math.round(timings.pairAfterMs / 1000);
  const settlingForTwo = queueTime * 1000 >= timings.pairAfterMs;

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
                <span>2 to 3 Players</span>
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

            <h2 className="search-state" data-state={settlingForTwo ? 'two' : 'looking'}>
              {settlingForTwo ? 'Starting with two' : 'Looking for players'}
            </h2>
            <p className="queue-time">{formatTime(queueTime)}</p>

            <p className="search-hint">
              {settlingForTwo
                ? 'The next player to arrive starts the game.'
                : `Three players start a match. After ${pairAfterSec} seconds, two will do.`}
            </p>

            <button className="btn-ghost" onClick={handleLeaveQueue}>
              Cancel
            </button>
          </motion.div>
        )}

        {/* Nobody Else Phase */}
        {phase === 'nomatch' && (
          <motion.div
            key="nomatch"
            className="qp-content qp-nomatch"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <h2 className="nomatch-title">Nobody else is looking right now</h2>
            <p className="search-hint">
              You waited {Math.round(timings.giveUpAfterMs / 1000)} seconds and nobody else queued up.
              You can look again, or set up a game and invite people yourself.
            </p>

            <div className="nomatch-actions">
              <button
                type="button"
                className="plain-btn quiet-action"
                onClick={handleJoinQueue}
                disabled={!isConnected || !signature}
              >
                Try again
              </button>
              <button
                type="button"
                className="plain-btn quiet-action"
                onClick={() => navigate('/host')}
              >
                Host a game instead
              </button>
            </div>
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
