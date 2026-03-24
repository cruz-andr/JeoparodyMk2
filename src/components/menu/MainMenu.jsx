import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import logo from '../../assets/images/JeoparodyTitle.png';
import SettingsModal from '../common/SettingsModal';
import { useDailyStore } from '../../stores/dailyStore';
import './MainMenu.css';

const gameModes = [
  {
    id: 'singleplayer',
    label: 'Single Player',
    description: 'Play solo against the board',
    path: '/singleplayer',
  },
  {
    id: 'multiplayer',
    label: 'Multiplayer',
    description: 'Create a private room',
    path: '/multiplayer',
  },
  {
    id: 'quickplay',
    label: 'Quickplay',
    description: 'Match with random players',
    path: '/quickplay',
  },
  {
    id: 'host',
    label: 'Host a Game',
    description: 'Educator & custom games',
    path: '/host',
  },
];

export default function MainMenu() {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const { hasPlayedToday, stats } = useDailyStore();
  const playedToday = hasPlayedToday();

  return (
    <div className="main-menu">
      {/* Logo */}
      <motion.img
        src={logo}
        alt="Jeoparody!"
        className="menu-logo"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Featured: Daily Challenge */}
      <motion.button
        className="daily-card"
        onClick={() => navigate('/daily')}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        whileHover="hover"
        whileTap={{ scale: 0.98 }}
      >
        <div className="daily-card-content">
          <motion.span
            className="star-icon gold"
            variants={{
              hover: { scale: 1.3, rotate: 25 },
            }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          />
          <div>
            <span className="daily-card-label">Daily Challenge</span>
            <span className="daily-card-desc">New puzzle every day</span>
          </div>
        </div>
        <div className="daily-card-meta">
          {stats.currentStreak > 0 && (
            <span className="streak-pill">{stats.currentStreak} day streak</span>
          )}
          <span className={`daily-status ${playedToday ? 'done' : 'new'}`}>
            {playedToday ? 'Completed' : 'Play Now'}
          </span>
        </div>
      </motion.button>

      {/* Game Mode Grid */}
      <div className="mode-grid">
        {gameModes.map((mode, i) => (
          <motion.button
            key={mode.id}
            className="mode-card"
            onClick={() => navigate(mode.path)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25 + i * 0.06 }}
            whileHover="hover"
            whileTap={{ scale: 0.98 }}
          >
            <motion.span
              className="star-icon"
              variants={{
                hover: { scale: 1.25, rotate: 20 },
              }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            />
            <span className="mode-label">{mode.label}</span>
            <span className="mode-desc">{mode.description}</span>
          </motion.button>
        ))}
      </div>

      {/* Footer */}
      <motion.div
        className="menu-footer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
      >
        <button className="footer-link" onClick={() => navigate('/highscores')}>
          Highscores
        </button>
        <button className="footer-link" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </motion.div>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
