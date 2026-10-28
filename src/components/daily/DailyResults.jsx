import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useDailyStore } from '../../stores/dailyStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUserStore } from '../../stores/userStore';
import { getSixerStats, postSixerResult } from '../../services/api/sixerStatsService';
import SixerCurve from './SixerCurve';
import ClueLog from './ClueLog';
import { boardGridRows, decodeAnswers,
  sixerEarned,
  sixerScore,
  sixerTop,
  sixerMarks,
  betterThan,
  answerMark,
  liveStreak,
  toDateString,
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

const MARK_SIGN = { correct: '\u2713', hinted: '\u2713', wrong: '\u2717', passed: '\u2014', unplayed: '' };

/* Both dailies turn over at midnight UTC, because that is the boundary the
   board itself is chosen on. Said in the reader's own clock, it is something
   they can act on; "come back tomorrow" is not. */
const nextRollover = () => {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(next);
};
const MARK_WORD = { correct: 'Correct', hinted: 'Correct with the hint', wrong: 'Wrong', passed: 'Passed', unplayed: 'Unplayed' };

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

  const { stats, shareResults, getShareText, markRecorded, ...store } = useDailyStore();
  const sessionId = useUserStore((s) => s.sessionId);
  const { date: todayDate, questions, answers } = store[slot];
  const formatStats = stats[format];
  const isArchive = slot === 'archiveRun';

  /* A shared link carries the sharer's typed answers. They are shown in the
     recap, under the player's own on each clue, rather than in a separate
     list behind a button nobody connected with the clues: this page is only
     reached once the player has played, so there is nothing left to spoil. */
  const theirAnswers = useMemo(() => {
    if (!verifyCode) return null;
    try {
      return decodeAnswers(verifyCode);
    } catch {
      return null;
    }
  }, [verifyCode]);

  // Transposed for the Board so each row is a value tier, as on the board
  // itself; a single row for the Sixer.
  const emojiRows = (() => {
    // Three states, not two: a passed clue is neither a hit nor a miss.
    const marks = answers.map(answerMark);
    if (format !== 'board') return [marks];
    return boardGridRows(marks) ?? [marks];
  })();

  /* How everyone did. Today's finished run is sent once, and the day's
     spread comes back with it; after that, or for an archive day, it is only
     read. Without the server the page is the same, minus the comparison. */
  const [day, setDay] = useState({ state: format === 'sixer' ? 'loading' : 'none', stats: null });
  useEffect(() => {
    if (format !== 'sixer' || !todayDate) return undefined;
    let live = true;
    const run = store[slot] ?? {};
    const send = !isArchive && run.isComplete && !run.recorded && sessionId;
    const asking = send
      ? postSixerResult({
        date: todayDate,
        player: sessionId,
        marks: sixerMarks(answers),
        values: questions.map((q) => q.value),
      }).then((r) => { markRecorded(slot); return r.stats; })
      : getSixerStats(todayDate);
    asking
      .then((dayStats) => { if (live) setDay({ state: 'ready', stats: dayStats }); })
      .catch(() => { if (live) setDay({ state: 'offline', stats: null }); });
    return () => { live = false; };
    // Once per run shown; the run's own changes are not a reason to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, slot, todayDate]);

  const won = sixerScore(answers, questions);
  const top = sixerTop(questions);
  /* The server's spread is the day's estimate blended with its real players,
     so there is always a curve to stand on. */
  const ready = day.state === 'ready';
  const estimated = Boolean(day.stats?.estimated);
  const standing = ready ? betterThan(day.stats, won) : null;
  const standingLine = (() => {
    if (day.state === 'loading') return 'Seeing how everyone did...';
    if (!ready || standing === null) return null;
    return `Better than ${standing}% of players`;
  })();

  const highContrast = useSettingsStore((s) => s.highContrast);
  const correctCount = answers.filter((a) => a.correct).length;
  const passedCount = answers.filter((a) => a.passed).length;
  const hintedCount = answers.filter((a) => a.correct && a.hinted).length;
  // Only the Board is timed.
  const run = store[slot] ?? {};
  const took = format === 'board' ? formatDuration(elapsedMs(run.timing)) : null;
  const totalQuestions = questions.length;
  const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  const shareOptions = { betterThan: standing, estimated };
  const handleShare = async () => {
    const success = await shareResults(slot, shareOptions);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Fallback: try to copy manually
      try {
        await navigator.clipboard.writeText(getShareText(slot, shareOptions));
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
      {format === 'sixer' ? (
        <div className="sixer-summary">
          <p className="sixer-summary-head">
            The Sixer <span aria-hidden="true">&middot;</span> {formatDisplayDate(todayDate)} <span aria-hidden="true">&middot;</span> Complete
          </p>
          {/* What was won, on its own: the day's total said nothing a player
              needed, and halved the size of the number they did. */}
          <div className="results-score">
            <span className="score-number">${won.toLocaleString()}</span>
          </div>
          <p className="score-percentage">
            {`${correctCount} of ${totalQuestions} right`}
            {hintedCount > 0 && `, ${hintedCount} with the hint`}
            {passedCount > 0 && `, ${passedCount} passed`}
          </p>
          {ready && <SixerCurve stats={day.stats} top={top} score={won} />}
          {standingLine && <p className="sixer-standing" role="status">{standingLine}</p>}
          <ClueLog questions={questions} answers={answers} stats={ready ? day.stats : null} theirAnswers={theirAnswers} />
        </div>
      ) : (
      <>
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
      </>
      )}

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

      {/* The Board keeps its stats and its review. The Sixer's climb above
          already is its review, and its page ends at the share. */}
      {format !== 'sixer' && (
      <>
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
            <span className="stat-value">{liveStreak(formatStats, toDateString())}</span>
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
                  {format === 'sixer' && answers[index]?.revealed && (
                    <p className="review-earned">
                      {mark === 'passed' ? 'Passed' : `+$${sixerEarned(answers[index], question.value).toLocaleString()}`}
                      {mark === 'hinted' && ' with the hint'}
                    </p>
                  )}
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
      </>
      )}

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
