import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  toDateString,
  applyCompletion,
  freshRun,
  emptyRun,
  emptyFormatStats,
  migrateToTwoFormats,
  shareGridRows,
} from './dailyLogic';

/**
 * Two daily formats, each with its own run and its own streak.
 *
 *   board - the full 6x5, about twenty minutes
 *   sixer - one clue per category, about ninety seconds
 *
 * Every action takes the format it applies to. Streaks are deliberately kept
 * apart: a bad week on The Board should not cost someone their Sixer habit.
 */

// A factory, not a constant: a shared object would hand every reset the same
// nested arrays, so one stray mutation would poison the blank state.
const makeInitialState = () => ({
  board: emptyRun(),
  sixer: emptyRun(),

  // Shared UI state; only one format is ever being fetched at a time.
  isLoading: false,
  error: null,

  stats: {
    board: emptyFormatStats(),
    sixer: emptyFormatStats(),
  },
});

const isFormat = (format) => format === 'board' || format === 'sixer';

export const useDailyStore = create(
  persist(
    (set, get) => ({
      ...makeInitialState(),

      hasPlayedToday: (format) => {
        if (!isFormat(format)) return false;
        return get().stats[format].lastPlayedDate === toDateString();
      },

      isNewDay: (format) => {
        if (!isFormat(format)) return true;
        return get()[format].date !== toDateString();
      },

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error, isLoading: false }),

      /**
       * Seed a format with today's clues. Ignored when that format has already
       * been played today, so a stray fetch cannot wipe a finished run.
       */
      setDailyChallenge: (format, data) => {
        if (!isFormat(format)) return;
        if (get().hasPlayedToday(format)) {
          set({ isLoading: false });
          return;
        }

        const questions = data?.questions ?? [];
        set({
          [format]: freshRun(
            data?.date ?? toDateString(),
            questions,
            data?.categories ?? null
          ),
          isLoading: false,
          error: null,
        });
      },

      setUserAnswer: (format, index, answer) => {
        if (!isFormat(format)) return;
        set((state) => {
          const userAnswers = [...state[format].userAnswers];
          userAnswers[index] = answer;
          return { [format]: { ...state[format], userAnswers } };
        });
      },

      revealAnswer: (format, index, isCorrect, playerAnswer = '') => {
        if (!isFormat(format)) return;
        set((state) => {
          const answers = [...state[format].answers];
          answers[index] = { correct: isCorrect, revealed: true, playerAnswer };
          return { [format]: { ...state[format], answers } };
        });
      },

      overrideAnswer: (format, index) => {
        if (!isFormat(format)) return;
        set((state) => {
          const answers = [...state[format].answers];
          if (!answers[index]) return {};
          answers[index] = { ...answers[index], correct: true };
          return { [format]: { ...state[format], answers } };
        });
      },

      nextQuestion: (format) => {
        if (!isFormat(format)) return;
        set((state) => ({
          [format]: {
            ...state[format],
            currentIndex: Math.min(
              state[format].currentIndex + 1,
              state[format].questions.length - 1
            ),
          },
        }));
      },

      goToQuestion: (format, index) => {
        if (!isFormat(format)) return;
        set((state) => ({
          [format]: {
            ...state[format],
            currentIndex: Math.max(
              0,
              Math.min(index, state[format].questions.length - 1)
            ),
          },
        }));
      },

      completeGame: (format) => {
        if (!isFormat(format)) return;
        const state = get();
        const run = state[format];

        set({
          [format]: { ...run, isComplete: true },
          stats: {
            ...state.stats,
            [format]: applyCompletion(state.stats[format], {
              correctCount: run.answers.filter((a) => a.correct).length,
              totalQuestions: run.questions.length,
              today: toDateString(),
            }),
          },
        });
      },

      getShareText: (format) => {
        if (!isFormat(format)) return '';
        const run = get()[format];
        const label = format === 'board' ? 'The Board' : 'The Sixer';
        const grid = run.answers.map((a) => (a.correct ? '\u{1F7E9}' : '\u{1F7E5}'));
        const correctCount = run.answers.filter((a) => a.correct).length;

        // The Board shares as the board looks: six across, five down.
        const emoji = format === 'board'
          ? (shareGridRows(grid) ?? grid).join('\n')
          : grid.join('');

        const dateStr = run.date || toDateString();
        return `Jeoparody ${label} ${dateStr}\n${emoji}\n${correctCount}/${run.questions.length}\nhttps://jeoparody-mk2.vercel.app/daily`;
      },

      shareResults: async (format) => {
        try {
          await navigator.clipboard.writeText(get().getShareText(format));
          return true;
        } catch {
          return false;
        }
      },

      /** Clear today's progress for one format without touching its stats. */
      resetToday: (format) => {
        if (!isFormat(format)) return;
        set((state) => ({
          [format]: freshRun(
            state[format].date,
            state[format].questions,
            state[format].categories ?? null
          ),
        }));
      },

      fullReset: () => set(makeInitialState()),
    }),
    {
      name: 'jeoparody-daily',
      version: 2,
      partialize: (state) => ({
        board: state.board,
        sixer: state.sixer,
        stats: state.stats,
      }),
      // v1 stored a single flat run and one streak. That daily was the Sixer,
      // so its history moves there and The Board starts clean.
      migrate: (persisted, version) => {
        if (version >= 2) return persisted;
        return migrateToTwoFormats(persisted) ?? undefined;
      },
    }
  )
);
