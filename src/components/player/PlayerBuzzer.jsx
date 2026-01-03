import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { socketClient } from '../../services/socket/socketClient';
import './PlayerBuzzer.css';

export default function PlayerBuzzer({
  roomCode,
  isEnabled = false,
  hasBuzzed = false,
  buzzedPlayerName = null,
  onBuzz,
}) {
  const [isPressed, setIsPressed] = useState(false);
  const [buzzTime, setBuzzTime] = useState(null);

  // Reset when buzzer is enabled
  useEffect(() => {
    if (isEnabled) {
      setIsPressed(false);
      setBuzzTime(null);
    }
  }, [isEnabled]);

  const handleBuzz = useCallback(() => {
    if (!isEnabled || hasBuzzed || isPressed) return;

    const reactionTime = Date.now();
    setIsPressed(true);
    setBuzzTime(reactionTime);

    // Emit buzz to server
    socketClient.emit('game:buzz-in', {
      roomCode,
      reactionTime,
    });

    // Haptic feedback if available
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }

    if (onBuzz) {
      onBuzz(reactionTime);
    }
  }, [isEnabled, hasBuzzed, isPressed, roomCode, onBuzz]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handleBuzz();
      }
    };

    if (isEnabled && !hasBuzzed) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isEnabled, hasBuzzed, handleBuzz]);

  const getButtonState = () => {
    if (buzzedPlayerName) {
      return 'buzzed-other';
    }
    if (hasBuzzed || isPressed) {
      return 'buzzed-self';
    }
    if (isEnabled) {
      return 'active';
    }
    return 'disabled';
  };

  const buttonState = getButtonState();

  return (
    <div className="player-buzzer-container">
      <motion.button
        className={`player-buzzer ${buttonState}`}
        onClick={handleBuzz}
        disabled={!isEnabled || hasBuzzed || isPressed}
        whileTap={isEnabled && !hasBuzzed ? { scale: 0.95 } : {}}
      >
        {buttonState === 'disabled' && (
          <span className="buzzer-text">Wait...</span>
        )}
        {buttonState === 'active' && (
          <>
            <span className="buzzer-text">BUZZ!</span>
            <span className="buzzer-hint">Press SPACE or tap</span>
          </>
        )}
        {buttonState === 'buzzed-self' && (
          <span className="buzzer-text">You buzzed!</span>
        )}
        {buttonState === 'buzzed-other' && (
          <>
            <span className="buzzer-text">{buzzedPlayerName}</span>
            <span className="buzzer-subtext">buzzed first</span>
          </>
        )}
      </motion.button>
    </div>
  );
}
