import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import SettingsModal from '../common/SettingsModal';
import { useDailyStore } from '../../stores/dailyStore';
import { useUserStore } from '../../stores';
import { getOrFetchDailyChallenge } from '../../services/api/jeopardyService';
import './MainMenu.css';

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
  const [showSettings, setShowSettings] = useState(false);
  const [code, setCode] = useState('');
  const [today, setToday] = useState(null);
  const codeInputRef = useRef(null);

  const stats = useDailyStore((s) => s.stats);
  const userStats = useUserStore((s) => s.stats);
  const displayName = useUserStore((s) => s.user?.displayName);

  const boardStreak = stats.board.currentStreak;
  const sixerStreak = stats.sixer.currentStreak;
  const losses = Math.max(0, userStats.gamesPlayed - userStats.gamesWon);

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
          <span className="menu-stat">
            <span className="menu-stat-label">Record</span>
            <span className="menu-stat-value">
              {userStats.gamesWon}&ndash;{losses}
            </span>
          </span>
          <span className="menu-divider" />
          <span className="menu-stat">
            <span className="menu-stat-label">Best</span>
            <span className="menu-stat-value gold">
              ${userStats.highestScore.toLocaleString()}
            </span>
          </span>
          <span className="menu-divider" />
          <span className="menu-player">{displayName || 'Guest'}</span>
          <button
            className="menu-text-btn"
            onClick={() => navigate('/highscores')}
          >
            Highscores
          </button>
          <button
            className="menu-icon-btn"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M12 2.5v3.2M12 18.3v3.2M4.5 4.5l2.3 2.3M17.2 17.2l2.3 2.3M2.5 12h3.2M18.3 12h3.2M4.5 19.5l2.3-2.3M17.2 6.8l2.3-2.3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
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
                  ${userStats.highestScore.toLocaleString()}
                </span>
                <span className="menu-bigstat-label">Your Best</span>
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

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
