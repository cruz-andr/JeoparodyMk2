import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const initialState = {
  // Timer Settings
  questionTimeLimit: 30000, // milliseconds (null = unlimited)
  dailyDoubleTimeLimit: 30000,
  finalJeopardyTimeLimit: 30000,

  // Round Settings
  enableDoubleJeopardy: true,
  enableDailyDouble: true,
  enableFinalJeopardy: true,

  // Audio Settings
  soundEnabled: true,
  musicEnabled: true,
  textToSpeechEnabled: true,
  ttsVoice: null, // null = auto-select best available
  volume: 0.7,

  // Display Settings
  showTimer: true,
  showScore: true,

  // Game Settings
  difficulty: 'mixed', // 'easy' | 'medium' | 'hard' | 'mixed'
  categorySource: 'ai', // 'ai' | 'custom'
};

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

      setDailyDoubleTimeLimit: (limit) => set({ dailyDoubleTimeLimit: limit }),

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

      toggleTextToSpeech: () => set(state => ({
        textToSpeechEnabled: !state.textToSpeechEnabled
      })),

      setTTSVoice: (voice) => set({ ttsVoice: voice }),

      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),

      toggleTimer: () => set(state => ({
        showTimer: !state.showTimer
      })),

      toggleScore: () => set(state => ({
        showScore: !state.showScore
      })),

      setDifficulty: (difficulty) => set({ difficulty }),

      setCategorySource: (source) => set({ categorySource: source }),

      // Reset to defaults
      resetToDefaults: () => set(initialState),

      // Presets
      loadPreset: (presetName) => {
        const presets = {
          casual: {
            questionTimeLimit: null, // Unlimited
            enableDoubleJeopardy: false,
            enableDailyDouble: false,
            enableFinalJeopardy: false,
            difficulty: 'easy',
          },
          standard: {
            questionTimeLimit: 30000,
            enableDoubleJeopardy: true,
            enableDailyDouble: true,
            enableFinalJeopardy: true,
            difficulty: 'mixed',
          },
          challenging: {
            questionTimeLimit: 15000,
            enableDoubleJeopardy: true,
            enableDailyDouble: true,
            enableFinalJeopardy: true,
            difficulty: 'hard',
          },
          speed: {
            questionTimeLimit: 10000,
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

export default useSettingsStore;
