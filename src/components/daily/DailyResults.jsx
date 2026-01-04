import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDailyStore } from '../../stores/dailyStore';
import './DailyResults.css';

export default function DailyResults({ onBackToMenu, verifyCode }) {
  const [copied, setCopied] = useState(false);
  const [showTheirAnswers, setShowTheirAnswers] = useState(false);
  const [theirAnswers, setTheirAnswers] = useState(null);

  const {
    todayDate,
    questions,
    answers,
    stats,
    shareResults,
    getShareText,
  } = useDailyStore();

  // Decode verification answers when user clicks to reveal
  const handleRevealTheirAnswers = () => {
    if (!verifyCode) return;
    try {
      const decoded = JSON.parse(atob(verifyCode));
      setTheirAnswers(decoded);
      setShowTheirAnswers(true);
    } catch (e) {
      console.error('Failed to decode verification code:', e);
    }
  };

  const correctCount = answers.filter((a) => a.correct).length;
  const totalQuestions = questions.length;
  const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  const handleShare = async () => {
    const success = await shareResults();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Fallback: try to copy manually
      try {
        await navigator.clipboard.writeText(getShareText());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        alert('Unable to copy to clipboard');
      }
    }
  };

  // Format date for display
  const formatDisplayDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <motion.div
      className="daily-results"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <h2>Today's Results</h2>
      <p className="results-date">{formatDisplayDate(todayDate)}</p>

      {/* Emoji Grid */}
      <div className="emoji-grid">
        {answers.map((answer, index) => (
          <motion.span
            key={index}
            className={`emoji-block ${answer.correct ? 'correct' : 'incorrect'}`}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.1, type: 'spring' }}
          >
            {answer.correct ? '🟩' : '🟥'}
          </motion.span>
        ))}
      </div>

      {/* Score */}
      <div className="results-score">
        <span className="score-number">{correctCount}</span>
        <span className="score-divider">/</span>
        <span className="score-total">{totalQuestions}</span>
      </div>

      <p className="score-percentage">{percentage}% correct</p>

      {/* Share Button */}
      <button
        className={`btn-share ${copied ? 'copied' : ''}`}
        onClick={handleShare}
      >
        {copied ? 'Copied!' : 'Share Results'}
      </button>

      {/* View Their Answers (if verification code present) */}
      {verifyCode && !showTheirAnswers && (
        <button
          className="btn-verify"
          onClick={handleRevealTheirAnswers}
        >
          View Their Answers
        </button>
      )}

      {/* Their Answers Revealed */}
      {showTheirAnswers && theirAnswers && (
        <div className="their-answers-section">
          <h3>Their Answers</h3>
          <div className="their-answers-list">
            {theirAnswers.map((answer, index) => (
              <div key={index} className="their-answer-item">
                <span className="their-answer-num">{index + 1}.</span>
                <span className="their-answer-text">{answer || '(skipped)'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats Section */}
      <div className="stats-section">
        <h3>Your Stats</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-value">{stats.gamesPlayed}</span>
            <span className="stat-label">Played</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">
              {stats.gamesPlayed > 0
                ? Math.round((stats.totalCorrect / (stats.gamesPlayed * 6)) * 100)
                : 0}%
            </span>
            <span className="stat-label">Accuracy</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.currentStreak}</span>
            <span className="stat-label">Streak</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.maxStreak}</span>
            <span className="stat-label">Max Streak</span>
          </div>
        </div>
      </div>

      {/* Questions Review */}
      <div className="review-section">
        <h3>Review</h3>
        <div className="review-list">
          {questions.map((question, index) => (
            <div
              key={index}
              className={`review-item ${answers[index]?.correct ? 'correct' : 'incorrect'}`}
            >
              <div className="review-header">
                <span className="review-category">{question.category || 'CATEGORY'}</span>
                <span className={`review-result ${answers[index]?.correct ? 'correct' : 'incorrect'}`}>
                  {answers[index]?.correct ? '✓' : '✗'}
                </span>
              </div>
              <p className="review-clue">{question.clue || ''}</p>
              <p className="review-answer">
                <strong>Answer:</strong> {question.answer || ''}
              </p>
              {answers[index]?.playerAnswer && !answers[index]?.correct && (
                <p className="review-your-answer">
                  <strong>You said:</strong> {answers[index].playerAnswer}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Back to Menu */}
      <div className="results-actions">
        <button onClick={onBackToMenu} className="btn-secondary">
          Back to Menu
        </button>
        <p className="comeback-text">Come back tomorrow for a new challenge!</p>
      </div>
    </motion.div>
  );
}
