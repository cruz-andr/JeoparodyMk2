import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Timer from '../common/Timer';
import ClueScreen from './ClueScreen';
import { useSettingsStore } from '../../stores';
import { useMediaQuery } from '../../hooks/useMediaQuery';
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
  /* The Sixer's second chance. `note` says what just happened ("close",
     "not quite"), `hint` is the shape of the answer once a miss has brought
     it up, and `onClaim` lets a player the grader got wrong say so before
     the response is shown. `earned` is what the clue paid, for a game that
     never takes money away; without it the verdict reads plus or minus the
     clue's value, as on The Board. */
  note = null,
  hint = null,
  onClaim = null,
  earned,
}) {
  const questionTimeLimit = useSettingsStore((s) => s.questionTimeLimit);
  // Settings offers a Show timer switch that nothing was reading.
  const showTimerSetting = useSettingsStore((s) => s.showTimer);
  /* No per clue countdown in typed mode. The board that uses it is timed as a
     whole, the way a crossword is, so a second clock ticking on each clue
     would be measuring the same thing twice and rushing the typing besides. */
  const hasTimer = questionTimeLimit !== null && showTimerSetting && !typed;
  const [entry, setEntry] = useState('');
  /* Autofocus is a desktop convenience. On a phone it throws the keyboard up
     over the clue the moment it appears, so the clue is read around it. */
  const isPhone = useMediaQuery('(max-width: 768px)');

  /* Time ran out before the player answered. As on the show, a clue nobody
     answered moves the score neither way, and a Daily Double not answered in
     time loses the wager. Before, the response was revealed and +points was
     still on offer. */
  const [timedOut, setTimedOut] = useState(false);

  // A new clue starts with an empty box, not the last one's text.
  useEffect(() => {
    setEntry('');
    setTimedOut(false);
  }, [question]);

  // The hint is a fresh try, so it starts from an empty box too.
  useEffect(() => {
    if (hint) setEntry('');
  }, [hint]);

  const handleTimeUp = () => {
    if (onTimeUp) {
      onTimeUp();
    } else {
      setTimedOut(true);
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
      } else if (timedOut) {
        // Out of time: the only move is on, and a Daily Double costs its wager.
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          (isDailyDouble ? onIncorrect : onClose)();
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
  }, [typed, result, onContinue, showAnswer, timedOut, isDailyDouble, onRevealAnswer, onCorrect, onIncorrect, onClose]);

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
          <ClueScreen clue={question} text={question.answer} />
        </div>

        {typed ? (
          result ? (
            <motion.div
              className="typed-result"
              /* The verdict replaces the input in place; without this it is
                 announced to nobody. */
              aria-live="polite"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div
                className={`typed-badge ${
                  result.passed ? 'passed' : result.correct ? 'correct' : 'incorrect'
                }`}
              >
                {result.passed
                  ? 'Passed'
                  : earned !== undefined
                    ? (result.correct
                      ? `Correct +$${earned.toLocaleString()}${result.hinted ? ' with the hint' : ''}`
                      : 'Incorrect')
                    : result.correct
                      ? `Correct +$${points.toLocaleString()}`
                      : `Incorrect -$${points.toLocaleString()}`}
              </div>

              <p className="typed-said">
                {result.passed
                  ? (earned !== undefined ? 'Nothing won or lost.' : 'No points either way.')
                  : result.playerAnswer
                    ? <>You said: <span>{result.playerAnswer}</span></>
                    : 'You did not answer.'}
              </p>
              <p className="typed-truth">
                Correct response: <span>{question.question}</span>
              </p>

              <div className="typed-after">
                {!result.correct && !result.passed && onOverride && (
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
            <>
            {note && <p className="typed-note" role="status">{note}</p>}
            {hint && (
              <p className="typed-hint" aria-label={`Hint: ${hint.replace(/_/g, 'blank')}`}>
                {hint}
              </p>
            )}
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
                placeholder="What is…"
                aria-label="Your response"
                autoFocus={!isPhone}
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
            {onClaim && (
              <button type="button" className="typed-claim" onClick={onClaim}>
                I was right
              </button>
            )}
            </>
          )
        ) : showAnswer ? (
          <motion.div
            className="answer-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="answer-label">Correct Response:</p>
            <p className="answer-text">{question.question}</p>

            {timedOut ? (
              <>
                <p className="time-up-note">
                  {isDailyDouble ? `Time's up: the wager of $${points.toLocaleString()} is lost.` : "Time's up: no change to your score."}
                </p>
                <div className="scoring-buttons">
                  <motion.button
                    className={isDailyDouble ? 'btn-incorrect' : 'btn-primary'}
                    onClick={isDailyDouble ? onIncorrect : onClose}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    Continue
                  </motion.button>
                </div>
              </>
            ) : (
            <>
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
            </>
            )}
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

        {/* No skipping a Daily Double: the wager is placed before the clue is
            read, so a skip would walk away from it. And once time is up the
            Continue above is the way on. */}
        {!(typed && result) && !isDailyDouble && !timedOut && (
          <button className="close-button" onClick={onClose}>
            {closeLabel}
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
