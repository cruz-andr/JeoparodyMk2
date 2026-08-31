import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MediaAttachment from '../setup/MediaAttachment';
import './BoardGridEditor.css';

const POINTS = [200, 400, 600, 800, 1000];
const CATEGORIES = 6;

/**
 * The board is the editor.
 *
 * A Jeopardy board is a 6x5 grid and it is the most recognisable object we
 * have, so you build one by clicking the cell you want to write, exactly the
 * way a player clicks the cell they want to answer. That also gives the
 * progress meter away for nothing: the empty cells are the list of what is
 * left, and you can see it from across the room.
 *
 * There is no Daily Double control here on purpose. Daily Doubles are placed
 * when a game starts, from the player's settings, and are not stored on a
 * clue. A switch that looked like it set one would be a switch that did
 * nothing.
 */

/** Below this the grid stops being a grid you can hit with a thumb. */
function useNarrow(query = '(max-width: 820px)') {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const listen = (e) => setNarrow(e.matches);
    mq.addEventListener('change', listen);
    setNarrow(mq.matches);
    return () => mq.removeEventListener('change', listen);
  }, [query]);

  return narrow;
}

const isWritten = (q) => Boolean(q?.answer?.trim() && q?.question?.trim());

export default function BoardGridEditor({ board, onChange }) {
  const narrow = useNarrow();
  const [at, setAt] = useState({ kind: 'clue', c: 0, r: 0 });
  const gridRef = useRef(null);
  const clueRef = useRef(null);
  const nameRef = useRef(null);
  const panelRef = useRef(null);
  const pagerRef = useRef(null);
  const lastAt = useRef(at);

  /* Memoised so the identity is stable: `board?.categories ?? []` mints a new
     array on every render when the board is missing, which would make the
     count below recompute forever. */
  const categories = useMemo(() => board?.categories ?? [], [board]);
  const here = at.kind === 'clue' ? categories[at.c]?.questions?.[at.r] : null;

  const written = useMemo(
    () => categories.reduce((n, c) => n + (c.questions ?? []).filter(isWritten).length, 0),
    [categories]
  );

  // ---------------------------------------------------------------- edits

  /* On a phone the panel is under the board, so tapping a row selected a clue
     whose fields were off the bottom of the screen: you had to tap, then hunt.
     Bringing the panel up is the interaction, not a nicety.

     Guarded on the identity of the selection rather than on a "first render"
     flag. StrictMode mounts, unmounts and mounts again on the same instance,
     so a flag is already spent by the second pass and the page opened part
     way down. setAt always makes a new object, so a change is a change and a
     remount is not. */
  useEffect(() => {
    if (!narrow || lastAt.current === at) return;
    lastAt.current = at;

    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    /* And the tab you are on has to be one you can see: six categories do not
       fit across a phone. */
    pagerRef.current?.children?.[at.c]?.scrollIntoView({
      behavior: 'smooth', block: 'nearest', inline: 'nearest',
    });
  }, [at, narrow]);

  const editClue = useCallback((c, r, patch) => {
    onChange({
      ...board,
      categories: board.categories.map((category, ci) =>
        ci !== c ? category : {
          ...category,
          questions: category.questions.map((q, ri) => (ri !== r ? q : { ...q, ...patch })),
        }
      ),
    });
  }, [board, onChange]);

  const editName = useCallback((c, name) => {
    onChange({
      ...board,
      categories: board.categories.map((category, ci) =>
        ci !== c ? category : { ...category, name }
      ),
    });
  }, [board, onChange]);

  const clearClue = () => editClue(at.c, at.r, {
    answer: '', question: '', mediaType: null, mediaData: null,
    youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
  });

  /* Walks the board the way it is read, down a category and on to the next,
     rather than jumping to whichever empty cell happens to be first. */
  const nextEmpty = () => {
    for (let step = 1; step <= CATEGORIES * POINTS.length; step += 1) {
      const flat = (at.c * POINTS.length + at.r + step) % (CATEGORIES * POINTS.length);
      const c = Math.floor(flat / POINTS.length);
      const r = flat % POINTS.length;
      if (!isWritten(categories[c]?.questions?.[r])) {
        setAt({ kind: 'clue', c, r });
        window.requestAnimationFrame(() => clueRef.current?.focus());
        return;
      }
    }
  };

  // ---------------------------------------------------------------- keys

  /* Arrows move around the board, Enter drops into the writing. Thirty clues
     is a lot of typing and reaching for the mouse between each one is the
     difference between finishing a board and abandoning one. */
  const onGridKey = (event) => {
    const { key } = event;
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];

    if (move) {
      event.preventDefault();
      const [dc, dr] = move;
      const c = Math.min(Math.max(at.c + dc, 0), CATEGORIES - 1);

      if (at.kind === 'category') {
        if (dr > 0) setAt({ kind: 'clue', c, r: 0 });
        else setAt({ kind: 'category', c });
        return;
      }
      const r = at.r + dr;
      if (r < 0) setAt({ kind: 'category', c });
      else setAt({ kind: 'clue', c, r: Math.min(r, POINTS.length - 1) });
      return;
    }

    if (key === 'Enter') {
      event.preventDefault();
      (at.kind === 'category' ? nameRef : clueRef).current?.focus();
    }
  };

  /* Escape hands focus back to the board, so the keyboard can leave a field
     without tabbing through everything after it. */
  const onFieldKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      gridRef.current?.focus();
    }
  };

  // ---------------------------------------------------------------- board

  const cellClass = (c, r) => {
    const on = at.kind === 'clue' && at.c === c && at.r === r;
    return `ge-cell ${isWritten(categories[c]?.questions?.[r]) ? 'is-written' : 'is-empty'} ${on ? 'is-on' : ''}`;
  };

  const headClass = (c) => {
    const on = at.kind === 'category' && at.c === c;
    return `ge-head ${categories[c]?.name?.trim() ? 'is-named' : 'is-empty'} ${on ? 'is-on' : ''}`;
  };

  const wideBoard = (
    <div
      className="ge-grid"
      ref={gridRef}
      tabIndex={0}
      role="grid"
      aria-label="The board"
      onKeyDown={onGridKey}
    >
      {categories.map((category, c) => (
        <button
          key={`h${c}`}
          type="button"
          className={`plain-btn ${headClass(c)}`}
          style={{ gridColumn: c + 1, gridRow: 1 }}
          onClick={() => setAt({ kind: 'category', c })}
        >
          {category.name?.trim() || 'Name it'}
        </button>
      ))}

      {POINTS.map((points, r) =>
        categories.map((category, c) => (
          <button
            key={`${c}-${r}`}
            type="button"
            className={`plain-btn ${cellClass(c, r)}`}
            style={{ gridColumn: c + 1, gridRow: r + 2 }}
            aria-label={`${category.name || `Category ${c + 1}`}, $${points}, ${
              isWritten(category.questions?.[r]) ? 'written' : 'empty'
            }`}
            onClick={() => setAt({ kind: 'clue', c, r })}
          >
            ${points}
          </button>
        ))
      )}
    </div>
  );

  /* Six columns do not survive a phone, so it becomes one column at a time
     with the six along the top. Same board, read one category down. */
  const narrowBoard = (
    <div className="ge-narrow">
      <div className="ge-pager" ref={pagerRef} role="tablist" aria-label="Categories">
        {categories.map((category, c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={at.c === c}
            className={`plain-btn ge-tab ${at.c === c ? 'is-on' : ''}`}
            onClick={() => setAt({ kind: 'clue', c, r: 0 })}
          >
            <span className="ge-tab-n">{c + 1}</span>
            <span className="ge-tab-name">{category.name?.trim() || 'Name it'}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`plain-btn ${headClass(at.c)} ge-head-wide`}
        onClick={() => setAt({ kind: 'category', c: at.c })}
      >
        {categories[at.c]?.name?.trim() || 'Name this category'}
      </button>

      <div className="ge-rows">
        {POINTS.map((points, r) => {
          const q = categories[at.c]?.questions?.[r];
          const on = at.kind === 'clue' && at.r === r;
          return (
            <button
              key={r}
              type="button"
              className={`plain-btn ge-row ${isWritten(q) ? 'is-written' : 'is-empty'} ${on ? 'is-on' : ''}`}
              onClick={() => setAt({ kind: 'clue', c: at.c, r })}
            >
              <span className="ge-row-points">${points}</span>
              <span className="ge-row-text">
                {q?.answer?.trim() || 'Empty'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ---------------------------------------------------------------- panel

  const panel = at.kind === 'category' ? (
    <>
      <p className="ge-where">Category {at.c + 1}</p>
      <label className="ge-label" htmlFor="ge-name">Category name</label>
      <input
        id="ge-name"
        ref={nameRef}
        className="ge-field"
        value={categories[at.c]?.name ?? ''}
        maxLength={60}
        placeholder="Rivers, Bad Movie Physics, Potent Potables"
        onKeyDown={onFieldKey}
        onChange={(e) => editName(at.c, e.target.value)}
      />
      <p className="ge-hint">
        Six of these run across the top of the board. Short ones read best.
      </p>
    </>
  ) : (
    <>
      <p className="ge-where">
        {categories[at.c]?.name?.trim() || `Category ${at.c + 1}`} &middot; ${POINTS[at.r]}
      </p>

      <label className="ge-label" htmlFor="ge-clue">The clue</label>
      <textarea
        id="ge-clue"
        ref={clueRef}
        className="ge-field ge-field-tall"
        value={here?.answer ?? ''}
        maxLength={1000}
        placeholder="What the players see"
        onKeyDown={onFieldKey}
        onChange={(e) => editClue(at.c, at.r, { answer: e.target.value })}
      />

      <label className="ge-label" htmlFor="ge-response">Correct response</label>
      <input
        id="ge-response"
        className="ge-field"
        value={here?.question ?? ''}
        maxLength={1000}
        placeholder="What is&hellip;?"
        onKeyDown={onFieldKey}
        onChange={(e) => editClue(at.c, at.r, { question: e.target.value })}
      />

      {/* No label of our own: MediaAttachment draws its own heading, and two
          labels stacked on one control reads as a mistake. */}
      <MediaAttachment
        mediaType={here?.mediaType ?? null}
        mediaData={here?.mediaData ?? null}
        youtubeStart={here?.youtubeStart ?? null}
        youtubeEnd={here?.youtubeEnd ?? null}
        audioOnly={here?.audioOnly ?? false}
        altText={here?.altText ?? null}
        onChange={(updates) => editClue(at.c, at.r, updates)}
      />

      <div className="ge-panel-actions">
        <button type="button" className="plain-btn ge-action" onClick={nextEmpty}>
          Next empty
        </button>
        <button
          type="button"
          className="plain-btn ge-action is-quiet"
          onClick={clearClue}
          disabled={!here?.answer?.trim() && !here?.question?.trim()}
        >
          Clear this clue
        </button>
      </div>
    </>
  );

  return (
    <div className="grid-editor">
      <div className="ge-board">
        {narrow ? narrowBoard : wideBoard}
        <p className="ge-legend">
          {written === 30
            ? 'Every clue written.'
            : `${30 - written} ${30 - written === 1 ? 'cell is' : 'cells are'} still empty.`}
          {!narrow && ' Arrow keys move, Enter writes, Escape comes back.'}
        </p>
      </div>

      <div className="ge-panel" ref={panelRef}>{panel}</div>
    </div>
  );
}
