import { motion } from 'framer-motion';
import { useHostStore } from '../../stores/hostStore';
import { useSettingsStore } from '../../stores';
import './HostSettingsPanel.css';

const answerModes = [
  {
    id: 'verbal',
    label: 'Buzzer + Verbal',
    description: 'Players buzz in, speak their answer aloud. You judge correct/incorrect.',
    icon: '🎤',
  },
  {
    id: 'typed',
    label: 'Typed Answers',
    description: 'All players type their answers simultaneously. You see and judge each one.',
    icon: '⌨️',
  },
  {
    id: 'multiple_choice',
    label: 'Multiple Choice',
    description: 'You define 4 options per question. Players select, auto-scored.',
    icon: '🔘',
  },
  {
    id: 'auto_grade',
    label: 'Auto-Grade',
    description: 'Players type answers, system auto-grades with fuzzy matching. You can override.',
    icon: '🤖',
  },
];

const timeLimitOptions = [
  { value: null, label: 'Off' },
  { value: 15000, label: '15s' },
  { value: 30000, label: '30s' },
  { value: 45000, label: '45s' },
  { value: 60000, label: '60s' },
];

const playerLimitOptions = [10, 15, 20, 25, 30];

export default function HostSettingsPanel({ onNext, onBack }) {
  const { answerMode, setAnswerMode } = useHostStore();
  const {
    questionTimeLimit,
    setQuestionTimeLimit,
    enableDoubleJeopardy,
    toggleDoubleJeopardy,
    enableDailyDouble,
    toggleDailyDouble,
    enableFinalJeopardy,
    toggleFinalJeopardy,
  } = useSettingsStore();

  const handleNext = () => {
    if (answerMode) {
      onNext();
    }
  };

  return (
    <motion.div
      className="host-settings-panel"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <h2>Game Settings</h2>
      <p className="settings-subtitle">Configure how players will answer questions</p>

      {/* Answer Mode Selection */}
      <div className="settings-section">
        <label className="section-label">Answer Mode</label>
        <div className="answer-modes-grid">
          {answerModes.map((mode, index) => (
            <motion.button
              key={mode.id}
              className={`answer-mode-card ${answerMode === mode.id ? 'selected' : ''}`}
              onClick={() => setAnswerMode(mode.id)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="mode-icon">{mode.icon}</span>
              <span className="mode-label">{mode.label}</span>
              <span className="mode-description">{mode.description}</span>
              {answerMode === mode.id && (
                <motion.span
                  className="selected-check"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                >
                  ✓
                </motion.span>
              )}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Timer Settings */}
      <div className="settings-section">
        <label className="section-label">Answer Time Limit</label>
        <div className="timer-options">
          {timeLimitOptions.map((option) => (
            <label
              key={option.label}
              className={`timer-option ${questionTimeLimit === option.value ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="hostTimerLimit"
                checked={questionTimeLimit === option.value}
                onChange={() => setQuestionTimeLimit(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Round Settings */}
      <div className="settings-section">
        <label className="section-label">Game Rules</label>
        <div className="rules-grid">
          <label className="rule-toggle">
            <input
              type="checkbox"
              checked={enableDoubleJeopardy}
              onChange={toggleDoubleJeopardy}
            />
            <span className="toggle-indicator" />
            <div className="rule-info">
              <span className="rule-name">Double Jeopardy</span>
              <span className="rule-desc">Second round with doubled point values</span>
            </div>
          </label>

          <label className="rule-toggle">
            <input
              type="checkbox"
              checked={enableDailyDouble}
              onChange={toggleDailyDouble}
            />
            <span className="toggle-indicator" />
            <div className="rule-info">
              <span className="rule-name">Daily Double</span>
              <span className="rule-desc">Hidden wager questions on the board</span>
            </div>
          </label>

          <label className="rule-toggle">
            <input
              type="checkbox"
              checked={enableFinalJeopardy}
              onChange={toggleFinalJeopardy}
            />
            <span className="toggle-indicator" />
            <div className="rule-info">
              <span className="rule-name">Final Jeopardy</span>
              <span className="rule-desc">Final wager question at the end</span>
            </div>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="settings-actions">
        <button onClick={onBack} className="btn-secondary">
          Back to Menu
        </button>
        <button
          onClick={handleNext}
          className="btn-primary"
          disabled={!answerMode}
        >
          Next: Create Questions
        </button>
      </div>
    </motion.div>
  );
}
