import { motion } from 'framer-motion';
import './GameResults.css';

export default function GameResults({
  score,
  questionsCorrect,
  questionsAttempted,
  genre,
  onPlayAgain,
  onBackToMenu,
}) {
  const accuracy = questionsAttempted > 0
    ? Math.round((questionsCorrect / questionsAttempted) * 100)
    : 0;

  const getMessage = () => {
    if (score >= 20000) return { text: 'LEGENDARY!', emoji: '🏆' };
    if (score >= 15000) return { text: 'Outstanding!', emoji: '🌟' };
    if (score >= 10000) return { text: 'Excellent!', emoji: '🎉' };
    if (score >= 5000) return { text: 'Great Job!', emoji: '👏' };
    if (score >= 0) return { text: 'Good Effort!', emoji: '👍' };
    return { text: 'Better Luck Next Time!', emoji: '💪' };
  };

  const message = getMessage();

  return (
    <motion.div
      className="game-results"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="results-header"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
      >
        <span className="result-emoji">{message.emoji}</span>
        <h2>{message.text}</h2>
      </motion.div>

      <div className="results-content">
        <motion.div
          className="final-score"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <span className="score-label">Final Score</span>
          <span className={`score-value ${score >= 0 ? 'positive' : 'negative'}`}>
            ${score.toLocaleString()}
          </span>
        </motion.div>

        <motion.div
          className="stats-grid"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <div className="stat-item">
            <span className="stat-value">{questionsCorrect}</span>
            <span className="stat-label">Correct</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{questionsAttempted}</span>
            <span className="stat-label">Attempted</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{accuracy}%</span>
            <span className="stat-label">Accuracy</span>
          </div>
        </motion.div>

        <motion.p
          className="genre-played"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          Genre: <span>{genre}</span>
        </motion.p>
      </div>

      <motion.div
        className="results-actions"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        <button className="btn-primary" onClick={onPlayAgain}>
          Play Again
        </button>
        <button className="btn-secondary" onClick={onBackToMenu}>
          Back to Menu
        </button>
      </motion.div>
    </motion.div>
  );
}
