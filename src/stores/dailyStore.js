import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  toDateString,
  applyCompletion,
  freshRun,
  emptyRun,
  emptyFormatStats,
  migrateToTwoFormats,
  elapsedMs,
  formatDuration,
  markEmoji,
  answerMark,
  boardGridRows,
  encodeAnswers,
} from './dailyLogic';
import { useSettingsStore } from './settingsStore';

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

      /* A pass uses the clue up without scoring it. Recorded rather than just
         closed, so the clue cannot be reopened for another free look and the
         run always reaches an end. */
      passQuestion: (format, index) => {
        if (!isFormat(format)) return;
        set((state) => {
          const answers = [...state[format].answers];
          answers[index] = { correct: false, passed: true, revealed: true, playerAnswer: '' };
          return { [format]: { ...state[format], answers } };
        });
      },

      overrideAnswer: (format, index) => {
        if (!isFormat(format)) return;
        set((state) => {
          const answers = [...state[format].answers];
          if (!answers[index]) return {};
          answers[index] = { ...answers[index], correct: true, passed: false };
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

      /** `score` applies to formats that have one; The Sixer passes none. */
      /* The board is timed like a crossword. Time with the tab shut is not
         time playing, so the clock banks each stretch as it stops. */
      startClock: (format) => {
        if (!isFormat(format)) return;
        set((state) => {
          const timing = state[format].timing ?? { elapsedMs: 0, startedAt: null };
          if (timing.startedAt) return {}; // already running
          return { [format]: { ...state[format], timing: { ...timing, startedAt: Date.now() } } };
        });
      },

      pauseClock: (format) => {
        if (!isFormat(format)) return;
        set((state) => {
          const timing = state[format].timing;
          if (!timing?.startedAt) return {};
          return {
            [format]: {
              ...state[format],
              timing: { elapsedMs: elapsedMs(timing), startedAt: null },
            },
          };
        });
      },

      completeGame: (format, { score = null } = {}) => {
        if (!isFormat(format)) return;
        const state = get();
        const run = state[format];
        // Stop the clock on the same tick the run ends, so the time recorded is
        // the time played and not the time the results screen stayed open.
        const timeMs = run.timing ? elapsedMs(run.timing) : null;

        set({
          [format]: {
            ...run,
            isComplete: true,
            timing: { elapsedMs: timeMs ?? 0, startedAt: null },
          },
          stats: {
            ...state.stats,
            [format]: applyCompletion(state.stats[format], {
              correctCount: run.answers.filter((a) => a.correct).length,
              totalQuestions: run.questions.length,
              today: toDateString(),
              score,
              timeMs,
            }),
          },
        });
      },

      getShareText: (format) => {
        if (!isFormat(format)) return '';
        const run = get()[format];
        const label = format === 'board' ? 'The Board' : 'The Sixer';
        /* A pass is neither a hit nor a miss, so it cannot share a colour with
           either without misreporting the board. The palette follows the
           player's own setting: a shared grid of red and green squares is
           unreadable to the people who most need the alternative. */
        const highContrast = useSettingsStore.getState().highContrast;
        const grid = run.answers.map((a) => markEmoji(answerMark(a), highContrast));
        const correctCount = run.answers.filter((a) => a.correct).length;

        // The Board shares as the board looks: six across, five down.
        const emoji = format === 'board'
          ? (boardGridRows(grid)?.map((row) => row.join('')) ?? [grid.join('')]).join('\n')
          : grid.join('');

        const dateStr = run.date || toDateString();
        const path = format === 'board' ? '/daily/board' : '/daily';

        // The Sixer carries the player's typed answers so a friend can reveal
        // them after playing. The Board is typed too, but thirty answers do not
        // fit in a link worth sending, so its link stays plain.
        let query = '';
        if (format === 'sixer') {
          const packed = encodeAnswers(run.answers.map((a) => a.playerAnswer || ''));
          // A share without the reveal beats no share at all.
          if (packed) query = `?verify=${packed}`;
        }

        const took = format === 'board' ? formatDuration(elapsedMs(run.timing)) : null;
        const tally = took
          ? `${correctCount}/${run.questions.length} in ${took}`
          : `${correctCount}/${run.questions.length}`;

        /* Built from wherever the player is rather than from a domain written
           into the source. The old hardcoded URL survived a domain change and
           would have kept sending everyone to the previous address. */
        const origin =
          typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin
            : 'https://jeoparody.andrescruz.xyz';

        return `Jeoparody ${label} ${dateStr}\n${emoji}\n${tally}\n${origin}${path}${query}`;
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
