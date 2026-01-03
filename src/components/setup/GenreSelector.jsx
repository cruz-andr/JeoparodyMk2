import { useState } from 'react';
import { motion } from 'framer-motion';
import './GenreSelector.css';

const popularGenres = [
  'Science',
  'Movies',
  'History',
  'Sports',
  'Music',
  'Geography',
  'Literature',
  'Technology',
];

export default function GenreSelector({ onSubmit, error, readOnly = false, selectedGenre = '' }) {
  const [genre, setGenre] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (genre.trim() && !readOnly) {
      onSubmit(genre.trim());
    }
  };

  const handleQuickSelect = (g) => {
    if (readOnly) return;
    setGenre(g);
    onSubmit(g);
  };

  // In read-only mode, show the host's selected genre
  const displayGenre = readOnly ? selectedGenre : genre;

  return (
    <motion.div
      className={`genre-selector ${readOnly ? 'read-only' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <h2>Choose a Genre</h2>
      {readOnly ? (
        <p className="genre-subtitle viewing-indicator">
          Watching host select a genre...
        </p>
      ) : (
        <p className="genre-subtitle">
          Enter any topic and AI will generate categories and questions
        </p>
      )}

      <form onSubmit={handleSubmit} className="genre-form">
        <input
          type="text"
          value={displayGenre}
          onChange={(e) => !readOnly && setGenre(e.target.value)}
          placeholder={readOnly ? "Waiting for host..." : "Enter a genre (e.g., Space, 90s Pop Culture, World War II)"}
          className="genre-input"
          autoFocus={!readOnly}
          disabled={readOnly}
          readOnly={readOnly}
        />
        {!readOnly && (
          <button
            type="submit"
            disabled={!genre.trim()}
            className="btn-primary"
          >
            Generate Categories
          </button>
        )}
      </form>

      <div className="quick-genres">
        <p className="quick-label">Quick Select:</p>
        <div className="genre-chips">
          {popularGenres.map((g) => (
            <motion.button
              key={g}
              className={`genre-chip ${readOnly ? 'disabled' : ''}`}
              onClick={() => handleQuickSelect(g)}
              whileHover={readOnly ? {} : { scale: 1.05 }}
              whileTap={readOnly ? {} : { scale: 0.95 }}
              disabled={readOnly}
            >
              {g}
            </motion.button>
          ))}
        </div>
      </div>

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
