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

  /* An archive day is played in a slot of its own rather than in the format's.
     The Board is twenty minutes; someone half way through today's and curious
     about last Tuesday would otherwise come back to an empty grid. Only one
     archive run is held: it carries the format it belongs to, because every
     action below takes the slot and no longer knows which daily it is. */
  archiveRun: { ...emptyRun(), format: null },

  /* What the archive has been played to, by format and date. Kept apart from
     `stats` on purpose: this records the run without letting it near a streak.
     Shape: { board: { 'YYYY-MM-DD': { score, correctCount, ... } }, sixer: {} } */
  archiveResults: { board: {}, sixer: {} },

  // Shared UI state; only one format is ever being fetched at a time.
  isLoading: false,
  error: null,

  stats: {
    board: emptyFormatStats(),
    sixer: emptyFormatStats(),
  },
});

const isFormat = (format) => format === 'board' || format === 'sixer';

/* Where a run lives. The two dailies keep theirs under their own name, so the
   persisted shape is unchanged; the archive adds a third. */
const isSlot = (slot) => isFormat(slot) || slot === 'archiveRun';

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

      setUserAnswer: (slot, index, answer) => {
        if (!isSlot(slot)) return;
        set((state) => {
          const userAnswers = [...state[slot].userAnswers];
          userAnswers[index] = answer;
          return { [slot]: { ...state[slot], userAnswers } };
        });
      },

      revealAnswer: (slot, index, isCorrect, playerAnswer = '') => {
        if (!isSlot(slot)) return;
        set((state) => {
          const answers = [...state[slot].answers];
          answers[index] = { correct: isCorrect, revealed: true, playerAnswer };
          return { [slot]: { ...state[slot], answers } };
        });
      },

      /* A pass uses the clue up without scoring it. Recorded rather than just
         closed, so the clue cannot be reopened for another free look and the
         run always reaches an end. */
      passQuestion: (slot, index) => {
        if (!isSlot(slot)) return;
        set((state) => {
          const answers = [...state[slot].answers];
          answers[index] = { correct: false, passed: true, revealed: true, playerAnswer: '' };
          return { [slot]: { ...state[slot], answers } };
        });
      },

      overrideAnswer: (slot, index) => {
        if (!isSlot(slot)) return;
        set((state) => {
          const answers = [...state[slot].answers];
          if (!answers[index]) return {};
          answers[index] = { ...answers[index], correct: true, passed: false };
          return { [slot]: { ...state[slot], answers } };
        });
      },

      nextQuestion: (slot) => {
        if (!isSlot(slot)) return;
        set((state) => ({
          [slot]: {
            ...state[slot],
            currentIndex: Math.min(
              state[slot].currentIndex + 1,
              state[slot].questions.length - 1
            ),
          },
        }));
      },

      goToQuestion: (slot, index) => {
        if (!isSlot(slot)) return;
        set((state) => ({
          [slot]: {
            ...state[slot],
            currentIndex: Math.max(
              0,
              Math.min(index, state[slot].questions.length - 1)
            ),
          },
        }));
      },

      /** `score` applies to formats that have one; The Sixer passes none. */
      /* The board is timed like a crossword. Time with the tab shut is not
         time playing, so the clock banks each stretch as it stops. */
      startClock: (slot) => {
        if (!isSlot(slot)) return;
        set((state) => {
          const timing = state[slot].timing ?? { elapsedMs: 0, startedAt: null };
          if (timing.startedAt) return {}; // already running
          return { [slot]: { ...state[slot], timing: { ...timing, startedAt: Date.now() } } };
        });
      },

      pauseClock: (slot) => {
        if (!isSlot(slot)) return;
        set((state) => {
          const timing = state[slot].timing;
          if (!timing?.startedAt) return {};
          return {
            [slot]: {
              ...state[slot],
              timing: { elapsedMs: elapsedMs(timing), startedAt: null },
            },
          };
        });
      },

      completeGame: (slot, { score = null } = {}) => {
        if (!isSlot(slot)) return;
        const state = get();
        const run = state[slot];
        // Stop the clock on the same tick the run ends, so the time recorded is
        // the time played and not the time the results screen stayed open.
        const timeMs = run.timing ? elapsedMs(run.timing) : null;
        const correctCount = run.answers.filter((a) => a.correct).length;

        const finished = {
          ...run,
          isComplete: true,
          timing: { elapsedMs: timeMs ?? 0, startedAt: null },
        };

        /* An archive day is recorded but never counted. A streak is a claim
           about showing up on consecutive days, and a player who works back
           through ninety of them in an afternoon has not done that; letting
           the archive feed it would turn the number on the menu into a measure
           of free time. The same goes for the week's best and the all time
           one, which is why none of `stats` is touched here.

           This is what both NYT and chess.com do with their own archives: the
           solve is saved, the streak is left alone. */
        if (slot === 'archiveRun') {
          const format = run.format;
          if (!isFormat(format) || !run.date) return;

          set({
            archiveRun: finished,
            archiveResults: {
              ...state.archiveResults,
              [format]: {
                ...state.archiveResults[format],
                [run.date]: {
                  score,
                  correctCount,
                  totalQuestions: run.questions.length,
                  timeMs,
                  playedAt: toDateString(),
                },
              },
            },
          });
          return;
        }

        set({
          [slot]: finished,
          stats: {
            ...state.stats,
            [slot]: applyCompletion(state.stats[slot], {
              correctCount,
              totalQuestions: run.questions.length,
              today: toDateString(),
              score,
              timeMs,
            }),
          },
        });
      },

      /**
       * Open a past day in the archive slot.
       *
       * No "already played" guard: replaying an archived day is the point, and
       * nothing about it is at stake. The previous archive run is dropped,
       * which is why there is only ever one.
       */
      startArchiveRun: (format, data) => {
        if (!isFormat(format) || !data?.date) return;
        set({
          archiveRun: {
            ...freshRun(data.date, data.questions ?? [], data.categories ?? null),
            format,
          },
          isLoading: false,
          error: null,
        });
      },

      /* Left behind on the way out, so returning to the menu and back in does
         not show the last day's grid while the new one loads. */
      clearArchiveRun: () => set({ archiveRun: { ...emptyRun(), format: null } }),

      /** What a past day was played to, or null if it has not been. */
      archiveResult: (format, date) => {
        if (!isFormat(format) || !date) return null;
        return get().archiveResults[format]?.[date] ?? null;
      },

      /** Every date of a format that has been played in the archive. */
      playedArchiveDates: (format) => {
        if (!isFormat(format)) return [];
        return Object.keys(get().archiveResults[format] ?? {});
      },

      getShareText: (slot) => {
        if (!isSlot(slot)) return '';
        const run = get()[slot];
        // The archive slot carries the daily it is standing in for.
        const format = slot === 'archiveRun' ? run.format : slot;
        if (!isFormat(format)) return '';
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

      shareResults: async (slot) => {
        try {
          await navigator.clipboard.writeText(get().getShareText(slot));
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
      version: 3,
      partialize: (state) => ({
        board: state.board,
        sixer: state.sixer,
        stats: state.stats,
        archiveRun: state.archiveRun,
        archiveResults: state.archiveResults,
      }),
      // v1 stored a single flat run and one streak. That daily was the Sixer,
      // so its history moves there and The Board starts clean.
      /* v3 added the archive. Nothing about the older shapes is lost by it:
         an install that has never opened the archive simply has none. */
      migrate: (persisted, version) => {
        const twoFormat = version >= 2 ? persisted : migrateToTwoFormats(persisted);
        if (!twoFormat) return undefined;
        return {
          ...twoFormat,
          archiveRun: twoFormat.archiveRun ?? { ...emptyRun(), format: null },
          archiveResults: twoFormat.archiveResults ?? { board: {}, sixer: {} },
        };
      },
    }
  )
);
