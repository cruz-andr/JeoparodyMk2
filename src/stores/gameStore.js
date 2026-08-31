import { create } from 'zustand';

const POINT_VALUES = {
  regular: [200, 400, 600, 800, 1000],
  double: [400, 800, 1200, 1600, 2000]
};

const initialState = {
  // Game Mode
  mode: null, // 'single' | 'quickplay' | 'multiplayer' | 'host'

  // Game Phase
  phase: 'idle', // 'idle' | 'setup' | 'playing' | 'questionActive' | 'dailyDouble' | 'finalJeopardy' | 'roundEnd' | 'finished'

  // Round State
  currentRound: 1,

  // Content
  genre: '',
  categories: [],
  questions: [], // 2D array: [categoryIndex][pointIndex]

  // Current Question
  currentQuestion: null,
  showAnswer: false,
  dailyDoubleWager: 0,

  // Daily Doubles (positions)
  dailyDoubles: [], // [{categoryIndex, pointIndex}]

  // Scoring (for single player)
  score: 0,

  // Multiplayer Scores
  scores: {}, // { oderId: score }

  // Timer
  timeRemaining: null,
  timerActive: false,

  // Statistics for current game
  questionsAttempted: 0,
  questionsCorrect: 0,

  // Loading/Error states
  loading: false,
  error: null,
};

export const useGameStore = create((set, get) => ({
  ...initialState,

  // Actions
  setMode: (mode) => set({ mode }),

  setGenre: (genre) => set({ genre }),

  setCategories: (categories) => set({ categories }),

  setQuestions: (questions, enableDailyDouble = true) => {
    const dailyDoubles = enableDailyDouble
      ? placeDailyDoubles(questions.length, get().currentRound, questions[0]?.length)
      : [];
    set({ questions, dailyDoubles });
  },

  setPhase: (phase) => set({ phase }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  selectQuestion: (categoryIndex, pointIndex) => {
    const { questions, dailyDoubles, phase } = get();
    if (phase !== 'playing') return;

    const question = questions[categoryIndex]?.[pointIndex];
    if (!question || question.revealed) return;

    // Mark as revealed
    const newQuestions = [...questions];
    newQuestions[categoryIndex] = [...newQuestions[categoryIndex]];
    newQuestions[categoryIndex][pointIndex] = { ...question, revealed: true };

    // Check if it's a daily double
    const isDailyDouble = dailyDoubles.some(
      dd => dd.categoryIndex === categoryIndex && dd.pointIndex === pointIndex
    );

    set({
      questions: newQuestions,
      currentQuestion: { ...question, categoryIndex, pointIndex },
      showAnswer: false,
      phase: isDailyDouble ? 'dailyDouble' : 'questionActive',
    });
  },

  setDailyDoubleWager: (wager) => set({ dailyDoubleWager: wager }),

  confirmDailyDoubleWager: () => {
    set({ phase: 'questionActive' });
  },

  revealAnswer: () => set({ showAnswer: true }),

  // For single player self-scoring
  /* The outcome is recorded on the clue itself, not only in the running total.

     A score says how you are doing; it does not say which of thirty cells you
     got right, and the phone wheel marks each one the way the daily board
     does. Without this every played cell reads as wrong, because
     answerMark treats a missing `correct` as a miss. */
  recordOutcome: (correct) => {
    const { questions, currentQuestion } = get();
    if (!currentQuestion) return;

    set({
      questions: questions.map((category, c) =>
        category.map((q, r) => (
          c === currentQuestion.categoryIndex && r === currentQuestion.pointIndex
            ? { ...q, correct }
            : q
        ))
      ),
    });
  },

  markCorrect: () => {
    const { currentQuestion, dailyDoubleWager, phase, score } = get();
    if (!currentQuestion) return;

    const points = phase === 'dailyDouble' || dailyDoubleWager > 0
      ? dailyDoubleWager
      : currentQuestion.points;

    get().recordOutcome(true);
    set({
      score: score + points,
      questionsAttempted: get().questionsAttempted + 1,
      questionsCorrect: get().questionsCorrect + 1,
    });
  },

  markIncorrect: () => {
    const { currentQuestion, dailyDoubleWager, phase, score } = get();
    if (!currentQuestion) return;

    const points = phase === 'dailyDouble' || dailyDoubleWager > 0
      ? dailyDoubleWager
      : currentQuestion.points;

    get().recordOutcome(false);
    set({
      score: score - points,
      questionsAttempted: get().questionsAttempted + 1,
    });
  },

  closeQuestion: () => {
    const { questions, currentRound } = get();

    // Check if all questions in current round are revealed
    const allRevealed = questions.every(category =>
      category.every(q => q.revealed)
    );

    if (allRevealed) {
      if (currentRound === 1) {
        // Move to Double Jeopardy
        set({
          currentQuestion: null,
          showAnswer: false,
          dailyDoubleWager: 0,
          phase: 'roundEnd',
        });
      } else {
        // Game finished
        set({
          currentQuestion: null,
          showAnswer: false,
          dailyDoubleWager: 0,
          phase: 'finished',
        });
      }
    } else {
      set({
        currentQuestion: null,
        showAnswer: false,
        dailyDoubleWager: 0,
        phase: 'playing',
      });
    }
  },

  startRound2: (newCategories, newQuestions, enableDailyDouble = true) => {
    const dailyDoubles = enableDailyDouble
      ? placeDailyDoubles(newQuestions.length, 2, newQuestions[0]?.length)
      : [];
    set({
      currentRound: 2,
      categories: newCategories,
      questions: newQuestions,
      dailyDoubles,
      phase: 'playing',
    });
  },

  startFinalJeopardy: () => {
    set({ phase: 'finalJeopardy' });
  },

  // Timer actions
  setTimeRemaining: (time) => set({ timeRemaining: time }),
  setTimerActive: (active) => set({ timerActive: active }),

  // Score actions
  setScore: (score) => set({ score }),

  // Multiplayer scoring
  updatePlayerScore: (playerId, points) => {
    const scores = { ...get().scores };
    scores[playerId] = (scores[playerId] || 0) + points;
    set({ scores });
  },

  // Reset game
  resetGame: () => set({ ...initialState }),

  // Get point values for current round
  getPointValues: () => {
    const { currentRound } = get();
    return currentRound === 1 ? POINT_VALUES.regular : POINT_VALUES.double;
  },

  // Get max wager for daily double
  getMaxWager: () => {
    const { score, currentRound } = get();
    const maxBoardValue = currentRound === 1 ? 1000 : 2000;
    return Math.max(score, maxBoardValue, 5);
  },
}));

// Helper function to place daily doubles
// Mirrors the server's placement rules: rows weighted toward the harder clues,
// no two Daily Doubles in one category, and the board's real row count.
function placeDailyDoubles(categoryCount, round, rowCount = 5) {
  const count = round === 1 ? 1 : 2;
  if (categoryCount < 1 || rowCount < 1) return [];

  const weights = Array.from({ length: rowCount }, (_, i) => i);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const pickRow = () => {
    if (totalWeight === 0) return 0;
    let random = Math.random() * totalWeight;
    for (let i = 0; i < rowCount; i++) {
      random -= weights[i];
      if (random <= 0 && weights[i] > 0) return i;
    }
    return rowCount - 1;
  };

  const available = Array.from({ length: categoryCount }, (_, i) => i);
  const dailyDoubles = [];

  while (dailyDoubles.length < count && available.length > 0) {
    const pick = Math.floor(Math.random() * available.length);
    const [categoryIndex] = available.splice(pick, 1);
    dailyDoubles.push({ categoryIndex, pointIndex: pickRow() });
  }

  return dailyDoubles;
}
