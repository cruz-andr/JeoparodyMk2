import { Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUserStore } from '../../stores';
import Icon from './Icon';
import './AppTabBar.css';

/**
 * The phone's navigation.
 *
 * On a small screen the top-right corner is the worst place to put the way
 * around an app: it is the furthest point from a thumb, and it was holding a
 * bare text link. The three places you actually go live along the bottom edge
 * instead, which is what every app a person already knows does.
 *
 * Three destinations, no more. A fourth would be a menu, and a menu of
 * destinations is the thing a tab bar exists to replace.
 *
 * It renders on the top-level screens only. Inside a game the whole screen is
 * the game, and a bar offering to leave it is a bar you will hit by accident.
 */
const TABS = [
  { to: '/menu', label: 'Play', icon: 'layout-grid' },
  { to: '/highscores', label: 'Records', icon: 'trophy' },
  { to: '/profile', label: 'You', icon: 'user' },
];

export default function AppTabBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, isAuthenticated } = useUserStore();

  /* A guest has no profile to land on, so You takes them to the place that
     makes one. The tab is not hidden: what it does is the pitch. */
  const youPath = isAuthenticated ? '/profile' : '/signin';
  const signature = isAuthenticated ? user?.signature : null;

  return (
    <Fragment>
      {/* The bar is fixed, so it floats over whatever is under it. This spacer
          is what keeps the last line of a page from hiding behind it. */}
      <div className="app-tabs-spacer" aria-hidden="true" />

      <nav className="app-tabs" aria-label="Primary">
        {TABS.map((tab) => {
          const to = tab.to === '/profile' ? youPath : tab.to;
          const active = pathname === tab.to || pathname.startsWith(`${tab.to}/`);

          return (
            <button
              key={tab.label}
              type="button"
              className={`plain-btn app-tab ${active ? 'is-on' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(to)}
            >
              <span className="app-tab-icon">
                {tab.label === 'You' && signature ? (
                  /* Your drawn name is your face here, the way a photograph is
                     anywhere else. It is the whole point of drawing it. */
                  <img className="app-tab-mark" src={signature} alt="" />
                ) : (
                  <Icon name={tab.icon} size={21} />
                )}
              </span>
              <span className="app-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </Fragment>
  );
}
