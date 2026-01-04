import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getTodayDateString } from '../services/api/jeopardyService';

const initialState = {
  // Today's challenge data
  todayDate: null,
  questions: [],
  currentIndex: 0,
  answers: [], // [{ correct: boolean | null, revealed: boolean, playerAnswer: string }]
  userAnswers: [], // Store what the user typed for each question

  // Game state
  isLoading: false,
  isComplete: false,
  error: null,

  // Stats (persisted across days)
  stats: {
    gamesPlayed: 0,
    totalCorrect: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: null,
  },
};

export const useDailyStore = create(
  persist(
    (set, get) => ({
      ...initialState,

      // Check if user has already played today
      hasPlayedToday: () => {
        const { stats } = get();
        const today = getTodayDateString();
        return stats.lastPlayedDate === today;
      },

      // Check if it's a new day (needs to fetch new challenge)
      isNewDay: () => {
        const { todayDate } = get();
        const today = getTodayDateString();
        return todayDate !== today;
      },

      // Set loading state
      setLoading: (isLoading) => set({ isLoading }),

      // Set error
      setError: (error) => set({ error, isLoading: false }),

      // Set the daily challenge data
      setDailyChallenge: (data) => {
        const today = getTodayDateString();
        const { stats } = get();

        // Check if this is continuing a previous session today
        if (stats.lastPlayedDate === today) {
          // Already played today - show results instead
          return;
        }

        set({
          todayDate: data.date,
          questions: data.questions,
          currentIndex: 0,
          answers: data.questions.map(() => ({
            correct: null,
            revealed: false,
            playerAnswer: '',
          })),
          userAnswers: data.questions.map(() => ''),
          isComplete: false,
          isLoading: false,
          error: null,
        });
      },

      // Store player's typed answer
      setUserAnswer: (index, answer) => {
        set((state) => {
          const newUserAnswers = [...state.userAnswers];
          newUserAnswers[index] = answer;
          return { userAnswers: newUserAnswers };
        });
      },

      // Reveal answer and mark correct/incorrect
      revealAnswer: (index, isCorrect, playerAnswer = '') => {
        set((state) => {
          const newAnswers = [...state.answers];
          newAnswers[index] = {
            correct: isCorrect,
            revealed: true,
            playerAnswer,
          };
          return { answers: newAnswers };
        });
      },

      // Override an answer (mark as correct even if auto-grader said wrong)
      overrideAnswer: (index) => {
        set((state) => {
          const newAnswers = [...state.answers];
          if (newAnswers[index]) {
            newAnswers[index] = {
              ...newAnswers[index],
              correct: true,
            };
          }
          return { answers: newAnswers };
        });
      },

      // Move to next question
      nextQuestion: () => {
        set((state) => ({
          currentIndex: Math.min(state.currentIndex + 1, state.questions.length - 1),
        }));
      },

      // Go to specific question
      goToQuestion: (index) => {
        set((state) => ({
          currentIndex: Math.max(0, Math.min(index, state.questions.length - 1)),
        }));
      },

      // Complete the game
      completeGame: () => {
        const state = get();
        const correctCount = state.answers.filter((a) => a.correct).length;
        const today = getTodayDateString();

        // Check if streak continues (played yesterday)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const streakContinues = state.stats.lastPlayedDate === yesterdayStr;

        // Calculate new streak
        const perfect = correctCount === state.questions.length;
        let newStreak = state.stats.currentStreak;

        if (streakContinues) {
          // Streak continues if we got any correct, or keep if perfect
          newStreak = perfect ? newStreak + 1 : (correctCount > 0 ? newStreak : 0);
        } else {
          // New streak starts
          newStreak = perfect ? 1 : 0;
        }

        set({
          isComplete: true,
          stats: {
            gamesPlayed: state.stats.gamesPlayed + 1,
            totalCorrect: state.stats.totalCorrect + correctCount,
            currentStreak: newStreak,
            maxStreak: Math.max(state.stats.maxStreak, newStreak),
            lastPlayedDate: today,
          },
        });
      },

      // Get share text for results
      getShareText: () => {
        const state = get();
        const emoji = state.answers
          .map((a) => (a.correct ? '🟩' : '🟥'))
          .join('');
        const correctCount = state.answers.filter((a) => a.correct).length;
        const total = state.questions.length;
        const dateStr = state.todayDate || getTodayDateString();

        // Encode answers for verification (others can reveal after playing)
        const playerAnswers = state.answers.map((a) => a.playerAnswer || '');
        const verifyCode = btoa(JSON.stringify(playerAnswers));

        return `Daily Jeoparody ${dateStr}\n${emoji}\n${correctCount}/${total}\nhttps://jeoparody-mk2.vercel.app/daily?verify=${verifyCode}`;
      },

      // Copy share text to clipboard
      shareResults: async () => {
        const shareText = get().getShareText();
        try {
          await navigator.clipboard.writeText(shareText);
          return true;
        } catch {
          return false;
        }
      },

      // Reset for testing (clear today's progress)
      resetToday: () => {
        set({
          currentIndex: 0,
          answers: get().questions.map(() => ({
            correct: null,
            revealed: false,
            playerAnswer: '',
          })),
          userAnswers: get().questions.map(() => ''),
          isComplete: false,
        });
      },

      // Full reset (clear all data including stats)
      fullReset: () => {
        set(initialState);
      },
    }),
    {
      name: 'jeoparody-daily',
      partialize: (state) => ({
        // Only persist these fields
        todayDate: state.todayDate,
        questions: state.questions,
        currentIndex: state.currentIndex,
        answers: state.answers,
        userAnswers: state.userAnswers,
        isComplete: state.isComplete,
        stats: state.stats,
      }),
    }
  )
);
