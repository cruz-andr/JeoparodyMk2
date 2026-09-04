import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useDailyStore } from '../stores/dailyStore';
import { getOrFetchDailyChallenge } from '../services/api/jeopardyService';
import { checkAnswer } from '../services/answerChecker';
import { useAudio } from '../hooks';
import QuestionModal from '../components/game/QuestionModal';
import DailyResults from '../components/daily/DailyResults';
import { usePageTitle } from '../hooks/usePageTitle';
import './DailyPage.css';

const FORMAT = 'sixer';

export default function DailyPage() {
  usePageTitle('The Sixer');
  const navigate = useNavigate();
  const { playCorrect, playWrong } = useAudio();
  // Null while the player is still typing; set once the answer has been graded.
  const [result, setResult] = useState(null);
  /* Which clue is up, pinned rather than read back from the run. Grading a clue
     marks it revealed, so a screen that asked "which one is unplayed?" would
     swap to the next clue the instant an answer landed, and show what you typed
     against the following clue's response. */
  const [openIndex, setOpenIndex] = useState(null);
  const [verifyCode, setVerifyCode] = useState(null);

  // Parse verification code from URL (for viewing sharer's answers)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('verify');
    if (code) setVerifyCode(code);
  }, []);

  const {
    sixer,
    isLoading,
    error,
    stats,
    hasPlayedToday,
    isNewDay,
    setLoading,
    setError,
    setDailyChallenge,
    setUserAnswer,
    revealAnswer,
    overrideAnswer,
    passQuestion,
    nextQuestion,
    completeGame,
  } = useDailyStore();

  const { date: todayDate, questions, answers, isComplete } = sixer;
  const formatStats = stats[FORMAT];
  const alreadyPlayed = hasPlayedToday(FORMAT);

  // Format today's date for display
  const formatDisplayDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Load daily challenge on mount
  useEffect(() => {
    const loadChallenge = async () => {
      // `error` is shared by both daily pages and outlives a route change, so
      // a failure on The Board would otherwise strand this screen on "Oops!".
      setError(null);

      // If already played today, show results
      if (hasPlayedToday(FORMAT)) {
        setLoading(false);
        return;
      }

      // If new day or no data, fetch fresh
      if (isNewDay(FORMAT) || questions.length === 0) {
        setLoading(true);
        try {
          const challenge = await getOrFetchDailyChallenge();
          setDailyChallenge(FORMAT, challenge.sixer);
        } catch (err) {
          console.error('Failed to load daily challenge:', err);
          setError('Failed to load today\'s challenge. Please try again.');
        }
      }
    };

    loadChallenge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The clue the player is on, taken from what has actually been played rather
     than from the stored cursor. A reload between grading a clue and closing it
     would otherwise land on a clue that is both current and already answered.
     -1 once all six are done. */
  const activeIndex = useMemo(
    () => answers.findIndex((a) => !a?.revealed),
    [answers]
  );

  const playable = !alreadyPlayed && !isComplete && questions.length > 0;

  /* Six clues in a fixed order is a run, not a menu, so there is nothing to
     pick from: the first clue comes up on its own, and Continue hands the index
     to the next one. This only fires at the start of a run or after a reload. */
  useEffect(() => {
    if (!playable || openIndex !== null || activeIndex === -1) return;
    setOpenIndex(activeIndex);
    setResult(null);
  }, [playable, openIndex, activeIndex]);

  /* Every clue used but the run never closed, which a reload on the last one
     used to leave stranded. Not while a clue is up: that is the ordinary
     moment between answering the sixth and reading it. */
  useEffect(() => {
    if (!playable || openIndex !== null) return;
    if (!answers.length || activeIndex !== -1) return;
    completeGame(FORMAT);
  }, [playable, openIndex, answers, activeIndex, completeGame]);

  const openQuestion = useMemo(() => {
    if (openIndex === null) return null;
    const q = questions[openIndex];
    if (!q) return null;
    /* The Sixer's clue shape is the scraper's and the clue screen expects the
       board's, which names the two halves the other way round: `answer` is the
       clue that gets read out and `question` is the correct response. */
    return { ...q, answer: q.clue, question: q.answer };
  }, [openIndex, questions]);

  const submitAnswer = useCallback(
    (given) => {
      if (openIndex === null) return;
      const q = questions[openIndex];
      if (!q) return;
      setUserAnswer(FORMAT, openIndex, given);
      const { isCorrect } = checkAnswer(given, q.answer);
      revealAnswer(FORMAT, openIndex, isCorrect, given);
      setResult({ correct: isCorrect, playerAnswer: given });
      if (isCorrect) playCorrect();
      else playWrong();
    },
    [openIndex, questions, setUserAnswer, revealAnswer, playCorrect, playWrong]
  );

  // Fuzzy matching gets things wrong, so the player has the last word.
  const override = useCallback(() => {
    if (openIndex === null) return;
    overrideAnswer(FORMAT, openIndex);
    setResult((r) => (r ? { ...r, correct: true } : r));
    playCorrect();
  }, [openIndex, overrideAnswer, playCorrect]);

  /* A pass uses the clue up and scores nothing, as on The Board. Giving up
     still shows the response, because the point of passing is that you did not
     know it. Continue moves on, not this, so passing the sixth cannot end the
     run before you have read the answer. */
  const passClue = useCallback(() => {
    if (openIndex === null) return;
    passQuestion(FORMAT, openIndex);
    setResult({ correct: false, passed: true, playerAnswer: '' });
  }, [openIndex, passQuestion]);

  /* Closing the clue is what moves the run on, not grading it: advancing at
     submit would swap the clue for the next one while the player is still
     reading the answer they got wrong. Letting go of the index hands the next
     clue to the effect above. */
  const continueOn = useCallback(() => {
    setResult(null);
    // Keep the stored cursor walking alongside the clues it counts.
    nextQuestion(FORMAT);
    const settled = useDailyStore.getState()[FORMAT].answers;
    const next = settled.findIndex((a) => !a?.revealed);
    if (next === -1) {
      setOpenIndex(null);
      completeGame(FORMAT);
      return;
    }
    /* Straight to the next clue rather than back through null: releasing the
       index unmounts the clue screen and mounts it again, so every Continue
       played a fade out, a fade in and a spring before the next clue arrived. */
    setOpenIndex(next);
  }, [nextQuestion, completeGame]);

  const handleBackToMenu = () => {
    navigate('/menu');
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="daily-page">
        <div className="daily-loading">
          <div className="spinner" />
          <p>Loading today's challenge...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="daily-page">
        <div className="daily-error">
          <h2>Oops!</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="btn-primary">
            Try Again
          </button>
          <button onClick={handleBackToMenu} className="btn-secondary">
            Back to Menu
          </button>
        </div>
      </div>
    );
  }

  // Already played today - show results
  if (alreadyPlayed || isComplete) {
    return (
      <div className="daily-page">
        <DailyResults onBackToMenu={handleBackToMenu} verifyCode={verifyCode} format={FORMAT} />
      </div>
    );
  }

  // No questions loaded yet, or a run short of its clues
  if (!questions.length) {
    return (
      <div className="daily-page">
        <div className="daily-loading">
          <div className="spinner" />
          <p>Preparing questions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="daily-page daily-sixer-page">
      {/* The clue fills the screen, so this rides above it: without it there is
          no way out of a run until the sixth clue is answered. */}
      <header className="daily-header">
        <button onClick={handleBackToMenu} className="btn-back">
          &larr; Menu
        </button>
        <div className="daily-title">
          <h1>The Sixer</h1>
          <p className="daily-date">{formatDisplayDate(todayDate)}</p>
        </div>
        <div className="daily-stats-mini">
          {formatStats.currentStreak > 0 && (
            <span className="streak-badge" title="Current streak">
              {formatStats.currentStreak} day streak
            </span>
          )}
        </div>
      </header>

      {/* Where you are in the six, without keeping score. */}
      <ol className="sixer-pips" aria-label={`Clue ${(openIndex ?? activeIndex) + 1} of ${questions.length}`}>
        {questions.map((_, i) => (
          <li
            key={i}
            className={`sixer-pip ${answers[i]?.revealed ? 'played' : ''} ${i === (openIndex ?? activeIndex) ? 'current' : ''}`}
          />
        ))}
      </ol>

      <AnimatePresence>
        {openQuestion && (
          <QuestionModal
            question={openQuestion}
            points={openQuestion.value ?? 200}
            typed
            result={result}
            onSubmitAnswer={submitAnswer}
            onOverride={override}
            onContinue={continueOn}
            closeLabel="Pass"
            onClose={passClue}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
