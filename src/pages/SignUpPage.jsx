import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUserStore } from '../stores';
import { readableError } from '../services/api/authService';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';
import { usePageTitle } from '../hooks/usePageTitle';
import '../components/auth/auth-forms.css';

/* Shown under the field and ticked as they are met. Being told the rule only
   after being rejected is the most common complaint about sign-up forms. */
const RULES = [
  { id: 'length', label: 'At least 8 characters', met: (p) => p.length >= 8 },
  { id: 'number', label: 'One number', met: (p) => /\d/.test(p) },
  { id: 'capital', label: 'One capital letter', met: (p) => /[A-Z]/.test(p) },
];

export default function SignUpPage() {
  usePageTitle('Make an account');
  const navigate = useNavigate();
  const register = useUserStore((s) => s.register);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const met = RULES.filter((r) => r.met(password));
  const matches = confirm.length > 0 && confirm === password;
  // Only complain once they have actually typed something to compare.
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready =
    email.trim().length > 3 && met.length === RULES.length && matches && !busy;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      // A stand-in until the next screen, where a username is chosen.
      await register({
        email: email.trim(),
        password,
        displayName: email.trim().split('@')[0],
      });
      navigate('/account/username?new=1');
    } catch (err) {
      setError(readableError(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Make an account" subtitle="Free. About twenty seconds.">
      <GoogleButton />
      <div className="auth-or">or</div>

      <form onSubmit={handleSubmit} noValidate>
        {error && <div className="auth-error" role="alert">{error}</div>}

        <label className="auth-field-label" htmlFor="email">Email</label>
        <input
          id="email" className="auth-input" type="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email" autoCapitalize="none" spellCheck="false" required
        />

        <label className="auth-field-label" htmlFor="password">Password</label>
        <div className="auth-password-wrap">
          <input
            id="password" className="auth-input"
            type={reveal ? 'text' : 'password'} value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password" required
          />
          <button
            type="button" className="auth-reveal" onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide both passwords' : 'Show both passwords'}
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>

        <ul className="auth-reqs">
          {RULES.map((rule) => {
            const ok = rule.met(password);
            return (
              <li key={rule.id} className={ok ? 'met' : ''}>
                <span aria-hidden="true">{ok ? '✓' : '○'}</span>
                <span>{rule.label}</span>
              </li>
            );
          })}
        </ul>

        <label className="auth-field-label" htmlFor="confirm">Confirm password</label>
        <div className="auth-password-wrap">
          <input
            id="confirm"
            className={`auth-input ${mismatch ? 'auth-input-bad' : ''}`}
            type={reveal ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch}
            aria-describedby="confirm-note"
            required
          />
        </div>
        {/* Said the moment it stops matching, not after the form is rejected. */}
        <p
          id="confirm-note"
          className={`auth-match ${mismatch ? 'bad' : matches ? 'ok' : ''}`}
          role={mismatch ? 'alert' : undefined}
        >
          {mismatch
            ? 'These do not match yet.'
            : matches
              ? 'Both match.'
              : 'Type it once more.'}
        </p>

        <button className="auth-submit" type="submit" disabled={!ready}>
          {busy ? 'Creating…' : 'Continue'}
        </button>
      </form>

      <p className="auth-foot">
        Already have one? <Link to="/signin">Sign in</Link>
      </p>
      <p className="auth-legal">
        By continuing you agree to our <Link to="/privacy">privacy policy</Link>.
      </p>
    </AuthLayout>
  );
}
