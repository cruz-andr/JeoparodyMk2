import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUserStore } from '../stores';
import { readableError } from '../services/api/authService';
import AuthLayout from '../components/auth/AuthLayout';
import SignatureCanvas from '../components/common/SignatureCanvas';
import { usePageTitle } from '../hooks/usePageTitle';
import '../components/common/SignatureCanvas.css';
import '../components/auth/auth-forms.css';

/**
 * Draw your name.
 *
 * On the show contestants write their name on the podium, and this is the
 * same thing: it is what other players see when you buzz. Reached after
 * signing up, and again from the account screen whenever you want to change it.
 */
export default function AccountNamePage() {
  usePageTitle('Draw your name');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';

  const user = useUserStore((s) => s.user);
  const saveSignature = useUserStore((s) => s.saveSignature);

  const [drawing, setDrawing] = useState(user?.signature ?? null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!drawing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveSignature(drawing);
      navigate(isNew ? '/menu' : '/account', { replace: true });
    } catch (err) {
      setError(readableError(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Draw your name"
      subtitle="This is what people see when you buzz in."
      pitch={'Now sign in,\nliterally.'}
      pitchLine="On the show, contestants write their name on the podium."
    >
      {error && <div className="auth-error" role="alert">{error}</div>}

      <SignatureCanvas
        width={300}
        height={120}
        initialSignature={user?.signature ?? null}
        onSignatureChange={setDrawing}
      />

      <button className="auth-submit" onClick={handleSave} disabled={!drawing || busy}>
        {busy ? 'Saving…' : 'Use this'}
      </button>

      <button
        className="auth-secondary"
        onClick={() => navigate(isNew ? '/menu' : '/account', { replace: true })}
      >
        {isNew ? 'Do this later' : 'Cancel'}
      </button>

      <p className="auth-foot">You can redraw it any time.</p>
    </AuthLayout>
  );
}
