import { motion } from 'framer-motion';
import { scoreCurve } from '../../stores/dailyLogic';

/* Where a player landed among everyone who played the same six: the day's
   scores as a curve from $0 to the most it paid, and a mark at theirs, drawn
   the way the daily games people share draw it. A cyan curve over a soft
   fill, a thin axis with even ticks, and the player in pink, named on the
   axis where their score falls. */

const W = 600;
const H = 190;
const LEFT = 26;
const RIGHT = W - 26;
const BASE = 150;
const PEAK = 22;
const TICKS = 8;

const money = (n) => `$${Math.round(n).toLocaleString()}`;
const short = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : `$${n}`);

/* Through every point, smoothly: a Catmull-Rom spline as cubic Beziers. */
function smooth(points) {
  if (points.length < 2) return '';
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1] ?? points[i];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const [x3, y3] = points[i + 2] ?? points[i + 1];
    d += ` C${(x1 + (x2 - x0) / 6).toFixed(1)},${(y1 + (y2 - y0) / 6).toFixed(1)}`
      + ` ${(x2 - (x3 - x1) / 6).toFixed(1)},${(y2 - (y3 - y1) / 6).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return d;
}

export default function SixerCurve({ stats, top: dayTop, score }) {
  /* Wide enough for every score in the spread, so the estimate's reach past
     this run's clues is drawn rather than cut off. */
  const top = Math.max(dayTop, ...(stats?.scores ?? []).map((s) => s.score));
  const xOf = (v) => LEFT + ((RIGHT - LEFT) * Math.min(Math.max(v, 0), top)) / (top || 1);
  const yOf = (y) => BASE - (BASE - PEAK) * y;
  const curve = scoreCurve(stats, top);
  if (!curve.length) return null;

  const line = smooth(curve.map((p) => [xOf(p.x), yOf(p.y)]));
  const area = `${line} L${xOf(top)},${BASE} L${xOf(0)},${BASE} Z`;

  // Where the curve stands at the player's score, for the dot.
  const step = top / (curve.length - 1);
  const i = Math.min(Math.floor(score / step), curve.length - 2);
  const here = yOf(curve[i].y + (curve[i + 1].y - curve[i].y) * ((score - curve[i].x) / step));
  const you = xOf(score);

  /* Even ticks along the axis. The label nearest the player gives way to
     YOU, as it does on the axis this is modelled on. */
  const ticks = Array.from({ length: TICKS + 1 }, (_, t) => (top * t) / TICKS);
  const yielding = ticks.reduce((best, t, n) => (Math.abs(xOf(t) - you) < Math.abs(xOf(ticks[best]) - you) ? n : best), 0);
  const crowded = Math.abs(xOf(ticks[yielding]) - you) < (RIGHT - LEFT) / TICKS / 2;

  return (
    <svg
      className="sixer-curve"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Score distribution of today's players, with yours at ${money(score)}`}
    >
      <defs>
        <linearGradient id="sixer-curve-fill" x1="0" y1="0" x2="0" y2="1">
          {/* The deep blue of a Jeopardy board, under a gold line. */}
          <stop offset="0%" stopColor="#1B23D9" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0E1467" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      <path d={area} fill="url(#sixer-curve-fill)" />
      <motion.path
        className="sixer-curve-line"
        d={line}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />

      <line className="sixer-curve-axis" x1={LEFT} x2={RIGHT} y1={BASE} y2={BASE} />
      {ticks.map((t, n) => (
        <g key={t}>
          <line className="sixer-curve-tick" x1={xOf(t)} x2={xOf(t)} y1={BASE} y2={BASE + 4} />
          {!(crowded && n === yielding) && (
            <text className="sixer-curve-label" x={xOf(t)} y={BASE + 20} textAnchor="middle">
              {short(t)}
            </text>
          )}
        </g>
      ))}

      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7, duration: 0.3 }}>
        <line className="sixer-curve-you" x1={you} x2={you} y1={BASE} y2={here} />
        <circle className="sixer-curve-dot" cx={you} cy={here} r="5" />
        <text className="sixer-curve-you-label" x={you} y={BASE + 20} textAnchor="middle">YOU</text>
      </motion.g>
    </svg>
  );
}
