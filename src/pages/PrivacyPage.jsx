import { Link } from 'react-router-dom';
import './PrivacyPage.css';

/**
 * Required by Google before an OAuth app can be published to production, and
 * worth having regardless once real accounts exist.
 *
 * Every claim here has to stay true of the code. If the schema in
 * server/config/database.js gains a column, or a store starts keeping
 * something new in the browser, this page is part of that change.
 */
const UPDATED = '30 August 2026';
const CONTACT = 'acruz24100@gmail.com';

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <div className="legal-inner">
        <Link to="/menu" className="legal-back">&larr; Back to Jeoparody</Link>

        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated {UPDATED}</p>

        <p className="legal-lede">
          Jeoparody is a Jeopardy-style trivia game. This page says exactly what it keeps,
          why, and how to get rid of it. It is short because the game collects little.
        </p>

        <h2>Playing without an account</h2>
        <p>
          You can play everything without signing in. In that case nothing about you reaches
          our server. Your settings, your daily streak and your scores are saved by your own
          browser, on your own device, and clearing your browser data removes them.
        </p>

        <h2>If you make an account</h2>
        <p>We keep only what the game needs to work:</p>
        <ul>
          <li><b>Your email address</b>, so you can sign back in and recover access.</li>
          <li><b>Your password</b>, stored only as a bcrypt hash. We cannot read it, and
            neither can anyone who obtains the database.</li>
          <li><b>Your display name and your drawn signature</b>, which is the name other
            players see when you buzz in.</li>
          <li><b>Your game statistics</b>: games played, scores, streaks and daily results.</li>
        </ul>

        <h2>If you sign in with Google</h2>
        <p>
          We ask Google for three things only: that you are signed in, your email address, and
          your basic profile (your name and picture). We never ask for access to your Gmail,
          Drive, Calendar, contacts or anything else, and we could not read them if we tried.
          We do not receive your Google password.
        </p>

        <h2>What we do not do</h2>
        <ul>
          <li>We do not sell or rent your data to anyone.</li>
          <li>We do not share it with advertisers, and there is no advertising in the game.</li>
          <li>We do not run third-party analytics or tracking pixels.</li>
          <li>We do not use your data to train anything.</li>
        </ul>

        <h2>Cookies and local storage</h2>
        <p>
          One cookie holds a session identifier so that a dropped connection can rejoin the
          game you were in. Your browser also stores your settings, your daily progress and,
          when signed in, a sign-in token. None of it is used to follow you anywhere else.
        </p>

        <h2>Where it is kept</h2>
        <p>
          On a server in Amsterdam, in the European Union, run for us by Fly.io. The site
          itself is served by Vercel. Both can see the technical information any web host
          sees, such as your IP address, in order to deliver the site to you.
        </p>

        <h2>Deleting your account</h2>
        <p>
          Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we will delete it. That removes
          your email address, your password hash, your drawn signature and your statistics from
          the database. It cannot be undone, and it does not remove scores already shown on a
          public leaderboard alongside a display name.
        </p>
        <p>
          A button on your account screen will do the same thing without having to ask. Until
          that ships, email is the way, and it is honoured either way.
        </p>

        <h2>Children</h2>
        <p>
          The game is suitable for all ages, but accounts are not intended for children under
          13. If you believe a child has made one, email us and we will remove it.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes in a way that affects what we keep about you, the date at the
          top changes and, if you have an account, we will tell you by email.
        </p>

        <h2>Contact</h2>
        <p>
          Questions, corrections or deletion requests:{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </div>
    </div>
  );
}
