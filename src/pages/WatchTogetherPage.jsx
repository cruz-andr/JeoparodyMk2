import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSocket } from '../hooks/useSocket';
import { useUserStore } from '../stores';
import { getBoard } from '../services/api/boardsService';
import socketClient from '../services/socket/socketClient';
import { loadYouTubeApi } from '../components/media/youtubeApi';
import { stopsFor } from '@shared/watchAlong.js';
import GameBoard from '../components/game/GameBoard';
import { BoardHeader, Money } from '../components/game/BoardChrome';
import { AskPanel, BuzzPanel, PlayMark, StartButton, Verdict } from '../components/watch/WatchParts';
import '../components/boards/BoardsChrome.css';
import './WatchAlongPage.css';

// Off by more than this and a playing video is put back where the room is.
const DRIFT = 1;
const NAME_KEY = 'jeoparody-watch-name';

const ask = (event, payload) => new Promise((resolve) => socketClient.emit(event, payload, resolve));

/**
 * One of the show's episodes, watched together, each on their own device.
 * The server keeps the room's clock (watchRooms.js); this page keeps its own
 * copy of the video where that clock says, answers when the room stops, and
 * shows how everyone did. Whoever started the room drives it, until someone
 * gets one right: the last one right drives, as in a multiplayer game.
 */
export default function WatchTogetherPage() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, token, sessionId } = useUserStore();
  const { isConnected } = useSocket();

  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState(() => user?.displayName || readName());
  const [nameDraft, setNameDraft] = useState('');
  const [room, setRoom] = useState(null);
  const [joined, setJoined] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  usePageTitle(board ? `Watch together: ${board.title}` : 'Watch together');

  const host = useRef(null);
  const player = useRef(null);
  const offset = useRef(0);
  const roomRef = useRef(null);
  roomRef.current = room;

  const code = params.get('room');

  useEffect(() => {
    getBoard(slug, token).then(setBoard).catch((err) => setError(err.message));
  }, [slug, token]);

  const stops = useMemo(() => (board?.watch ? stopsFor(board.watch, board.board) : []), [board]);

  // The server's time against this device's, from the quickest of a few round trips.
  const setClock = useCallback(async () => {
    let best = null;
    for (let i = 0; i < 3; i++) {
      const sent = Date.now();
      const { now } = await ask('watch:time', {});
      const back = Date.now();
      if (!best || back - sent < best.rtt) best = { rtt: back - sent, offset: now - (sent + back) / 2 };
    }
    offset.current = best.offset;
  }, []);

  // In: a new room, or the one in the link. And back in after a dropped connection.
  useEffect(() => {
    if (!isConnected || !name || !board?.watch) return undefined;
    let live = true;
    const onState = (state) => live && setRoom(state);
    socketClient.on('watch:state', onState);
    (async () => {
      await setClock();
      const reply = code
        ? await ask('watch:join', { code, name })
        : await ask('watch:create', { slug, name });
      if (!live) return;
      if (reply?.error) { setError(reply.error); return; }
      setRoom(reply.state);
      if (!code) setParams({ room: reply.code }, { replace: true });
    })();
    return () => {
      live = false;
      socketClient.off('watch:state', onState);
    };
  }, [isConnected, name, board, code, slug, setClock, setParams]);

  /* The video: everyone's own copy, with no controls of its own. The room's
     clock drives it. Not until there is a name: until then the page is the
     name, and there is nowhere to put a video. */
  useEffect(() => {
    if (!board?.watch || !name || !host.current) return undefined;
    let gone = false;
    loadYouTubeApi().then(() => {
      if (gone) return;
      player.current = new window.YT.Player(host.current, {
        videoId: board.watch.youtube,
        playerVars: { rel: 0, playsinline: 1, modestbranding: 1, controls: 0, disablekb: 1 },
      });
    });
    return () => {
      gone = true;
      player.current?.destroy?.();
      player.current = null;
    };
  }, [board, name]);

  // Twice a second: where the room's clock says the video is, and this one put there.
  useEffect(() => {
    if (!joined) return undefined;
    const keep = setInterval(() => {
      const state = roomRef.current;
      const video = player.current;
      if (!state || !video?.getCurrentTime) return;
      const { playing, position, since } = state.clock;
      const target = playing ? position + (Date.now() + offset.current - since) / 1000 : position;
      const at = video.getCurrentTime();
      const isPlaying = video.getPlayerState?.() === window.YT.PlayerState.PLAYING;
      if (playing) {
        if (Math.abs(at - target) > DRIFT) video.seekTo(target, true);
        if (!isPlaying) video.playVideo();
      } else {
        if (isPlaying) video.pauseVideo();
        if (Math.abs(at - target) > 0.4) video.seekTo(target, true);
      }
      setTick((n) => n + 1);
    }, 500);
    return () => clearInterval(keep);
  }, [joined]);

  if (error) {
    return (
      <div className="wa-page">
        <main className="boards-body">
          <p className="wa-gone">{error}</p>
          <button className="plain-btn quiet-action" onClick={() => navigate(`/boards/${slug}`)}>Back to the board</button>
        </main>
      </div>
    );
  }
  if (!board) return <div className="wa-page" />;

  if (!name) {
    const save = (e) => {
      e.preventDefault();
      const chosen = nameDraft.trim().slice(0, 24);
      if (!chosen) return;
      try { localStorage.setItem(NAME_KEY, chosen); } catch { /* a name for this visit only */ }
      setName(chosen);
    };
    return (
      <div className="board-play-page wa-page">
        <BoardHeader title={board.title} sub="Watch together" onBack={() => navigate(`/boards/${slug}`)} backLabel="Back to the board" />
        <form className="wa-ask wa-name" onSubmit={save}>
          <p className="wa-ask-where">Your name</p>
          <input className="wa-input" value={nameDraft} maxLength={24} onChange={(e) => setNameDraft(e.target.value)} placeholder="So the others know who scored" autoFocus />
          <div className="wa-ask-do">
            <button type="submit" className="btn-primary" disabled={!nameDraft.trim()}>Join</button>
          </div>
        </form>
      </div>
    );
  }

  const me = room?.players.find((p) => p.id === sessionId);
  const driving = room?.hostId === sessionId;
  const current = room?.current && stops.find((s) => s.key === room.current.key);
  const phase = room?.current?.phase;
  const answeredHere = room?.current?.answered.includes(sessionId);
  const triedHere = room?.current?.tried.includes(sessionId);
  const answering = room?.players.find((p) => p.id === room?.current?.answering);
  const mine = room?.last?.results?.[sessionId];
  const taken = new Set((room?.asked ?? []).filter((k) => k !== 'final').map((k) => k.replace(':', '-')));
  const values = board.board.categories[0]?.questions.map((q) => q.points) ?? [];
  const waitingOn = room?.current
    ? room.players.filter((p) => p.connected && !room.current.answered.includes(p.id)).length
    : 0;
  const secondsLeft = room?.current
    ? Math.max(0, Math.ceil((room.current.deadline - (Date.now() + offset.current)) / 1000))
    : 0;
  const link = room ? `${window.location.origin}/boards/${slug}/together?room=${room.code}` : '';

  const control = (action, extra = {}) => socketClient.emit('watch:control', { action, ...extra });
  const answer = (given, wager) => ask('watch:answer', { key: current.key, given, wager });
  const buzz = () => socketClient.emit('watch:buzz', { key: current.key }, () => {});
  const pass = () => socketClient.emit('watch:pass', { key: current.key });
  const overrule = () => socketClient.emit('watch:overrule', { key: room.last.key });
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* shown below to copy by hand */ }
  };

  return (
    <div className="board-play-page wa-page">
      <BoardHeader
        title={board.title}
        sub={room ? `Watching together · ${room.code}` : 'Watching together'}
        onBack={() => navigate(`/boards/${slug}`)}
        backLabel="Back to the board"
      >
        <Money value={me?.score ?? 0} />
      </BoardHeader>

      <main className="wa-body">
        <div className="wa-stage">
          <div className="wa-video">
            <div ref={host} />
            {!joined && (
              <StartButton
                label={room ? 'Join the episode' : 'Opening the room'}
                onStart={() => { if (room) { player.current?.playVideo?.(); setJoined(true); } }}
              />
            )}
          </div>

          {driving && joined && (
            <div className="wa-drive">
              {room.clock.playing ? (
                <button className="plain-btn wa-word" onClick={() => control('pause')}>Pause for everyone</button>
              ) : (
                <button className="plain-btn wa-word wa-drive-play" onClick={() => control('play')} disabled={Boolean(room.current)}>
                  <PlayMark /> Play for everyone
                </button>
              )}
              <span className="wa-note">You are driving until someone else gets one right. Pick a square to take everyone to that clue.</span>
            </div>
          )}

          {current && phase === 'final' ? (
            answeredHere ? (
              <p className="wa-hint">Waiting on {waitingOn} more · {secondsLeft}s</p>
            ) : (
              <AskPanel key={current.key} stop={current} score={me?.score ?? 0} onAnswer={answer} onPass={pass} waiting={`${secondsLeft}s`} />
            )
          ) : current && phase === 'answer' && answering?.id === sessionId ? (
            <AskPanel key={`${current.key}-${sessionId}`} stop={current} score={me?.score ?? 0} onAnswer={answer} waiting={`${secondsLeft}s`} />
          ) : current && phase === 'answer' ? (
            <BuzzPanel stop={current} note={`${answering?.name ?? 'Someone'} is answering · ${secondsLeft}s`} />
          ) : current ? (
            <BuzzPanel
              stop={current}
              onBuzz={triedHere ? null : buzz}
              note={triedHere ? `You have had your go · ${secondsLeft}s` : `${secondsLeft}s`}
            />
          ) : mine ? (
            <Verdict result={mine} onOverrule={overrule} />
          ) : room?.last && !Object.keys(room.last.results).length ? (
            <p className="wa-hint">Nobody rang in.</p>
          ) : (
            <p className="wa-hint">
              {driving ? 'Start it when everyone is in. ' : 'The video plays when the room does. '}
              It stops a moment before each answer for everyone&rsquo;s.
            </p>
          )}

          {!current && room?.last && <Others room={room} me={sessionId} />}
        </div>

        <aside className="wa-side">
          <GameBoard
            categories={board.board.categories.map((c) => c.name)}
            questions={board.board.categories.map((c) => c.questions)}
            pointValues={values}
            revealedQuestions={taken}
            onQuestionSelect={(column, row) => control('clue', { column, row })}
            disabled={!driving}
          />

          <ol className="wa-players">
            {(room?.players ?? []).slice().sort((a, b) => b.score - a.score).map((p) => (
              <li key={p.id} className={p.connected ? '' : 'is-away'}>
                <span className="wa-player-name">
                  {p.name}{p.id === sessionId ? ' (you)' : ''}{p.id === room.hostId ? ' · driving' : ''}
                </span>
                <span className="wa-player-score"><Money value={p.score} /></span>
              </li>
            ))}
          </ol>

          {room && (
            <div className="wa-invite">
              <p className="wa-note">Send this to watch with you</p>
              <div className="wa-invite-row">
                <input className="wa-input" readOnly value={link} onFocus={(e) => e.target.select()} />
                <button className="plain-btn wa-word" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

/** How everyone else did on the last clue: "Bo RIGHT $400". */
function Others({ room, me }) {
  const rows = room.players.filter((p) => p.id !== me && room.last.results[p.id]);
  if (!rows.length) return null;
  return (
    <ul className="wa-others">
      {rows.map((p) => {
        const r = room.last.results[p.id];
        return (
          <li key={p.id}>
            <span className="wa-player-name">{p.name}</span>
            <span>{r.passed ? 'Passed' : r.correct ? 'Right' : 'Wrong'}</span>
            {!r.passed && <span className="wa-verdict-money"><Money value={r.points} /></span>}
          </li>
        );
      })}
    </ul>
  );
}

function readName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
