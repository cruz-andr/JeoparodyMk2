import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import MediaAttachment from '../setup/MediaAttachment';
import {
  CLUES, POINTS,
  countWritten, emptyClue, finalState, isWritten, moveSelection, nextEmptyFrom,
} from './gridLogic';
import './BoardGridEditor.css';

/**
 * The board is the editor.
 *
 * A Jeopardy board is a 6x5 grid and it is the most recognisable object we
 * have, so you build one by clicking the cell you want to write, exactly the
 * way a player clicks the cell they want to answer. The progress meter comes
 * free: the empty cells are what is left.
 *
 * Underneath sits Final Jeopardy, one clue on a board of its own, which is
 * where it is on the show and where it belongs here.
 *
 * There is no Daily Double control, deliberately. Daily Doubles are placed
 * when a game starts, from the player's settings, and are not stored on a
 * clue. A switch that looked like it set one would be a switch that did
 * nothing.
 *
 * All the arithmetic lives in gridLogic.js so it can be tested by running it.
 */

/** Where the grid stops being something you can hit with a thumb. */
const NARROW_AT = 820;

/**
 * How wide this component is, not how wide the window is.
 *
 * The editor does not care about the viewport, it cares about its own box, and
 * asking the right question means it also works in a split view or a preview
 * pane. The stylesheet asks the same question with a container query and the
 * same number, so there is one breakpoint rather than one here and a different
 * one over there, which is what produced a phone grid inside a desktop header.
 */
function useNarrowBox(ref, max = NARROW_AT) {
  const [narrow, setNarrow] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    /* Measured before paint, so a phone does not show the desktop grid for a
       frame on the way to the right one. */
    setNarrow(element.getBoundingClientRect().width < max);

    const observer = new ResizeObserver(([entry]) => {
      setNarrow(entry.contentRect.width < max);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, max]);

  return narrow;
}

const sameCell = (a, b) => (
  a.kind === b.kind
  && (a.kind !== 'clue' || (a.c === b.c && a.r === b.r))
  && (a.kind !== 'category' || a.c === b.c)
);

/**
 * `onReroll` and `onSuggestWrong` are optional because they need a model and
 * not every caller has one to offer. Host mode passes both; the community
 * board editor passes neither, and the controls are simply absent rather than
 * present and dead.
 */
export default function BoardGridEditor({
  board, onChange, onCleared, onBeforeClear, onReroll, rerollsLeft, onSuggestWrong,
  dailyDoubles, onToggleDailyDouble, dailyDoublesWanted = 0,
}) {
  const [at, setAt] = useState({ kind: 'clue', c: 0, r: 0 });
  const [showChoices, setShowChoices] = useState(false);
  const [thinking, setThinking] = useState('');

  const outerRef = useRef(null);
  const selectedRef = useRef(null);
  const clueRef = useRef(null);
  const nameRef = useRef(null);
  const panelRef = useRef(null);
  const pagerRef = useRef(null);
  const lastAt = useRef(at);
  const byKeyboard = useRef(false);

  const narrow = useNarrowBox(outerRef);

  const categories = useMemo(() => board?.categories ?? [], [board]);

  /* The row values come from the board, not from a constant. Double Jeopardy
     is the same grid at twice the money, and reading POINTS here drew a round
     two full of $200s while the clues underneath were worth $400. */
  const values = useMemo(() => {
    const row = categories[0]?.questions ?? [];
    return POINTS.map((fallback, r) => row[r]?.points ?? fallback);
  }, [categories]);
  const written = useMemo(() => countWritten(board), [board]);
  const final = board?.finalJeopardy ?? null;
  const finalIs = finalState(board);
  const here = at.kind === 'clue' ? categories[at.c]?.questions?.[at.r] : null;

  // ---------------------------------------------------------------- edits

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

  const editFinal = useCallback((patch) => {
    onChange({
      ...board,
      finalJeopardy: {
        category: '', answer: '', question: '',
        ...(board.finalJeopardy ?? {}),
        ...patch,
      },
    });
  }, [board, onChange]);

  /* A destructive action takes its own undo step immediately, never merged
     into the burst of typing that happened just before it. */
  const clearClue = () => {
    onBeforeClear?.();
    editClue(at.c, at.r, emptyClue());
    onCleared?.('clue');
  };

  const clearFinal = () => {
    onBeforeClear?.();
    onChange({ ...board, finalJeopardy: null });
    onCleared?.('final');
  };

  /* Multiple choice is three wrong answers, not four answers.

     The correct one is the response already typed above: GameStateManager
     expects it at index 0 and shuffles from there, and normalizeBoard derives
     index 0 from the response so the two can never drift. Asking for it twice
     is how a right answer ends up marked wrong. */
  const distractors = (here?.options ?? []).slice(1);

  const editDistractor = (i, value) => {
    const next = [...distractors];
    next[i] = value;
    editClue(at.c, at.r, {
      options: next.some((d) => d?.trim())
        ? [here?.question ?? '', ...next]
        : null,
    });
  };

  const goNextEmpty = () => {
    const next = nextEmptyFrom(board, at);
    if (!next) return;
    byKeyboard.current = false;
    setAt(next);
    window.requestAnimationFrame(() => clueRef.current?.focus());
  };

  // ---------------------------------------------------------------- keys

  const onBoardKey = (event) => {
    const moved = moveSelection(at, event.key);
    if (moved) {
      event.preventDefault();
      byKeyboard.current = true;
      setAt(moved);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      (at.kind === 'category' ? nameRef : clueRef).current?.focus();
    }
  };

  /* Escape hands focus back to the board, so a keyboard can leave a field
     without tabbing past everything after it. */
  const onFieldKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      selectedRef.current?.focus();
    }
  };

  /* Focus follows selection, which is the whole of the roving tabindex.

     Exactly one cell is in the tab order and it is the selected one, so the
     gold square and the focus ring cannot end up on different cells. Before
     this the container was tabbable and so were all thirty-six buttons, so you
     could Tab onto one cell, press an arrow, and watch a different one move. */
  useEffect(() => {
    if (!byKeyboard.current) return;
    byKeyboard.current = false;
    selectedRef.current?.focus();
  }, [at]);

  /* On a narrow box the panel is under the board, so selecting a clue left its
     fields off the bottom of the screen. Guarded on the identity of the
     selection rather than a first-render flag, because StrictMode mounts twice
     and spends a flag on the first pass. */
  useEffect(() => {
    if (!narrow || lastAt.current === at) return;
    lastAt.current = at;
    panelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    pagerRef.current?.children?.[at.c]?.scrollIntoView?.({
      behavior: 'smooth', block: 'nearest', inline: 'nearest',
    });
  }, [at, narrow]);

  // ---------------------------------------------------------------- board

  const pick = (next) => { byKeyboard.current = false; setAt(next); };

  const cell = (next, classes) => {
    const on = sameCell(at, next);
    return {
      type: 'button',
      /* Roving tabindex: only the selected cell is in the tab order. */
      tabIndex: on ? 0 : -1,
      ref: on ? selectedRef : null,
      className: `plain-btn ${classes} ${on ? 'is-on' : ''}`,
      onClick: () => pick(next),
    };
  };

  const contents = { display: 'contents' };

  /* Marking Daily Doubles turns the whole board into targets, so it is a mode
     rather than something you can do by accident: the cells say what a click
     will do while it is on. */
  const marking = Boolean(onToggleDailyDouble);
  const isDouble = (c, r) => (dailyDoubles ?? []).some(
    (d) => d.categoryIndex === c && d.pointIndex === r
  );

  const wideBoard = (
    <div className="ge-grid" role="grid" aria-label="The board" onKeyDown={onBoardKey}>
      {/* display:contents gives a screen reader real rows without the
          six-column CSS grid noticing they are there. */}
      <div role="row" style={contents}>
        {categories.map((category, c) => (
          <div role="gridcell" style={contents} key={`h${c}`}>
            <button
              {...cell({ kind: 'category', c },
                `ge-head ${category.name?.trim() ? 'is-named' : 'is-empty'}`)}
              style={{ gridColumn: c + 1, gridRow: 1 }}
            >
              {category.name?.trim() || 'Name it'}
            </button>
          </div>
        ))}
      </div>

      {values.map((points, r) => (
        <div role="row" style={contents} key={`r${r}`}>
          {categories.map((category, c) => (
            <div role="gridcell" style={contents} key={`${c}-${r}`}>
              <button
                {...cell({ kind: 'clue', c, r },
                  `ge-cell ${isWritten(category.questions?.[r]) ? 'is-written' : 'is-empty'}`
                  + `${isDouble(c, r) ? ' is-double' : ''}${marking ? ' is-marking' : ''}`)}
                style={{ gridColumn: c + 1, gridRow: r + 2 }}
                onClick={() => {
                  /* Marking still moves the selection, so the arrow keys carry
                     on from the cell you just clicked and the panel shows the
                     clue you are putting the marker on. */
                  pick({ kind: 'clue', c, r });
                  if (marking) onToggleDailyDouble(c, r);
                }}
                aria-label={`${category.name || `Category ${c + 1}`}, $${points}, ${
                  isWritten(category.questions?.[r]) ? 'written' : 'empty'}${
                  isDouble(c, r) ? ', Daily Double' : ''}`}
              >
                ${points}
                {isDouble(c, r) && <span className="ge-dd" aria-hidden="true">DD</span>}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  const narrowBoard = (
    <div className="ge-narrow" onKeyDown={onBoardKey}>
      <div className="ge-pager" ref={pagerRef} role="tablist" aria-label="Categories">
        {categories.map((category, c) => {
          const on = at.c === c && at.kind !== 'final';
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className={`plain-btn ge-tab ${on ? 'is-on' : ''}`}
              onClick={() => pick({ kind: 'clue', c, r: 0 })}
            >
              <span className="ge-tab-n">{c + 1}</span>
              <span className="ge-tab-name">{category.name?.trim() || 'Name it'}</span>
            </button>
          );
        })}
      </div>

      <button
        {...cell({ kind: 'category', c: at.c },
          `ge-head ge-head-wide ${categories[at.c]?.name?.trim() ? 'is-named' : 'is-empty'}`)}
      >
        {categories[at.c]?.name?.trim() || 'Name this category'}
      </button>

      <div className="ge-rows">
        {values.map((points, r) => {
          const q = categories[at.c]?.questions?.[r];
          return (
            <button
              key={r}
              {...cell({ kind: 'clue', c: at.c, r },
                `ge-row ${isWritten(q) ? 'is-written' : 'is-empty'}`)}
            >
              <span className="ge-row-points">${points}</span>
              <span className="ge-row-text">{q?.answer?.trim() || 'Empty'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  /* One tile the width of the board, under it: where Final Jeopardy is on the
     show, and honest about not being part of the 6x5. */
  const finalTile = (
    <button
      {...cell({ kind: 'final', c: at.c ?? 0 }, `ge-final is-${finalIs}`)}
      onKeyDown={onBoardKey}
    >
      <span className="ge-final-label">Final Jeopardy</span>
      <span className="ge-final-text">
        {finalIs === 'complete' ? (final?.category || 'Written')
          : finalIs === 'partial' ? 'Half written'
          : 'Not set. Optional.'}
      </span>
    </button>
  );

  // ---------------------------------------------------------------- panel

  let panel;
  if (at.kind === 'category') {
    panel = (
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

        {onReroll && (
          <div className="ge-panel-actions">
            <button
              type="button"
              className="plain-btn quiet-action ge-action"
              disabled={!rerollsLeft || thinking === 'reroll'}
              onClick={async () => {
                setThinking('reroll');
                try { await onReroll(at.c); } finally { setThinking(''); }
              }}
            >
              {thinking === 'reroll'
                ? 'Finding another'
                : `Try another category${rerollsLeft ? ` (${rerollsLeft} left)` : ''}`}
            </button>
          </div>
        )}
      </>
    );
  } else if (at.kind === 'final') {
    panel = (
      <>
        <p className="ge-where">Final Jeopardy</p>

        <label className="ge-label" htmlFor="ge-final-cat">Category</label>
        <input
          id="ge-final-cat"
          ref={clueRef}
          className="ge-field"
          value={final?.category ?? ''}
          maxLength={60}
          placeholder="One more category"
          onKeyDown={onFieldKey}
          onChange={(e) => editFinal({ category: e.target.value })}
        />

        <label className="ge-label" htmlFor="ge-final-clue">The clue</label>
        <textarea
          id="ge-final-clue"
          className="ge-field ge-field-tall"
          value={final?.answer ?? ''}
          maxLength={1000}
          placeholder="What the players see after the wagers"
          onKeyDown={onFieldKey}
          onChange={(e) => editFinal({ answer: e.target.value })}
        />

        <label className="ge-label" htmlFor="ge-final-response">Correct response</label>
        <input
          id="ge-final-response"
          className="ge-field"
          value={final?.question ?? ''}
          maxLength={1000}
          placeholder="What is...?"
          onKeyDown={onFieldKey}
          onChange={(e) => editFinal({ question: e.target.value })}
        />

        <p className={`ge-hint ${finalIs === 'partial' ? 'is-warn' : ''}`}>
          {finalIs === 'partial'
            ? 'All three are needed, or clear it. A half-written round stops a game dead.'
            : 'Optional. A board without one just ends after the last clue.'}
        </p>

        {finalIs !== 'none' && (
          <div className="ge-panel-actions">
            <button type="button" className="plain-btn quiet-action ge-action is-quiet" onClick={clearFinal}>
              Clear Final Jeopardy
            </button>
          </div>
        )}
      </>
    );
  } else {
    panel = (
      <>
        <p className="ge-where">
          {categories[at.c]?.name?.trim() || `Category ${at.c + 1}`} &middot; ${values[at.r]}
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
          placeholder="What is...?"
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

        <div className="ge-choices">
          <button
            type="button"
            className="plain-btn ge-choices-toggle"
            aria-expanded={showChoices || distractors.some(Boolean)}
            onClick={() => setShowChoices((v) => !v)}
          >
            <span className="ge-choices-arrow">
              {showChoices || distractors.some(Boolean) ? '\u2013' : '+'}
            </span>
            Multiple choice
            {distractors.filter(Boolean).length > 0 && (
              <span className="ge-choices-count">
                {distractors.filter(Boolean).length} of 3 wrong answers
              </span>
            )}
          </button>

          {(showChoices || distractors.some(Boolean)) && (
            <div className="ge-choices-body">
              <p className="ge-hint" style={{ margin: '0 0 10px' }}>
                Three wrong answers. The right one is the response above, and it
                is shuffled in when the clue is played.
              </p>
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  className="ge-field"
                  value={distractors[i] ?? ''}
                  maxLength={1000}
                  placeholder={`Wrong answer ${i + 1}`}
                  onKeyDown={onFieldKey}
                  onChange={(e) => editDistractor(i, e.target.value)}
                />
              ))}

              {onSuggestWrong && (
                <button
                  type="button"
                  className="plain-btn quiet-action ge-action"
                  disabled={thinking === 'wrong' || !here?.answer?.trim() || !here?.question?.trim()}
                  onClick={async () => {
                    setThinking('wrong');
                    try {
                      /* The category comes from here, because the editor is
                         the only thing that knows which cell is open. */
                      const wrong = await onSuggestWrong({
                        clue: here.answer,
                        response: here.question,
                        category: categories[at.c]?.name ?? '',
                      });
                      if (wrong?.length) {
                        editClue(at.c, at.r, { options: [here.question, ...wrong.slice(0, 3)] });
                      }
                    } finally { setThinking(''); }
                  }}
                >
                  {thinking === 'wrong' ? 'Thinking' : 'Suggest three wrong answers'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="ge-panel-actions">
          <button
            type="button"
            className="plain-btn quiet-action ge-action"
            onClick={goNextEmpty}
            disabled={written === CLUES}
          >
            Next empty
          </button>
          <button
            type="button"
            className="plain-btn quiet-action ge-action is-quiet"
            onClick={clearClue}
            disabled={!here?.answer?.trim() && !here?.question?.trim() && !here?.mediaType}
          >
            Clear this clue
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="grid-editor-outer" ref={outerRef}>
      <div className="grid-editor">
        <div className="ge-board">
          {narrow ? narrowBoard : wideBoard}
          {finalTile}
          {marking && (
            <p className="ge-marking">
              {(dailyDoubles ?? []).length === dailyDoublesWanted
                ? `Daily ${dailyDoublesWanted === 1 ? 'Double' : 'Doubles'} placed. Click one to move it.`
                : `Click ${dailyDoublesWanted - (dailyDoubles ?? []).length} more ${
                  dailyDoublesWanted - (dailyDoubles ?? []).length === 1 ? 'cell' : 'cells'
                } to place the Daily ${dailyDoublesWanted === 1 ? 'Double' : 'Doubles'}`}
            </p>
          )}

          <p className="ge-legend">
            {written === CLUES
              ? 'Every clue written.'
              : `${CLUES - written} ${CLUES - written === 1 ? 'cell is' : 'cells are'} still empty.`}
            {!narrow && ' Arrow keys move, Enter writes, Escape comes back.'}
          </p>
        </div>

        <div className="ge-panel" ref={panelRef}>{panel}</div>
      </div>
    </div>
  );
}
