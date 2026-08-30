import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUserStore } from '../stores';
import { checkUsername, readableError } from '../services/api/authService';
import AuthLayout from '../components/auth/AuthLayout';
import '../components/auth/auth-forms.css';

/**
 * Choose a username.
 *
 * Two names, two jobs. The username is the handle: unique, typed, and how
 * somebody finds you or adds you as a friend. The drawing made on the next
 * screen is the name people SEE, on your podium when you buzz. The username
 * stands in wherever a drawing cannot go, which is a text leaderboard row and
 * the alt text on the drawing itself.
 *
 * Both ways in arrive here, since Google hands over whatever name it has on
 * file and that is not one you chose.
 */
export default function AccountUsernamePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';

  const user = useUserStore((s) => s.user);
  const saveUsername = useUserStore((s) => s.saveUsername);

  const [value, setValue] = useState(user?.username ?? '');
  const [status, setStatus] = useState(null); // { available, reason }
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  /* Asked as you type, but only once you have stopped: a request per keystroke
     would answer about names you were halfway through writing. The sequence
     number drops answers that arrive out of order. */
  const latest = useRef(0);
  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) { setStatus(null); return undefined; }

    const mine = ++latest.current;
    setChecking(true);
    const timer = setTimeout(() => {
      checkUsername(trimmed)
        .then((result) => {
          if (mine === latest.current) setStatus(result);
        })
        .catch(() => {
          if (mine === latest.current) setStatus(null);
        })
        .finally(() => {
          if (mine === latest.current) setChecking(false);
        });
    }, 350);

    return () => clearTimeout(timer);
  }, [value]);

  const unchanged = user?.username && value.trim() === user.username;
  const ready = !busy && value.trim().length >= 3 && (unchanged || status?.available === true);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await saveUsername(value.trim());
      navigate(isNew ? '/account/name?new=1' : '/account', { replace: true });
    } catch (err) {
      setError(readableError(err));
      setBusy(false);
    }
  };

  const note = checking
    ? 'Checking…'
    : unchanged
      ? 'This is already yours.'
      : status?.available === true
        ? 'That one is free.'
        : status?.reason ?? 'Letters, numbers and underscores. 3 to 20 characters.';

  const bad = !checking && !unchanged && status && status.available === false;

  return (
    <AuthLayout
      title={isNew ? 'Pick a username' : 'Change your username'}
      subtitle="How people find you. Not what they see."
      pitch={'One board.\nEveryone on it.'}
      pitchLine="Unique to you, so a friend can find you by typing it. You draw the name people see next."
    >
      <form onSubmit={handleSubmit} noValidate>
        {error && <div className="auth-error" role="alert">{error}</div>}

        <label className="auth-field-label" htmlFor="username">Username</label>
        <input
          id="username"
          className={`auth-input ${bad ? 'auth-input-bad' : ''}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck="false"
          maxLength={20}
          aria-invalid={Boolean(bad)}
          aria-describedby="username-note"
          autoFocus
          required
        />
        <p
          id="username-note"
          className={`auth-match ${bad ? 'bad' : status?.available || unchanged ? 'ok' : ''}`}
          role={bad ? 'alert' : undefined}
        >
          {note}
        </p>

        <button className="auth-submit" type="submit" disabled={!ready}>
          {busy ? 'Saving…' : isNew ? 'Continue' : 'Save'}
        </button>
      </form>

      {!isNew && (
        <button className="auth-secondary" onClick={() => navigate('/account')}>
          Cancel
        </button>
      )}
    </AuthLayout>
  );
}
