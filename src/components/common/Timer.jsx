import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore, useGameStore } from '../../stores';
import './Timer.css';

export default function Timer({
  duration = null, // Override duration (ms), null = use settings
  onTimeUp,
  autoStart = true,
  showLabel = true,
  size = 'medium', // 'small' | 'medium' | 'large'
}) {
  const { questionTimeLimit } = useSettingsStore();
  const { setTimeRemaining, setTimerActive } = useGameStore();

  const effectiveDuration = duration ?? questionTimeLimit;
  const [timeLeft, setTimeLeft] = useState(effectiveDuration);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // No timer if unlimited
  if (effectiveDuration === null) {
    return null;
  }

  const totalSeconds = Math.ceil(effectiveDuration / 1000);
  const secondsLeft = Math.ceil(timeLeft / 1000);
  const progress = timeLeft / effectiveDuration;
  const isLow = secondsLeft <= 5;
  const isCritical = secondsLeft <= 3;

  // Start timer
  const start = useCallback(() => {
    setIsRunning(true);
    setIsPaused(false);
    setTimerActive(true);
  }, [setTimerActive]);

  // Pause timer
  const pause = useCallback(() => {
    setIsPaused(true);
    setTimerActive(false);
  }, [setTimerActive]);

  // Resume timer
  const resume = useCallback(() => {
    setIsPaused(false);
    setTimerActive(true);
  }, [setTimerActive]);

  // Reset timer
  const reset = useCallback(() => {
    setTimeLeft(effectiveDuration);
    setIsRunning(false);
    setIsPaused(false);
    setTimerActive(false);
    setTimeRemaining(effectiveDuration);
  }, [effectiveDuration, setTimerActive, setTimeRemaining]);

  // Auto-start if enabled
  useEffect(() => {
    if (autoStart && !isRunning) {
      start();
    }
  }, [autoStart, isRunning, start]);

  // Timer countdown logic
  useEffect(() => {
    if (!isRunning || isPaused) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        const newTime = prev - 100;
        setTimeRemaining(newTime);

        if (newTime <= 0) {
          clearInterval(interval);
          setIsRunning(false);
          setTimerActive(false);
          if (onTimeUp) {
            onTimeUp();
          }
          return 0;
        }
        return newTime;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isRunning, isPaused, onTimeUp, setTimeRemaining, setTimerActive]);

  // Format time display
  const formatTime = (ms) => {
    const seconds = Math.ceil(ms / 1000);
    return seconds.toString();
  };

  return (
    <div className={`timer timer-${size} ${isLow ? 'timer-low' : ''} ${isCritical ? 'timer-critical' : ''}`}>
      {/* Circular progress */}
      <svg className="timer-svg" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          className="timer-bg"
          cx="50"
          cy="50"
          r="45"
          fill="none"
          strokeWidth="8"
        />
        {/* Progress circle */}
        <motion.circle
          className="timer-progress"
          cx="50"
          cy="50"
          r="45"
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          initial={{ pathLength: 1 }}
          animate={{ pathLength: progress }}
          transition={{ duration: 0.1, ease: 'linear' }}
          style={{
            transformOrigin: 'center',
            transform: 'rotate(-90deg)',
          }}
        />
      </svg>

      {/* Time display */}
      <div className="timer-display">
        <motion.span
          className="timer-seconds"
          animate={isCritical ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 0.5, repeat: isCritical ? Infinity : 0 }}
        >
          {formatTime(timeLeft)}
        </motion.span>
        {showLabel && <span className="timer-label">seconds</span>}
      </div>
    </div>
  );
}
