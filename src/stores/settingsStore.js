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
        const presets = {
          casual: {
            questionTimeLimit: null, // Unlimited
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
