import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import logo from '../../assets/images/JeoparodyTitle.png';
import SettingsModal from '../common/SettingsModal';
import { useDailyStore } from '../../stores/dailyStore';
import './MainMenu.css';

const menuItems = [
  {
    id: 'daily',
    label: 'Daily Challenge',
    description: 'New puzzle every day!',
    path: '/daily',
    icon: '📅',
    featured: true,
  },
  {
    id: 'quickplay',
    label: 'Quickplay',
    description: 'Match with 2 random players',
    path: '/quickplay',
    icon: '🎲',
  },
  {
    id: 'singleplayer',
    label: 'Single Player',
    description: 'Play solo with highscores',
    path: '/singleplayer',
    icon: '🎯',
  },
  {
    id: 'multiplayer',
    label: 'Multiplayer',
    description: 'Create a private room',
    path: '/multiplayer',
    icon: '👥',
  },
  {
    id: 'host',
    label: 'Host',
    description: 'Educator mode - custom games',
    path: '/host',
    icon: '🎓',
  },
  {
    id: 'join',
    label: 'Join Room',
    description: 'Enter a room code',
    path: '/join',
    icon: '🚪',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.3,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: 'easeOut',
    },
  },
};

export default function MainMenu() {
  const navigate = useNavigate();
  const [hoveredItem, setHoveredItem] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const { hasPlayedToday, stats } = useDailyStore();
  const playedToday = hasPlayedToday();

  return (
    <div className="main-menu">
      {/* Logo */}
      <motion.div
        className="menu-logo-container"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <img src={logo} alt="Jeoparody!" className="menu-logo" />
      </motion.div>

      {/* Menu Items */}
      <motion.nav
        className="menu-nav"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {menuItems.map((item) => (
          <motion.button
            key={item.id}
            className={`menu-item ${hoveredItem === item.id ? 'hovered' : ''} ${item.featured ? 'featured' : ''}`}
            variants={itemVariants}
            onClick={() => navigate(item.path)}
            onMouseEnter={() => setHoveredItem(item.id)}
            onMouseLeave={() => setHoveredItem(null)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="menu-icon">{item.icon}</span>
            <div className="menu-text">
              <span className="menu-label">{item.label}</span>
              <span className="menu-description">{item.description}</span>
            </div>
            {item.id === 'daily' && (
              <span className={`daily-badge ${playedToday ? 'completed' : 'new'}`}>
                {playedToday ? '✓' : 'NEW'}
              </span>
            )}
            {item.id === 'daily' && stats.currentStreak > 0 && (
              <span className="streak-indicator" title={`${stats.currentStreak} day streak`}>
                {stats.currentStreak}
              </span>
            )}
          </motion.button>
        ))}
      </motion.nav>

      {/* Footer Links */}
      <motion.div
        className="menu-footer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        <button
          className="footer-link"
          onClick={() => navigate('/highscores')}
        >
          Highscores
        </button>
        <span className="footer-divider">|</span>
        <button
          className="footer-link"
          onClick={() => setShowSettings(true)}
        >
          Settings
        </button>
      </motion.div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
