import { useMemo, useState } from 'react';
import { canPlayDate, isWithinArchive } from '@shared/archiveWindow.js';
import { monthMatrix, shiftMonth, startOfMonth, WEEKDAY_INITIALS } from '../../utils/archiveCalendar';

const monthTitle = (month) => new Date(`${month}T12:00:00Z`)
  .toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

const dayTitle = (date) => new Date(`${date}T12:00:00Z`)
  .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

/**
 * A month of the archive, to pick one day from: the archive page's calendar,
 * small enough for the lobby. Days a player may not open are shown but shut.
 */
export default function DayPicker({ today, value, onChange, isAuthenticated, disabled = false }) {
  const [month, setMonth] = useState(() => startOfMonth(value ?? today));
  const weeks = useMemo(() => monthMatrix(month), [month]);

  // A month is worth stepping to when any of its days is in the window.
  const reachable = (candidate) => monthMatrix(candidate).flat().some((d) => d && isWithinArchive(d, today));
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <div className="day-picker">
      <div className="day-picker-bar">
        <button type="button" className="day-picker-step" onClick={() => setMonth(previous)}
          disabled={disabled || !reachable(previous)} aria-label="Previous month">&lsaquo;</button>
        <span className="day-picker-month" aria-live="polite">{monthTitle(month)}</span>
        <button type="button" className="day-picker-step" onClick={() => setMonth(next)}
          disabled={disabled || !reachable(next)} aria-label="Next month">&rsaquo;</button>
      </div>
      <div className="day-picker-grid" role="grid" aria-label={monthTitle(month)}>
        {WEEKDAY_INITIALS.map((initial, i) => (
          <span key={`h${i}`} className="day-picker-head" aria-hidden="true">{initial}</span>
        ))}
        {weeks.flat().map((date, i) => {
          if (!date) return <span key={`e${i}`} className="day-picker-day empty" />;
          const open = canPlayDate({ date, format: 'board', today, isAuthenticated });
          return (
            <button
              type="button"
              key={date}
              className={`day-picker-day${date === value ? ' selected' : ''}${date === today ? ' today' : ''}`}
              disabled={disabled || !open}
              aria-pressed={date === value}
              aria-label={`${dayTitle(date)}${open ? '' : ', sign in to play'}`}
              onClick={() => onChange(date)}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
