import { useEffect, useState } from 'react';
import { Btn, Ghost, MiniBoard } from '../studio/Studio';
import HouseRules from '../studio/HouseRules';

/**
 * Single player: name it, and watch the board get written.
 *
 * The whole promise of the mode is that a board can be about anything, so the
 * screen is one question and the board it produces. The board is on screen
 * the entire time: empty while you think, filling in as the categories land,
 * lit when it is ready to play. There is nothing to browse and no list to
 * pick from, and the step where you approved the categories on a separate
 * screen has been folded in here, because renaming a header is a thing you do
 * to a board you are looking at.
 */
const STEP_MS = 240;

export default function SoloWriter({
  onDesk = false,
  topic,
  categories = [],
  phase,            // 'setup' | 'categoryEdit'
  loading = false,
  error = null,
  onWrite,          // (topic) => write the categories
  onRename,         // (index, name)
  onPlay,           // write the clues and start
  onTestBoard = null,
}) {
  const [draft, setDraft] = useState(topic || '');
  /* The categories arrive together. They are revealed one at a time so the
     board looks written rather than pasted, which is also what gives the eye
     time to read six new names. */
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!categories.length) { setShown(0); return undefined; }
    setShown(0);
    const timers = categories.map((_, i) => setTimeout(() => setShown(i + 1), (i + 1) * STEP_MS));
    return () => timers.forEach(clearTimeout);
  }, [categories]);

  const writing = loading && phase === 'setup';
  const writingClues = loading && phase === 'categoryEdit';
  const revealed = categories.slice(0, shown);
  const ready = phase === 'categoryEdit' && shown >= categories.length && !loading;

  const submit = (e) => {
    e.preventDefault();
    if (draft.trim() && !loading) onWrite(draft.trim());
  };

  return (
    <div className="st-two">
      <div className="st-stack">
        {phase === 'setup' ? (
          <form className="st-field" onSubmit={submit}>
            <label className="st-field-label is-big" htmlFor="solo-topic">
              What is tonight&apos;s board about?
            </label>
            <input
              id="solo-topic"
              className="st-input is-big solo-input"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Space, 90s pop, the Roman Empire"
              autoComplete="off"
              disabled={loading}
            />
            <span className="st-hint">
              Anything. A century, a band, your home town, a TV show. Six categories
              and thirty clues get written about it.
            </span>
            <div className="st-actions solo-actions">
              <Btn type="submit" disabled={!draft.trim() || loading} className="solo-write">
                {writing ? 'Writing' : 'Write the board'}
              </Btn>
              {onTestBoard && <Ghost onClick={onTestBoard} className="solo-test">Use the test board</Ghost>}
            </div>
          </form>
        ) : (
          <div className="st-stack">
            <span className="st-field-label is-big">{topic}</span>
            <p className="st-note">
              Tap any category to rename it. The clues get written when you play.
            </p>
          </div>
        )}

        {error && <p className="st-error">{error}</p>}
        <HouseRules showDifficulty alwaysOpen={onDesk} />
      </div>

      <div className="st-stack">
        <MiniBoard
          categories={revealed}
          filledColumns={writingClues ? 0 : shown}
          onRename={phase === 'categoryEdit' ? onRename : null}
          disabled={loading}
        />
        {/* What the board is waiting on. Before a topic is named it is a
            list of what you will get; once the writing starts it is progress. */}
        <div className="st-checklist">
          {phase === 'setup' && !writing ? (
            <>
              <span className="st-check is-todo"><i aria-hidden="true" /><span>Six categories</span></span>
              <span className="st-check is-todo"><i aria-hidden="true" /><span>Thirty clues</span></span>
              <span className="st-check is-todo"><i aria-hidden="true" /><span>A Daily Double, hidden</span></span>
            </>
          ) : (
            <>
              {Array.from({ length: 6 }, (_, i) => {
                const name = revealed[i];
                const state = name ? 'is-done' : (writing || i === shown) ? 'is-now' : 'is-todo';
                return (
                  <span className={`st-check ${state}`} key={i}>
                    <i aria-hidden="true" />
                    <span>{name || (i === shown || writing ? 'Writing a category' : 'To come')}</span>
                  </span>
                );
              })}
              <span className={`st-check ${writingClues ? 'is-now' : 'is-todo'}`}>
                <i aria-hidden="true" />
                <span>{writingClues ? 'Writing thirty clues' : 'Thirty clues'}</span>
              </span>
            </>
          )}
        </div>
        {phase === 'categoryEdit' && (
          <>
            <Btn wide onClick={onPlay} disabled={!ready} className="solo-play">
              {writingClues ? 'Writing the clues' : 'Play this board'}
            </Btn>
            {!ready && !writingClues && <p className="st-note is-centred">Still writing</p>}
          </>
        )}
      </div>
    </div>
  );
}
