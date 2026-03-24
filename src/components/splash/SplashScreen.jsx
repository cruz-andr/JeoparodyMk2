import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAudio } from '../../hooks';
import { useSettingsStore } from '../../stores';
import logo from '../../assets/images/JeoparodyTitle.png';
import './SplashScreen.css';

export default function SplashScreen() {
  const navigate = useNavigate();
  const [isReady, setIsReady] = useState(false);
  const { playTheme, fadeOutTheme } = useAudio();
  const { musicEnabled } = useSettingsStore();
  const hasPlayedTheme = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => handleContinue(), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleContinue = () => {
    if (isReady) return;
    setIsReady(true);
    fadeOutTheme(400);
    setTimeout(() => navigate('/menu'), 400);
  };

  const handleInteraction = () => {
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
      transition={{ duration: 0.4 }}
    >
      <div className="splash-glow" />
      <motion.img
        src={logo}
        alt="Jeoparody!"
        className="splash-logo"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.div>
  );
}
