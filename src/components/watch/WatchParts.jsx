import { useEffect, useRef, useState } from 'react';
import { Money } from '../game/BoardChrome';
import { CLOSE_NOTE } from '../../utils/typedClue';
import { canPlayFinalJeopardy, clampFinalWager, finalWagerLimit, wagerEntry } from '../../utils/wagers';

/* What watching along alone and watching together both draw: the question
   when the video stops, what the last one came to, and the way to start. */

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;

/** The play mark, drawn: the ▶ character is a colour emoji on some phones. */
export function PlayMark() {
  return (
    <svg viewBox="0 0 10 12" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M0 0L10 6L0 12Z" />
    </svg>
  );
}

export function StartButton({ onStart, label = 'Start the episode' }) {
  return (
    <button className="plain-btn wa-start" onClick={onStart}>
      <span className="wa-start-mark"><PlayMark /></span>
      {label}
    </button>
  );
}

/**
 * The clue the video stopped for, and the player's response to it. Final
 * asks for a wager first. `onAnswer(given, wager)` resolves to { retry } for
 * a close spelling, which gets one more go; anything else and it is done.
 */
export function AskPanel({ stop, score, onAnswer, onPass, waiting = null }) {
  const [given, setGiven] = useState('');
  const [wager, setWager] = useState(stop.final ? null : 0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  useEffect(() => { setTimeout(() => input.current?.focus(), 0); }, [wager]);

  const where = stop.final ? `Final Jeopardy · ${stop.category}` : `${stop.category} · $${stop.clue.points}`;
  const blocked = stop.final && !canPlayFinalJeopardy(score);

  const submit = async (e) => {
    e.preventDefault();
    if (!given.trim() || busy) return;
    setBusy(true);
    const result = await onAnswer(given, wager);
    setBusy(false);
    if (result?.retry) setNote(CLOSE_NOTE);
  };

  return (
    <form className="wa-ask" onSubmit={submit}>
      <p className="wa-ask-where">{where}</p>
      <p className="wa-ask-clue">{stop.clue.answer}</p>

      {blocked ? (
        <>
          <p className="wa-note">Final Jeopardy takes a score above zero to wager. Watch how it ends.</p>
          <div className="wa-ask-do">
            <button type="button" className="btn-primary" onClick={onPass}>Keep watching</button>
          </div>
        </>
      ) : wager === null ? (
        <WagerEntry limit={finalWagerLimit(score)} inputRef={input} onWager={setWager} />
      ) : (
        <>
          {stop.final && <p className="wa-note">Wagering {money(clampFinalWager(wager, score))}</p>}
          <input
            ref={input}
            className="wa-input"
            value={given}
            onChange={(e) => setGiven(e.target.value)}
            placeholder="What is..."
            aria-label="Your response"
            autoComplete="off"
          />
          {note && <p className="wa-note">{note}</p>}
          <div className="wa-ask-do">
            <button type="submit" className="btn-primary" disabled={!given.trim() || busy}>Answer</button>
            {onPass && <button type="button" className="plain-btn wa-word" onClick={onPass}>Pass</button>}
            {waiting && <span className="wa-waiting">{waiting}</span>}
          </div>
        </>
      )}
    </form>
  );
}

/** Final's wager: up to the whole score, as the show allows. */
function WagerEntry({ limit, inputRef, onWager }) {
  const [text, setText] = useState('');
  const amount = Math.min(Number(wagerEntry(text)) || 0, limit);
  return (
    <div className="wa-wager">
      <label className="wa-note" htmlFor="wa-wager">Wager up to {money(limit)}</label>
      <input
        id="wa-wager"
        ref={inputRef}
        className="wa-input"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(wagerEntry(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onWager(amount); } }}
        placeholder="0"
      />
      <div className="wa-ask-do">
        <button type="button" className="btn-primary" onClick={() => onWager(amount)}>Wager {money(amount)}</button>
      </div>
    </div>
  );
}

/**
 * A clue up in a room, with the buzzer open: the first to ring in answers.
 * The space bar rings in too, as a buzzer on a desk would.
 */
export function BuzzPanel({ stop, onBuzz, note }) {
  useEffect(() => {
    if (!onBuzz) return undefined;
    const key = (e) => {
      if (e.code !== 'Space' || e.target.closest?.('input, textarea')) return;
      e.preventDefault();
      onBuzz();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onBuzz]);

  return (
    <div className="wa-ask">
      <p className="wa-ask-where">{stop.category} · ${stop.clue.points}</p>
      <p className="wa-ask-clue">{stop.clue.answer}</p>
      <div className="wa-ask-do">
        {onBuzz && <button type="button" className="btn-primary wa-buzz" onClick={onBuzz}>Buzz in</button>}
        {note && <span className="wa-waiting">{note}</span>}
      </div>
    </div>
  );
}

/** What the last response came to, in the board's own type: "RIGHT $200". */
export function Verdict({ result, onOverrule }) {
  if (!result) return null;
  return (
    <p className="wa-verdict" aria-live="polite">
      <span className="wa-verdict-word">{result.passed ? 'Passed' : result.correct ? 'Right' : 'Wrong'}</span>
      {!result.passed && <span className="wa-verdict-money"><Money value={result.points} /></span>}
      {!result.passed && !result.correct && onOverrule && (
        <button className="plain-btn wa-word" onClick={onOverrule}>I had it</button>
      )}
    </p>
  );
}
