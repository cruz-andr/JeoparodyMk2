import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useDailyStore } from '../stores/dailyStore';
import { useGameRecord } from '../hooks/useGameRecord';
import { describeGame, deviceOnlyNote, modeLabel, money, whenPlayed } from '../utils/gameRecord';
import './HighscoresPage.css';
import AppTabBar from '../components/common/AppTabBar';
import { usePageTitle } from '../hooks/usePageTitle';

export default function HighscoresPage() {
  usePageTitle('Highscores');
  const navigate = useNavigate();
  /* The same record the profile shows: the archive when signed in, this
     device's own when not. See hooks/useGameRecord.js. */
  const { record, source, deviceOnly, loading } = useGameRecord({ limit: 10 });
  // The all-time board best lives here rather than on the menu: the menu's job
  // is a target you can beat today, this is the record.
  const dailyStats = useDailyStore((s) => s.stats);

  return (
    <div className="highscores-page">
      <motion.div
        className="highscores-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1>Highscores</h1>

        {/* Stats Overview */}
        <div className="stats-overview" aria-busy={loading}>
          <div className="stat-card">
            <span className="stat-value">{record.stats.gamesPlayed}</span>
            <span className="stat-label">Games Played</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{money(record.stats.bestScore)}</span>
            <span className="stat-label">Best Score</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">
              {dailyStats.board.bestScore === null
                ? 'None yet'
                : `${dailyStats.board.bestScore < 0 ? '-' : ''}$${Math.abs(dailyStats.board.bestScore).toLocaleString()}`}
            </span>
            <span className="stat-label">Best Board, All Time</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{record.stats.accuracy}%</span>
            <span className="stat-label">Accuracy</span>
          </div>
        </div>

        {/* Recent games */}
        <div className="highscores-list">
          <h2>Recent Games</h2>
          {record.games.length > 0 ? (
            <table className="scores-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Mode</th>
                  <th>Score</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {record.games.slice(0, 10).map((entry, index) => (
                  <motion.tr
                    key={entry.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <td className="genre">{describeGame(entry)}</td>
                    <td className="date">{modeLabel(entry.mode)}</td>
                    <td className={`score ${entry.score >= 0 ? 'positive' : 'negative'}`}>
                      {money(entry.score)}
                    </td>
                    <td className="date">{whenPlayed(entry.playedAt)}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="no-scores">
              {loading ? 'Looking up your games.' : 'No games yet. Play a game to set your first score.'}
            </p>
          )}
          {source === 'local' && !loading && (
            <p className="scores-note">Kept on this device. Sign in to keep your record with your account.</p>
          )}
          {source === 'account' && deviceOnly > 0 && (
            <p className="scores-note">{deviceOnlyNote(deviceOnly)}</p>
          )}
        </div>

        <button onClick={() => navigate('/menu')} className="btn-primary highscores-back">
          Back to Menu
        </button>
      </motion.div>

      <AppTabBar />
    </div>
  );
}
