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

  // A roll that is still pending when the page unmounts would call onSelect
  // into a screen that no longer exists.
  useEffect(() => () => clearTimeout(rollTimer.current), []);

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
    if (step !== undefined) {
      e.preventDefault();
      setFocus((f) => clamp(f + step));
      return;
    }
    if (e.key === 'Home') { e.preventDefault(); setFocus(0); }
    if (e.key === 'End') { e.preventDefault(); setFocus(lastIndex); }
  };

  const onTouchStart = (e) => {
    touchStart.current = e.touches[0]?.clientY ?? null;
  };

  const onTouchEnd = (e) => {
    if (touchStart.current === null) return;
    const delta = (e.changedTouches[0]?.clientY ?? 0) - touchStart.current;
    touchStart.current = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    setFocus((f) => clamp(f + (delta < 0 ? 1 : -1)));
  };

  return (
    <div
      className={`wheel ${reduceMotion ? 'no-motion' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="group"
      aria-label={`Game board, ${categories[focus] ?? ''} of ${categories.length} categories. Use up and down arrows to change category.`}
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
