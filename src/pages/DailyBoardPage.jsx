import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useDailyStore } from '../stores/dailyStore';
import {
  toBoardGrid,
  BOARD_ROW_COUNT,
  currentWeekBest,
  toDateString,
} from '../stores/dailyLogic';
import { getOrFetchDailyChallenge } from '../services/api/jeopardyService';
import GameBoard from '../components/game/GameBoard';
import BoardWheel from '../components/game/BoardWheel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import QuestionModal from '../components/game/QuestionModal';
import DailyResults from '../components/daily/DailyResults';
import './DailyBoardPage.css';

const FORMAT = 'board';
const POINT_VALUES = [200, 400, 600, 800, 1000];

// The board is stored flat in category-major order, so a cell maps straight in.
const flatIndex = (categoryIndex, pointIndex) => categoryIndex * BOARD_ROW_COUNT + pointIndex;

export default function DailyBoardPage() {
  const navigate = useNavigate();
  const [openCell, setOpenCell] = useState(null); // { categoryIndex, pointIndex }
  const [showAnswer, setShowAnswer] = useState(false);
  // The two boards are different components, not one restyled, so this cannot
  // be a media query in CSS.
  const isPhone = useMediaQuery('(max-width: 768px)');

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

  const score = useMemo(
    () =>
      answers.reduce((total, a, i) => {
        if (!a?.revealed) return total;
        const points = POINT_VALUES[i % BOARD_ROW_COUNT];
        return a.correct ? total + points : total - points;
      }, 0),
    [answers]
  );

  const openQuestion = useMemo(() => {
    if (!openCell || !grid) return null;
    return grid[openCell.categoryIndex]?.[openCell.pointIndex] ?? null;
  }, [openCell, grid]);

  const handleSelect = useCallback((categoryIndex, pointIndex) => {
    setOpenCell({ categoryIndex, pointIndex });
    setShowAnswer(false);
  }, []);

  // Grading closes the clue and, once the board is clear, the run.
  const grade = useCallback(
    (correct) => {
      if (!openCell) return;
      const index = flatIndex(openCell.categoryIndex, openCell.pointIndex);
      revealAnswer(FORMAT, index, correct, '');
      setOpenCell(null);
      setShowAnswer(false);

      // Recompute from the store rather than the memo: the answer that just
      // landed is not in `score` yet.
      const settled = useDailyStore.getState().board.answers;
      if (settled.every((a) => a?.revealed)) {
        const finalScore = settled.reduce((total, a, i) => {
          const points = POINT_VALUES[i % BOARD_ROW_COUNT];
          return a.correct ? total + points : total - points;
        }, 0);
        completeGame(FORMAT, { score: finalScore });
      }
    },
    [openCell, revealAnswer, completeGame]
  );

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
          showAnswer={showAnswer}
          onRevealAnswer={() => setShowAnswer(true)}
          onCorrect={() => grade(true)}
          onIncorrect={() => grade(false)}
          onClose={() => {
            setOpenCell(null);
            setShowAnswer(false);
          }}
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
            {date} &middot; {playedCount} of {questions.length}
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
          <p className="daily-board-date">{date}</p>
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
