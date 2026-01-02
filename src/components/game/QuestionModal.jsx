import { motion } from 'framer-motion';
import Timer from '../common/Timer';
import { useSettingsStore } from '../../stores';
import './QuestionModal.css';

export default function QuestionModal({
  question,
  showAnswer,
  onRevealAnswer,
  onCorrect,
  onIncorrect,
  onClose,
  onTimeUp,
}) {
  const { questionTimeLimit } = useSettingsStore();
  const hasTimer = questionTimeLimit !== null;

  const handleTimeUp = () => {
    if (onTimeUp) {
      onTimeUp();
    } else {
      // Default: reveal answer when time runs out
      onRevealAnswer();
    }
  };

  return (
    <motion.div
      className="question-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="question-modal"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        {/* Timer */}
        {hasTimer && !showAnswer && (
          <div className="question-timer">
            <Timer
              duration={questionTimeLimit}
              onTimeUp={handleTimeUp}
              size="small"
              autoStart={true}
            />
          </div>
        )}

        <div className="question-header">
          <span className="question-category">{question.category}</span>
          <span className="question-points">${question.points}</span>
        </div>

        <div className="question-content">
          <p className="clue-text">{question.answer}</p>
        </div>

        {showAnswer ? (
          <motion.div
            className="answer-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="answer-label">Correct Response:</p>
            <p className="answer-text">{question.question}</p>

            <div className="scoring-buttons">
              <motion.button
                className="btn-correct"
                onClick={onCorrect}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                I Got It Right (+${question.points})
              </motion.button>
              <motion.button
                className="btn-incorrect"
                onClick={onIncorrect}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                I Got It Wrong (-${question.points})
              </motion.button>
            </div>
          </motion.div>
        ) : (
          <motion.button
            className="reveal-button"
            onClick={onRevealAnswer}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Reveal Answer
          </motion.button>
        )}

        <button className="close-button" onClick={onClose}>
          Skip
        </button>
      </motion.div>
    </motion.div>
  );
}
