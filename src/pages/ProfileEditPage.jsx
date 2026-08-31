import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../stores';
import { checkUsername, readableError } from '../services/api/authService';
import SignatureCanvas from '../components/common/SignatureCanvas';
import '../components/common/SignatureCanvas.css';
import '../components/auth/auth-forms.css';
import './ProfileEditPage.css';

/**
 * Edit what other players see, and nothing else.
 *
 * Your drawn name and your username, together, because they are one act:
 * changing how you appear. Email, password and deleting the account are under
 * Account, since those are a different kind of change with different
 * consequences, and the page says so rather than leaving you to wonder.
 */
export default function ProfileEditPage() {
  const navigate = useNavigate();
  const { user, saveUsername, saveSignature, restoreSession, isAuthenticated } = useUserStore();

  const [username, setUsername] = useState(user?.username ?? '');
  const [drawing, setDrawing] = useState(null);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    restoreSession().finally(() => setReady(true));
  }, [restoreSession]);

  useEffect(() => {
    if (ready && !isAuthenticated) navigate('/signin', { replace: true });
  }, [ready, isAuthenticated, navigate]);

  useEffect(() => {
    if (user?.username && !username) setUsername(user.username);
  }, [user?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Asked as you type but only once you stop, and carrying a sequence number so
     a slow answer about an earlier name cannot overwrite a newer one. */
  const latest = useRef(0);
  useEffect(() => {
    const trimmed = username.trim();
    if (!trimmed || trimmed === user?.username) { setStatus(null); return undefined; }

    const mine = ++latest.current;
    setChecking(true);
    const timer = setTimeout(() => {
      checkUsername(trimmed)
        .then((result) => { if (mine === latest.current) setStatus(result); })
        .catch(() => { if (mine === latest.current) setStatus(null); })
        .finally(() => { if (mine === latest.current) setChecking(false); });
    }, 350);
    return () => clearTimeout(timer);
  }, [username, user?.username]);

  if (!user) return null;

  const unchangedName = username.trim() === user.username;
  const nameOk = unchangedName || status?.available === true;
  const nameBad = !checking && !unchangedName && status?.available === false;
  const nothingToSave = unchangedName && !drawing;

  const handleSave = async (e) => {
    e.preventDefault();
    if (busy || nothingToSave || !nameOk) return;
    setBusy(true);
    setError(null);
    try {
      // Saved separately because they are separate endpoints; the drawing first
      // so a rejected username never loses a drawing you just made.
      if (drawing) await saveSignature(drawing);
      if (!unchangedName) await saveUsername(username.trim());
      navigate('/profile', { replace: true });
    } catch (err) {
      setError(readableError(err));
      setBusy(false);
    }
  };

  const note = checking
    ? 'Checking…'
    : unchangedName
      ? 'This is already yours.'
      : status?.available === true
        ? 'That one is free.'
        : status?.reason ?? 'Letters, numbers and underscores. 3 to 20 characters.';

  return (
    <div className="edit-page">
      <header className="edit-top">
        <button className="plain-btn edit-back" onClick={() => navigate('/profile')}>Cancel</button>
        <span className="edit-title">Edit profile</span>
        <button
          className="plain-btn edit-save"
          onClick={handleSave}
          disabled={busy || nothingToSave || !nameOk}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </header>

      <form className="edit-body" onSubmit={handleSave}>
        {error && <div className="auth-error" role="alert">{error}</div>}

        <p className="auth-field-label">Your name</p>
        <SignatureCanvas
          width={300}
          height={120}
          initialSignature={user.signature ?? null}
          onSignatureChange={setDrawing}
        />
        <p className="edit-note">What players see when you buzz in.</p>

        <p className="auth-field-label" style={{ marginTop: 26 }}>Username</p>
        <input
          className={`auth-input ${nameBad ? 'auth-input-bad' : ''}`}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck="false"
          maxLength={20}
          aria-invalid={Boolean(nameBad)}
          aria-describedby="edit-username-note"
        />
        <p
          id="edit-username-note"
          className={`auth-match ${nameBad ? 'bad' : nameOk && !unchangedName ? 'ok' : ''}`}
          role={nameBad ? 'alert' : undefined}
        >
          {note}
        </p>

        <p className="edit-elsewhere">
          Your email and password are not here. They live under Account.
        </p>
      </form>
    </div>
  );
}
