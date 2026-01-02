import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Timer from '../common/Timer';
import './FinalJeopardyModal.css';

const WAGER_TIME = 30000; // 30 seconds for wager
const ANSWER_TIME = 30000; // 30 seconds for answer

export default function FinalJeopardyModal({
  category,
  clue,
  correctAnswer,
  currentScore,
  onComplete,
}) {
  const [phase, setPhase] = useState('category'); // 'category' | 'wager' | 'clue' | 'answer' | 'reveal'
  const [wager, setWager] = useState(0);
  const [playerAnswer, setPlayerAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [showTimer, setShowTimer] = useState(false);

  const maxWager = currentScore > 0 ? currentScore : 1000;

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

  const handleWagerSubmit = () => {
    if (wager > 0 && wager <= maxWager) {
      setShowTimer(false);
      setPhase('clue');
    }
  };

  const handleWagerTimeUp = () => {
    // Default to max wager if time runs out
    setWager(maxWager);
    setShowTimer(false);
    setPhase('clue');
  };

  const handleClueReveal = () => {
    setPhase('answer');
    setShowTimer(true);
  };

  const handleAnswerSubmit = () => {
    setShowTimer(false);
    setPhase('reveal');
  };

  const handleAnswerTimeUp = () => {
    setShowTimer(false);
    setPhase('reveal');
  };

  const handleJudgment = (isCorrect) => {
    const pointsChange = isCorrect ? wager : -wager;
    const newScore = currentScore + pointsChange;

    setResult({
      isCorrect,
      pointsChange,
      newScore,
    });

    // Auto-complete after showing result
    setTimeout(() => {
      onComplete({
        isCorrect,
        wager,
        playerAnswer,
        pointsChange,
        finalScore: newScore,
      });
    }, 3000);
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
                disabled={wager <= 0 || wager > maxWager}
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
                <p className="fj-clue-text">{clue}</p>
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
              <div className="fj-clue-card fj-clue-small">
                <p className="fj-clue-text">{clue}</p>
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

          {/* Reveal Phase */}
          {phase === 'reveal' && !result && (
            <motion.div
              key="reveal"
              className="fj-phase fj-reveal-phase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <p className="fj-category-display">{category}</p>

              <div className="fj-answers-compare">
                <div className="fj-answer-box fj-player-answer">
                  <h4>Your Answer</h4>
                  <p>{playerAnswer || '(No answer given)'}</p>
                </div>

                <div className="fj-answer-box fj-correct-answer">
                  <h4>Correct Answer</h4>
                  <p>{correctAnswer}</p>
                </div>
              </div>

              <h3>Were you correct?</h3>
              <div className="fj-judgment-buttons">
                <button
                  className="fj-correct-btn"
                  onClick={() => handleJudgment(true)}
                >
                  Correct (+${wager.toLocaleString()})
                </button>
                <button
                  className="fj-incorrect-btn"
                  onClick={() => handleJudgment(false)}
                >
                  Incorrect (-${wager.toLocaleString()})
                </button>
              </div>
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

              <div className="fj-final-score">
                <h3>Final Score</h3>
                <span className={result.newScore >= 0 ? 'positive' : 'negative'}>
                  ${result.newScore.toLocaleString()}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
