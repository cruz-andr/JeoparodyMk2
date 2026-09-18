import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks';
import { useUserStore, useRoomStore } from '../stores';
import Studio, { Live, Roster, Clock, Btn, Ghost, Seg, MiniBoard } from '../components/studio/Studio';
import SignatureCanvas from '../components/common/SignatureCanvas';
import { usePageTitle } from '../hooks/usePageTitle';
import { useMediaQuery } from '../hooks/useMediaQuery';
import '../components/common/SignatureCanvas.css';
import './QuickplayPage.css';

/* Mirrors QUICKPLAY_PRESETS on the server, which is what the game actually
   plays by. This copy only labels the two choices. */
const MODES = [
  { id: 'standard', label: 'Standard', line: 'Two rounds, Daily Doubles, Final Jeopardy, a 30 second clock.' },
  { id: 'speed', label: 'Speed', line: 'One round on a 15 second clock, no Final Jeopardy.' },
];

/* The pad is a fixed pixel canvas, so its size is a prop rather than CSS.
   A name drawn with a mouse wants room; a thumb on a phone does not have it. */
const DESK_PAD = { width: 460, height: 150 };
const PHONE_PAD = { width: 300, height: 80 };

const PLAYERS = 3;
/* Somebody joins, then a beat, then the next one. They are seated together on
   the server; arriving together on screen is what makes three strangers look
   like a switch being thrown. */
const ARRIVAL_GAP_MS = 1100;
const LEAVE_FOR_GAME_MS = 3400;

export default function QuickplayPage() {
  usePageTitle('Quickplay');
  const navigate = useNavigate();
  const onDesk = useMediaQuery('(min-width: 821px)');
  const [displayName, setDisplayName] = useState('');
  const [signature, setSignature] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [phase, setPhase] = useState('setup'); // 'setup' | 'looking' | 'found' | 'nomatch'
  const [mode, setMode] = useState('standard');
  const [arrived, setArrived] = useState(1);

  const {
    isConnected, matchFound, noMatch, queueTime, timings, joinQueue, leaveQueue,
  } = useMatchmaking();
  const { user, isGuest, sessionId } = useUserStore();

  /* The name that goes on the card: the one just drawn, else the one saved on
     the account. Whether the pad is shown is a separate question, and it turns
     on the SAVED name only. Asking it about `myName` hid the pad the instant
     the first stroke landed, because a stroke is a signature. */
  const savedName = user?.signature || null;
  const myName = signature || savedName;
  const showPad = !savedName || drawing;

  useEffect(() => {
    if (user?.displayName) setDisplayName(user.displayName);
    else if (isGuest) setDisplayName(`Player${Math.floor(Math.random() * 1000)}`);
  }, [user, isGuest]);

  /* The phase follows the player's own actions (join, cancel, try again), not
     isInQueue: that is what the server last confirmed, and it stays true for
     a moment after a cancel, until the queue-left ack. An effect that pushed
     the phase back to 'looking' whenever isInQueue was true undid every
     cancel, and the clock stayed up with nothing coming. */
  useEffect(() => { if (noMatch) setPhase('nomatch'); }, [noMatch]);

  /* Everyone is in. They are shown arriving one at a time, then the game. */
  useEffect(() => {
    if (!matchFound) return undefined;
    setPhase('found');
    setArrived(1);
    const timers = matchFound.players.slice(1).map((_, i) =>
      setTimeout(() => setArrived(i + 2), 300 + i * ARRIVAL_GAP_MS));

    timers.push(setTimeout(() => {
      /* The room store is set up for the game page to finish. The players are
         deliberately NOT written here and no fresh-join flag is set: the game
         page then asks the server for the room the way a reload does, which
         joins the socket to the room and brings back whatever has already
         happened in it. Setting the players by hand skipped that, the socket
         never joined the room, and a quickplay game sat in a lobby nobody
         could hear. */
      const room = useRoomStore.getState();
      room.resetRoom();
      room.setRoomCode(matchFound.roomCode);
      room.setRoomType('quickplay');
      if (matchFound.settings) room.updateSettings(matchFound.settings);
      navigate(`/game/${matchFound.roomCode}`);
    }, LEAVE_FOR_GAME_MS));

    return () => timers.forEach(clearTimeout);
  }, [matchFound, navigate]);

  const handleFind = () => {
    if (!myName) return;
    const name = displayName.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    joinQueue(name, myName, mode);
    setPhase('looking');
  };

  const handleCancel = () => {
    leaveQueue();
    setPhase('setup');
  };

  const me = useMemo(() => ({ id: sessionId, displayName, signature: myName }), [sessionId, displayName, myName]);
  const chosen = MODES.find((m) => m.id === mode) ?? MODES[0];

  /* ── setup ─────────────────────────────────────────────── */
  if (phase === 'setup' || phase === 'nomatch') {
    const rows = [
      { key: 'you', player: myName ? me : null, isYou: true, status: 'You', label: 'Draw your name' },
      { key: 'two', player: null, status: 'Player two', label: 'Waiting' },
      { key: 'three', player: null, status: 'Player three', label: 'Waiting' },
    ];
    return (
      <Studio title="Quickplay" className="quickplay-page" right={<Live isConnected={isConnected} isConnecting={!isConnected} />}>
        <div className="st-two">
          <div className="st-stack">
            <MiniBoard
              dim
              values={[200, 400, 600]}
              /* Decoration: a board waiting to be dealt. Short names, because
                 this preview is six narrow cells on a phone. */
              categories={['Capitals', 'The body', 'Opera', 'Numbers', 'Movies', 'Rivers']}
            />
            <p className="st-caption">The board stays dark until all three players are in.</p>
            <div className="st-field">
              <span className="st-field-label">Which mode?</span>
              <Seg
                ariaLabel="Which mode"
                value={mode}
                onChange={setMode}
                options={MODES.map((m) => ({ value: m.id, label: m.label }))}
              />
              <span className="st-hint">{chosen.line}</span>
            </div>
          </div>

          <div className="st-stack">
            {phase === 'nomatch' && (
              <p className="st-error">
                Nobody else was looking and the game could not be filled. Try again in a moment.
              </p>
            )}
            <Roster rows={rows} count={`1 of ${PLAYERS}`} />
            {showPad ? (
              <div className="qp-pad">
                <SignatureCanvas onSignatureChange={setSignature} {...(onDesk ? DESK_PAD : PHONE_PAD)} />
              </div>
            ) : (
              <div className="st-saved-name">
                {/* The name itself, not a sentence about it. Someone with an
                    account has already drawn this; telling them "your name is
                    on your card" asks them to take on trust the one thing that
                    is right here and was the whole point of drawing it. */}
                <div className="st-plate is-you">
                  <img src={savedName} alt="The name you drew" />
                </div>
                <button type="button" className="st-rules-open" onClick={() => setDrawing(true)}>Draw a new one</button>
              </div>
            )}
            <Btn wide onClick={handleFind} disabled={!isConnected || !myName} className="qp-find">
              {isConnected ? 'Find a game' : 'Connecting'}
            </Btn>
            <p className="st-note is-centred">
              If nobody else turns up, other players join you after about twenty seconds,
              so the game starts anyway.
            </p>
          </div>
        </div>
      </Studio>
    );
  }

  /* ── looking, and everyone arriving ────────────────────── */
  const found = phase === 'found' && matchFound ? matchFound.players : null;
  const inSoFar = found ? Math.min(arrived, found.length) : 1;
  const rows = Array.from({ length: PLAYERS }, (_, i) => {
    if (!found) {
      return i === 0
        ? { key: 'you', player: me, isYou: true, status: 'You' }
        : { key: i, player: null, waiting: true, status: i === 1 ? 'Player two' : 'Player three', label: 'Waiting' };
    }
    const p = found[i];
    const here = i < inSoFar;
    return {
      key: p?.id ?? i,
      player: here ? p : null,
      isYou: p?.id === sessionId,
      waiting: true,
      status: here ? (p?.id === sessionId ? 'You' : 'Joined') : 'Waiting',
      label: 'Waiting',
    };
  });

  const justArrived = found && inSoFar > 1 ? found[inSoFar - 1] : null;

  return (
    <Studio title="Quickplay" className="quickplay-page" right={<Live isConnected={isConnected} isConnecting={!isConnected} />}>
      <div className="st-middle qp-wait">
        <Clock seconds={queueTime} label={found ? 'Everyone in' : 'Looking'} />
        <div className="qp-wait-roster">
          <Roster rows={rows} count={`${inSoFar} of ${PLAYERS}`} />
        </div>
        <div className="st-stack is-centred">
          <h2 className="qp-state" data-state={found ? 'found' : 'looking'}>
            {found
              ? (inSoFar < found.length && justArrived
                ? `${justArrived.displayName} joined`
                : 'Everyone is in')
              : 'Looking for players'}
          </h2>
          <p className="st-note is-centred">
            {found
              ? 'Taking you to the board.'
              : isConnected
                ? 'Most games start inside half a minute.'
                : 'Connection lost. Reconnecting, then looking again.'}
          </p>
          {!found && <Ghost onClick={handleCancel} className="qp-cancel">Cancel</Ghost>}
        </div>
      </div>
      {/* The thresholds the server sent, kept out of sight: the wait is a
          clock counting up, not a countdown to a mark. */}
      <span hidden data-fill-after={timings.fillAfterMs} />
    </Studio>
  );
}
