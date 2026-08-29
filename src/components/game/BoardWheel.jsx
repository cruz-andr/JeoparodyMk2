import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery';
import './BoardWheel.css';

/**
 * The board as a wheel, for phones.
 *
 * A six by five grid needs about 600px to be legible and a phone gives about
 * 360, which is why the flat board renders its category names at 8px. Here the
 * board turns: one category per row, five rows on screen, and the middle three
 * are playable.
 *
 * Tapping a tile in a neighbouring row rolls that row to the centre first and
 * only then opens the clue, so you never watch a tilted face turn into a page.
 */

const VISIBLE_RADIUS = 2; // rows drawn either side of centre
const PLAYABLE_RADIUS = 1; // rows that can be tapped either side of centre
const ROLL_MS = 380;
const SWIPE_THRESHOLD = 40;
const DRAG_SLOP = 10; // past this, the gesture is a swipe and not a tap

export default function BoardWheel({
  categories = [],
  answers = [],
  pointValues = [],
  onSelect,
}) {
  const [focus, setFocus] = useState(0);
  const [rolling, setRolling] = useState(false);
  const reduceMotion = usePrefersReducedMotion();
  const rollTimer = useRef(null);
  const touchStart = useRef(null);
  // Nothing here scrolls, so the browser never swallows the click that follows
  // a swipe. Without this, dragging from a tile changes category AND opens
  // that tile's clue, burning a clue the player never chose.
  const dragged = useRef(false);
  const wheelRef = useRef(null);

  // A roll that is still pending when the page unmounts would call onSelect
  // into a screen that no longer exists.
  useEffect(() => () => clearTimeout(rollTimer.current), []);

  // touch-action: none says we own vertical drags, but iOS still starts a
  // scroll or a rubber band unless something calls preventDefault, and React's
  // touchmove is passive so it cannot. Registered by hand, non-passive.
  useEffect(() => {
    const node = wheelRef.current;
    if (!node) return undefined;

    const onMove = (e) => {
      if (touchStart.current === null) return;
      e.preventDefault();
      const delta = (e.touches[0]?.clientY ?? 0) - touchStart.current;
      if (Math.abs(delta) > DRAG_SLOP) dragged.current = true;
    };

    node.addEventListener('touchmove', onMove, { passive: false });
    return () => node.removeEventListener('touchmove', onMove);
  }, []);

  const rowCount = pointValues.length;
  const lastIndex = Math.max(0, categories.length - 1);
  const clamp = (i) => Math.max(0, Math.min(i, lastIndex));

  const answerAt = (categoryIndex, pointIndex) =>
    answers[categoryIndex * rowCount + pointIndex];

  /**
   * A tap on the centre row opens straight away. A tap on a neighbour rolls it
   * in first, then opens: the second beat is what makes an angled target feel
   * deliberate rather than lucky.
   */
  const handleTile = useCallback(
    (categoryIndex, pointIndex) => {
      if (rolling) return;
      if (dragged.current) return; // this click is the tail of a swipe
      if (answerAt(categoryIndex, pointIndex)?.revealed) return;

      const offset = categoryIndex - focus;
      if (Math.abs(offset) > PLAYABLE_RADIUS) {
        setFocus(clamp(categoryIndex)); // context row: just bring it in
        return;
      }

      if (offset === 0 || reduceMotion) {
        if (offset !== 0) setFocus(categoryIndex);
        onSelect(categoryIndex, pointIndex);
        return;
      }

      setFocus(categoryIndex);
      setRolling(true);
      clearTimeout(rollTimer.current);
      rollTimer.current = setTimeout(() => {
        setRolling(false);
        onSelect(categoryIndex, pointIndex);
      }, ROLL_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus, rolling, reduceMotion, onSelect, answers, rowCount, lastIndex]
  );

  const onKeyDown = (e) => {
    const step = { ArrowUp: -1, ArrowDown: 1 }[e.key];
    const jump = { Home: 0, End: lastIndex }[e.key];
    if (step === undefined && jump === undefined) return;

    e.preventDefault();
    if (rolling) return; // see onTouchEnd

    // Focus lives on the container while arrowing. A tile that scrolls out to
    // a context row becomes disabled, and the browser would drop focus to the
    // body, after which no further arrow key reaches the wheel at all.
    wheelRef.current?.focus();
    if (step !== undefined) setFocus((f) => clamp(f + step));
    else setFocus(jump);
  };

  const onTouchStart = (e) => {
    dragged.current = false;
    touchStart.current = e.touches[0]?.clientY ?? null;
  };

  const onTouchEnd = (e) => {
    if (touchStart.current === null) return;
    const delta = (e.changedTouches[0]?.clientY ?? 0) - touchStart.current;
    touchStart.current = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    // A committed roll owns the wheel until it lands, or the timeout would
    // open a clue that has since moved off centre.
    if (rolling) return;
    setFocus((f) => clamp(f + (delta < 0 ? 1 : -1)));
  };

  return (
    <div
      ref={wheelRef}
      className={`wheel ${reduceMotion ? 'no-motion' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="group"
      aria-label={`Game board, category ${focus + 1} of ${categories.length}, ${
        categories[focus] ?? ''
      }. Use up and down arrows to change category.`}
    >
      <div className="wheel-track" style={{ transform: `translateY(${-focus * 150}px)` }}>
        {categories.map((name, categoryIndex) => {
          const offset = categoryIndex - focus;
          if (Math.abs(offset) > VISIBLE_RADIUS) return null;

          const distance = Math.abs(offset);
          const playable = distance <= PLAYABLE_RADIUS;

          return (
            <div
              key={`${name}-${categoryIndex}`}
              className={`wheel-band d${distance} ${offset < 0 ? 'above' : ''} ${
                offset > 0 ? 'below' : ''
              } ${playable ? 'playable' : 'context'}`}
              style={{ top: `${categoryIndex * 150}px` }}
            >
              <button
                type="button"
                className="wheel-name"
                onClick={() => setFocus(categoryIndex)}
                aria-label={`${name}, bring to centre`}
              >
                {name}
              </button>

              <div className="wheel-row">
                {pointValues.map((points, pointIndex) => {
                  const answer = answerAt(categoryIndex, pointIndex);
                  const done = Boolean(answer?.revealed);

                  return (
                    <button
                      type="button"
                      key={pointIndex}
                      className={`wheel-tile ${done ? 'done' : ''}`}
                      onClick={() => handleTile(categoryIndex, pointIndex)}
                      disabled={done || !playable}
                      aria-label={
                        done
                          ? `${name}, $${points}, already played`
                          : `${name}, $${points}`
                      }
                    >
                      {done ? (
                        <span className={answer.correct ? 'mark ok' : 'mark miss'}>
                          {answer.correct ? '✓' : '✗'}
                        </span>
                      ) : (
                        <span className="wheel-value">${points}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="wheel-fade top" aria-hidden="true" />
      <div className="wheel-fade bottom" aria-hidden="true" />
    </div>
  );
}
