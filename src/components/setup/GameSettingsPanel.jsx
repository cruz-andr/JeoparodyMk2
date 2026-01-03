import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '../../stores';
import { getAvailableVoices, previewVoice, setVoice } from '../../services/ttsService';
import './GameSettingsPanel.css';

export default function GameSettingsPanel({
  settings = null,
  onSettingsChange = null,
  readOnly = false,
  defaultExpanded = false
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [availableVoices, setAvailableVoices] = useState([]);

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = getAvailableVoices();
      setAvailableVoices(voices);
    };

    // Voices may load asynchronously
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Use provided settings or fall back to global store
  const globalSettings = useSettingsStore();
  const {
    questionTimeLimit,
    enableDoubleJeopardy,
    enableDailyDouble,
    enableFinalJeopardy,
    setQuestionTimeLimit,
    toggleDoubleJeopardy,
    toggleDailyDouble,
    toggleFinalJeopardy,
    loadPreset,
  } = settings ? { ...settings, ...createSettingsHandlers(settings, onSettingsChange) } : globalSettings;

  // TTS settings are always from global store (user preference, not room setting)
  const { textToSpeechEnabled, ttsVoice, toggleTextToSpeech, setTTSVoice } = globalSettings;

  // Sync voice selection with TTS service
  useEffect(() => {
    setVoice(ttsVoice);
  }, [ttsVoice]);

  const handleVoiceChange = (voiceName) => {
    setTTSVoice(voiceName);
  };

  const handlePreviewVoice = (voiceName) => {
    previewVoice(voiceName || availableVoices[0]?.name);
  };

  const timeLimitOptions = [
    { value: null, label: 'Off' },
    { value: 15000, label: '15s' },
    { value: 30000, label: '30s' },
    { value: 60000, label: '60s' },
  ];

  const presets = [
    { id: 'casual', label: 'Casual' },
    { id: 'standard', label: 'Standard' },
    { id: 'challenging', label: 'Hard' },
  ];

  // Get current preset name based on settings
  const getCurrentPreset = () => {
    if (!questionTimeLimit && !enableDoubleJeopardy) return 'Casual';
    if (questionTimeLimit === 30000 && enableDoubleJeopardy && enableDailyDouble && enableFinalJeopardy) return 'Standard';
    if (questionTimeLimit === 15000) return 'Hard';
    return 'Custom';
  };

  // Get summary text for collapsed view
  const getSummary = () => {
    const parts = [];
    if (questionTimeLimit) {
      parts.push(`${questionTimeLimit / 1000}s timer`);
    } else {
      parts.push('No timer');
    }
    if (enableDoubleJeopardy) parts.push('Double Jeopardy');
    if (enableDailyDouble) parts.push('Daily Double');
    if (enableFinalJeopardy) parts.push('Final Jeopardy');
    return parts.join(' | ');
  };

  return (
    <div className={`game-settings-panel ${readOnly ? 'read-only' : ''}`}>
      <button
        className="settings-panel-header"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        <div className="header-left">
          <span className="settings-icon">&#9881;</span>
          <span className="header-title">Game Settings</span>
          <span className="current-preset">{getCurrentPreset()}</span>
        </div>
        <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>&#9662;</span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="settings-panel-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Presets - only show if editable */}
            {!readOnly && (
              <div className="panel-section presets-section">
                <div className="preset-buttons">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      className={`preset-chip ${getCurrentPreset() === preset.label ? 'active' : ''}`}
                      onClick={() => loadPreset(preset.id)}
                      type="button"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Timer */}
            <div className="panel-section">
              <label className="section-label">Timer</label>
              <div className="timer-options">
                {timeLimitOptions.map((option) => (
                  <label
                    key={option.label}
                    className={`timer-option ${questionTimeLimit === option.value ? 'selected' : ''} ${readOnly ? 'disabled' : ''}`}
                  >
                    <input
                      type="radio"
                      name="gameSettingsTimer"
                      checked={questionTimeLimit === option.value}
                      onChange={() => !readOnly && setQuestionTimeLimit(option.value)}
                      disabled={readOnly}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Game Rules */}
            <div className="panel-section">
              <label className="section-label">Rules</label>
              <div className="rules-grid">
                <label className={`rule-toggle ${readOnly ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={enableDoubleJeopardy}
                    onChange={() => !readOnly && toggleDoubleJeopardy()}
                    disabled={readOnly}
                  />
                  <span className="toggle-indicator" />
                  <span className="rule-name">Double Jeopardy</span>
                </label>

                <label className={`rule-toggle ${readOnly ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={enableDailyDouble}
                    onChange={() => !readOnly && toggleDailyDouble()}
                    disabled={readOnly}
                  />
                  <span className="toggle-indicator" />
                  <span className="rule-name">Daily Double</span>
                </label>

                <label className={`rule-toggle ${readOnly ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={enableFinalJeopardy}
                    onChange={() => !readOnly && toggleFinalJeopardy()}
                    disabled={readOnly}
                  />
                  <span className="toggle-indicator" />
                  <span className="rule-name">Final Jeopardy</span>
                </label>
              </div>
            </div>

            {/* Audio / TTS - always editable (personal preference) */}
            <div className="panel-section">
              <label className="section-label">Audio</label>
              <div className="rules-grid">
                <label className="rule-toggle">
                  <input
                    type="checkbox"
                    checked={textToSpeechEnabled}
                    onChange={toggleTextToSpeech}
                  />
                  <span className="toggle-indicator" />
                  <span className="rule-name">Read Clues Aloud</span>
                </label>
              </div>

              {textToSpeechEnabled && availableVoices.length > 0 && (
                <div className="voice-selector">
                  <select
                    value={ttsVoice || ''}
                    onChange={(e) => handleVoiceChange(e.target.value || null)}
                    className="voice-dropdown"
                  >
                    <option value="">Auto (Best Available)</option>
                    {availableVoices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="preview-btn"
                    onClick={() => handlePreviewVoice(ttsVoice)}
                  >
                    Preview
                  </button>
                </div>
              )}
            </div>

            {readOnly && (
              <div className="read-only-notice">
                Only the host can change settings
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary when collapsed */}
      {!isExpanded && (
        <div className="settings-summary">{getSummary()}</div>
      )}
    </div>
  );
}

// Helper to create settings handlers for custom settings object
function createSettingsHandlers(settings, onSettingsChange) {
  if (!onSettingsChange) {
    return {
      setQuestionTimeLimit: () => {},
      toggleDoubleJeopardy: () => {},
      toggleDailyDouble: () => {},
      toggleFinalJeopardy: () => {},
      loadPreset: () => {},
    };
  }

  const presetConfigs = {
    casual: {
      questionTimeLimit: null,
      enableDoubleJeopardy: false,
      enableDailyDouble: false,
      enableFinalJeopardy: false,
    },
    standard: {
      questionTimeLimit: 30000,
      enableDoubleJeopardy: true,
      enableDailyDouble: true,
      enableFinalJeopardy: true,
    },
    challenging: {
      questionTimeLimit: 15000,
      enableDoubleJeopardy: true,
      enableDailyDouble: true,
      enableFinalJeopardy: true,
    },
  };

  return {
    setQuestionTimeLimit: (value) => onSettingsChange({ ...settings, questionTimeLimit: value }),
    toggleDoubleJeopardy: () => onSettingsChange({ ...settings, enableDoubleJeopardy: !settings.enableDoubleJeopardy }),
    toggleDailyDouble: () => onSettingsChange({ ...settings, enableDailyDouble: !settings.enableDailyDouble }),
    toggleFinalJeopardy: () => onSettingsChange({ ...settings, enableFinalJeopardy: !settings.enableFinalJeopardy }),
    loadPreset: (presetId) => onSettingsChange({ ...settings, ...presetConfigs[presetId] }),
  };
}
