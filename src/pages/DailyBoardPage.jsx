import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useDailyStore } from '../stores/dailyStore';
import {
  toBoardGrid,
  BOARD_ROW_COUNT,
  currentWeekBest,
  liveStreak,
  isArchiveRunFor,
  toDateString,
  boardScore,
  elapsedMs,
  formatDuration,
} from '../stores/dailyLogic';
import { getOrFetchDailyChallenge } from '../services/api/jeopardyService';
import { checkAnswer } from '../services/answerChecker';
import { judgeTyped, CLOSE_NOTE } from '../utils/typedClue';
import GameBoard from '../components/game/GameBoard';
import BoardWheel from '../components/game/BoardWheel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useAudio } from '../hooks';
import QuestionModal from '../components/game/QuestionModal';
import { BoardHeader, BoardTag, Money, WheelHeader, WheelPodium, PodiumScore } from '../components/game/BoardChrome';
import DailyResults from '../components/daily/DailyResults';
import { useUserStore } from '../stores';
import { canPlayDate } from '@shared/archiveWindow.js';
import { getChallengeForDate } from '../services/api/jeopardyService';
import { usePageTitle } from '../hooks/usePageTitle';
import './DailyBoardPage.css';

const FORMAT = 'board';
const POINT_VALUES = [200, 400, 600, 800, 1000];

// The board is stored flat in category-major order, so a cell maps straight in.
const flatIndex = (categoryIndex, pointIndex) => categoryIndex * BOARD_ROW_COUNT + pointIndex;

export default function DailyBoardPage() {
  usePageTitle('The Board');
  const navigate = useNavigate();

  /* `?date=` opens a day from the archive. Today's own date is not archive, so
     a link carrying it plays the ordinary board rather than a second copy of
     it in the archive slot. */
  const [params] = useSearchParams();
  const requestedDate = params.get('date');
  const archiveDate =
    requestedDate && requestedDate !== toDateString() ? requestedDate : null;
  /* Where the run lives. An archive day gets its own slot, so a board half
     played today survives a trip through the archive. */
  const SLOT = archiveDate ? 'archiveRun' : FORMAT;

  const [openCell, setOpenCell] = useState(null); // { categoryIndex, pointIndex }
  // Null while the player is still typing; set once the answer has been graded.
  const [result, setResult] = useState(null);
  // A close spelling's one free retry, per clue, as everywhere a clue is typed.
  const [note, setNote] = useState(null);
  const closeUsed = useRef(false);
  // The two boards are different components, not one restyled, so this cannot
  // be a media query in CSS.
  const isPhone = useMediaQuery('(max-width: 768px)');
  // Both dailies were silent: the sound bank is loaded and the Sound toggle
  // exists, but neither daily ever asked it for anything.
  const { playCorrect, playWrong } = useAudio();

  // The wheel is a fixed surface, so the document behind it must not scroll.
  /* The scroll lock lives in BoardWheel now: it is the thing that needs the
     document to hold still, so it is the thing that asks. */

  const isAuthenticated = useUserStore((s) => s.isAuthenticated);

  const {
    board,
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
    revealAnswer,
    overrideAnswer,
    passQuestion,
    startClock,
    pauseClock,
    completeGame,
  } = useDailyStore();

  const run = archiveDate ? archiveRun : board;
  const { date, questions, answers, isComplete } = run;
  /* An archive day is always replayable: nothing is at stake on it, and the
     "come back tomorrow" that guards today's board would be a lie about a day
     that has already been and gone. */
  const alreadyPlayed = archiveDate ? false : hasPlayedToday(FORMAT);
  // The number to chase while playing. Null until there is one this week.
  const weekBest = currentWeekBest(stats[FORMAT], toDateString());

  // Load today's board once.
  useEffect(() => {
    const load = async () => {
      // `error` is shared by both daily pages and outlives a route change, so
      // a failure on the other one would strand this screen on "Oops!".
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
          startArchiveRun(FORMAT, {
            date: archiveDate,
            questions: challenge.board.questions,
            categories: challenge.board.categories,
          });
        } catch (err) {
          console.error('Failed to load that day:', err);
          setError(err.message || 'Failed to load that day. Please try again.');
        }
        return;
      }

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
    startClock(SLOT);

    const onVisibility = () => {
      if (document.hidden) pauseClock(SLOT);
      else startClock(SLOT);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      pauseClock(SLOT);
    };
  }, [playable, startClock, pauseClock, SLOT]);

  // Redraw the clock once a second. The time itself lives in the store.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!playable) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [playable]);

  const onTheClock = formatDuration(elapsedMs(run.timing, now)) ?? '0:00';

  /* Every clue used but the run never closed. Reachable by reloading on the
     last clue, which used to leave the board unplayable and unfinishable with
     the score thrown away. Not while a clue is open: that is the ordinary
     moment between answering the last one and reading it. */
  useEffect(() => {
    if (!playable || openCell) return;
    if (!answers.length || !answers.every((a) => a?.revealed)) return;
    completeGame(SLOT, { score: boardScore(answers, POINT_VALUES) });
  }, [playable, openCell, answers, completeGame, SLOT]);

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
    setNote(null);
    closeUsed.current = false;
  }, []);

  /* Typed and graded for you, as on the Sixer. The board's own question shape
     is the show's; `question` is the correct response and `answer` is the clue
     that was read out, which is the opposite of the Sixer's. */
  const submitAnswer = useCallback(
    (given) => {
      if (!openCell || !openQuestion) return;
      const index = flatIndex(openCell.categoryIndex, openCell.pointIndex);
      const judged = judgeTyped(checkAnswer, given, openQuestion.question, { closeUsed: closeUsed.current });
      if (judged.retry) {
        closeUsed.current = true;
        setNote(CLOSE_NOTE);
        return;
      }
      setNote(null);
      const isCorrect = judged.correct;
      revealAnswer(SLOT, index, isCorrect, given);
      setResult({ correct: isCorrect, playerAnswer: given });
      if (isCorrect) playCorrect();
      else playWrong();
    },
    [openCell, openQuestion, revealAnswer, playCorrect, playWrong, SLOT]
  );

  // Fuzzy matching gets things wrong, so the player has the last word.
  const override = useCallback(() => {
    if (!openCell) return;
    overrideAnswer(SLOT, flatIndex(openCell.categoryIndex, openCell.pointIndex));
    setResult((r) => (r ? { ...r, correct: true } : r));
    playCorrect();
  }, [openCell, overrideAnswer, playCorrect, SLOT]);

  // Read the store rather than the memo: the answer that just landed is not in
  // `score` yet.
  const finishIfDone = useCallback(() => {
    const settled = useDailyStore.getState()[SLOT].answers;
    if (settled.every((a) => a?.revealed)) {
      completeGame(SLOT, { score: boardScore(settled, POINT_VALUES) });
    }
  }, [completeGame, SLOT]);

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
    passQuestion(SLOT, flatIndex(openCell.categoryIndex, openCell.pointIndex));
    setResult({ correct: false, passed: true, playerAnswer: '' });
  }, [openCell, passQuestion, SLOT]);

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
        <DailyResults onBackToMenu={backToMenu} format={FORMAT} slot={SLOT} />
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
  const streak = liveStreak(stats[FORMAT], toDateString());

  const clueModal = (
    <AnimatePresence>
      {openQuestion && (
        <QuestionModal
          question={openQuestion}
          points={POINT_VALUES[openCell.pointIndex]}
          typed
          result={result}
          note={note}
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
        <WheelHeader
          state={<>{playedCount} of {questions.length} &middot; <span className="wheel-clock">{onTheClock}</span></>}
          onClose={backToMenu}
        />

        <BoardWheel
          categories={board.categories ?? []}
          answers={answers}
          pointValues={POINT_VALUES}
          onSelect={handleSelect}
        />

        <WheelPodium meta={<><span>The Board</span>{streak > 0 && <span>{streak} day streak</span>}</>}>
          <PodiumScore value={score} />
        </WheelPodium>

        {clueModal}
      </div>
    );
  }

  return (
    <div className="board-play-page daily-board-page">
      <BoardHeader
        title="The Board"
        sub={<>{date} &middot; <span className="board-clock">{onTheClock}</span></>}
        onBack={backToMenu}
      >
        <Money value={score} />
        {weekBest !== null && <BoardTag quiet>Beat ${weekBest.toLocaleString()}</BoardTag>}
        {streak > 0 && <BoardTag>{streak} day streak</BoardTag>}
      </BoardHeader>

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
