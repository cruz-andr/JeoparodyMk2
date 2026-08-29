import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './ControllerView.css';

/**
 * Minimal "controller" UI for players in Projector Mode.
 * Replaces the full game board — phone becomes a buzzer/input device only.
 */
export default function ControllerView({
  answerMode = 'verbal',
  // Game state
  currentQuestion,
  canBuzz,
  buzzerWinnerId,
  iAmBuzzerWinner,
  buzzTimedOut,
  showAnswer,
  hasSkipped,
  hasAlreadyBuzzed,
  hostBuzzerOpen,
  hostAnswerWindowOpen,
  // MC options
  mcOptions,
  // Handlers
  onBuzz,
  onSkip,
  onSubmitTypedAnswer,
  onSelectMCOption,
  onRevealAnswer,
  onCorrect,
  onIncorrect,
  // Player info
  currentPlayerId,
  score = 0,
}) {
  const [typedAnswer, setTypedAnswer] = useState('');
  const [selectedMC, setSelectedMC] = useState(null);

  const handleTypedSubmit = useCallback((e) => {
    e.preventDefault();
    if (!typedAnswer.trim()) return;
    onSubmitTypedAnswer?.(typedAnswer.trim());
    setTypedAnswer('');
  }, [typedAnswer, onSubmitTypedAnswer]);

  const handleMCSelect = useCallback((index) => {
    setSelectedMC(index);
    onSelectMCOption?.(index);
  }, [onSelectMCOption]);

  // Reset state when question changes
  const questionKey = currentQuestion
    ? `${currentQuestion.categoryIndex}-${currentQuestion.pointIndex}`
    : 'none';

  // ---- Determine what to show ----

  // No question active — waiting screen
  if (!currentQuestion) {
    return (
      <div className="controller-view controller-waiting">
        <div className="controller-score">${score.toLocaleString()}</div>
        <div className="controller-status">Waiting for host...</div>
      </div>
    );
  }

  // Buzz timed out — show timeout
  if (buzzTimedOut) {
    return (
      <div className="controller-view controller-timeout">
        <div className="controller-score">${score.toLocaleString()}</div>
        <div className="controller-status">Time's up!</div>
      </div>
    );
  }

  // ---- VERBAL MODE ----
  if (answerMode === 'verbal') {
    // Can buzz — show giant buzzer
    if (canBuzz && hostBuzzerOpen && !buzzerWinnerId && !hasAlreadyBuzzed && !hasSkipped) {
      return (
        <div className="controller-view">
          <motion.button
            className="controller-buzzer"
            onClick={onBuzz}
            whileTap={{ scale: 0.95 }}
            key={questionKey}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            BUZZ
          </motion.button>
          {onSkip && (
            <button className="controller-skip" onClick={onSkip}>
              I don't know
            </button>
          )}
        </div>
      );
    }

    // I buzzed and won — waiting for host judgment (verbal, so just wait)
    if (iAmBuzzerWinner) {
      return (
        <div className="controller-view controller-buzzed">
          <div className="controller-status-large">You buzzed in!</div>
          <div className="controller-status">Speak your answer...</div>
        </div>
      );
    }

    // Someone else buzzed or already buzzed/skipped — waiting
    return (
      <div className="controller-view controller-waiting">
        <div className="controller-score">${score.toLocaleString()}</div>
        <div className="controller-status">
          {hasAlreadyBuzzed ? 'Already buzzed' : hasSkipped ? 'Skipped' : 'Waiting...'}
        </div>
      </div>
    );
  }

  // ---- TYPED / AUTO-GRADE MODE ----
  if (answerMode === 'typed' || answerMode === 'auto_grade') {
    if (hostAnswerWindowOpen) {
      return (
        <div className="controller-view controller-typed">
          <form onSubmit={handleTypedSubmit} className="controller-typed-form">
            <input
              type="text"
              className="controller-typed-input"
              placeholder="Type your answer..."
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              autoFocus
              autoComplete="off"
            />
            <button type="submit" className="controller-submit-btn" disabled={!typedAnswer.trim()}>
              Submit
            </button>
          </form>
        </div>
      );
    }

    return (
      <div className="controller-view controller-waiting">
        <div className="controller-score">${score.toLocaleString()}</div>
        <div className="controller-status">Get ready...</div>
      </div>
    );
  }

  // ---- MULTIPLE CHOICE MODE ----
  if (answerMode === 'multiple_choice') {
    if (hostAnswerWindowOpen && mcOptions?.length > 0) {
      const colors = ['mc-red', 'mc-blue', 'mc-green', 'mc-yellow'];
      const letters = ['A', 'B', 'C', 'D'];

      return (
        <div className="controller-view controller-mc">
          <div className="controller-mc-grid">
            {mcOptions.map((option, idx) => (
              <motion.button
                key={idx}
                className={`controller-mc-btn ${colors[idx]} ${selectedMC === idx ? 'selected' : ''}`}
                onClick={() => selectedMC === null && handleMCSelect(idx)}
                disabled={selectedMC !== null}
                whileTap={{ scale: 0.95 }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: idx * 0.05 }}
              >
                <span className="mc-letter">{letters[idx]}</span>
                <span className="mc-text">{option}</span>
              </motion.button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="controller-view controller-waiting">
        <div className="controller-score">${score.toLocaleString()}</div>
        <div className="controller-status">Get ready...</div>
      </div>
    );
  }

  // Fallback
  return (
    <div className="controller-view controller-waiting">
      <div className="controller-score">${score.toLocaleString()}</div>
      <div className="controller-status">Waiting...</div>
    </div>
  );
}
