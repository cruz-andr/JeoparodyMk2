import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { gradeAnswer } from '@shared/answerMatch.js';
import { usePageTitle } from '../hooks/usePageTitle';
import { useUserStore } from '../stores';
import { getBoard } from '../services/api/boardsService';
import { loadYouTubeApi } from '../components/media/youtubeApi';
import { judgeTyped } from '../utils/typedClue';
import { clampFinalWager } from '../utils/wagers';
import { reached, scored, startOf, stopsFor } from '@shared/watchAlong.js';
import { AskPanel, StartButton, Verdict } from '../components/watch/WatchParts';
import GameBoard from '../components/game/GameBoard';
import { BoardHeader, Money } from '../components/game/BoardChrome';
import '../components/boards/BoardsChrome.css';
import './WatchAlongPage.css';

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;

/**
 * One of the show's episodes, played along with: the video runs, and stops a
 * moment before each answer for the player's own. Typed, graded the way solo
 * play grades it, scored the way the show scores it, and then the video goes
 * on and gives the answer.
 */
export default function WatchAlongPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { token } = useUserStore();

  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  usePageTitle(board ? `Watch along: ${board.title}` : 'Watch along');

  const [started, setStarted] = useState(false);
  const [asking, setAsking] = useState(null);
  const [closeUsed, setCloseUsed] = useState(false);
  const [score, setScore] = useState(0);
  const [results, setResults] = useState({});
  const [last, setLast] = useState(null);
  const [ended, setEnded] = useState(false);

  const host = useRef(null);
  const player = useRef(null);
  const settled = useRef(new Set());
  const askingRef = useRef(null);

  useEffect(() => {
    getBoard(slug, token).then(setBoard).catch((err) => setError(err.message));
  }, [slug, token]);

  const stops = useMemo(() => (board?.watch ? stopsFor(board.watch, board.board) : []), [board]);

  // The video, once there is one to play.
  useEffect(() => {
    if (!board?.watch || !host.current) return undefined;
    let gone = false;
    loadYouTubeApi().then(() => {
      if (gone) return;
      player.current = new window.YT.Player(host.current, {
        videoId: board.watch.youtube,
        playerVars: { rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.PLAYING) setStarted(true);
            if (e.data === window.YT.PlayerState.ENDED) setEnded(true);
          },
        },
      });
    });
    return () => {
      gone = true;
      player.current?.destroy?.();
      player.current = null;
    };
  }, [board]);

  const settle = useCallback((stop, result) => {
    settled.current.add(stop.key);
    setResults((now) => ({ ...now, [stop.key]: result }));
  }, []);

  // A quarter of a second at a time: has the video reached the next stop?
  useEffect(() => {
    if (!stops.length) return undefined;
    const tick = setInterval(() => {
      const video = player.current;
      if (askingRef.current || !video?.getCurrentTime) return;
      /* Stops gone past without stopping (skipped ahead) are left as they
         are: still on the board, a click away. */
      const { ask } = reached(stops, settled.current, video.getCurrentTime());
      if (!ask) return;
      video.pauseVideo();
      askingRef.current = ask;
      setAsking(ask);
      setCloseUsed(false);
    }, 250);
    return () => clearInterval(tick);
  }, [stops]);

  /* A square on the board: the video from as that clue comes up, to see
     it read and play it. A question already up is let go unanswered. */
  const jump = (column, row) => {
    const stop = stops.find((s) => s.column === column && s.row === row);
    const video = player.current;
    if (!stop || !video?.seekTo) return;
    askingRef.current = null;
    setAsking(null);
    video.seekTo(startOf(stop), true);
    video.playVideo();
  };

  const goOn = () => {
    askingRef.current = null;
    setAsking(null);
    player.current?.playVideo?.();
  };

  const finish = (correct, response, wager) => {
    const stop = asking;
    const staked = stop.final ? clampFinalWager(Number(wager) || 0, score) : 0;
    const points = scored(stop, correct, staked);
    setScore((s) => s + points);
    settle(stop, { correct, points, given: response });
    setLast({ stop, correct, points, given: response });
    goOn();
  };

  const answer = (given, wager) => {
    const verdict = judgeTyped(gradeAnswer, given, asking.clue.question, { closeUsed });
    if (verdict.retry) {
      setCloseUsed(true);
      return verdict;
    }
    finish(verdict.correct, given, wager);
    return verdict;
  };

  const pass = () => {
    settle(asking, { passed: true, points: 0 });
    setLast({ stop: asking, passed: true, points: 0 });
    goOn();
  };

  // The player says they had it after all: a wrong turned right, as solo play allows.
  const overrule = () => {
    if (!last || last.correct || last.passed) return;
    const worth = -last.points * 2;
    setScore((s) => s + worth);
    setResults((now) => ({ ...now, [last.stop.key]: { ...now[last.stop.key], correct: true, points: -last.points } }));
    setLast({ ...last, correct: true, points: -last.points });
  };

  if (error) {
    return (
      <div className="wa-page">
        <main className="boards-body"><p className="wa-gone">{error}</p></main>
      </div>
    );
  }
  if (!board) return <div className="wa-page" />;
  if (!board.watch) {
    return (
      <div className="wa-page">
        <main className="boards-body">
          <p className="wa-gone">This board has no episode to watch along with.</p>
          <button className="plain-btn quiet-action" onClick={() => navigate(`/boards/${slug}`)}>Back to the board</button>
        </main>
      </div>
    );
  }

  const done = stops.filter((s) => results[s.key]).length;
  // Answered or passed: gone from the board, the way a taken clue is.
  const taken = new Set(Object.keys(results).filter((k) => k !== 'final').map((k) => k.replace(':', '-')));
  const values = board.board.categories[0]?.questions.map((q) => q.points) ?? [];

  return (
    <div className="board-play-page wa-page">
      <BoardHeader
        title={board.title}
        sub="Watch along"
        onBack={() => navigate(`/boards/${slug}`)}
        backLabel="Back to the board"
      >
        <Money value={score} />
      </BoardHeader>

      <main className="wa-body">
        <div className="wa-stage">
          <div className="wa-video">
            <div ref={host} />
            {!started && <StartButton onStart={() => player.current?.playVideo?.()} />}
          </div>

          {asking ? (
            <AskPanel key={asking.key} stop={asking} score={score} onAnswer={answer} onPass={pass} />
          ) : last ? (
            <Verdict result={last} onOverrule={overrule} />
          ) : (
            <p className="wa-hint">
              The episode stops a moment before each answer for yours. Pick a square to go to that clue.
            </p>
          )}
        </div>

        <aside className="wa-side">
          <GameBoard
            categories={board.board.categories.map((c) => c.name)}
            questions={board.board.categories.map((c) => c.questions)}
            pointValues={values}
            revealedQuestions={taken}
            onQuestionSelect={jump}
          />
          <p className="wa-progress">{done} of {stops.length} played</p>

          {(ended || done === stops.length) && (
            <div className="wa-end">
              <p className="wa-end-score">You finished on {money(score)}</p>
              <button className="plain-btn quiet-action" onClick={() => navigate(`/boards/${slug}`)}>Back to the board</button>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
