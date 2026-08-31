import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUserStore } from '../stores';
import { useDailyStore } from '../stores/dailyStore';
import { currentWeekBest, toDateString } from '../stores/dailyLogic';
import Icon from '../components/common/Icon';
import './ProfilePage.css';

/**
 * Your profile: what you have done, then what is yours.
 *
 * Settings and Account are rows inside this rather than places reached some
 * other way. How the game behaves is personal, so it belongs under your own
 * name; the gear that used to sit beside the logo has gone. Friends will be a
 * row here, which is the reason for building it this way now.
 */
export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, restoreSession } = useUserStore();
  const dailyStats = useDailyStore((s) => s.stats);

  const [checked, setChecked] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    restoreSession().finally(() => setChecked(true));
  }, [restoreSession]);

  // Only once the stored token has been checked; deciding on the first render
  // sent everyone to sign-in before the answer came back.
  useEffect(() => {
    if (checked && !isAuthenticated && !leaving.current) {
      navigate('/signin', { replace: true });
    }
  }, [checked, isAuthenticated, navigate]);

  if (!user) return null;

  const weekBest = currentWeekBest(dailyStats.board, toDateString());
  const money = (n) =>
    n === null || n === undefined ? '—'
      : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;

  return (
    <div className="profile-page">
      <header className="profile-top">
        <button className="plain-btn profile-back" onClick={() => navigate('/menu')}>&lsaquo; Menu</button>
        <span className="profile-top-title">You</span>
        <span className="profile-top-spacer" />
      </header>

      <main className="profile-body">
        <div className="profile-head">
          <div className="profile-card">
            {user.signature ? (
              <img src={user.signature} alt={user.username ? `${user.username}, drawn` : 'Your name'} />
            ) : (
              <p className="profile-nodrawing">You have not drawn your name yet.</p>
            )}
          </div>

          <div className="profile-who">
            <h1>
              {user.username ? `@${user.username}` : 'No username yet'}
              <Link className="profile-edit" to="/profile/edit" aria-label="Edit your profile">
                <Icon name="pen-line" size={22} />
              </Link>
            </h1>
            {user.createdAt && (
              <p>Playing since {new Date(user.createdAt).toLocaleDateString(undefined, {
                month: 'long', year: 'numeric',
              })}</p>
            )}
          </div>
        </div>

        <div className="profile-record">
          <div className="profile-stat">
            <b>{dailyStats.board.currentStreak}</b><span>Board streak</span>
          </div>
          <div className="profile-stat">
            <b>{dailyStats.sixer.currentStreak}</b><span>Sixer streak</span>
          </div>
          <div className="profile-stat">
            <b>{money(weekBest)}</b><span>Best this week</span>
          </div>
          <div className="profile-stat">
            <b>{dailyStats.board.gamesPlayed}</b><span>Boards played</span>
          </div>
        </div>

        <nav className="profile-rows">
          <Link className="plain-btn profile-row" to="/settings">
            <span className="profile-row-icon"><Icon name="settings" size={20} /></span>
            <span className="profile-row-main">
              <span className="profile-row-name">Settings</span>
              <span className="profile-row-note">Timers, sound, text size, colours</span>
            </span>
            <span className="profile-row-go">&rsaquo;</span>
          </Link>

          <Link className="plain-btn profile-row" to="/account">
            <span className="profile-row-icon"><Icon name="mail" size={20} /></span>
            <span className="profile-row-main">
              <span className="profile-row-name">Account</span>
              <span className="profile-row-note">Email, password, how you sign in</span>
            </span>
            <span className="profile-row-go">&rsaquo;</span>
          </Link>

          {/* Shown before it works, because the shape of this page is the
              argument for building friends here rather than somewhere else. */}
          <span className="profile-row is-soon" aria-disabled="true">
            <span className="profile-row-icon"><Icon name="user-round-plus" size={20} /></span>
            <span className="profile-row-main">
              <span className="profile-row-name">Friends</span>
              <span className="profile-row-note">Coming next</span>
            </span>
          </span>

          <button
            className="plain-btn profile-row"
            onClick={() => { leaving.current = true; logout(); navigate('/menu'); }}
          >
            <span className="profile-row-icon"><Icon name="log-out" size={20} /></span>
            <span className="profile-row-main">
              <span className="profile-row-name">Sign out</span>
            </span>
          </button>
        </nav>
      </main>
    </div>
  );
}
