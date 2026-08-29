import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
 * The wheel tracks your thumb 1:1 and coasts on release, rather than stepping
 * one category per swipe. It does this by hand because CSS scroll snap cannot:
 * on iOS, snapping disables momentum outright, so a native scroller would give
 * exactly the one-category-per-flick stiffness this is here to avoid.
 * See https://bugs.webkit.org/show_bug.cgi?id=243582
 */

const VISIBLE_RADIUS = 3; // rows kept in the DOM either side of centre
const PLAYABLE_RADIUS = 1; // rows that can be tapped either side of centre
const SLOT = 150; // px per category, matching the band spacing
const DRAG_SLOP = 10; // past this, the gesture is a swipe and not a tap
const EDGE_RESISTANCE = 0.32; // how much of a drag past the ends actually lands
const COAST_MS = 190; // how far a flick's velocity is allowed to carry
const MIN_SETTLE_MS = 260;
const MAX_SETTLE_MS = 820;
const VELOCITY_WINDOW_MS = 90; // only the end of the drag decides the throw

/* Tilt, scale and fade read off four stops by distance from centre. The old
   version switched between three fixed tiers, so a row changed size in one
   jump as it crossed; interpolating means there is nothing to pop between. */
const TILT = [0, 20, 46, 62];
const SCALE = [1, 0.74, 0.48, 0.33];
const FADE = [1, 0.72, 0.2, 0];

function stopAt(distance, stops) {
  const d = Math.min(Math.abs(distance), stops.length - 1);
  const low = Math.floor(d);
  const high = Math.min(low + 1, stops.length - 1);
  return stops[low] + (stops[high] - stops[low]) * (d - low);
}

// Quintic ease out: nearly all the distance is covered early, so a throw reads
// as momentum bleeding off rather than as a slide of a fixed length.
const easeOut = (t) => 1 - (1 - t) ** 5;

export default function BoardWheel({
  categories = [],
  answers = [],
  pointValues = [],
  onSelect,
}) {
  const [settled, setSettled] = useState(0);
  const reduceMotion = usePrefersReducedMotion();

  const wheelRef = useRef(null);
  const trackRef = useRef(null);
  const bandRefs = useRef(new Map());

  const offset = useRef(0); // fractional category position, the whole state of the wheel
  const settledRef = useRef(0);
  const frame = useRef(null);
  const glide = useRef(null); // { from, to, start, duration }
  const drag = useRef(null); // { startY, startOffset, samples }
  const moved = useRef(false);
  const pending = useRef(null); // what to run once the wheel stops

  const lastIndex = Math.max(0, categories.length - 1);
  const rowCount = pointValues.length;

  const clamp = useCallback(
    (value) => Math.max(0, Math.min(value, lastIndex)),
    [lastIndex]
  );
  const answerAt = (categoryIndex, pointIndex) =>
    answers[categoryIndex * rowCount + pointIndex];

  /* Transforms are written straight to the DOM rather than through state: at
     60fps a re-render per frame would cost more than the motion is worth.
     React only hears about the wheel when the centred category changes. */
  const paint = useCallback(() => {
    const at = offset.current;
    if (trackRef.current) {
      trackRef.current.style.transform = `translate3d(0, ${-at * SLOT}px, 0)`;
    }
    bandRefs.current.forEach((node, index) => {
      if (!node) return;
      const d = index - at;
      const tilt = -Math.sign(d) * stopAt(d, TILT);
      node.style.transform = `rotateX(${tilt}deg) scale(${stopAt(d, SCALE)})`;
      node.style.opacity = stopAt(d, FADE);
    });
  }, []);

  const syncSettled = useCallback(() => {
    const next = clamp(Math.round(offset.current));
    if (next !== settledRef.current) {
      settledRef.current = next;
      setSettled(next);
    }
  }, [clamp]);

  const tick = useCallback(() => {
    const run = glide.current;
    if (run) {
      const t = Math.min(1, (performance.now() - run.start) / run.duration);
      offset.current = run.from + (run.to - run.from) * easeOut(t);
      if (t >= 1) {
        offset.current = run.to;
        glide.current = null;
      }
    }

    paint();
    syncSettled();

    if (glide.current || drag.current) {
      frame.current = requestAnimationFrame(tick);
      return;
    }
    frame.current = null;
    const after = pending.current;
    pending.current = null;
    if (after) after();
  }, [paint, syncSettled]);

  const startLoop = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(tick);
  }, [tick]);

  /** Animate to a whole category, then run `after` once it has actually landed. */
  const glideTo = useCallback(
    (target, after) => {
      const to = clamp(target);
      const from = offset.current;
      const distance = Math.abs(to - from);

      if (reduceMotion || distance < 0.002) {
        offset.current = to;
        paint();
        syncSettled();
        if (after) after();
        return;
      }

      glide.current = {
        from,
        to,
        start: performance.now(),
        // longer throws take longer, but not proportionally: a five category
        // flick should feel fast, not five times the length of a one.
        duration: Math.min(MAX_SETTLE_MS, Math.max(MIN_SETTLE_MS, 250 + distance * 105)),
      };
      pending.current = after || null;
      startLoop();
    },
    [clamp, paint, reduceMotion, startLoop, syncSettled]
  );

  // Past either end the wheel still moves, but gives back only a third of the
  // drag, so it reads as resistance and not as a dead stop.
  const withResistance = useCallback(
    (value) => {
      if (value < 0) return value * EDGE_RESISTANCE;
      if (value > lastIndex) return lastIndex + (value - lastIndex) * EDGE_RESISTANCE;
      return value;
    },
    [lastIndex]
  );

  const onTouchStart = (e) => {
    glide.current = null; // catching a moving wheel stops it, as it should
    pending.current = null;
    moved.current = false;
    const y = e.touches[0]?.clientY ?? 0;
    drag.current = {
      startY: y,
      startOffset: offset.current,
      samples: [{ t: performance.now(), y }],
    };
    startLoop();
  };

  const onTouchMove = (e) => {
    const held = drag.current;
    if (!held) return;
    // Nothing here scrolls, and touch-action alone does not stop iOS starting
    // a rubber band, so the gesture has to be claimed outright.
    e.preventDefault();

    const y = e.touches[0]?.clientY ?? 0;
    const dy = y - held.startY;
    if (Math.abs(dy) > DRAG_SLOP) moved.current = true;

    offset.current = withResistance(held.startOffset - dy / SLOT);

    const now = performance.now();
    held.samples.push({ t: now, y });
    while (held.samples.length > 2 && now - held.samples[0].t > VELOCITY_WINDOW_MS) {
      held.samples.shift();
    }
  };

  const onTouchEnd = () => {
    const held = drag.current;
    if (!held) return;
    drag.current = null;

    const first = held.samples[0];
    const last = held.samples[held.samples.length - 1];
    const elapsed = last.t - first.t;
    // px/ms of thumb, converted to categories/ms. Negative dy raises the offset.
    const velocity = elapsed > 0 ? -((last.y - first.y) / elapsed) / SLOT : 0;

    glideTo(Math.round(offset.current + velocity * COAST_MS));
  };

  /* Registered by hand because React's touchmove is passive and so can never
     preventDefault. Held in a ref so the listeners bind once and still see
     current state. */
  const handlers = useRef(null);
  handlers.current = { onTouchStart, onTouchMove, onTouchEnd };

  useEffect(() => {
    const node = wheelRef.current;
    if (!node) return undefined;

    const start = (e) => handlers.current.onTouchStart(e);
    const move = (e) => handlers.current.onTouchMove(e);
    const end = () => handlers.current.onTouchEnd();

    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchmove', move, { passive: false });
    node.addEventListener('touchend', end, { passive: true });
    node.addEventListener('touchcancel', end, { passive: true });
    return () => {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', end);
    };
  }, []);

  // A frame or a pending open that outlives the page would run into a screen
  // that no longer exists.
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      pending.current = null;
    },
    []
  );

  useLayoutEffect(() => {
    paint();
  });

  /**
   * A tap on the centre row opens straight away. A tap on a neighbour rolls it
   * in first, then opens: the second beat is what makes an angled target feel
   * deliberate rather than lucky.
   */
  const handleTile = (categoryIndex, pointIndex) => {
    if (moved.current) return; // this click is the tail of a swipe
    if (drag.current) return;
    if (answerAt(categoryIndex, pointIndex)?.revealed) return;

    if (Math.abs(categoryIndex - settled) > PLAYABLE_RADIUS) {
      glideTo(categoryIndex); // context row: just bring it in
      return;
    }
    glideTo(categoryIndex, () => onSelect(categoryIndex, pointIndex));
  };

  const onKeyDown = (e) => {
    const step = { ArrowUp: -1, ArrowDown: 1 }[e.key];
    const jump = { Home: 0, End: lastIndex }[e.key];
    if (step === undefined && jump === undefined) return;

    e.preventDefault();
    // Focus lives on the container while arrowing. A tile that scrolls out to
    // a context row becomes disabled, and the browser would drop focus to the
    // body, after which no further arrow key reaches the wheel at all.
    wheelRef.current?.focus();
    glideTo(step !== undefined ? Math.round(offset.current) + step : jump);
  };

  return (
    <div
      ref={wheelRef}
      className={`wheel ${reduceMotion ? 'no-motion' : ''}`}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="group"
      aria-label={`Game board, category ${settled + 1} of ${categories.length}, ${
        categories[settled] ?? ''
      }. Use up and down arrows to change category.`}
    >
      <div className="wheel-track" ref={trackRef}>
        {categories.map((name, categoryIndex) => {
          const distance = Math.abs(categoryIndex - settled);
          if (distance > VISIBLE_RADIUS) return null;
          const playable = distance <= PLAYABLE_RADIUS;

          return (
            <div
              key={`${name}-${categoryIndex}`}
              ref={(node) => {
                if (node) bandRefs.current.set(categoryIndex, node);
                else bandRefs.current.delete(categoryIndex);
              }}
              className={`wheel-band d${Math.min(distance, 2)} ${
                playable ? 'playable' : 'context'
              }`}
              style={{ top: `${categoryIndex * SLOT}px` }}
            >
              <button
                type="button"
                className="wheel-name"
                onClick={() => !moved.current && glideTo(categoryIndex)}
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
