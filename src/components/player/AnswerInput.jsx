import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { socketClient } from '../../services/socket/socketClient';
import './AnswerInput.css';

export default function AnswerInput({
  roomCode,
  isEnabled = false,
  timeLimit = 30,
  hasSubmitted = false,
  onSubmit,
}) {
  const [answer, setAnswer] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef(null);

  // Reset when enabled
  useEffect(() => {
    if (isEnabled) {
      setAnswer('');
      setSubmitted(false);
      setTimeRemaining(timeLimit);
      // Focus input when enabled
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isEnabled, timeLimit]);

  // Timer countdown
  useEffect(() => {
    if (!isEnabled || submitted || hasSubmitted || timeLimit <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          // Auto-submit when time runs out
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isEnabled, submitted, hasSubmitted, timeLimit]);

  const handleSubmit = () => {
    if (submitted || hasSubmitted) return;

    const trimmedAnswer = answer.trim();
    setSubmitted(true);

    // Emit answer to server
    socketClient.emit('player:submit-typed-answer', {
      roomCode,
      answer: trimmedAnswer,
    });

    // Haptic feedback if available
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }

    if (onSubmit) {
      onSubmit(trimmedAnswer);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isSubmitted = submitted || hasSubmitted;
  const progress = timeLimit > 0 ? (timeRemaining / timeLimit) * 100 : 100;
  const isUrgent = timeRemaining <= 10 && timeRemaining > 0;

  if (!isEnabled && !isSubmitted) {
    return (
      <div className="answer-input-container">
        <div className="answer-input-disabled">
          <span>Wait for the question...</span>
        </div>
      </div>
    );
  }

  if (isSubmitted) {
    return (
      <div className="answer-input-container">
        <motion.div
          className="answer-input-submitted"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <span className="submitted-icon">✓</span>
          <span className="submitted-text">Answer Submitted!</span>
          {answer && <p className="submitted-answer">"{answer}"</p>}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="answer-input-container">
      <motion.div
        className="answer-input-active"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Timer */}
        {timeLimit > 0 && (
          <div className={`timer-section ${isUrgent ? 'urgent' : ''}`}>
            <div className="timer-bar">
              <motion.div
                className="timer-progress"
                initial={{ width: '100%' }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: 'linear' }}
              />
            </div>
            <span className="timer-text">{timeRemaining}s</span>
          </div>
        )}

        {/* Input field */}
        <div className="input-section">
          <input
            ref={inputRef}
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer..."
            className="answer-text-input"
            disabled={isSubmitted}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
        </div>

        {/* Submit button */}
        <motion.button
          className="submit-button"
          onClick={handleSubmit}
          disabled={isSubmitted}
          whileTap={{ scale: 0.95 }}
        >
          Submit Answer
        </motion.button>

        <p className="input-hint">Press Enter to submit</p>
      </motion.div>
    </div>
  );
}
