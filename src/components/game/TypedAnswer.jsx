import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import './TypedAnswer.css';

/**
 * The typed answer box and the verdict card, one of each for every mode that
 * types: The Board, the Sixer, solo play, and a room. They used to be two
 * different boxes and three different ways of saying how it went.
 */

/**
 * The box. `note` says what just happened ("close") and `hint` is the shape
 * of the answer, both above it. Where the server grades, `awaiting` holds the
 * box shut on "Checking" between a submit and its answer, and `retry`
 * changing hands it back for another go at the spelling, text kept.
 */
export function TypedAnswerForm({ onSubmit, note = null, hint = null, awaiting = false, retry = 0 }) {
  const [entry, setEntry] = useState('');
  const [sent, setSent] = useState(false);
  const input = useRef(null);
  /* Autofocus is a desktop convenience. On a phone it throws the keyboard up
     over the clue the moment it appears, so the clue is read around it. */
  const isPhone = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    if (!retry) return;
    setSent(false);
    input.current?.focus();
    input.current?.select();
  }, [retry]);

  const checking = awaiting && sent;

  return (
    <>
      {note && <p className="typed-note" role="status">{note}</p>}
      {hint && (
        <p className="typed-hint" aria-label={`Hint: ${hint.replace(/_/g, 'blank')}`}>
          {hint}
        </p>
      )}
      <form
        className="typed-form"
        onSubmit={(e) => {
          e.preventDefault();
          const given = entry.trim();
          if (!given || checking) return;
          setSent(true);
          onSubmit?.(given);
        }}
      >
        <input
          ref={input}
          type="text"
          className="typed-input"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          placeholder="What is…"
          aria-label="Your response"
          autoFocus={!isPhone}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck="false"
          enterKeyHint="done"
          maxLength={200}
          disabled={checking}
        />
        <button type="submit" className="typed-submit" disabled={!entry.trim() || checking}>
          {checking ? 'Checking…' : 'Submit'}
        </button>
      </form>
    </>
  );
}

/**
 * The verdict: how it went, what was said, the correct response once it is
 * out, and whatever comes next (Continue, "I was right"). `tone` is correct,
 * incorrect or passed.
 */
export function TypedVerdict({ tone, label, said = null, truth = null, children = null }) {
  return (
    <motion.div
      className="typed-result"
      /* The verdict replaces the input in place; without this it is
         announced to nobody. */
      aria-live="polite"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className={`typed-badge ${tone}`}>{label}</div>
      {said && <p className="typed-said">{said}</p>}
      {truth && (
        <p className="typed-truth">
          Correct response: <span>{truth}</span>
        </p>
      )}
      {children && <div className="typed-after">{children}</div>}
    </motion.div>
  );
}
