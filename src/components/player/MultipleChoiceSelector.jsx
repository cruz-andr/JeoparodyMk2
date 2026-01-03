import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { socketClient } from '../../services/socket/socketClient';
import './MultipleChoiceSelector.css';

const OPTION_LABELS = ['A', 'B', 'C', 'D'];
const OPTION_COLORS = [
  { bg: '#dc2626', hover: '#b91c1c' }, // Red
  { bg: '#2563eb', hover: '#1d4ed8' }, // Blue
  { bg: '#16a34a', hover: '#15803d' }, // Green
  { bg: '#ca8a04', hover: '#a16207' }, // Yellow/Gold
];

export default function MultipleChoiceSelector({
  roomCode,
  options = [],
  isEnabled = false,
  hasSelected = false,
  correctIndex = null, // null until revealed
  onSelect,
}) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [revealed, setRevealed] = useState(false);

  // Reset when enabled
  useEffect(() => {
    if (isEnabled) {
      setSelectedIndex(null);
      setRevealed(false);
    }
  }, [isEnabled]);

  // Handle correct answer reveal
  useEffect(() => {
    if (correctIndex !== null) {
      setRevealed(true);
    }
  }, [correctIndex]);

  const handleSelect = (index) => {
    if (!isEnabled || hasSelected || selectedIndex !== null) return;

    setSelectedIndex(index);

    // Emit selection to server
    socketClient.emit('player:select-mc-option', {
      roomCode,
      optionIndex: index,
    });

    // Haptic feedback if available
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }

    if (onSelect) {
      onSelect(index);
    }
  };

  const getOptionState = (index) => {
    if (revealed) {
      if (index === correctIndex) {
        return 'correct';
      }
      if (selectedIndex === index && index !== correctIndex) {
        return 'incorrect';
      }
      return 'revealed';
    }
    if (selectedIndex === index) {
      return 'selected';
    }
    return 'default';
  };

  const isLocked = hasSelected || selectedIndex !== null;

  if (!isEnabled && !isLocked && !revealed) {
    return (
      <div className="mc-selector-container">
        <div className="mc-selector-disabled">
          <span>Wait for the question...</span>
        </div>
      </div>
    );
  }

  // If no options provided or invalid
  if (!options || options.length === 0) {
    return (
      <div className="mc-selector-container">
        <div className="mc-selector-disabled">
          <span>No options available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-selector-container">
      <motion.div
        className="mc-selector-grid"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {options.slice(0, 4).map((option, index) => {
          const state = getOptionState(index);
          const color = OPTION_COLORS[index];

          return (
            <motion.button
              key={index}
              className={`mc-option ${state}`}
              onClick={() => handleSelect(index)}
              disabled={isLocked || revealed}
              style={{
                '--option-bg': color.bg,
                '--option-hover': color.hover,
              }}
              whileTap={!isLocked && !revealed ? { scale: 0.95 } : {}}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
            >
              <span className="option-label">{OPTION_LABELS[index]}</span>
              <span className="option-text">{option}</span>
              {state === 'selected' && (
                <motion.span
                  className="selected-indicator"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                >
                  ✓
                </motion.span>
              )}
              {state === 'correct' && (
                <motion.span
                  className="result-indicator correct-indicator"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                >
                  ✓
                </motion.span>
              )}
              {state === 'incorrect' && (
                <motion.span
                  className="result-indicator incorrect-indicator"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                >
                  ✗
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </motion.div>

      {isLocked && !revealed && (
        <motion.p
          className="selection-status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          Answer locked in! Waiting for results...
        </motion.p>
      )}

      {revealed && selectedIndex !== null && (
        <motion.p
          className={`result-status ${selectedIndex === correctIndex ? 'correct' : 'incorrect'}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {selectedIndex === correctIndex
            ? 'Correct! 🎉'
            : `Incorrect. The answer was ${OPTION_LABELS[correctIndex]}.`}
        </motion.p>
      )}
    </div>
  );
}
