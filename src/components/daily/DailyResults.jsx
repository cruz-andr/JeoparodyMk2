import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDailyStore } from '../../stores/dailyStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { boardGridRows, decodeAnswers,
  answerMark,
  elapsedMs,
  formatDuration,
} from '../../stores/dailyLogic';
import './DailyResults.css';

// Clues per run, used to turn a running total into an accuracy percentage.
const CLUES_PER_RUN = { board: 30, sixer: 6 };

/* The two formats name the halves of a clue the other way round: the Board
   carries the scraper's shape, where `answer` is what gets read out and
   `question` is the correct response. Reading the Sixer's names off a Board
   clue leaves the clue blank and prints the clue where the answer belongs. */
const clueText = (q, format) => (format === 'board' ? q?.answer : q?.clue) || '';
const responseText = (q, format) => (format === 'board' ? q?.question : q?.answer) || '';

const MARK_SIGN = { correct: '\u2713', wrong: '\u2717', passed: '\u2014', unplayed: '' };

/* Both dailies turn over at midnight UTC, because that is the boundary the
   board itself is chosen on. Said in the reader's own clock, it is something
   they can act on; "come back tomorrow" is not. */
const nextRollover = () => {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(next);
};
const MARK_WORD = { correct: 'Correct', wrong: 'Wrong', passed: 'Passed', unplayed: 'Unplayed' };

/**
 * `slot` is where the run lives and `format` is which daily it is. They are
 * the same thing for today's board; an archive day is played in its own slot
 * while still being a Sixer or a Board, which decides the clue shape, the grid
 * and the label.
 */
export default function DailyResults({
  onBackToMenu,
  verifyCode,
  format = 'sixer',
  slot = format,
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showTheirAnswers, setShowTheirAnswers] = useState(false);
  const [theirAnswers, setTheirAnswers] = useState(null);

  const { stats, shareResults, getShareText, ...store } = useDailyStore();
  const { date: todayDate, questions, answers } = store[slot];
  const formatStats = stats[format];
  const isArchive = slot === 'archiveRun';

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

  const highContrast = useSettingsStore((s) => s.highContrast);
  const correctCount = answers.filter((a) => a.correct).length;
  const passedCount = answers.filter((a) => a.passed).length;
  // Only the Board is timed.
  const run = store[slot] ?? {};
  const took = format === 'board' ? formatDuration(elapsedMs(run.timing)) : null;
  const totalQuestions = questions.length;
  const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  const handleShare = async () => {
    const success = await shareResults(slot);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Fallback: try to copy manually
      try {
        await navigator.clipboard.writeText(getShareText(slot));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setCopyFailed(true);
      }
    }
  };

  // Format date for display
  const formatDisplayDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  return (
    <motion.div
      className="daily-results"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <h2>Today’s Results</h2>
      <p className="results-date">{formatDisplayDate(todayDate)}</p>

      {/* Results grid. The Board is laid out the way the board reads, six
          categories across and five values down, matching the shared text.
          The Sixer stays a single row. */}
      <div
        className={`emoji-grid ${format === 'board' ? 'board' : ''} ${highContrast ? 'high-contrast' : ''}`}
        role="img"
        aria-label={`${correctCount} of ${totalQuestions} correct${passedCount > 0 ? `, ${passedCount} passed` : ''}`}
      >
        {emojiRows.map((row, rowIndex) => (
          <div className="emoji-row" key={rowIndex}>
            {row.map((mark, colIndex) => {
              const n = rowIndex * row.length + colIndex;
              return (
                <motion.span
                  key={colIndex}
                  className={`result-mark ${mark}`}
                  title={MARK_WORD[mark]}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  // capped so a thirty cell board does not take three seconds
                  transition={{ delay: Math.min(n * 0.04, 0.8), type: 'spring' }}
                />
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

      {copyFailed && (
        <p className="share-failed" role="status">
          Your browser blocked the copy. Select the text of this page to share it
          by hand.
        </p>
      )}

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

      {/* Stats Section. An archive day is recorded but never counted, so the
          streak beside it would be answering a question nobody asked. */}
      <div className="stats-section">
        <h3>{isArchive ? 'Your Stats (unchanged)' : 'Your Stats'}</h3>
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
          {questions.map((question, index) => {
            const mark = answerMark(answers[index]);
            return (
              <div key={index} className={`review-item ${mark}`}>
                <span className={`review-mark ${mark}`} title={MARK_WORD[mark]}>
                  {MARK_SIGN[mark]}
                </span>
                <div className="review-body">
                  <span className="review-category">{question.category || 'Category'}</span>
                  <p className="review-clue">{clueText(question, format)}</p>
                  <p className="review-answer">{responseText(question, format)}</p>
                  {answers[index]?.playerAnswer && mark === 'wrong' && (
                    <p className="review-your-answer">
                      <span>You said</span> {answers[index].playerAnswer}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Back to Menu */}
      <div className="results-actions">
        <button onClick={onBackToMenu} className="btn-back-to-menu">
          Back to Menu
        </button>
        <p className="comeback-text">
          {isArchive
            ? 'An archive day does not touch your streak.'
            : `${format === 'board' ? 'Next board' : 'Next six'} at ${nextRollover()}`}
        </p>
      </div>
    </motion.div>
  );
}
