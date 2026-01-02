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

export default function GenreSelector({ onSubmit, error }) {
  const [genre, setGenre] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (genre.trim()) {
      onSubmit(genre.trim());
    }
  };

  const handleQuickSelect = (selectedGenre) => {
    setGenre(selectedGenre);
    onSubmit(selectedGenre);
  };

  return (
    <motion.div
      className="genre-selector"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <h2>Choose a Genre</h2>
      <p className="genre-subtitle">
        Enter any topic and AI will generate categories and questions
      </p>

      <form onSubmit={handleSubmit} className="genre-form">
        <input
          type="text"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="Enter a genre (e.g., Space, 90s Pop Culture, World War II)"
          className="genre-input"
          autoFocus
        />
        <button
          type="submit"
          disabled={!genre.trim()}
          className="btn-primary"
        >
          Generate Categories
        </button>
      </form>

      <div className="quick-genres">
        <p className="quick-label">Quick Select:</p>
        <div className="genre-chips">
          {popularGenres.map((g) => (
            <motion.button
              key={g}
              className="genre-chip"
              onClick={() => handleQuickSelect(g)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
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
