import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const initialState = {
  // Auth State
  isGuest: true,
  isAuthenticated: false,
  user: null, // { id, email, displayName, avatar }
  token: null,

  // Statistics
  stats: {
    gamesPlayed: 0,
    gamesWon: 0,
    totalScore: 0,
    highestScore: 0,
    averageScore: 0,
    correctAnswers: 0,
    totalAnswers: 0,
  },

  // Local highscores (persisted)
  localHighscores: [],
};

export const useUserStore = create(
  persist(
    (set, get) => ({
      ...initialState,

      // Actions
      setUser: (user) => set({ user, isAuthenticated: !!user, isGuest: !user }),

      setToken: (token) => set({ token }),

      login: async (credentials) => {
        // This will be implemented when backend is ready
        // For now, simulate login
        const { email, password } = credentials;

        // TODO: Call API
        const mockUser = {
          id: 'user-' + Date.now(),
          email,
          displayName: email.split('@')[0],
        };

        set({
          user: mockUser,
          isAuthenticated: true,
          isGuest: false,
        });

        return mockUser;
      },

      register: async (userData) => {
        // This will be implemented when backend is ready
        const { email, password, displayName } = userData;

        // TODO: Call API
        const mockUser = {
          id: 'user-' + Date.now(),
          email,
          displayName,
        };

        set({
          user: mockUser,
          isAuthenticated: true,
          isGuest: false,
        });

        return mockUser;
      },

      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isGuest: true,
        });
      },

      continueAsGuest: (displayName = 'Player') => {
        set({
          user: {
            id: 'guest-' + Date.now(),
            displayName,
          },
          isGuest: true,
          isAuthenticated: false,
        });
      },

      // Update stats after a game
      updateStats: (gameResult) => {
        const { stats } = get();
        const { score, won, questionsCorrect, questionsTotal } = gameResult;

        const newGamesPlayed = stats.gamesPlayed + 1;
        const newTotalScore = stats.totalScore + score;

        set({
          stats: {
            gamesPlayed: newGamesPlayed,
            gamesWon: stats.gamesWon + (won ? 1 : 0),
            totalScore: newTotalScore,
            highestScore: Math.max(stats.highestScore, score),
            averageScore: Math.round(newTotalScore / newGamesPlayed),
            correctAnswers: stats.correctAnswers + questionsCorrect,
            totalAnswers: stats.totalAnswers + questionsTotal,
          },
        });
      },

      // Add highscore
      addHighscore: (entry) => {
        const { localHighscores } = get();
        const newEntry = {
          id: 'hs-' + Date.now(),
          ...entry,
          date: new Date().toISOString(),
        };

        // Keep top 50 highscores
        const updated = [...localHighscores, newEntry]
          .sort((a, b) => b.score - a.score)
          .slice(0, 50);

        set({ localHighscores: updated });
      },

      // Get accuracy percentage
      getAccuracy: () => {
        const { stats } = get();
        if (stats.totalAnswers === 0) return 0;
        return Math.round((stats.correctAnswers / stats.totalAnswers) * 100);
      },

      // Reset stats (for testing)
      resetStats: () => {
        set({
          stats: initialState.stats,
          localHighscores: [],
        });
      },
    }),
    {
      name: 'jeopardy-user-storage',
      partialize: (state) => ({
        stats: state.stats,
        localHighscores: state.localHighscores,
        user: state.isGuest ? null : state.user,
        isGuest: state.isGuest,
      }),
    }
  )
);

export default useUserStore;
