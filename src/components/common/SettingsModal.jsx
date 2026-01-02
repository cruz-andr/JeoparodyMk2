import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '../../stores';
import './SettingsModal.css';

export default function SettingsModal({ isOpen, onClose }) {
  const {
    questionTimeLimit,
    enableDoubleJeopardy,
    enableDailyDouble,
    enableFinalJeopardy,
    soundEnabled,
    musicEnabled,
    volume,
    setQuestionTimeLimit,
    toggleDoubleJeopardy,
    toggleDailyDouble,
    toggleFinalJeopardy,
    toggleSound,
    toggleMusic,
    setVolume,
    loadPreset,
    resetToDefaults,
  } = useSettingsStore();

  const timeLimitOptions = [
    { value: null, label: 'Unlimited' },
    { value: 15000, label: '15 seconds' },
    { value: 30000, label: '30 seconds' },
    { value: 60000, label: '60 seconds' },
  ];

  const presets = [
    { id: 'casual', label: 'Casual', description: 'No time pressure, simpler rules' },
    { id: 'standard', label: 'Standard', description: 'Classic Jeopardy experience' },
    { id: 'challenging', label: 'Challenging', description: 'Fast timer, hard questions' },
    { id: 'speed', label: 'Speed Round', description: '10s timer, no Final Jeopardy' },
  ];

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="settings-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="settings-modal"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="settings-header">
            <h2>Settings</h2>
            <button className="close-btn" onClick={onClose}>
              &times;
            </button>
          </header>

          <div className="settings-content">
            {/* Presets */}
            <section className="settings-section">
              <h3>Quick Presets</h3>
              <div className="presets-grid">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    className="preset-btn"
                    onClick={() => loadPreset(preset.id)}
                  >
                    <span className="preset-label">{preset.label}</span>
                    <span className="preset-description">{preset.description}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Timer Settings */}
            <section className="settings-section">
              <h3>Timer</h3>
              <div className="settings-group">
                <label>Question Time Limit</label>
                <div className="radio-group">
                  {timeLimitOptions.map((option) => (
                    <label key={option.label} className="radio-label">
                      <input
                        type="radio"
                        name="timeLimit"
                        checked={questionTimeLimit === option.value}
                        onChange={() => setQuestionTimeLimit(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            {/* Game Rules */}
            <section className="settings-section">
              <h3>Game Rules</h3>
              <div className="toggle-group">
                <label className="toggle-label">
                  <span>Double Jeopardy Round</span>
                  <input
                    type="checkbox"
                    checked={enableDoubleJeopardy}
                    onChange={toggleDoubleJeopardy}
                  />
                  <span className="toggle-switch" />
                </label>

                <label className="toggle-label">
                  <span>Daily Double</span>
                  <input
                    type="checkbox"
                    checked={enableDailyDouble}
                    onChange={toggleDailyDouble}
                  />
                  <span className="toggle-switch" />
                </label>

                <label className="toggle-label">
                  <span>Final Jeopardy</span>
                  <input
                    type="checkbox"
                    checked={enableFinalJeopardy}
                    onChange={toggleFinalJeopardy}
                  />
                  <span className="toggle-switch" />
                </label>
              </div>
            </section>

            {/* Audio Settings */}
            <section className="settings-section">
              <h3>Audio</h3>
              <div className="toggle-group">
                <label className="toggle-label">
                  <span>Sound Effects</span>
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={toggleSound}
                  />
                  <span className="toggle-switch" />
                </label>

                <label className="toggle-label">
                  <span>Music</span>
                  <input
                    type="checkbox"
                    checked={musicEnabled}
                    onChange={toggleMusic}
                  />
                  <span className="toggle-switch" />
                </label>
              </div>

              <div className="settings-group">
                <label>Volume</label>
                <div className="volume-slider">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                  />
                  <span>{Math.round(volume * 100)}%</span>
                </div>
              </div>
            </section>
          </div>

          <footer className="settings-footer">
            <button className="btn-ghost" onClick={resetToDefaults}>
              Reset to Defaults
            </button>
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
