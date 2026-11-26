import { useEffect, useRef } from 'react';
import SettingsPanel from './SettingsPanel';
import { useSettingsOverlay } from './settingsOverlayStore';
import './SettingsOverlay.css';

/**
 * Settings, over whatever page you are on.
 *
 * Five settings are not a page's worth, and opening them should not take you
 * away from the game you were looking at. Mounted once (Root, in App.jsx), and
 * opened from anywhere with openSettings() (settingsOverlayStore.js).
 */
export default function SettingsOverlay() {
  const open = useSettingsOverlay((s) => s.open);
  const hide = useSettingsOverlay((s) => s.hide);
  const dialog = useRef(null);

  /* Escape closes it, focus starts inside it and goes back where it was, and
     the page underneath does not scroll while it is up. */
  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [open, hide]);

  if (!open) return null;

  return (
    <div className="settings-scrim" onClick={hide}>
      <div
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-sheet-title"
        tabIndex={-1}
        ref={dialog}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-sheet-head">
          <h2 id="settings-sheet-title">Settings</h2>
          <button type="button" className="plain-btn settings-sheet-close" onClick={hide} aria-label="Close settings">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <SettingsPanel />
      </div>
    </div>
  );
}
