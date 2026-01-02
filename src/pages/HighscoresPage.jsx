import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../stores';
import './HighscoresPage.css';

export default function HighscoresPage() {
  const navigate = useNavigate();
  const { localHighscores, stats } = useUserStore();

  return (
    <div className="highscores-page">
      <motion.div
        className="highscores-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1>Highscores</h1>

        {/* Stats Overview */}
        <div className="stats-overview">
          <div className="stat-card">
            <span className="stat-value">{stats.gamesPlayed}</span>
            <span className="stat-label">Games Played</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">${stats.highestScore.toLocaleString()}</span>
            <span className="stat-label">Best Score</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">
              {stats.totalAnswers > 0
                ? Math.round((stats.correctAnswers / stats.totalAnswers) * 100)
                : 0}%
            </span>
            <span className="stat-label">Accuracy</span>
          </div>
        </div>

        {/* Highscores List */}
        <div className="highscores-list">
          <h2>Recent Scores</h2>
          {localHighscores.length > 0 ? (
            <table className="scores-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Score</th>
                  <th>Genre</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {localHighscores.slice(0, 10).map((entry, index) => (
                  <motion.tr
                    key={entry.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <td className="rank">#{index + 1}</td>
                    <td className={`score ${entry.score >= 0 ? 'positive' : 'negative'}`}>
                      ${entry.score.toLocaleString()}
                    </td>
                    <td className="genre">{entry.genre}</td>
                    <td className="date">
                      {new Date(entry.date).toLocaleDateString()}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="no-scores">No scores yet. Play a game to set your first highscore!</p>
          )}
        </div>

        <button onClick={() => navigate('/menu')} className="btn-primary">
          Back to Menu
        </button>
      </motion.div>
    </div>
  );
}
