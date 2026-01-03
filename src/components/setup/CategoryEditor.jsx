import { motion } from 'framer-motion';
import './CategoryEditor.css';

export default function CategoryEditor({
  categories,
  onEdit,
  onBack,
  onNext,
  error,
  readOnly = false,
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
            <input
              id={`category-${index}`}
              type="text"
              value={category}
              onChange={(e) => !readOnly && onEdit(index, e.target.value)}
              className="category-input"
              disabled={readOnly}
              readOnly={readOnly}
            />
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
