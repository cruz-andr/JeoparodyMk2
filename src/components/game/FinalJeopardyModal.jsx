import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Timer from '../common/Timer';
import ClueScreen from './ClueScreen';
import { useAudio } from '../../hooks';
import { finalWagerLimit, clampFinalWager } from '../../utils/wagers';
import { checkAnswer } from '../../services/answerChecker';
import './FinalJeopardyModal.css';

const WAGER_TIME = 30000; // 30 seconds for wager
const ANSWER_TIME = 30000; // 30 seconds for answer

export default function FinalJeopardyModal({
  category,
  clue,
  correctAnswer,
  currentScore,
  onComplete,
  // The Final's picture or clip, when it has one: { mediaType, mediaData, ... }.
  media = null,
}) {
  const [phase, setPhase] = useState('category'); // 'category' | 'wager' | 'clue' | 'answer' | 'reveal'
  const [wager, setWager] = useState(0);
  const [playerAnswer, setPlayerAnswer] = useState('');
  const [result, setResult] = useState(null);
  const judged = useRef(false);
  const [showTimer, setShowTimer] = useState(false);
  const { playFinalJeopardy, stopFinalJeopardy, playCorrect, playWrong } = useAudio();

  // $0 up to the score. It used to invent a $1,000 limit for a score of $0;
  // a player at $0 is no longer offered Final Jeopardy at all.
  const maxWager = finalWagerLimit(currentScore);

  // The think music runs while the answer is being written, and stops the
  // moment the answer is locked in — as it does on the show.
  useEffect(() => {
    if (phase === 'answer') {
      playFinalJeopardy();
    } else {
      stopFinalJeopardy();
    }
  }, [phase, playFinalJeopardy, stopFinalJeopardy]);

  // Never leave the music running if the modal unmounts mid-answer.
  useEffect(() => stopFinalJeopardy, [stopFinalJeopardy]);

  // Handle category reveal (auto-advance after 3 seconds)
  useEffect(() => {
    if (phase === 'category') {
      const timer = setTimeout(() => {
        setPhase('wager');
        setShowTimer(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  // $0 is a real wager: standing pat is a common Final Jeopardy play.
  const handleWagerSubmit = () => {
    if (wager >= 0 && wager <= maxWager) {
      setShowTimer(false);
      setPhase('clue');
    }
  };

  /* Out of time, the wager is whatever was in the box. It used to become the
     whole score, betting everything for a player who had typed something
     smaller or had decided to wager nothing. */
  const handleWagerTimeUp = () => {
    setWager((w) => clampFinalWager(w, currentScore));
    setShowTimer(false);
    setPhase('clue');
  };

  const handleClueReveal = () => {
    setPhase('answer');
    setShowTimer(true);
  };

  /* Graded the moment the answer is locked in, by the same grader as every
     typed clue. Final Jeopardy has no second go at the spelling: the answer
     is written once, against the clock, as it is in a room. */
  const grade = () => {
    const given = playerAnswer.trim();
    const isCorrect = given ? checkAnswer(given, correctAnswer).isCorrect : false;
    if (isCorrect) playCorrect();
    else playWrong();
    const pointsChange = isCorrect ? wager : -wager;
    setResult({ isCorrect, pointsChange, newScore: currentScore + pointsChange });
  };

  const handleAnswerSubmit = () => {
    setShowTimer(false);
    setPhase('reveal');
    grade();
  };

  const handleAnswerTimeUp = () => {
    setShowTimer(false);
    setPhase('reveal');
    grade();
  };

  // The grader is fuzzy, so the player has the last word, as on every clue.
  const handleOverride = () => {
    playCorrect();
    setResult({ isCorrect: true, pointsChange: wager, newScore: currentScore + wager });
  };

  const handleFinish = () => {
    /* One finish. A double click used to file the same game twice; a ref,
       because the second click lands before a re-render. */
    if (judged.current || !result) return;
    judged.current = true;
    onComplete({
      isCorrect: result.isCorrect,
      wager,
      playerAnswer,
      pointsChange: result.pointsChange,
      finalScore: result.newScore,
    });
  };

  return (
    <motion.div
      className="final-jeopardy-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="final-jeopardy-modal"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Header */}
        <div className="fj-header">
          <h1>Final Jeopardy!</h1>
        </div>

        {/* Category Reveal Phase */}
        <AnimatePresence mode="wait">
          {phase === 'category' && (
            <motion.div
              key="category"
              className="fj-phase fj-category-phase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <p className="fj-label">The category is...</p>
              <motion.h2
                className="fj-category-name"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.5 }}
              >
                {category}
              </motion.h2>
            </motion.div>
          )}

          {/* Wager Phase */}
          {phase === 'wager' && (
            <motion.div
              key="wager"
              className="fj-phase fj-wager-phase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <p className="fj-category-display">{category}</p>
              <h3>Enter Your Wager</h3>
              <p className="fj-score-info">
                Current Score: <span className={currentScore >= 0 ? 'positive' : 'negative'}>
                  ${currentScore.toLocaleString()}
                </span>
              </p>
              <p className="fj-max-wager">Maximum wager: ${maxWager.toLocaleString()}</p>

              <div className="fj-wager-input-group">
                <span className="fj-dollar">$</span>
                <input
                  type="number"
                  value={wager || ''}
                  onChange={(e) => setWager(Math.min(maxWager, Math.max(0, parseInt(e.target.value) || 0)))}
                  placeholder="0"
                  min="0"
                  max={maxWager}
                  className="fj-wager-input"
                  autoFocus
                />
              </div>

              <div className="fj-quick-wagers">
                <button onClick={() => setWager(Math.floor(maxWager * 0.25))}>25%</button>
                <button onClick={() => setWager(Math.floor(maxWager * 0.5))}>50%</button>
                <button onClick={() => setWager(Math.floor(maxWager * 0.75))}>75%</button>
                <button onClick={() => setWager(maxWager)}>All In</button>
              </div>

              <button
                className="fj-submit-btn"
                onClick={handleWagerSubmit}
                disabled={wager < 0 || wager > maxWager}
              >
                Lock In Wager
              </button>

              {showTimer && (
                <div className="fj-timer">
                  <Timer
                    duration={WAGER_TIME}
                    onTimeUp={handleWagerTimeUp}
                    size="small"
                  />
                </div>
              )}
            </motion.div>
          )}

          {/* Clue Phase */}
          {phase === 'clue' && (
            <motion.div
              key="clue"
              className="fj-phase fj-clue-phase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <p className="fj-category-display">{category}</p>
              <p className="fj-wager-display">Your wager: ${wager.toLocaleString()}</p>

              <div className="fj-clue-card">
                <ClueScreen clue={media} text={clue} textClassName="fj-clue-text" />
              </div>

              <button className="fj-submit-btn" onClick={handleClueReveal}>
                I'm Ready to Answer
              </button>
            </motion.div>
          )}

          {/* Answer Phase */}
          {phase === 'answer' && (
            <motion.div
              key="answer"
              className="fj-phase fj-answer-phase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <p className="fj-category-display">{category}</p>
              {/* Still in front of them while they write: a picture clue is
                  answered from the picture. */}
              <div className="fj-clue-card fj-clue-small">
                <ClueScreen clue={media} text={clue} textClassName="fj-clue-text" />
              </div>

              <h3>Your Answer</h3>
              <input
                type="text"
                value={playerAnswer}
                onChange={(e) => setPlayerAnswer(e.target.value)}
                placeholder="What is..."
                className="fj-answer-input"
                autoFocus
              />

              <button
                className="fj-submit-btn"
                onClick={handleAnswerSubmit}
                disabled={!playerAnswer.trim()}
              >
                Submit Answer
              </button>

              {showTimer && (
                <div className="fj-timer">
                  <Timer
                    duration={ANSWER_TIME}
                    onTimeUp={handleAnswerTimeUp}
                    size="medium"
                  />
                </div>
              )}
            </motion.div>
          )}

          {/* Result Phase */}
          {result && (
            <motion.div
              key="result"
              className="fj-phase fj-result-phase"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <motion.div
                className={`fj-result-badge ${result.isCorrect ? 'correct' : 'incorrect'}`}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 10 }}
              >
                {result.isCorrect ? 'Correct!' : 'Incorrect'}
              </motion.div>

              <div className="fj-score-change">
                <span className={result.pointsChange >= 0 ? 'positive' : 'negative'}>
                  {result.pointsChange >= 0 ? '+' : ''}${result.pointsChange.toLocaleString()}
                </span>
              </div>

              <div className="fj-answers-compare">
                <div className="fj-answer-box fj-player-answer">
                  <h4>You said</h4>
                  <p>{playerAnswer.trim() || '(No answer given)'}</p>
                </div>
                <div className="fj-answer-box fj-correct-answer">
                  <h4>Correct response</h4>
                  <p>{correctAnswer}</p>
                </div>
              </div>

              <div className="fj-final-score">
                <h3>Final Score</h3>
                <span className={result.newScore >= 0 ? 'positive' : 'negative'}>
                  ${result.newScore.toLocaleString()}
                </span>
              </div>

              <div className="fj-judgment-buttons">
                {!result.isCorrect && playerAnswer.trim() && (
                  <button type="button" className="typed-override" onClick={handleOverride}>
                    I was right
                  </button>
                )}
                <button type="button" className="fj-submit-btn" onClick={handleFinish}>
                  Continue
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
