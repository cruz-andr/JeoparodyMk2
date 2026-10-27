import { useEffect, useRef, useState } from 'react';
import './TypedResponse.css';

/**
 * The response box for a game the server grades: quickplay, where the player
 * holding the buzz or the Daily Double types what they would say and the
 * server decides. There is no response on this screen to check it against;
 * the player is never sent one before the clue is over.
 *
 * `close` is the server saying the spelling is nearly there: one more go,
 * without saying what it is nearly.
 */
export default function TypedResponse({ onSubmit, close = false }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const input = useRef(null);

  // A close answer hands the box back for a second try.
  useEffect(() => {
    if (!close) return;
    setSent(false);
    input.current?.focus();
    input.current?.select();
  }, [close]);

  const submit = (e) => {
    e.preventDefault();
    if (sent || !text.trim()) return;
    setSent(true);
    onSubmit(text.trim());
  };

  return (
    <form className="typed-response" onSubmit={submit}>
      {close && !sent && <p className="typed-response-close">Close. Check the spelling and try again.</p>}
      <input
        ref={input}
        className="typed-response-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What is..."
        aria-label="Your response"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus
        disabled={sent}
        maxLength={200}
      />
      <button className="btn-primary typed-response-submit" type="submit" disabled={sent || !text.trim()}>
        {sent ? 'Checking...' : 'Submit'}
      </button>
    </form>
  );
}
