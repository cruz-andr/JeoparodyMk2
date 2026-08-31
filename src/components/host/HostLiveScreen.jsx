import { useEffect, useMemo, useRef, useState } from 'react';
import GameBoard from '../game/GameBoard';
import MediaClueDisplay from '../media/MediaClueDisplay';
import { socketClient } from '../../services/socket/socketClient';
import {
  cluesLeft, hostStage, isWindowMode, money, primaryAction, reaction, stageHeading, standings,
} from './liveStage';
import { CHANNEL, forProjector } from './projectorFeed';
import './HostLiveScreen.css';

const ROUND_NAME = { 1: 'Round one', 2: 'Double Jeopardy' };

/**
 * The host's screen while the game is running.
 *
 * It replaces a draggable panel that floated over the board. The panel had
 * every control on it at once and covered whatever was underneath, so a host
 * had to hunt for the button that mattered and then move the thing out of the
 * way. This is a fixed rail beside the board: it always says what is happening
 * and offers the one action that moment calls for.
 *
 * The host is not a player. They have no score, never buzz and never answer,
 * so none of the player screen belongs here.
 */
export default function HostLiveScreen({
  roomCode,
  players = [],
  categories = [],
  questions = [],
  revealedQuestions = new Set(),
  currentRound = 1,
  currentQuestion,
  answerMode = 'verbal',
  projectorMode = false,
  buzzerOpen = false,
  answerWindowOpen = false,
  buzzedPlayerId = null,
  buzzedReactionTime = null,
  answers = [],
  submittedPlayerIds = [],
  isDailyDouble = false,
  dailyDoublePhase = null,
  showAnswer = false,
  onQuestionSelect,
  onLeave,
}) {
  const [adjusting, setAdjusting] = useState(null);
  const [delta, setDelta] = useState('');
  const [confirmKick, setConfirmKick] = useState(null);
  const [revealed, setRevealed] = useState(false);
  /* Who has already had their shot at this clue and got it wrong. The server
     keeps the buzzer shut to them; this is so the host can see why the rail
     went back to waiting instead of moving on. */
  const [wrongSoFar, setWrongSoFar] = useState([]);
  const projector = useRef(null);
  const channelRef = useRef(null);

  const stage = hostStage({
    currentQuestion, answerMode, isDailyDouble, dailyDoublePhase,
    buzzerOpen, answerWindowOpen, buzzedPlayerId, answers,
  });
  const windowed = isWindowMode(answerMode);
  const action = primaryAction(stage, answerMode);
  const rows = useMemo(() => standings(players), [players]);
  const left = cluesLeft(questions, revealedQuestions);
  const buzzed = players.find((p) => p.id === buzzedPlayerId) ?? null;
  const waitingOn = rows.filter((p) => !submittedPlayerIds.includes(p.id));

  const send = (event, extra = {}) => socketClient.emit(event, { roomCode, ...extra });

  const judge = (player, correct) => {
    if (!correct) {
      const name = player.displayName || player.name || player.playerName;
      if (name) setWrongSoFar((prev) => (prev.includes(name) ? prev : [...prev, name]));
    }
    send('host:judge-answer', { playerId: player.id ?? player.playerId, correct });
  };

  /* Everyone who has not answered wrong yet. The server decides who may buzz;
     this only names them, because "waiting for a buzz" a second time is
     confusing without saying who is left. */
  const stillIn = rows.filter((p) => !wrongSoFar.includes(p.displayName || p.name));

  /* Anything half-finished belongs to the clue it was started on. Carrying an
     open adjust field or a half-typed kick across to the next clue put the
     host one stray Enter away from changing the wrong score. */
  useEffect(() => {
    setAdjusting(null);
    setDelta('');
    setConfirmKick(null);
    setRevealed(false);
    setWrongSoFar([]);
  }, [currentQuestion?.category, currentQuestion?.points]);

  /* What the wall is shown, rebuilt whenever anything it depends on moves.
     forProjector picks the fields out by hand so the response cannot travel;
     this only decides when to send. */
  const feed = useMemo(() => forProjector({
    categories, questions, revealed: [...revealedQuestions], currentRound,
    currentQuestion, players, buzzedPlayerId, buzzerOpen, showAnswer,
  }), [categories, questions, revealedQuestions, currentRound, currentQuestion,
    players, buzzedPlayerId, buzzerOpen, showAnswer]);

  const feedRef = useRef(feed);
  feedRef.current = feed;

  useEffect(() => {
    if (!projectorMode || typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(CHANNEL(roomCode));
    /* A projector window opened mid game has missed every update so far, so it
       asks and gets the current state rather than a blank screen until the
       next thing happens. */
    channel.onmessage = (event) => {
      if (event.data?.ask) channel.postMessage(feedRef.current);
    };
    channelRef.current = channel;
    channel.postMessage(feedRef.current);
    return () => { channelRef.current = null; channel.close(); };
  }, [projectorMode, roomCode]);

  useEffect(() => { channelRef.current?.postMessage(feed); }, [feed]);

  const applyDelta = (playerId) => {
    const by = Number(delta);
    if (!Number.isFinite(by) || by === 0) { setAdjusting(null); setDelta(''); return; }
    const player = players.find((p) => p.id === playerId);
    send('host:override-score', {
      playerId, newScore: (player?.score || 0) + by, reason: 'Host adjustment',
    });
    setAdjusting(null);
    setDelta('');
  };

  /* A separate window rather than this one. In projector mode the host's screen
     goes on the wall, and this screen shows the answer, so the two cannot be
     the same surface. Presenter view, the way slides have always done it. */
  const openProjector = () => {
    const url = `${window.location.origin}/project/${roomCode}`;
    if (projector.current && !projector.current.closed) { projector.current.focus(); return; }
    projector.current = window.open(url, `projector-${roomCode}`, 'width=1280,height=800');
  };

  return (
    <div className="hl">
      <header className="hl-top">
        <button className="plain-btn quiet-action hl-leave" onClick={onLeave}>
          &lsaquo; End the game
        </button>

        <span className="hl-where">
          {ROUND_NAME[currentRound] ?? `Round ${currentRound}`}
          <span className="hl-dot">·</span>
          {left} {left === 1 ? 'clue' : 'clues'} left
        </span>

        <div className="hl-top-right">
          {projectorMode && (
            <button className="plain-btn quiet-action hl-project" onClick={openProjector}>
              Open the board on the projector
            </button>
          )}
          <span className="hl-room">
            Room <b>{roomCode}</b>
          </span>
        </div>
      </header>

      <div className="hl-main">
        <div className="hl-board">
          <GameBoard
            categories={categories}
            questions={questions}
            pointValues={currentRound === 1 ? [200, 400, 600, 800, 1000] : [400, 800, 1200, 1600, 2000]}
            onQuestionSelect={onQuestionSelect}
            revealedQuestions={revealedQuestions}
            /* Opening a second clue over the top of a live one would score the
               wrong board cell, so the board only takes a pick between clues. */
            disabled={Boolean(currentQuestion)}
            players={players}
          />
        </div>

        <aside className="hl-rail" aria-label="Host controls">
          <h2 className="hl-stage">{stageHeading(stage, answerMode)}</h2>

          {!currentQuestion ? (
            <p className="hl-quiet">
              {rows.length
                ? 'Nothing is open. Choose the next clue from the board.'
                : 'Nobody has joined yet. Read out the room code.'}
            </p>
          ) : (
            <>
              <div className="hl-clue">
                <p className="hl-clue-where">
                  {currentQuestion.category}<span className="hl-dot">·</span>${currentQuestion.points}
                </p>
                {currentQuestion.mediaType && (
                  <MediaClueDisplay question={currentQuestion} compact roomCode={roomCode} />
                )}
                <p className="hl-clue-text">{currentQuestion.answer}</p>

                {/* The answer, plainly. This screen is the host's, so there is
                    no reason to make them work for it. */}
                <p className="hl-answer-label">The answer</p>
                <p className="hl-answer">{currentQuestion.question}</p>
              </div>

              {/* A wrong answer does not end the clue: whoever has not buzzed
                  gets a go. Without saying so, the rail dropping back to
                  "waiting for a buzz" looks like nothing happened. */}
              {stage === 'waiting' && !windowed && wrongSoFar.length > 0 && (
                <p className="hl-again">
                  {wrongSoFar.join(' and ')} {wrongSoFar.length === 1 ? 'was' : 'were'} wrong.
                  {stillIn.length
                    ? ` ${stillIn.map((p) => p.displayName || p.name).join(', ')} can still buzz.`
                    : ' Nobody else can buzz.'}
                </p>
              )}

              {action && (
                <button className="hl-do" onClick={() => send(action.event)}>
                  {action.label}
                </button>
              )}

              {stage === 'wagering' && (
                <p className="hl-quiet">
                  The player is choosing what to risk. The clue opens once they
                  have.
                </p>
              )}

              {/* Verbal: one person buzzed, and the verdict is about them. */}
              {stage === 'judging' && !windowed && buzzed && (
                <div className="hl-judge">
                  <p className="hl-buzzed">
                    <b>{buzzed.displayName || buzzed.name}</b>
                    {buzzedReactionTime != null && (
                      <span className="hl-react">{reaction(buzzedReactionTime)}</span>
                    )}
                  </p>
                  <div className="hl-verdict">
                    <button className="hl-right" onClick={() => judge(buzzed, true)}>
                      Right <span className="hl-worth">+{money(currentQuestion.points)}</span>
                    </button>
                    <button className="hl-wrong" onClick={() => judge(buzzed, false)}>
                      Wrong <span className="hl-worth">-{money(currentQuestion.points)}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Typed, tapped and auto graded: a verdict per submission. */}
              {windowed && answers.length > 0 && (
                <div className="hl-answers">
                  {answers.map((entry) => {
                    const who = players.find((p) => p.id === entry.playerId);
                    const graded = entry.autoGradeResult;
                    return (
                      <div key={entry.playerId} className="hl-answer-row">
                        <p className="hl-answer-who">
                          {who?.displayName || who?.name || entry.playerName}
                          {graded && (
                            <span className={`hl-graded ${graded.isCorrect ? 'is-right' : 'is-wrong'}`}>
                              {graded.isCorrect ? 'reads as right' : 'reads as wrong'}
                              {' '}{Math.round(graded.confidence * 100)}%
                            </span>
                          )}
                        </p>
                        <p className="hl-answer-said">{entry.answer}</p>
                        <div className="hl-verdict is-small">
                          <button className="hl-right" onClick={() => judge(entry, true)}>
                            Right
                          </button>
                          <button className="hl-wrong" onClick={() => judge(entry, false)}>
                            Wrong
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!revealed && (
                    <button
                      className="plain-btn quiet-action hl-reveal"
                      onClick={() => { send('host:reveal-answers'); setRevealed(true); }}
                    >
                      Show everyone the answers
                    </button>
                  )}
                </div>
              )}

              {/* Who is still out. Named, because "3 of 5" does not tell a host
                  whose name to say out loud. */}
              {windowed && answerWindowOpen && waitingOn.length > 0 && (
                <p className="hl-waiting">
                  Still answering: {waitingOn.map((p) => p.displayName || p.name).join(', ')}
                </p>
              )}

              <button className="plain-btn quiet-action hl-skip" onClick={() => send('host:skip-question')}>
                Nobody got it, move on
              </button>
            </>
          )}
        </aside>
      </div>

      <footer className="hl-scores">
        {rows.length === 0 && <span className="hl-quiet">Waiting for players</span>}
        {rows.map((player) => (
          <div key={player.id} className="hl-score">
            <span className="hl-name">{player.displayName || player.name}</span>
            <span className={`hl-money ${player.score < 0 ? 'is-negative' : ''}`}>
              {money(player.score)}
            </span>

            {adjusting === player.id ? (
              <span className="hl-adjust">
                <input
                  type="number"
                  className="hl-delta"
                  value={delta}
                  autoFocus
                  placeholder="+200"
                  aria-label={`Change ${player.displayName || player.name}'s score by`}
                  onChange={(e) => setDelta(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyDelta(player.id);
                    if (e.key === 'Escape') { setAdjusting(null); setDelta(''); }
                  }}
                />
                <button className="plain-btn quiet-action" onClick={() => applyDelta(player.id)}>Apply</button>
              </span>
            ) : confirmKick === player.id ? (
              /* Not window.confirm: it steals focus from a host who is mid
                 game and looks like the browser, not the room. */
              <span className="hl-adjust">
                <span className="hl-sure">Remove them?</span>
                <button
                  className="plain-btn quiet-action hl-yes"
                  onClick={() => { send('host:kick-player', { playerId: player.id }); setConfirmKick(null); }}
                >
                  Remove
                </button>
                <button className="plain-btn quiet-action" onClick={() => setConfirmKick(null)}>Keep</button>
              </span>
            ) : (
              <span className="hl-adjust">
                <button
                  className="plain-btn quiet-action"
                  onClick={() => { setAdjusting(player.id); setConfirmKick(null); }}
                >
                  Adjust
                </button>
                <button
                  className="plain-btn quiet-action"
                  onClick={() => { setConfirmKick(player.id); setAdjusting(null); }}
                >
                  Remove
                </button>
              </span>
            )}
          </div>
        ))}
      </footer>
    </div>
  );
}
