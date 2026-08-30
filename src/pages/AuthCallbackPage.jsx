import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../stores';
import AuthLayout from '../components/auth/AuthLayout';
import '../components/auth/auth-forms.css';

/**
 * Where Google sends people back.
 *
 * The token arrives in the URL fragment rather than the query, because a
 * fragment is never sent to a server: it stays out of access logs and out of
 * the Referer header. It is read once, exchanged for a session, and then
 * scrubbed from the address bar so it is not left sitting in history.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const adoptToken = useUserStore((s) => s.adoptToken);
  const [failed, setFailed] = useState(false);
  // React runs effects twice in development; without this the token is
  // exchanged, wiped, and then the second run finds nothing and reports failure.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (!token) {
      setFailed(true);
      return;
    }

    // Out of the address bar before anything else can read it.
    window.history.replaceState(null, '', window.location.pathname);

    adoptToken(token)
      .then((user) => navigate(user?.signature ? '/menu' : '/account/name?new=1', { replace: true }))
      .catch(() => setFailed(true));
  }, [adoptToken, navigate]);

  if (failed) {
    return (
      <AuthLayout title="That did not work" subtitle="The sign-in link was missing or expired.">
        <button className="auth-submit" onClick={() => navigate('/signin', { replace: true })}>
          Try again
        </button>
      </AuthLayout>
    );
  }

  return <AuthLayout title="Signing you in" subtitle="One moment." />;
}
