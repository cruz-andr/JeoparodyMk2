import { useState } from 'react';
import { motion } from 'framer-motion';
import './DailyDoubleModal.css';

export default function DailyDoubleModal({
  question,
  currentScore,
  currentRound,
  onWagerConfirm,
}) {
  const maxBoardValue = currentRound === 1 ? 1000 : 2000;
  const maxWager = Math.max(currentScore, maxBoardValue, 5);
  const [wager, setWager] = useState(5);
  const [showWagerInput, setShowWagerInput] = useState(false);

  const handleWagerChange = (e) => {
    const value = parseInt(e.target.value, 10) || 0;
    setWager(Math.max(5, Math.min(maxWager, value)));
  };

  const handleQuickWager = (amount) => {
    if (amount === 'all') {
      setWager(Math.max(currentScore, 5));
    } else if (amount === 'max') {
      setWager(maxWager);
    } else {
      setWager(Math.min(amount, maxWager));
    }
  };

  const handleConfirm = () => {
    onWagerConfirm(wager);
  };

  return (
    <motion.div
      className="daily-double-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {!showWagerInput ? (
        <motion.div
          className="daily-double-reveal"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 200 }}
        >
          <motion.h1
            className="daily-double-title"
            animate={{
              scale: [1, 1.1, 1],
              textShadow: [
                '0 0 10px #D69F4C',
                '0 0 30px #D69F4C, 0 0 60px #D69F4C',
                '0 0 10px #D69F4C',
              ],
            }}
            transition={{ duration: 1.5, repeat: 2 }}
            onAnimationComplete={() => setShowWagerInput(true)}
          >
            DAILY DOUBLE!
          </motion.h1>
        </motion.div>
      ) : (
        <motion.div
          className="wager-container"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="wager-title">Make Your Wager</h2>

          <div className="wager-info">
            <p>Category: <span>{question.category}</span></p>
            <p>Current Score: <span>${currentScore.toLocaleString()}</span></p>
            <p>Maximum Wager: <span>${maxWager.toLocaleString()}</span></p>
          </div>

          <div className="wager-input-group">
            <label htmlFor="wager-input">Your Wager: $</label>
            <input
              id="wager-input"
              type="number"
              min={5}
              max={maxWager}
              value={wager}
              onChange={handleWagerChange}
              className="wager-input"
            />
          </div>

          <div className="quick-wagers">
            <button onClick={() => handleQuickWager(100)}>$100</button>
            <button onClick={() => handleQuickWager(500)}>$500</button>
            <button onClick={() => handleQuickWager(1000)}>$1,000</button>
            {currentScore > 0 && (
              <button onClick={() => handleQuickWager('all')}>True Daily Double</button>
            )}
          </div>

          <motion.button
            className="confirm-wager-btn"
            onClick={handleConfirm}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Confirm Wager: ${wager.toLocaleString()}
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}
