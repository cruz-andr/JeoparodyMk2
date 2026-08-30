import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOrFetchDailyChallenge } from '../../services/api/jeopardyService';
import './AuthLayout.css';

/**
 * The frame every account screen sits in.
 *
 * A board runs past all four edges of the left half so no square is whole,
 * which is what makes it read as a window onto the game rather than a picture
 * of it. On a phone that half is dropped entirely rather than shrunk: a
 * cropped board at 390px is noise above the only thing anyone came for.
 */

const ROWS = ['$200', '$400', '$600', '$800', '$1000', '$1200'];
const COLUMNS = 7;

// Shown until today's board arrives, and if it never does.
const FALLBACK = [
  'POTENT POTABLES', 'WORLD CAPITALS', 'THE SILVER SCREEN',
  'ANCIENT HISTORY', 'FAMOUS FIRSTS', 'WORD ORIGINS',
];

export default function AuthLayout({ title, subtitle, children, pitch, pitchLine }) {
  const [categories, setCategories] = useState(FALLBACK);

  // Decoration, so a failure here is silent and the fallback stands.
  useEffect(() => {
    let cancelled = false;
    getOrFetchDailyChallenge()
      .then((challenge) => {
        const found = challenge?.board?.categories;
        if (!cancelled && Array.isArray(found) && found.length) setCategories(found);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="auth-page">
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-board">
          {Array.from({ length: COLUMNS }, (_, c) => (
            <div className="auth-board-cat" key={`c${c}`}>
              {categories[c % categories.length]}
            </div>
          ))}
          {ROWS.map((value, r) =>
            Array.from({ length: COLUMNS }, (_, c) => (
              <div className="auth-board-sq" key={`${r}-${c}`}>{value}</div>
            ))
          )}
        </div>

        <div className="auth-art-top">
          <Link to="/menu" className="auth-wordmark">Jeoparody!</Link>
        </div>

        <div className="auth-art-foot">
          <h2>{pitch ?? 'Six categories.\nThirty clues. Daily.'}</h2>
          <p>{pitchLine ?? 'The same board as everyone else, pulled from a real episode.'}</p>
        </div>
      </aside>

      <main className="auth-form-side">
        <div className="auth-form">
          <Link to="/menu" className="auth-wordmark auth-wordmark-phone">Jeoparody!</Link>
          <h1>{title}</h1>
          {subtitle && <p className="auth-sub">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
