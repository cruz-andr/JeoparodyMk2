import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDailyStore } from '../../stores/dailyStore';
import { boardGridRows, decodeAnswers,
  answerMark,
  elapsedMs,
  formatDuration,
} from '../../stores/dailyLogic';
import './DailyResults.css';

// Clues per run, used to turn a running total into an accuracy percentage.
const CLUES_PER_RUN = { board: 30, sixer: 6 };

export default function DailyResults({ onBackToMenu, verifyCode, format = 'sixer' }) {
  const [copied, setCopied] = useState(false);
  const [showTheirAnswers, setShowTheirAnswers] = useState(false);
  const [theirAnswers, setTheirAnswers] = useState(null);

  const { stats, shareResults, getShareText, ...store } = useDailyStore();
  const { date: todayDate, questions, answers } = store[format];
  const formatStats = stats[format];

  // Decode verification answers when user clicks to reveal
  const handleRevealTheirAnswers = () => {
    if (!verifyCode) return;
    try {
      const decoded = decodeAnswers(verifyCode);
      if (!decoded) return;
      setTheirAnswers(decoded);
      setShowTheirAnswers(true);
    } catch (e) {
      console.error('Failed to decode verification code:', e);
    }
  };

  // Transposed for the Board so each row is a value tier, as on the board
  // itself; a single row for the Sixer.
  const emojiRows = (() => {
    // Three states, not two: a passed clue is neither a hit nor a miss.
    const marks = answers.map(answerMark);
    if (format !== 'board') return [marks];
    return boardGridRows(marks) ?? [marks];
  })();

  const correctCount = answers.filter((a) => a.correct).length;
  const passedCount = answers.filter((a) => a.passed).length;
  // Only the Board is timed.
  const run = store[format] ?? {};
  const took = format === 'board' ? formatDuration(elapsedMs(run.timing)) : null;
  const totalQuestions = questions.length;
  const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  const handleShare = async () => {
    const success = await shareResults(format);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Fallback: try to copy manually
      try {
        await navigator.clipboard.writeText(getShareText(format));
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

      {/* Results grid. The Board is laid out the way the board reads, six
          categories across and five values down, matching the shared text.
          The Sixer stays a single row. */}
      <div className={`emoji-grid ${format === 'board' ? 'board' : ''}`}>
        {emojiRows.map((row, rowIndex) => (
          <div className="emoji-row" key={rowIndex}>
            {row.map((mark, colIndex) => {
              const n = rowIndex * row.length + colIndex;
              return (
                <motion.span
                  key={colIndex}
                  className={`emoji-block ${mark}`}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  // capped so a thirty cell board does not take three seconds
                  transition={{ delay: Math.min(n * 0.04, 0.8), type: 'spring' }}
                >
                  {mark === 'correct' ? '🟩' : mark === 'passed' ? '⬜' : '🟥'}
                </motion.span>
              );
            })}
          </div>
        ))}
      </div>

      {/* Score */}
      <div className="results-score">
        <span className="score-number">{correctCount}</span>
        <span className="score-divider">/</span>
        <span className="score-total">{totalQuestions}</span>
      </div>

      <p className="score-percentage">
        {percentage}% correct
        {passedCount > 0 && `, ${passedCount} passed`}
        {took && ` in ${took}`}
      </p>

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
            <span className="stat-value">{formatStats.gamesPlayed}</span>
            <span className="stat-label">Played</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">
              {formatStats.gamesPlayed > 0
                ? Math.round(
                    (formatStats.totalCorrect /
                      (formatStats.gamesPlayed * CLUES_PER_RUN[format])) * 100
                  )
                : 0}%
            </span>
            <span className="stat-label">Accuracy</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{formatStats.currentStreak}</span>
            <span className="stat-label">Streak</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{formatStats.maxStreak}</span>
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
