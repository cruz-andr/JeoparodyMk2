import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useDailyStore } from '../stores/dailyStore';
import {
  toBoardGrid,
  BOARD_ROW_COUNT,
  currentWeekBest,
  toDateString,
  boardScore,
  elapsedMs,
  formatDuration,
} from '../stores/dailyLogic';
import { getOrFetchDailyChallenge } from '../services/api/jeopardyService';
import { checkAnswer } from '../services/answerChecker';
import GameBoard from '../components/game/GameBoard';
import BoardWheel from '../components/game/BoardWheel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useAudio } from '../hooks';
import QuestionModal from '../components/game/QuestionModal';
import DailyResults from '../components/daily/DailyResults';
import { usePageTitle } from '../hooks/usePageTitle';
import './DailyBoardPage.css';

const FORMAT = 'board';
const POINT_VALUES = [200, 400, 600, 800, 1000];

// The board is stored flat in category-major order, so a cell maps straight in.
const flatIndex = (categoryIndex, pointIndex) => categoryIndex * BOARD_ROW_COUNT + pointIndex;

export default function DailyBoardPage() {
  usePageTitle('The Board');
  const navigate = useNavigate();
  const [openCell, setOpenCell] = useState(null); // { categoryIndex, pointIndex }
  // Null while the player is still typing; set once the answer has been graded.
  const [result, setResult] = useState(null);
  // The two boards are different components, not one restyled, so this cannot
  // be a media query in CSS.
  const isPhone = useMediaQuery('(max-width: 768px)');
  // Both dailies were silent: the sound bank is loaded and the Sound toggle
  // exists, but neither daily ever asked it for anything.
  const { playCorrect, playWrong } = useAudio();

  // The wheel is a fixed surface, so the document behind it must not scroll.
  /* The scroll lock lives in BoardWheel now: it is the thing that needs the
     document to hold still, so it is the thing that asks. */

  const {
    board,
    isLoading,
    error,
    stats,
    hasPlayedToday,
    isNewDay,
    setLoading,
    setError,
    setDailyChallenge,
    revealAnswer,
    overrideAnswer,
    passQuestion,
    startClock,
    pauseClock,
    completeGame,
  } = useDailyStore();

  const { date, questions, answers, isComplete } = board;
  const alreadyPlayed = hasPlayedToday(FORMAT);
  // The number to chase while playing. Null until there is one this week.
  const weekBest = currentWeekBest(stats[FORMAT], toDateString());

  // Load today's board once.
  useEffect(() => {
    const load = async () => {
      // `error` is shared by both daily pages and outlives a route change, so
      // a failure on the other one would strand this screen on "Oops!".
      setError(null);

      if (hasPlayedToday(FORMAT)) {
        setLoading(false);
        return;
      }
      if (!isNewDay(FORMAT) && questions.length > 0) return;

      setLoading(true);
      try {
        const challenge = await getOrFetchDailyChallenge();
        setDailyChallenge(FORMAT, {
          date: challenge.date,
          questions: challenge.board.questions,
          categories: challenge.board.categories,
        });
      } catch (err) {
        console.error('Failed to load the daily board:', err);
        setError("Could not load today's board. Please try again.");
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playable = !alreadyPlayed && !isComplete && questions.length > 0;

  /* Timed like a crossword rather than per clue: the clock runs while the
     board is open and banks its time whenever the tab goes away, so putting
     the phone down is not the same as playing. */
  useEffect(() => {
    if (!playable) return undefined;
    startClock(FORMAT);

    const onVisibility = () => {
      if (document.hidden) pauseClock(FORMAT);
      else startClock(FORMAT);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      pauseClock(FORMAT);
    };
  }, [playable, startClock, pauseClock]);

  // Redraw the clock once a second. The time itself lives in the store.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!playable) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [playable]);

  const onTheClock = formatDuration(elapsedMs(board.timing, now)) ?? '0:00';

  /* Every clue used but the run never closed. Reachable by reloading on the
     last clue, which used to leave the board unplayable and unfinishable with
     the score thrown away. Not while a clue is open: that is the ordinary
     moment between answering the last one and reading it. */
  useEffect(() => {
    if (!playable || openCell) return;
    if (!answers.length || !answers.every((a) => a?.revealed)) return;
    completeGame(FORMAT, { score: boardScore(answers, POINT_VALUES) });
  }, [playable, openCell, answers, completeGame]);

  const grid = useMemo(() => toBoardGrid(questions), [questions]);

  const revealedQuestions = useMemo(() => {
    const set = new Set();
    answers.forEach((a, i) => {
      if (a?.revealed) {
        set.add(`${Math.floor(i / BOARD_ROW_COUNT)}-${i % BOARD_ROW_COUNT}`);
      }
    });
    return set;
  }, [answers]);

  const score = useMemo(() => boardScore(answers, POINT_VALUES), [answers]);

  const openQuestion = useMemo(() => {
    if (!openCell || !grid) return null;
    return grid[openCell.categoryIndex]?.[openCell.pointIndex] ?? null;
  }, [openCell, grid]);

  const handleSelect = useCallback((categoryIndex, pointIndex) => {
    setOpenCell({ categoryIndex, pointIndex });
    setResult(null);
  }, []);

  /* Typed and graded for you, as on the Sixer. The board's own question shape
     is the show's; `question` is the correct response and `answer` is the clue
     that was read out, which is the opposite of the Sixer's. */
  const submitAnswer = useCallback(
    (given) => {
      if (!openCell || !openQuestion) return;
      const index = flatIndex(openCell.categoryIndex, openCell.pointIndex);
      const { isCorrect } = checkAnswer(given, openQuestion.question);
      revealAnswer(FORMAT, index, isCorrect, given);
      setResult({ correct: isCorrect, playerAnswer: given });
      if (isCorrect) playCorrect();
      else playWrong();
    },
    [openCell, openQuestion, revealAnswer, playCorrect, playWrong]
  );

  // Fuzzy matching gets things wrong, so the player has the last word.
  const override = useCallback(() => {
    if (!openCell) return;
    overrideAnswer(FORMAT, flatIndex(openCell.categoryIndex, openCell.pointIndex));
    setResult((r) => (r ? { ...r, correct: true } : r));
    playCorrect();
  }, [openCell, overrideAnswer, playCorrect]);

  // Read the store rather than the memo: the answer that just landed is not in
  // `score` yet.
  const finishIfDone = useCallback(() => {
    const settled = useDailyStore.getState().board.answers;
    if (settled.every((a) => a?.revealed)) {
      completeGame(FORMAT, { score: boardScore(settled, POINT_VALUES) });
    }
  }, [completeGame]);

  /* Closing the clue is what ends the run, not grading it: completing at
     submit would swap the board for the results screen while the player is
     still reading the answer they got wrong. */
  const continueOn = useCallback(() => {
    setOpenCell(null);
    setResult(null);
    finishIfDone();
  }, [finishIfDone]);

  /* A pass uses the clue up and scores nothing. It is recorded rather than
     just closed: a clue you could reopen was a free look that also handed you
     a fresh clock, and a run of skipped clues could never reach an end.
     Giving up still shows you the response, as on the Sixer, because the point
     of passing is that you did not know it. Continue closes it, not this, so
     the last clue cannot end the run before you have read the answer. */
  const passClue = useCallback(() => {
    if (!openCell) return;
    passQuestion(FORMAT, flatIndex(openCell.categoryIndex, openCell.pointIndex));
    setResult({ correct: false, passed: true, playerAnswer: '' });
  }, [openCell, passQuestion]);

  const backToMenu = () => navigate('/menu');

  if (isLoading) {
    return (
      <div className="daily-board-page">
        <div className="daily-board-status">
          <div className="spinner" />
          <p>Loading today&apos;s board...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="daily-board-page">
        <div className="daily-board-status">
          <h2>Oops!</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="btn-primary">
            Try Again
          </button>
          <button onClick={backToMenu} className="btn-secondary">
            Back to Menu
          </button>
        </div>
      </div>
    );
  }

  if (alreadyPlayed || isComplete) {
    return (
      <div className="daily-board-page">
        <DailyResults onBackToMenu={backToMenu} format={FORMAT} />
      </div>
    );
  }

  if (!grid) {
    return (
      <div className="daily-board-page">
        <div className="daily-board-status">
          <div className="spinner" />
          <p>Preparing the board...</p>
        </div>
      </div>
    );
  }

  const playedCount = answers.filter((a) => a?.revealed).length;
  const streak = stats[FORMAT].currentStreak;

  const clueModal = (
    <AnimatePresence>
      {openQuestion && (
        <QuestionModal
          question={openQuestion}
          points={POINT_VALUES[openCell.pointIndex]}
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
  );

  // Phone: the board turns. See BoardWheel for why.
  if (isPhone) {
    return (
      <div className="daily-board-page phone">
        <div className="wheel-header">
          <span className="wheel-state">
            {playedCount} of {questions.length} &middot;{' '}
            <span className="wheel-clock">{onTheClock}</span>
          </span>
          <button className="wheel-close" onClick={backToMenu} aria-label="Back to menu">
            &times;
          </button>
        </div>

        <BoardWheel
          categories={board.categories ?? []}
          answers={answers}
          pointValues={POINT_VALUES}
          onSelect={handleSelect}
        />

        <div className="wheel-podium">
          <div className="wheel-podium-meta">
            <span>The Board</span>
            {streak > 0 && <span>{streak} day streak</span>}
          </div>
          <div className="wheel-podium-score">
            <span className={score < 0 ? 'negative' : ''}>
              {score < 0 ? '-' : ''}${Math.abs(score).toLocaleString()}
            </span>
          </div>
        </div>

        {clueModal}
      </div>
    );
  }

  return (
    <div className="daily-board-page">
      <header className="daily-board-header">
        <button onClick={backToMenu} className="btn-back">&larr; Menu</button>
        <div className="daily-board-title">
          <h1>The Board</h1>
          <p className="daily-board-date">
            {date} &middot; <span className="daily-board-clock">{onTheClock}</span>
          </p>
        </div>
        <div className="daily-board-score">
          <span className={score < 0 ? 'negative' : ''}>
            {score < 0 ? '-' : ''}${Math.abs(score).toLocaleString()}
          </span>
          {weekBest !== null && (
            <span className="daily-board-target">
              Beat ${weekBest.toLocaleString()}
            </span>
          )}
          {streak > 0 && (
            <span className="daily-board-streak">{streak} day streak</span>
          )}
        </div>
      </header>

      <GameBoard
        categories={board.categories ?? []}
        questions={grid}
        pointValues={POINT_VALUES}
        onQuestionSelect={handleSelect}
        revealedQuestions={revealedQuestions}
      />

      {clueModal}
    </div>
  );
}
