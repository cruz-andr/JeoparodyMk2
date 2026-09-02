import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUserStore } from '../stores';
import { readableError } from '../services/api/authService';
import AuthLayout from '../components/auth/AuthLayout';
import { usePageTitle } from '../hooks/usePageTitle';
import '../components/auth/auth-forms.css';
import './AccountPage.css';

export default function AccountPage() {
  usePageTitle('Your account');
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, clearSignature, deleteAccount, restoreSession } =
    useUserStore();

  const [error, setError] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  // Set when we are leaving on purpose, so the guard below does not race the
  // navigation and send a signing-out player to the sign-in page instead.
  const leaving = useRef(false);

  // The stored token may have expired while the tab was closed.
  useEffect(() => {
    restoreSession().finally(() => setChecked(true));
  }, [restoreSession]);

  /* Only once the token has been checked. Redirecting on the first render sent
     everyone to sign-in before the answer had come back. */
  useEffect(() => {
    if (checked && !isAuthenticated && !leaving.current) {
      navigate('/signin', { replace: true });
    }
  }, [checked, isAuthenticated, navigate]);

  if (!user) return null;

  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Your account"
      pitch={'Your streak.\nYour name.\nYour archive.'}
      pitchLine="Everything you have played, kept where you left it."
    >
      {error && <div className="auth-error" role="alert">{error}</div>}

      <section className="account-block">
        <p className="auth-field-label">Your name</p>
        <p className="account-hint">What players see when you buzz in.</p>
        {/* The username is the alt text: the same identity in words, which is
            exactly what a screen reader needs in place of a drawing. */}
        {user.signature ? (
          <img
            className="account-signature"
            src={user.signature}
            alt={user.username ? `${user.username}, drawn` : 'The name you drew'}
          />
        ) : (
          <p className="account-empty">You have not drawn one yet.</p>
        )}
        <div className="account-actions">
          <Link className="plain-btn account-link" to="/account/name">
            {user.signature ? 'Redraw' : 'Draw it'}
          </Link>
          {user.signature && (
            <button
              className="plain-btn account-link" disabled={busy}
              onClick={() => run(clearSignature)}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <dl className="account-rows">
        <div>
          <dt>Username<span className="account-dt-hint">how people find you</span></dt>
          <dd>
            {user.username ?? <span className="account-unset">Not chosen</span>}{' '}
            <Link className="plain-btn account-link" to="/account/username">
              {user.username ? 'Change' : 'Pick one'}
            </Link>
          </dd>
        </div>
        <div><dt>Email</dt><dd>{user.email ?? 'None'}</dd></div>
        <div>
          <dt>Signed in with</dt>
          <dd>
            {[user.hasGoogle && 'Google', user.hasPassword && 'Password']
              .filter(Boolean)
              .join(' and ')}
          </dd>
        </div>
        {user.createdAt && (
          <div><dt>Member since</dt><dd>{String(user.createdAt).slice(0, 10)}</dd></div>
        )}
      </dl>

      <button
        className="auth-secondary"
        onClick={() => { leaving.current = true; logout(); navigate('/menu'); }}
      >
        Sign out
      </button>

      {/* Promised by the privacy policy, so it is here and it really deletes. */}
      {!confirmingDelete ? (
        <p className="auth-foot">
          <button className="plain-btn account-danger" onClick={() => setConfirmingDelete(true)}>
            Delete account
          </button>
        </p>
      ) : (
        <div className="account-confirm">
          <p>
            This removes your email, your drawn name and your statistics. It cannot be undone.
          </p>
          <button
            className="account-danger-solid" disabled={busy}
            onClick={() => run(async () => {
              leaving.current = true;
              await deleteAccount();
              navigate('/menu', { replace: true });
            })}
          >
            {busy ? 'Deleting…' : 'Delete it permanently'}
          </button>
          <button className="plain-btn account-link" onClick={() => setConfirmingDelete(false)}>
            Keep my account
          </button>
        </div>
      )}
    </AuthLayout>
  );
}
