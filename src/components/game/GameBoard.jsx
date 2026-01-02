import { motion } from 'framer-motion';
import './GameBoard.css';

export default function GameBoard({
  categories,
  questions,
  pointValues,
  onQuestionSelect,
  onNewGame,
  disabled = false,
  revealedQuestions = null, // Set() for multiplayer, null for single player
}) {
  // Helper to check if question is revealed
  const isQuestionRevealed = (categoryIndex, pointIndex) => {
    // For multiplayer, use the revealedQuestions Set
    if (revealedQuestions) {
      return revealedQuestions.has(`${categoryIndex}-${pointIndex}`);
    }
    // For single player, check the question object
    const question = questions[categoryIndex]?.[pointIndex];
    return question?.revealed;
  };

  const handleCellClick = (categoryIndex, pointIndex) => {
    if (disabled) return;
    if (isQuestionRevealed(categoryIndex, pointIndex)) return;
    onQuestionSelect(categoryIndex, pointIndex);
  };

  return (
    <div className={`game-board ${disabled ? 'disabled' : ''}`}>
      {/* Category Headers */}
      <div className="categories-row">
        {categories.map((category, index) => (
          <motion.div
            key={index}
            className="category-header"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            {category}
          </motion.div>
        ))}
      </div>

      {/* Questions Grid */}
      <div className="questions-grid">
        {pointValues.map((points, pointIndex) => (
          <div key={pointIndex} className="question-row">
            {categories.map((_, categoryIndex) => {
              const isRevealed = isQuestionRevealed(categoryIndex, pointIndex);
              const isClickable = !isRevealed && !disabled;

              return (
                <motion.div
                  key={categoryIndex}
                  className={`question-cell ${isRevealed ? 'revealed' : ''} ${disabled && !isRevealed ? 'not-my-turn' : ''}`}
                  onClick={() => handleCellClick(categoryIndex, pointIndex)}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: (pointIndex * 6 + categoryIndex) * 0.02 }}
                  whileHover={isClickable ? { scale: 1.02, backgroundColor: '#1a2080' } : {}}
                  whileTap={isClickable ? { scale: 0.98 } : {}}
                >
                  {isRevealed ? '' : `$${points}`}
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>

      {/* New Game Button - only show if onNewGame provided */}
      {onNewGame && (
        <motion.button
          className="new-game-button"
          onClick={onNewGame}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Back to Menu
        </motion.button>
      )}
    </div>
  );
}
