import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAudio } from '../../hooks';
import './AnswerFeedback.css';

/**
 * Full-screen flash overlay when a player's answer is judged.
 * Green + checkmark for correct, Red + X for incorrect.
 * Auto-dismisses after 2 seconds.
 */
export default function AnswerFeedback({ result, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const audio = useAudio();

  // The parent passes a fresh inline callback every render; holding it in a ref
  // keeps the dismissal timer tied to `result` alone instead of restarting on
  // every parent re-render.
  const latest = useRef({ onDismiss, audio });
  latest.current = { onDismiss, audio };

  useEffect(() => {
    if (result == null) return;

    setVisible(true);

    if (result) {
      latest.current.audio.playCorrect();
    } else {
      latest.current.audio.playWrong();
    }

    // Auto-dismiss after 2 seconds
    const timer = setTimeout(() => {
      setVisible(false);
      latest.current.onDismiss?.();
    }, 2000);

    return () => clearTimeout(timer);
  }, [result]);

  return (
    <AnimatePresence>
      {visible && result != null && (
        <motion.div
          className={`answer-feedback ${result ? 'feedback-correct' : 'feedback-incorrect'}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="feedback-icon"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.05 }}
          >
            {result ? '\u2713' : '\u2717'}
          </motion.div>
          <motion.div
            className="feedback-text"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            {result ? 'Correct!' : 'Incorrect'}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
