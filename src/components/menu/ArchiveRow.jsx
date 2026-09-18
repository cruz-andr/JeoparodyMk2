import { useNavigate } from 'react-router-dom';
import { freeArchivePicks } from '@shared/archiveWindow.js';
import { useDailyStore } from '../../stores/dailyStore';
import { FORMAT_META, dayOf, weekdayOf } from '../../utils/dailyFormats';
import './ArchiveRow.css';

/**
 * The four days anyone can play, sitting under the join box.
 *
 * Deliberately not a scroller. Four is the whole set, so a row that could be
 * dragged would be promising more than it holds; what holds more is the
 * calendar behind MORE, and that is what an account is for.
 *
 * The picks come from the shared window module, which the API reads too, so a
 * card on screen is a card the server will build.
 */

export default function ArchiveRow() {
  const navigate = useNavigate();
  const archiveResults = useDailyStore((s) => s.archiveResults);
  const picks = freeArchivePicks();

  return (
    <section className="archive-row" aria-labelledby="archive-row-title">
      <div className="archive-row-head">
        <h2 className="archive-row-title" id="archive-row-title">
          Free From The Archive
        </h2>
        <button className="archive-row-more" onClick={() => navigate('/archive')}>
          More
        </button>
      </div>

      <ul className="archive-cards">
        {picks.map(({ date, format }) => {
          const meta = FORMAT_META[format];
          const played = archiveResults[format]?.[date];

          return (
            <li key={`${format}-${date}`}>
              <button
                className="archive-card"
                onClick={() => navigate(`${meta.path}?date=${date}`)}
              >
                <span className="archive-card-day">{weekdayOf(date)}</span>
                <span className="archive-card-date">{dayOf(date)}</span>
                <img className="archive-card-icon" src={meta.icon} alt="" />
                <span className="archive-card-game">{meta.name}</span>
                {/* Reserved whether or not it is filled, so a played card is
                    not a different height from the one beside it. */}
                <span className={`archive-card-state ${played ? 'played' : ''}`}>
                  {played ? 'Played' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
