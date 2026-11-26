import { useSettingsStore } from '../../stores';
import './SettingsPanel.css';

/**
 * The player's own settings: how the game sounds and how it reads.
 *
 * It used to hold every setting there was, a search box to find them, and
 * four presets. Most did nothing any more: a music switch for music the site
 * no longer plays, a difficulty that only AI-written boards read, an "after
 * buzzing in" clock the rooms overrule with their own, a "show the timer"
 * switch that turned the clock off rather than hiding it, and a "show score"
 * that nothing read. The round rules and the clue clock belong to a game, not
 * to a person, so they are set where a game is made (the Multiplayer screen's
 * house rules, and the lobby) and the daily games keep their own.
 */

const TEXT_SCALES = [
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' },
];

const MOTION_CHOICES = [
  { value: 'system', label: 'Match my device' },
  { value: 'on', label: 'Reduce motion' },
  { value: 'off', label: 'Full motion' },
];

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-label">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="toggle-switch" />
    </label>
  );
}

function Radios({ name, label, options, value, onChange }) {
  return (
    <div className="settings-group">
      <label>{label}</label>
      <div className="radio-group">
        {options.map((o) => (
          <label className="radio-label" key={String(o.value)}>
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPanel() {
  const s = useSettingsStore();

  return (
    <div className="settings-content">
      <section className="settings-section">
        <h3>Sound</h3>
        <div className="toggle-group">
          <div className="setting-row">
            <Toggle label="Sound effects" checked={s.soundEnabled} onChange={s.toggleSound} />
          </div>
          <div className="setting-row">
            <div className="settings-group">
              <label htmlFor="settings-volume">Volume: {Math.round(s.volume * 100)}%</label>
              <input
                id="settings-volume"
                type="range" min="0" max="1" step="0.05" value={s.volume}
                disabled={!s.soundEnabled}
                onChange={(e) => s.setVolume(parseFloat(e.target.value))}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>Display and access</h3>
        <div className="toggle-group">
          <div className="setting-row">
            <Toggle label="Colourblind friendly results" checked={s.highContrast} onChange={s.toggleHighContrast} />
          </div>
          <div className="setting-row">
            <Radios name="textScale" label="Text size" options={TEXT_SCALES} value={s.textScale} onChange={s.setTextScale} />
          </div>
          <div className="setting-row">
            <Radios name="reduceMotion" label="Motion" options={MOTION_CHOICES} value={s.reduceMotion} onChange={s.setReduceMotion} />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <button className="preset-btn" onClick={s.resetToDefaults}>
          <span className="preset-label">Reset to defaults</span>
          <span className="preset-description">Puts every setting back</span>
        </button>
      </section>
    </div>
  );
}
