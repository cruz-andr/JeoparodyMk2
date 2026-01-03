import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAudio } from '../../hooks';
import { useSettingsStore } from '../../stores';
import logo from '../../assets/images/JeoparodyTitle.png';
import './SplashScreen.css';

export default function SplashScreen() {
  const navigate = useNavigate();
  const [isReady, setIsReady] = useState(false);
  const [showSkip, setShowSkip] = useState(false);
  const { playTheme, fadeOutTheme } = useAudio();
  const { musicEnabled } = useSettingsStore();
  const hasPlayedTheme = useRef(false);

  useEffect(() => {
    // Show skip hint after 1 second
    const skipTimer = setTimeout(() => setShowSkip(true), 1000);

    // Auto-navigate after 4 seconds
    const navTimer = setTimeout(() => {
      handleContinue();
    }, 4000);

    return () => {
      clearTimeout(skipTimer);
      clearTimeout(navTimer);
    };
  }, []);

  const handleContinue = () => {
    if (isReady) return;
    setIsReady(true);
    fadeOutTheme(500);
    setTimeout(() => navigate('/menu'), 500);
  };

  const handleInteraction = () => {
    // Play theme on first interaction (required for audio autoplay policies)
    if (musicEnabled && !hasPlayedTheme.current) {
      playTheme();
      hasPlayedTheme.current = true;
    }
    handleContinue();
  };

  return (
    <motion.div
      className="splash-screen"
      onClick={handleInteraction}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="splash-content"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          duration: 0.8,
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        <motion.img
          src={logo}
          alt="Jeoparody!"
          className="splash-logo"
          animate={{
            scale: [1, 1.02, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </motion.div>

      <AnimatePresence>
        {showSkip && (
          <motion.p
            className="skip-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            Click anywhere or wait to continue...
          </motion.p>
        )}
      </AnimatePresence>

      {/* Stars background effect */}
      <div className="stars-container">
        {[...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            className="star"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              opacity: [0.3, 1, 0.3],
              scale: [0.8, 1.2, 0.8],
            }}
            transition={{
              duration: 1 + Math.random() * 2,
              repeat: Infinity,
              delay: Math.random() * 2,
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
