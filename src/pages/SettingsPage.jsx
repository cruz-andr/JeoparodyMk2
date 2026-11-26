import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { openSettings } from '../components/common/settingsOverlayStore';

/**
 * /settings, for a link or a bookmark. Settings are an overlay now
 * (components/common/SettingsOverlay.jsx), so the address opens it over the
 * menu rather than being a page of its own.
 */
export default function SettingsPage() {
  useEffect(() => { openSettings(); }, []);
  return <Navigate to="/menu" replace />;
}
