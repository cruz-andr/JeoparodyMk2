import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import * as authApi from '../services/api/authService';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const readCookie = (name) => document.cookie
  .split('; ')
  .find(row => row.startsWith(`${name}=`))
  ?.split('=')[1];
const writeCookie = (name, value) => {
  document.cookie = `${name}=${value}; path=/; max-age=${SESSION_MAX_AGE}; SameSite=Lax`;
};

/* A brand-new session: an id, which every other player sees, and a key, which
   only this browser has. The server lets a connection be this player only with
   both, so a player cannot be impersonated by someone who has seen their id. */
const newSession = () => {
  const session = { sessionId: uuidv4(), sessionKey: uuidv4() };
  writeCookie('jeopardy_session', session.sessionId);
  writeCookie('jeopardy_session_key', session.sessionKey);
  return session;
};

/* The session from the cookies, or a new one. An id without its key (from
   before keys existed) cannot be proven to be ours, so it is replaced. */
const getSession = () => {
  const sessionId = readCookie('jeopardy_session');
  const sessionKey = readCookie('jeopardy_session_key');
  return sessionId && sessionKey ? { sessionId, sessionKey } : newSession();
};

const initialState = {
  // Session id and key (persisted in cookies for reconnection)
  ...getSession(),
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

      /* These two used to invent a user and never call anything, which is why
         signing in appeared to work while no account existed anywhere. */
      login: async ({ email, password }) => {
        const { token, user } = await authApi.login(email, password);
        set({ token, user, isAuthenticated: true, isGuest: false });
        return user;
      },

      register: async ({ email, password, displayName }) => {
        const { token, user } = await authApi.register(email, password, displayName);
        set({ token, user, isAuthenticated: true, isGuest: false });
        return user;
      },

      /** Google hands the token back in the URL; this turns it into a session. */
      adoptToken: async (token) => {
        const { user } = await authApi.me(token);
        set({ token, user, isAuthenticated: true, isGuest: false });
        return user;
      },

      /* On boot the stored token might be expired, or belong to an account
         that has since been deleted. Ask, and stand down quietly if so, rather
         than showing someone a name they cannot use. */
      restoreSession: async () => {
        const { token } = get();
        if (!token) return null;
        try {
          const { user } = await authApi.me(token);
          set({ user, isAuthenticated: true, isGuest: false });
          return user;
        } catch (err) {
          if (err?.status === 401 || err?.status === 403 || err?.status === 404) {
            set({ token: null, user: null, isAuthenticated: false, isGuest: true });
          }
          return null;
        }
      },

      saveUsername: async (username) => {
        const { token } = get();
        if (!token) return null;
        const { user } = await authApi.saveUsername(token, username);
        set({ user });
        return user;
      },

      saveSignature: async (signature) => {
        const { token, user } = get();
        if (!token) return null;
        await authApi.saveSignature(token, signature);
        set({ user: { ...user, signature } });
        return signature;
      },

      clearSignature: async () => {
        const { token, user } = get();
        if (!token) return;
        await authApi.clearSignature(token);
        set({ user: { ...user, signature: null } });
      },

      deleteAccount: async () => {
        const { token } = get();
        if (!token) return;
        await authApi.deleteAccount(token);
        set({ token: null, user: null, isAuthenticated: false, isGuest: true });
      },

      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isGuest: true,
        });
      },

      /* The server refused this session: its id is claimed by another key, or
         it has none. Start a fresh one; useSocket reconnects when it changes. */
      resetSession: () => {
        set(newSession());
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
        // Kept so a refresh does not sign you out. Checked against the server
        // on boot; see restoreSession.
        token: state.isGuest ? null : state.token,
        /* Persisted alongside the token. Without it a reload came back with a
           token but isAuthenticated false, so any screen guarding on it bounced
           to sign-in before the check against the server could finish. */
        isAuthenticated: state.isGuest ? false : state.isAuthenticated,
      }),
    }
  )
);
