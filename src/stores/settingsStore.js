import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const initialState = {
  // Timer Settings
  questionTimeLimit: 30000, // milliseconds (null = unlimited)
  answerTimeLimit: 7000,    // time to answer once buzzed in, close to the show's five
  finalJeopardyTimeLimit: 30000,

  // Round Settings
  enableDoubleJeopardy: true,
  enableDailyDouble: true,
  /* 'random' is what has always happened. 'chosen' lets a host mark the cells,
     which a quiz night wants and a classroom mostly does not. */
  dailyDoublePlacement: 'random',
  enableFinalJeopardy: true,

  // Audio Settings
  soundEnabled: true,
  musicEnabled: true,
  volume: 0.7,

  // Display and access
  showTimer: true,
  showScore: true,
  // Red and green squares are unreadable to the most common colour blindness,
  // and the results grid is the part of the game that gets shared.
  highContrast: false,
  textScale: 'normal', // 'normal' | 'large' | 'larger'
  reduceMotion: 'system', // 'system' | 'on' | 'off'

  // Game Settings
  // Fed into question generation, so a genre can be asked for at a level.
  difficulty: 'mixed', // 'easy' | 'medium' | 'hard' | 'mixed'
};


/**
 * The part of a player's settings that is a room RULE rather than a personal
 * preference.
 *
 * Audio and display choices stay local to whoever set them; timers and round
 * structure have to be the same for everyone in the room, so they travel with
 * the room when it is created. Kept here, and used by every screen that makes
 * a room, because hand copying the fields at each call site is how host mode
 * ended up sending four of them and multiplayer sending none.
 */
/*
 * The choices the settings screen offers.
 *
 * They live beside the presets rather than in the component, because a preset
 * that sets a value the screen does not list leaves the group showing nothing
 * selected: the preset looks like it did nothing and the player cannot see what
 * the timer now is. A test holds the two in step.
 */
/**
 * The presets, at module scope so a test can hold every value they set against
 * the options the screen actually offers.
 */
export const PRESETS = {
  casual: {
    questionTimeLimit: null,
    answerTimeLimit: 10000,
    enableDoubleJeopardy: false,
    enableDailyDouble: false,
    enableFinalJeopardy: false,
    difficulty: 'easy',
  },
  standard: {
    questionTimeLimit: 30000,
    answerTimeLimit: 7000,
    enableDoubleJeopardy: true,
    enableDailyDouble: true,
    enableFinalJeopardy: true,
    difficulty: 'mixed',
  },
  challenging: {
    questionTimeLimit: 15000,
    answerTimeLimit: 5000,
    enableDoubleJeopardy: true,
    enableDailyDouble: true,
    enableFinalJeopardy: true,
    difficulty: 'hard',
  },
  speed: {
    questionTimeLimit: 10000,
    answerTimeLimit: 5000,
    enableDoubleJeopardy: true,
    enableDailyDouble: true,
    enableFinalJeopardy: false,
    difficulty: 'medium',
  },
};

export const QUESTION_TIME_LIMITS = [
  { value: null, label: 'Unlimited' },
  { value: 10000, label: '10 seconds' },
  { value: 15000, label: '15 seconds' },
  { value: 30000, label: '30 seconds' },
  { value: 60000, label: '60 seconds' },
];

export const ANSWER_TIME_LIMITS = [
  { value: 5000, label: '5 seconds' },
  { value: 7000, label: '7 seconds' },
  { value: 10000, label: '10 seconds' },
];

export function roomRulesFromSettings(settings, defaults = {}) {
  return {
    ...defaults,
    questionTimeLimit: settings.questionTimeLimit,
    answerTimeLimit: settings.answerTimeLimit,
    finalJeopardyTimeLimit: settings.finalJeopardyTimeLimit,
    enableDoubleJeopardy: settings.enableDoubleJeopardy,
    enableDailyDouble: settings.enableDailyDouble,
    enableFinalJeopardy: settings.enableFinalJeopardy,
  };
}

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      ...initialState,

      // Actions
      updateSetting: (key, value) => {
        set({ [key]: value });
      },

      updateMultiple: (settings) => {
        set(settings);
      },

      setQuestionTimeLimit: (limit) => set({ questionTimeLimit: limit }),

      setAnswerTimeLimit: (limit) => set({ answerTimeLimit: limit }),

      setFinalJeopardyTimeLimit: (limit) => set({ finalJeopardyTimeLimit: limit }),

      toggleDoubleJeopardy: () => set(state => ({
        enableDoubleJeopardy: !state.enableDoubleJeopardy
      })),

      setDailyDoublePlacement: (dailyDoublePlacement) => set({ dailyDoublePlacement }),

  toggleDailyDouble: () => set(state => ({
        enableDailyDouble: !state.enableDailyDouble
      })),

      toggleFinalJeopardy: () => set(state => ({
        enableFinalJeopardy: !state.enableFinalJeopardy
      })),

      toggleSound: () => set(state => ({
        soundEnabled: !state.soundEnabled
      })),

      toggleMusic: () => set(state => ({
        musicEnabled: !state.musicEnabled
      })),

      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),

      toggleTimer: () => set(state => ({
        showTimer: !state.showTimer
      })),

      toggleScore: () => set(state => ({
        showScore: !state.showScore
      })),

      setDifficulty: (difficulty) => set({ difficulty }),

      toggleHighContrast: () => set((state) => ({ highContrast: !state.highContrast })),

      setTextScale: (textScale) => set({ textScale }),

      setReduceMotion: (reduceMotion) => set({ reduceMotion }),

      // Reset to defaults
      resetToDefaults: () => set(initialState),

      // Presets
      loadPreset: (presetName) => {
        const presets = PRESETS;

        if (presets[presetName]) {
          set(presets[presetName]);
        }
      },

      // Get time limit in seconds for display
      getTimeLimitSeconds: () => {
        const { questionTimeLimit } = get();
        return questionTimeLimit ? questionTimeLimit / 1000 : null;
      },
    }),
    {
      name: 'jeopardy-settings-storage',
    }
  )
);
