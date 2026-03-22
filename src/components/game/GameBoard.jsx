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
  onSuggest,
  suggestions = {},
  players = [],
  suggestMode = false,
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

  const getSuggestionsForCell = (catIdx, ptIdx) => {
    return Object.entries(suggestions)
      .filter(([, s]) => s && s.categoryIndex === catIdx && s.pointIndex === ptIdx)
      .map(([playerId]) => playerId);
  };

  const handleCellClick = (categoryIndex, pointIndex) => {
    if (isQuestionRevealed(categoryIndex, pointIndex)) return;
    if (suggestMode && onSuggest) {
      onSuggest(categoryIndex, pointIndex);
      return;
    }
    if (disabled) return;
    onQuestionSelect(categoryIndex, pointIndex);
  };

  return (
    <div className={`game-board ${disabled && !suggestMode ? 'disabled' : ''}`}>
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
              const isClickable = !isRevealed && (!disabled || suggestMode);
              const cellSuggestions = getSuggestionsForCell(categoryIndex, pointIndex);

              return (
                <motion.div
                  key={categoryIndex}
                  className={`question-cell ${isRevealed ? 'revealed' : ''} ${disabled && !suggestMode && !isRevealed ? 'not-my-turn' : ''} ${suggestMode && !isRevealed ? 'suggest-mode' : ''}`}
                  onClick={() => handleCellClick(categoryIndex, pointIndex)}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: (pointIndex * 6 + categoryIndex) * 0.02 }}
                  whileHover={isClickable ? { scale: 1.02, backgroundColor: suggestMode ? '#2a1080' : '#1a2080' } : {}}
                  whileTap={isClickable ? { scale: 0.98 } : {}}
                >
                  {isRevealed ? '' : `$${points}`}
                  {cellSuggestions.length > 0 && !isRevealed && (
                    <div className="suggestion-indicators">
                      {cellSuggestions.map(pid => {
                        const player = players.find(p => p.id === pid);
                        const name = player?.displayName || player?.name || '?';
                        return (
                          <span key={pid} className="suggestion-dot" title={name}>
                            {name.charAt(0).toUpperCase()}
                          </span>
                        );
                      })}
                    </div>
                  )}
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
