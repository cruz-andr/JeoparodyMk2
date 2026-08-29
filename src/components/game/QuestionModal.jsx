import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Timer from '../common/Timer';
import MediaClueDisplay from '../media/MediaClueDisplay';
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
  // What this clue is actually worth. On a Daily Double the stake is the
  // player's wager, not the value printed on the board.
  points = question.points,
  isDailyDouble = false,
  // Typed mode: the player writes a response and it is graded for them, as on
  // the Sixer. Opt in, so the self graded flow everywhere else is untouched.
  typed = false,
  result = null,
  onSubmitAnswer,
  onOverride,
  onContinue,
  closeLabel = 'Skip',
}) {
  const questionTimeLimit = useSettingsStore((s) => s.questionTimeLimit);
  /* No per clue countdown in typed mode. The board that uses it is timed as a
     whole, the way a crossword is, so a second clock ticking on each clue
     would be measuring the same thing twice and rushing the typing besides. */
  const hasTimer = questionTimeLimit !== null && !typed;
  const [entry, setEntry] = useState('');

  // A new clue starts with an empty box, not the last one's text.
  useEffect(() => {
    setEntry('');
  }, [question]);

  const handleTimeUp = () => {
    if (onTimeUp) {
      onTimeUp();
    } else {
      // Default: reveal answer when time runs out
      onRevealAnswer();
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (typed) {
        // Nothing to reveal and nothing to self grade; the only key that acts
        // is the one that moves on.
        if (result && (e.code === 'Enter' || e.code === 'Space')) {
          e.preventDefault();
          onContinue?.();
        }
        return;
      }

      if (!showAnswer) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          onRevealAnswer();
        }
      } else {
        if (e.code === 'Digit1' || e.code === 'ArrowLeft') {
          e.preventDefault();
          onCorrect();
        } else if (e.code === 'Digit2' || e.code === 'ArrowRight') {
          e.preventDefault();
          onIncorrect();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [typed, result, onContinue, showAnswer, onRevealAnswer, onCorrect, onIncorrect]);

  return (
    <motion.div
      className={`question-modal-overlay ${typed ? 'typed' : ''}`}
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
          <span className="question-points">
            {isDailyDouble ? `Wager: $${points.toLocaleString()}` : `$${points.toLocaleString()}`}
          </span>
        </div>

        <div className="question-content">
          {question.mediaType && <MediaClueDisplay question={question} />}
          <p className="clue-text">{question.answer}</p>
        </div>

        {typed ? (
          result ? (
            <motion.div
              className="typed-result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className={`typed-badge ${result.correct ? 'correct' : 'incorrect'}`}>
                {result.correct
                  ? `Correct +$${points.toLocaleString()}`
                  : `Incorrect -$${points.toLocaleString()}`}
              </div>

              <p className="typed-said">
                {result.playerAnswer
                  ? <>You said: <span>{result.playerAnswer}</span></>
                  : 'You did not answer.'}
              </p>
              <p className="typed-truth">
                Correct response: <span>{question.question}</span>
              </p>

              <div className="typed-after">
                {!result.correct && onOverride && (
                  <button type="button" className="typed-override" onClick={onOverride}>
                    I was right
                  </button>
                )}
                <button type="button" className="typed-continue" onClick={onContinue}>
                  Continue
                </button>
              </div>
            </motion.div>
          ) : (
            <form
              className="typed-form"
              onSubmit={(e) => {
                e.preventDefault();
                const given = entry.trim();
                if (given) onSubmitAnswer?.(given);
              }}
            >
              <input
                type="text"
                className="typed-input"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                placeholder="What is..."
                aria-label="Your response"
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck="false"
                enterKeyHint="done"
              />
              <button type="submit" className="typed-submit" disabled={!entry.trim()}>
                Submit
              </button>
            </form>
          )
        ) : showAnswer ? (
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
                I Got It Right (+${points.toLocaleString()})
              </motion.button>
              <motion.button
                className="btn-incorrect"
                onClick={onIncorrect}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                I Got It Wrong (-${points.toLocaleString()})
              </motion.button>
            </div>
            <span className="keyboard-hint">Press 1 for Correct, 2 for Incorrect</span>
          </motion.div>
        ) : (
          <div>
            <motion.button
              className="reveal-button"
              onClick={onRevealAnswer}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Reveal Answer
            </motion.button>
            <span className="keyboard-hint">Press SPACE to reveal</span>
          </div>
        )}

        {!(typed && result) && (
          <button className="close-button" onClick={onClose}>
            {closeLabel}
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
