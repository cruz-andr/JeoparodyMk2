import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ARCHIVE_DAYS,
  ARCHIVE_FORMATS,
  canPlayDate,
  isWithinArchive,
  oldestArchiveDate,
  toDateString,
} from '@shared/archiveWindow.js';
import { useDailyStore } from '../stores/dailyStore';
import { useUserStore } from '../stores';
import { usePageTitle } from '../hooks/usePageTitle';
import { FORMAT_META, monthTitleOf } from '../utils/dailyFormats';
import { monthMatrix, shiftMonth, startOfMonth, WEEKDAY_INITIALS } from '../utils/archiveCalendar';
import './ArchivePage.css';

/**
 * The whole archive, a month at a time.
 *
 * Which days may be opened is not decided here: `canPlayDate` in the shared
 * window module answers that for the menu row, this page and the API alike, so
 * there is one rule and one place to change it.
 */
export default function ArchivePage() {
  usePageTitle('Archive');
  const navigate = useNavigate();

  const today = toDateString();
  const [format, setFormat] = useState('sixer');
  const [month, setMonth] = useState(() => startOfMonth(today));

  const isAuthenticated = useUserStore((s) => s.isAuthenticated);
  const archiveResults = useDailyStore((s) => s.archiveResults);

  const weeks = useMemo(() => monthMatrix(month), [month]);

  /* A signed out visitor is shown the top of the month and no more. The point
     of this page for them is the pitch, and a full six row grid pushed it two
     screens down: they were being sold the archive by being made to scroll
     past it. Two rows is enough to say "these go back a long way", and it is
     what the calendar this borrows from shows.

     Nothing is stranded by the cut. Everything a guest may actually play —
     today and the four picks — is on the menu they came from. */
  const visibleWeeks = isAuthenticated ? weeks : weeks.slice(0, PREVIEW_ROWS);

  /* A month is reachable when any day in it is. Checking its ends is enough:
     the window is a contiguous run, so a month with neither end inside it has
     no day inside it either. */
  const monthHasArchive = (candidate) => {
    const days = monthMatrix(candidate).flat().filter(Boolean);
    return days.some((d) => isWithinArchive(d, today));
  };

  const previousMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const canGoBack = monthHasArchive(previousMonth);
  const canGoForward = monthHasArchive(nextMonth);

  const meta = FORMAT_META[format];

  return (
    <div className="archive-page">
      <header className="archive-top">
        <button className="plain-btn archive-back" onClick={() => navigate('/menu')}>
          &lsaquo; Menu
        </button>
        <span className="archive-top-title">Archive</span>
        <span className="archive-top-spacer" />
      </header>

      <main className="archive-body">
        {/* Which daily's calendar this is. */}
        <div className="archive-tabs" role="tablist" aria-label="Which daily">
          {ARCHIVE_FORMATS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={format === key}
              className={`archive-tab ${format === key ? 'active' : ''}`}
              onClick={() => setFormat(key)}
            >
              <img className="archive-tab-icon" src={FORMAT_META[key].icon} alt="" />
              {FORMAT_META[key].name}
            </button>
          ))}
        </div>

        <div className="archive-monthbar">
          <button
            className="archive-step"
            onClick={() => setMonth(previousMonth)}
            disabled={!canGoBack}
            aria-label="Previous month"
          >
            &lsaquo;
          </button>

          <h1 className="archive-month" aria-live="polite">{monthTitleOf(month)}</h1>

          <div className="archive-monthbar-end">
            <button
              className="archive-today"
              onClick={() => setMonth(startOfMonth(today))}
              disabled={month === startOfMonth(today)}
            >
              Today
            </button>
            <button
              className="archive-step"
              onClick={() => setMonth(nextMonth)}
              disabled={!canGoForward}
              aria-label="Next month"
            >
              &rsaquo;
            </button>
          </div>
        </div>

        {/* Wrapped so the preview can fade out over it. A guest is looking at
            a sample, and it should read as one before they click anything. */}
        <div className={`archive-grid-wrap ${isAuthenticated ? '' : 'preview'}`}>
          <table className="archive-grid">
            <thead>
              <tr>
                {WEEKDAY_INITIALS.map((initial, i) => (
                  // The initials repeat (T, T and S, S), so each needs a key that
                  // is not the letter, and a full name only the reader hears.
                  <th key={i} scope="col">
                    <abbr title={FULL_WEEKDAYS[i]}>{initial}</abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleWeeks.map((week, w) => (
                <tr key={w}>
                  {week.map((date, d) => {
                    if (!date) return <td key={d} className="archive-cell empty" />;

                    const inWindow = isWithinArchive(date, today);
                    const playable = canPlayDate({ date, format, today, isAuthenticated });
                    const played = archiveResults[format]?.[date];
                    const isToday = date === today;
                    const dayNumber = Number(date.slice(8));
                    /* A locked day is a preview, and a preview does not need a
                       date on it: the icons alone say "there is a month of these
                       here" without inviting anyone to read a day they cannot
                       open. Signing in puts every number back. */
                    const showNumber = playable || isAuthenticated;

                    return (
                      <td key={d} className="archive-cell">
                        <button
                          className={[
                            'archive-day',
                            playable ? 'open' : 'shut',
                            inWindow ? '' : 'outside',
                            played ? 'played' : '',
                            isToday ? 'today' : '',
                          ].join(' ').trim()}
                          disabled={!playable}
                          onClick={() => navigate(`${meta.path}?date=${date}`)}
                          aria-label={describeDay({ date, meta, inWindow, playable, played, isToday })}
                        >
                          <img className="archive-day-icon" src={meta.icon} alt="" />
                          {/* Hidden rather than dropped, so a row of locked days
                              is the same height as a row of open ones. The date
                              is still on the button's label for a screen reader,
                              which cannot see the icons doing the explaining. */}
                          <span className={`archive-day-number ${showNumber ? '' : 'concealed'}`}>
                            {dayNumber}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isAuthenticated && (
          /* The pitch, and the only thing on this page an account changes. */
          <section className="archive-pitch">
            <h2>Want every board of the last {ARCHIVE_DAYS} days?</h2>
            <p>
              Create an account to open the whole archive, back to{' '}
              {monthTitleOf(oldestArchiveDate(today))}. The four on the menu and
              today&apos;s board stay free either way.
            </p>
            <div className="archive-pitch-actions">
              <button className="archive-pitch-primary" onClick={() => navigate('/signup')}>
                Create an account
              </button>
              <button className="archive-pitch-secondary" onClick={() => navigate('/signin')}>
                Sign in
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

/* How much of a month a signed out visitor sees. */
const PREVIEW_ROWS = 2;

const FULL_WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/* A locked square is a grey icon and a number, which tells a screen reader
   nothing about why it cannot be opened. */
function describeDay({ date, meta, inWindow, playable, played, isToday }) {
  const when = isToday ? "today's" : date;
  if (!inWindow) return `${meta.name}, ${date}, outside the archive`;
  if (!playable) return `${meta.name}, ${date}, locked. Sign in to play it.`;
  return `Play ${meta.name}, ${when}${played ? ', already played' : ''}`;
}
