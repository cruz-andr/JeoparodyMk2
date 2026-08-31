import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDailyStore } from '../../stores/dailyStore';
import { useUserStore } from '../../stores';
import { getOrFetchDailyChallenge } from '../../services/api/jeopardyService';
import { currentWeekBest, toDateString } from '../../stores/dailyLogic';
import './MainMenu.css';
import AppTabBar from '../common/AppTabBar';

/**
 * The board is the menu: six category headers are the six ways to play, and
 * the clue below is today's Board, opened up.
 */

// Room codes are six characters from an unambiguous alphabet (no O/0, I/1).
const CODE_LENGTH = 6;
const CODE_ALPHABET = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

const CATEGORIES = [
  { id: 'sixer', label: 'The Sixer', path: '/daily', daily: true },
  { id: 'multiplayer', label: 'Multi­player', path: '/multiplayer' },
  { id: 'host', label: 'Host\nA Game', path: '/host' },
  { id: 'single', label: 'Single\nPlayer', path: '/singleplayer' },
  { id: 'quickplay', label: 'Quickplay', path: '/quickplay' },
  { id: 'join', label: 'Join\nA Room', path: '/join' },
];

function formatDate(dateString) {
  const date = dateString ? new Date(`${dateString}T00:00:00Z`) : new Date();
  return date
    .toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
    .toUpperCase();
}

export default function MainMenu() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [today, setToday] = useState(null);
  const codeInputRef = useRef(null);

  const stats = useDailyStore((s) => s.stats);
  const userStats = useUserStore((s) => s.stats);
  const displayName = useUserStore((s) => s.user?.displayName);
  const signature = useUserStore((s) => s.user?.signature);
  const isAuthenticated = useUserStore((s) => s.isAuthenticated);
  const restoreSession = useUserStore((s) => s.restoreSession);
  const logout = useUserStore((s) => s.logout);
  const [showIdentity, setShowIdentity] = useState(false);
  const identityRef = useRef(null);
  const chipRef = useRef(null);

  const boardStreak = stats.board.currentStreak;
  const sixerStreak = stats.sixer.currentStreak;
  // The Board's own best, for the week in progress. Read through the helper so
  // a value left over from last week is not shown as if it still counted.
  const boardWeekBest = currentWeekBest(stats.board, toDateString());

  /* A menu that only closes by clicking the thing that opened it is not a menu.
     Both ways out are expected: clicking away, and Escape. Escape also puts the
     focus back on the chip, or a keyboard user is left nowhere. */
  useEffect(() => {
    if (!showIdentity) return undefined;

    const onPointerDown = (e) => {
      if (!identityRef.current?.contains(e.target)) setShowIdentity(false);
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      setShowIdentity(false);
      chipRef.current?.focus();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showIdentity]);

  /* A stored token can have expired, or belong to an account since deleted.
     Ask once on arrival rather than showing someone a name they cannot use. */
  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Today's categories make the hero real. The menu must still work when the
  // backend is unreachable, so a failure here is silent.
  useEffect(() => {
    let cancelled = false;
    getOrFetchDailyChallenge()
      .then((challenge) => {
        if (!cancelled) setToday(challenge);
      })
      .catch(() => {
        /* the board is decoration here; never block the menu on it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCodeChange = useCallback((e) => {
    const next = e.target.value
      .toUpperCase()
      .replace(CODE_ALPHABET, '')
      .slice(0, CODE_LENGTH);
    setCode(next);
  }, []);

  const handleJoin = useCallback(
    (e) => {
      e.preventDefault();
      if (code.length === CODE_LENGTH) navigate(`/join/${code}`);
    },
    [code, navigate]
  );

  const categories = today?.board?.categories ?? [];

  return (
    <div className="menu">
      {/* Rail */}
      <header className="menu-rail">
        <div className="menu-brand">
          <span className="menu-wordmark">Jeoparody!</span>
          <span className="menu-tagline">Six categories. One board. Pick your poison.</span>
        </div>

        <div className="menu-identity">
          {/* Highscores used to be a bare word in the corner. Your best score
              is already sitting here and is the first row of that table, so it
              is the link: click the number, see the numbers. On a phone this
              is the Records tab along the bottom instead. */}
          <button
            className="plain-btn menu-stat"
            onClick={() => navigate('/highscores')}
            title="See the highscores"
          >
            <span className="menu-stat-label">Solo Best</span>
            <span className="menu-stat-value gold">
              ${userStats.highestScore.toLocaleString()}
            </span>
          </button>
          <span className="menu-divider" />
          {/* Guest used to be a word that did nothing. It is the way in now. */}
          <div className="menu-identity-wrap" ref={identityRef}>
            <button
              ref={chipRef}
              className="plain-btn menu-player"
              onClick={() => setShowIdentity((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showIdentity}
            >
              {signature ? (
                <img className="menu-signature" src={signature} alt={displayName || 'Your account'} />
              ) : (
                displayName || 'Guest'
              )}
            </button>

            {showIdentity && (
              <div className="menu-identity-menu" role="menu">
                {isAuthenticated ? (
                  <>
                    {/* Profile and Settings only. Account is a row inside the
                        profile: it is where you change an email or delete the
                        thing, not somewhere you jump to from a header. */}
                    <button role="menuitem" onClick={() => navigate('/profile')}>Profile</button>
                    <button role="menuitem" onClick={() => navigate('/settings')}>Settings</button>
                    <div className="menu-identity-sep" />
                    <button role="menuitem" className="quiet" onClick={() => { logout(); setShowIdentity(false); }}>
                      Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <button role="menuitem" onClick={() => navigate('/signup')}>
                      Create an account
                    </button>
                    <button role="menuitem" onClick={() => navigate('/signin')}>Sign in</button>
                    <div className="menu-identity-sep" />
                    {/* A guest has settings but no profile, so the way in cannot
                        be through one. They keep a direct route. */}
                    <button role="menuitem" onClick={() => navigate('/settings')}>Settings</button>
                    <button role="menuitem" className="quiet" onClick={() => setShowIdentity(false)}>
                      Keep playing as a guest
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Six categories are the six ways to play */}
      <nav className="menu-categories" aria-label="Game modes">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className={`menu-category ${cat.daily ? 'daily' : ''}`}
            onClick={() => navigate(cat.path)}
          >
            <span className="menu-category-name">{cat.label}</span>
            {cat.id === 'sixer' && (
              <>
                <span className="menu-category-meta">6 Clues &middot; 90 Sec</span>
                {sixerStreak > 0 && (
                  <span className="menu-category-streak">{sixerStreak}-Day Streak</span>
                )}
              </>
            )}
          </button>
        ))}
      </nav>

      {/* The revealed clue: today's Board */}
      <section className="menu-hero">
        <div className="menu-hero-main">
          <div className="menu-hero-top">
            <div className="menu-hero-eyebrow">
              <span className="menu-date">{formatDate(today?.date)}</span>
              <span className="menu-edition">Today&apos;s Edition</span>
            </div>
            <h1 className="menu-hero-title">The Board</h1>
            <p className="menu-hero-copy">
              A fresh board every day. Six categories and thirty clues, the same
              ones for every player, pulled from a real episode.
            </p>
            <span className="menu-hero-kicker">What is a good twenty minutes?</span>
          </div>

          <div className="menu-hero-actions">
            <button className="menu-cta" onClick={() => navigate('/daily/board')}>
              Play The Board
            </button>
            <div className="menu-hero-stats">
              <span className="menu-bigstat">
                <span className="menu-bigstat-value gold">{boardStreak}</span>
                <span className="menu-bigstat-label">Board Streak</span>
              </span>
              <span className="menu-bigstat">
                <span className="menu-bigstat-value">
                  {boardWeekBest === null
                    ? '\u2014'
                    : `${boardWeekBest < 0 ? '-' : ''}$${Math.abs(boardWeekBest).toLocaleString()}`}
                </span>
                <span className="menu-bigstat-label">Best This Week</span>
              </span>
            </div>
          </div>
        </div>

        <aside className="menu-hero-rail" aria-label="Today's categories">
          <div className="menu-rail-head">Today&apos;s Categories</div>
          {categories.length > 0
            ? categories.map((name, i) => (
                <div className="menu-rail-row" key={`${name}-${i}`}>
                  <span className="menu-rail-name">{name}</span>
                  <span className="menu-rail-count">5 Clues</span>
                </div>
              ))
            : Array.from({ length: 6 }, (_, i) => (
                <div className="menu-rail-row empty" key={i} aria-hidden="true" />
              ))}
        </aside>
      </section>

      {/* Join */}
      <form className="menu-join" onSubmit={handleJoin}>
        <div className="menu-join-field">
          <label className="menu-join-label" htmlFor="room-code">
            Got a room code?
          </label>
          <div
            className="menu-code"
            onClick={() => codeInputRef.current?.focus()}
            role="presentation"
          >
            <input
              id="room-code"
              ref={codeInputRef}
              className="menu-code-input"
              value={code}
              onChange={handleCodeChange}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck="false"
              inputMode="text"
              maxLength={CODE_LENGTH}
            />
            <div className="menu-code-boxes" aria-hidden="true">
              {Array.from({ length: CODE_LENGTH }, (_, i) => (
                <span
                  key={i}
                  className={`menu-code-box ${code[i] ? 'filled' : ''} ${
                    i === code.length ? 'active' : ''
                  }`}
                >
                  {code[i] ?? ''}
                </span>
              ))}
            </div>
          </div>
        </div>
        <button
          type="submit"
          className="menu-join-btn"
          disabled={code.length !== CODE_LENGTH}
        >
          Join &rarr;
        </button>
      </form>

      <AppTabBar />
    </div>
  );
}
