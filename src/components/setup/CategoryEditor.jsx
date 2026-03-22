import { motion } from 'framer-motion';
import './CategoryEditor.css';

export default function CategoryEditor({
  categories,
  onEdit,
  onBack,
  onNext,
  error,
  readOnly = false,
  onRegenerate,
  remainingRolls = 5,
  regeneratingIndex = null,
}) {
  return (
    <motion.div
      className={`category-editor ${readOnly ? 'read-only' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <h2>Edit Categories</h2>
      {readOnly ? (
        <p className="editor-subtitle viewing-indicator">
          Watching host edit categories...
        </p>
      ) : (
        <p className="editor-subtitle">
          Review and customize the AI-generated categories
          {onRegenerate && (
            <span className="rolls-remaining"> ({remainingRolls} re-rolls remaining)</span>
          )}
        </p>
      )}

      <div className="categories-grid">
        {categories.map((category, index) => (
          <motion.div
            key={index}
            className="category-input-wrapper"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <label htmlFor={`category-${index}`}>Category {index + 1}</label>
            <div className="category-input-row">
              <input
                id={`category-${index}`}
                type="text"
                value={category}
                onChange={(e) => !readOnly && onEdit(index, e.target.value)}
                className="category-input"
                disabled={readOnly}
                readOnly={readOnly}
              />
              {!readOnly && onRegenerate && (
                <motion.button
                  className="btn-dice"
                  onClick={() => onRegenerate(index)}
                  disabled={remainingRolls <= 0 || regeneratingIndex !== null}
                  title={remainingRolls > 0 ? `Re-roll category (${remainingRolls} left)` : 'No re-rolls remaining'}
                  whileHover={remainingRolls > 0 && regeneratingIndex === null ? { scale: 1.1 } : {}}
                  whileTap={remainingRolls > 0 && regeneratingIndex === null ? { scale: 0.9 } : {}}
                >
                  {regeneratingIndex === index ? (
                    <span className="dice-spinner">...</span>
                  ) : (
                    <span role="img" aria-label="re-roll">&#x1F3B2;</span>
                  )}
                </motion.button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {!readOnly && (
        <div className="editor-actions">
          <button onClick={onBack} className="btn-secondary">
            Back
          </button>
          <button onClick={onNext} className="btn-primary">
            Generate Questions
          </button>
        </div>
      )}

      {error && (
        <motion.p
          className="error-message"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {error}
        </motion.p>
      )}
    </motion.div>
  );
}
