import { useNavigate } from 'react-router-dom';
import SettingsPanel from '../components/common/SettingsPanel';
import { usePageTitle } from '../hooks/usePageTitle';
import './SettingsPage.css';

/**
 * Settings, as a page rather than a modal over the menu.
 *
 * Signed in, you arrive here from your profile, because how the game behaves is
 * personal and belongs under your own name. A guest has settings but no profile,
 * so they come straight here from the menu.
 */
export default function SettingsPage() {
  usePageTitle('Settings');
  const navigate = useNavigate();

  return (
    <div className="settings-page">
      <header className="settings-page-head">
        <button className="plain-btn settings-back" onClick={() => navigate(-1)}>
          &lsaquo; Back
        </button>
        <h1>Settings</h1>
        <span className="settings-head-spacer" />
      </header>

      <div className="settings-page-body">
        <SettingsPanel />
      </div>
    </div>
  );
}
