import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '../../stores';
import './SettingsModal.css';

/**
 * Every setting, in one searchable place.
 *
 * There were three separate settings surfaces with overlapping and different
 * subsets, which is how five settings ended up being collected and then read by
 * nothing at all. One list, declared as data, means a setting cannot be added
 * to the screen without also being wired to something.
 *
 * Settings marked `room` are rules rather than preferences: they travel with a
 * room you create, so everyone plays the same game. See roomRulesFromSettings.
 */

const TIME_LIMITS = [
  { value: null, label: 'Unlimited' },
  { value: 15000, label: '15 seconds' },
  { value: 30000, label: '30 seconds' },
  { value: 60000, label: '60 seconds' },
];

const DIFFICULTIES = [
  { value: 'easy', label: 'Easy', hint: 'Recognisable people, places and events' },
  { value: 'medium', label: 'Medium', hint: 'Harder than a pub quiz' },
  { value: 'hard', label: 'Hard', hint: 'Precise dates and less obvious works' },
  { value: 'mixed', label: 'Mixed', hint: 'Scales with the point values' },
];

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

const PRESETS = [
  { id: 'casual', label: 'Casual', description: 'No time pressure, simpler rules' },
  { id: 'standard', label: 'Standard', description: 'Classic Jeopardy experience' },
  { id: 'challenging', label: 'Challenging', description: 'Fast timer, hard questions' },
  { id: 'speed', label: 'Speed Round', description: '10s timer, no Final Jeopardy' },
];

export default function SettingsModal({ isOpen, onClose }) {
  const s = useSettingsStore();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const toggle = (id, label, keywords, checked, onChange, hint) => ({
      id, label, keywords, hint,
      control: (
        <label className="toggle-label" key={id}>
          <span>{label}</span>
          <input type="checkbox" checked={checked} onChange={onChange} />
          <span className="toggle-switch" />
        </label>
      ),
    });
    const radios = (id, label, keywords, options, value, onChange, hint) => ({
      id, label, keywords, hint,
      control: (
        <div className="settings-group" key={id}>
          <label>{label}</label>
          <div className="radio-group">
            {options.map((o) => (
              <label className="radio-label" key={String(o.value)} title={o.hint ?? ''}>
                <input
                  type="radio"
                  name={id}
                  checked={value === o.value}
                  onChange={() => onChange(o.value)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      ),
    });

    return [
      {
        id: 'rounds', title: 'Rounds', room: true,
        items: [
          toggle('dj', 'Double Jeopardy', 'round two second double',
            s.enableDoubleJeopardy, s.toggleDoubleJeopardy),
          toggle('dd', 'Daily Double', 'wager bet daily double',
            s.enableDailyDouble, s.toggleDailyDouble),
          toggle('fj', 'Final Jeopardy', 'final last wager',
            s.enableFinalJeopardy, s.toggleFinalJeopardy),
        ],
      },
      {
        id: 'questions', title: 'Questions',
        items: [
          radios('difficulty', 'Difficulty', 'hard easy medium mixed level clues questions',
            DIFFICULTIES, s.difficulty, s.setDifficulty,
            'Applies to generated games. The dailies come from real archived shows.'),
        ],
      },
      {
        id: 'timing', title: 'Timing', room: true,
        items: [
          radios('questionTimeLimit', 'Time to answer', 'timer clock seconds time limit',
            TIME_LIMITS, s.questionTimeLimit, s.setQuestionTimeLimit),
          toggle('showTimer', 'Show the timer', 'timer clock countdown hide',
            s.showTimer, s.toggleTimer),
        ],
      },
      {
        id: 'sound', title: 'Sound',
        items: [
          toggle('sound', 'Sound effects', 'sound audio effects mute',
            s.soundEnabled, s.toggleSound),
          toggle('music', 'Music', 'music theme audio mute',
            s.musicEnabled, s.toggleMusic),
          {
            id: 'volume', label: 'Volume', keywords: 'volume loud quiet audio',
            control: (
              <div className="settings-group" key="volume">
                <label>Volume: {Math.round(s.volume * 100)}%</label>
                <input
                  type="range" min="0" max="1" step="0.05" value={s.volume}
                  onChange={(e) => s.setVolume(parseFloat(e.target.value))}
                />
              </div>
            ),
          },
        ],
      },
      {
        id: 'access', title: 'Display and access',
        items: [
          toggle('highContrast', 'Colourblind friendly results',
            'colour color blind contrast accessibility red green share grid',
            s.highContrast, s.toggleHighContrast,
            'Swaps the red and green squares for orange and blue, in the results and in what you share.'),
          radios('textScale', 'Text size', 'text size large bigger font accessibility read',
            TEXT_SCALES, s.textScale, s.setTextScale),
          radios('reduceMotion', 'Motion', 'motion animation reduce accessibility spin wheel',
            MOTION_CHOICES, s.reduceMotion, s.setReduceMotion),
        ],
      },
    ];
  }, [s]);

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? groups
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (i) =>
              i.label.toLowerCase().includes(needle) ||
              (i.keywords ?? '').includes(needle) ||
              g.title.toLowerCase().includes(needle)
          ),
        }))
        .filter((g) => g.items.length)
    : groups;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="settings-overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="settings-modal"
          initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="settings-header">
            <h2>Settings</h2>
            <button className="close-btn" onClick={onClose} aria-label="Close settings">
              &times;
            </button>
          </header>

          <div className="settings-search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              autoComplete="off"
            />
          </div>

          <div className="settings-content">
            {!needle && (
              <section className="settings-section">
                <h3>Quick Presets</h3>
                <div className="presets-grid">
                  {PRESETS.map((p) => (
                    <button key={p.id} className="preset-btn" onClick={() => s.loadPreset(p.id)}>
                      <span className="preset-label">{p.label}</span>
                      <span className="preset-description">{p.description}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {shown.map((g) => (
              <section className="settings-section" key={g.id}>
                <h3>
                  {g.title}
                  {g.room && (
                    <span className="room-badge" title="Everyone in a room you create plays by this">
                      shared
                    </span>
                  )}
                </h3>
                <div className="toggle-group">
                  {g.items.map((i) => (
                    <div className="setting-row" key={i.id}>
                      {i.control}
                      {i.hint && <p className="setting-hint">{i.hint}</p>}
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {needle && !shown.length && (
              <p className="settings-empty">Nothing matches &ldquo;{query}&rdquo;.</p>
            )}

            {!needle && (
              <section className="settings-section">
                <button className="preset-btn" onClick={s.resetToDefaults}>
                  <span className="preset-label">Reset to defaults</span>
                  <span className="preset-description">Puts every setting back</span>
                </button>
              </section>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
