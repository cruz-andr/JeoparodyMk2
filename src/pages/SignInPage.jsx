import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useUserStore } from '../stores';
import { readableError, readableGoogleError } from '../services/api/authService';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';
import '../components/auth/auth-forms.css';

export default function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const login = useUserStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Google sends people back here with a reason when it goes wrong.
  useEffect(() => {
    const reason = params.get('error');
    if (reason) setError(readableGoogleError(reason));
  }, [params]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
      navigate('/menu');
    } catch (err) {
      setError(readableError(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Pick up your streak."
      pitch={'Your streak.\nYour name.\nYour archive.'}
      pitchLine="Everything you have played, waiting where you left it."
    >
      <GoogleButton />
      <div className="auth-or">or</div>

      <form onSubmit={handleSubmit} noValidate>
        {/* One sentence for both halves. Saying which was wrong tells a
            stranger whether an email has an account here. */}
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
            autoComplete="current-password" required
          />
          <button
            type="button" className="auth-reveal" onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>

        <button className="auth-submit" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="auth-foot">
        New here? <Link to="/signup">Make an account</Link>
      </p>
    </AuthLayout>
  );
}
