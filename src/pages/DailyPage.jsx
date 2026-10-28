import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useDailyStore } from '../stores/dailyStore';
import { useUserStore } from '../stores';
import { canPlayDate, toDateString } from '@shared/archiveWindow.js';
import { answerHint, isArchiveRunFor, liveStreak, sixerEarned, sixerScore } from '../stores/dailyLogic';
import { getChallengeForDate, getOrFetchDailyChallenge } from '../services/api/jeopardyService';
import { checkAnswer } from '../services/answerChecker';
import { useAudio } from '../hooks';
import QuestionModal from '../components/game/QuestionModal';
import DailyResults from '../components/daily/DailyResults';
import { usePageTitle } from '../hooks/usePageTitle';
import './DailyPage.css';

const FORMAT = 'sixer';

/* The Sixer climbs through the week, and a player should know which day of
   the climb they are on before the first clue. Monday first. */
const WEEK_NOTE = [
  'The gentlest Sixer of the week',
  'A little harder than Monday',
  'Midweek, halfway up',
  'Getting harder',
  'Nearly the hardest of the week',
  'A hard one',
  'The hardest Sixer of the week',
];
const weekNote = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : WEEK_NOTE[(d.getUTCDay() + 6) % 7];
};

export default function DailyPage() {
  usePageTitle('The Sixer');
  const navigate = useNavigate();

  /* `?date=` opens a day from the archive. Today's own date is not archive, so
     a link carrying it plays the ordinary run rather than a second copy of it
     in the archive slot. */
  const [params] = useSearchParams();
  const requestedDate = params.get('date');
  const archiveDate =
    requestedDate && requestedDate !== toDateString() ? requestedDate : null;
  /* Where the run lives. An archive day gets its own slot so a Sixer in
     progress today is still there when the player comes back to it. */
  const SLOT = archiveDate ? 'archiveRun' : FORMAT;
  const { playCorrect, playWrong } = useAudio();
  // Null while the player is still typing; set once the answer has been graded.
  const [result, setResult] = useState(null);
  /* Which clue is up, pinned rather than read back from the run. Grading a clue
     marks it revealed, so a screen that asked "which one is unplayed?" would
     swap to the next clue the instant an answer landed, and show what you typed
     against the following clue's response. */
  const [openIndex, setOpenIndex] = useState(null);
  const [verifyCode, setVerifyCode] = useState(null);
  /* A close answer gets one free retype per try, said in this note. */
  const [note, setNote] = useState(null);
  const [closeUsed, setCloseUsed] = useState(false);

  // Parse verification code from URL (for viewing sharer's answers)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('verify');
    if (code) setVerifyCode(code);
  }, []);

  const isAuthenticated = useUserStore((s) => s.isAuthenticated);

  const {
    sixer,
    archiveRun,
    startArchiveRun,
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
    showHint,
    passQuestion,
    nextQuestion,
    completeGame,
  } = useDailyStore();

  const run = archiveDate ? archiveRun : sixer;
  const { date: todayDate, questions, answers, isComplete } = run;
  const formatStats = stats[FORMAT];
  /* An archive day is always replayable: nothing is at stake on it, and the
     "come back tomorrow" that guards today's run would be a lie about a day
     that has already been and gone. */
  const alreadyPlayed = archiveDate ? false : hasPlayedToday(FORMAT);

  /* Formatted for whoever is reading it. A hardcoded 'en-US' prints an
     American date to someone whose browser asked for anything else; passing no
     locale lets Intl use theirs. */
  const formatDisplayDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  };

  // Load daily challenge on mount
  useEffect(() => {
    const loadChallenge = async () => {
      // `error` is shared by both daily pages and outlives a route change, so
      // a failure on The Board would otherwise strand this screen on "Oops!".
      setError(null);

      if (archiveDate) {
        /* The gate is checked here as well as on the way in, because this is
           the URL: a locked day is one typed address away otherwise. The API
           enforces the window itself, but not who is asking. */
        if (!canPlayDate({ date: archiveDate, format: FORMAT, isAuthenticated })) {
          setLoading(false);
          setError('That day is locked. Sign in to play the whole archive.');
          return;
        }

        // Already open on this very day, part way through: leave it alone.
        // The slot is shared with the other daily, so its format is checked too.
        if (isArchiveRunFor(archiveRun, { date: archiveDate, format: FORMAT })) {
          setLoading(false);
          return;
        }

        setLoading(true);
        try {
          const challenge = await getChallengeForDate(archiveDate);
          startArchiveRun(FORMAT, { date: archiveDate, ...challenge.sixer });
        } catch (err) {
          console.error('Failed to load that day:', err);
          setError(err.message || 'Failed to load that day. Please try again.');
        }
        return;
      }

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
    setNote(null);
    setCloseUsed(false);
  }, [playable, openIndex, activeIndex]);

  /* Every clue used but the run never closed, which a reload on the last one
     used to leave stranded. Not while a clue is up: that is the ordinary
     moment between answering the sixth and reading it. */
  useEffect(() => {
    if (!playable || openIndex !== null) return;
    if (!answers.length || activeIndex !== -1) return;
    completeGame(SLOT, { score: sixerScore(answers, questions) });
  }, [playable, openIndex, answers, activeIndex, completeGame, SLOT, questions]);

  const openQuestion = useMemo(() => {
    if (openIndex === null) return null;
    const q = questions[openIndex];
    if (!q) return null;
    /* The Sixer's clue shape is the scraper's and the clue screen expects the
       board's, which names the two halves the other way round: `answer` is the
       clue that gets read out and `question` is the correct response. */
    return { ...q, answer: q.clue, question: q.answer };
  }, [openIndex, questions]);

  /* Whether the clue up has had its hint: a miss brings it up, and from then
     on the clue pays half. Read from the run, so a reload keeps it. */
  const hinted = openIndex !== null && Boolean(answers[openIndex]?.hinted);

  /* The answer is settled: right, or wrong after the hint. */
  const settle = useCallback(
    (correct, given, withHint) => {
      setUserAnswer(SLOT, openIndex, given);
      revealAnswer(SLOT, openIndex, correct, given, withHint);
      setResult({ correct, hinted: withHint, playerAnswer: given });
      setNote(null);
      if (correct) playCorrect();
      else playWrong();
    },
    [openIndex, setUserAnswer, revealAnswer, playCorrect, playWrong, SLOT]
  );

  const submitAnswer = useCallback(
    (given) => {
      if (openIndex === null) return;
      const q = questions[openIndex];
      if (!q) return;
      const { verdict } = checkAnswer(given, q.answer);

      // Nearly: the spelling, once, for free. The box keeps what was typed.
      if (verdict === 'close' && !closeUsed) {
        setCloseUsed(true);
        setNote('Close. Check the spelling and try again.');
        return;
      }
      if (verdict === 'correct') {
        settle(true, given, hinted);
        return;
      }
      // A first miss is not the end: up comes the hint, and one more try for half.
      if (!hinted) {
        setUserAnswer(SLOT, openIndex, given);
        showHint(SLOT, openIndex);
        setCloseUsed(false);
        const half = Math.round((q.value ?? 0) / 2);
        setNote(`Not quite. Here is a hint, and one more try for $${half.toLocaleString()}.`);
        return;
      }
      settle(false, given, true);
    },
    [openIndex, questions, closeUsed, hinted, settle, setUserAnswer, showHint, SLOT]
  );

  /* The grader can turn down a right answer. A player it did that to on the
     first try says so before seeing the response, and is paid in full. */
  const claim = useCallback(() => {
    if (openIndex === null) return;
    const given = useDailyStore.getState()[SLOT].userAnswers[openIndex] ?? '';
    settle(true, given, false);
  }, [openIndex, settle, SLOT]);

  // Fuzzy matching gets things wrong, so the player has the last word.
  const override = useCallback(() => {
    if (openIndex === null) return;
    overrideAnswer(SLOT, openIndex);
    setResult((r) => (r ? { ...r, correct: true } : r));
    playCorrect();
  }, [openIndex, overrideAnswer, playCorrect, SLOT]);

  /* A pass uses the clue up and scores nothing, as on The Board. Giving up
     still shows the response, because the point of passing is that you did not
     know it. Continue moves on, not this, so passing the sixth cannot end the
     run before you have read the answer. */
  const passClue = useCallback(() => {
    if (openIndex === null) return;
    passQuestion(SLOT, openIndex);
    setResult({ correct: false, passed: true, playerAnswer: '' });
  }, [openIndex, passQuestion, SLOT]);

  /* Closing the clue is what moves the run on, not grading it: advancing at
     submit would swap the clue for the next one while the player is still
     reading the answer they got wrong. Letting go of the index hands the next
     clue to the effect above. */
  const continueOn = useCallback(() => {
    setResult(null);
    // Keep the stored cursor walking alongside the clues it counts.
    nextQuestion(SLOT);
    const settled = useDailyStore.getState()[SLOT].answers;
    const next = settled.findIndex((a) => !a?.revealed);
    setNote(null);
    setCloseUsed(false);
    if (next === -1) {
      setOpenIndex(null);
      completeGame(SLOT, { score: sixerScore(settled, questions) });
      return;
    }
    /* Straight to the next clue rather than back through null: releasing the
       index unmounts the clue screen and mounts it again, so every Continue
       played a fade out, a fade in and a spring before the next clue arrived. */
    setOpenIndex(next);
  }, [nextQuestion, completeGame, SLOT, questions]);

  const handleBackToMenu = () => {
    navigate('/menu');
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="daily-page">
        <div className="daily-loading">
          <div className="spinner" />
          <p>Loading today’s challenge…</p>
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
        <DailyResults
          onBackToMenu={handleBackToMenu}
          verifyCode={verifyCode}
          format={FORMAT}
          slot={SLOT}
        />
      </div>
    );
  }

  // No questions loaded yet, or a run short of its clues
  if (!questions.length) {
    return (
      <div className="daily-page">
        <div className="daily-loading">
          <div className="spinner" />
          <p>Preparing questions…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="daily-page daily-sixer-page">
      {/* The clue fills the screen, so this rides above it: without it there is
          no way out of a run until the sixth clue is answered. */}
      <header className="daily-header">
        <button onClick={handleBackToMenu} className="btn-back back-chevron" aria-label="Back to menu" title="Back to menu">
          &lsaquo;
        </button>
        <div className="daily-title">
          <h1>The Sixer</h1>
          <p className="daily-date">{formatDisplayDate(todayDate)}</p>
          {todayDate && <p className="daily-week-note">{weekNote(todayDate)}. Easy to hard.</p>}
        </div>
        <div className="daily-stats-mini">
          {/* What the run has won so far, as the show keeps a contestant's
              total in front of them the whole game. */}
          <span className="sixer-winnings" aria-live="polite" aria-label={`Winnings: $${sixerScore(answers, questions).toLocaleString()}`}>
            ${sixerScore(answers, questions).toLocaleString()}
          </span>
          {liveStreak(formatStats, toDateString()) > 0 && (
            <span className="streak-badge" title="Current streak">
              {liveStreak(formatStats, toDateString())} day streak
            </span>
          )}
        </div>
      </header>

      {/* Where you are in the six. The money is kept in the header. */}
      <ol
        className="sixer-pips"
        role="img"
        aria-label={`Clue ${(openIndex ?? activeIndex) + 1} of ${questions.length}`}
      >
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
            note={result ? null : note}
            hint={!result && hinted ? answerHint(openQuestion.question) : null}
            onClaim={!result && hinted ? claim : null}
            earned={result ? sixerEarned({ revealed: true, ...result }, openQuestion.value) : 0}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
