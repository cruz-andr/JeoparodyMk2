import { create } from 'zustand';

const POINT_VALUES = {
  regular: [200, 400, 600, 800, 1000],
  double: [400, 800, 1200, 1600, 2000],
};

const initialState = {
  // Setup Phase
  setupPhase: 'settings', // 'settings' | 'content' | 'review' | 'creating'
  contentSubPhase: null, // 'genreSelect' | 'generating' | 'categoryEdit' | 'questionEdit' | 'import'

  // Answer Mode
  answerMode: 'verbal', // 'verbal' | 'typed' | 'multiple_choice' | 'auto_grade'

  // Display Mode
  projectorMode: false, // true = players get controller-only UI, host shows board on projector

  // Content Source
  contentSource: 'ai', // 'ai' | 'import'

  // AI-Generated Content
  genre: '',
  categories: [], // Array of 6 category names
  questions: [], // 2D array: [categoryIndex][pointIndex] of question objects

  // Import State
  importedData: null,
  importError: null,

  // Validation
  isValid: false,
  validationErrors: [],

  // Loading States
  isGenerating: false,
  generatingStep: null, // 'categories' | 'questions'
};

// Question object structure:
// {
//   category: string,
//   points: number,
//   answer: string,       // The clue shown to players
//   question: string,     // The correct response
//   options: string[],    // For multiple choice (4 options)
//   revealed: false,
//   mediaType: null | 'image' | 'youtube',
//   mediaData: null | string,  // compressed base64 WebP (image) or YouTube video ID
//   youtubeStart: null | number, // seconds
//   youtubeEnd: null | number,   // seconds
//   audioOnly: false,     // hide YT video, play audio only
//   altText: null | string,
// }

const MEDIA_DEFAULTS = {
  mediaType: null,
  mediaData: null,
  youtubeStart: null,
  youtubeEnd: null,
  audioOnly: false,
  altText: null,
};

export const useHostStore = create((set, get) => ({
  ...initialState,

  // Phase Navigation
  setSetupPhase: (phase) => set({ setupPhase: phase }),

  setContentSubPhase: (subPhase) => set({ contentSubPhase: subPhase }),

  nextPhase: () => {
    const { setupPhase } = get();
    const phases = ['settings', 'content', 'review', 'creating'];
    const currentIndex = phases.indexOf(setupPhase);
    if (currentIndex < phases.length - 1) {
      set({ setupPhase: phases[currentIndex + 1] });
    }
  },

  prevPhase: () => {
    const { setupPhase } = get();
    const phases = ['settings', 'content', 'review', 'creating'];
    const currentIndex = phases.indexOf(setupPhase);
    if (currentIndex > 0) {
      set({ setupPhase: phases[currentIndex - 1] });
    }
  },

  // Answer Mode
  setAnswerMode: (mode) => set({ answerMode: mode }),

  // Display Mode
  setProjectorMode: (enabled) => set({ projectorMode: enabled }),

  // Content Source
  setContentSource: (source) => {
    set({
      contentSource: source,
      contentSubPhase: source === 'ai' ? 'genreSelect' : 'import',
      // Reset content when switching sources
      categories: [],
      questions: [],
      importedData: null,
      importError: null,
    });
  },

  // Genre
  setGenre: (genre) => set({ genre }),

  // Categories
  setCategories: (categories) => set({ categories }),

  updateCategory: (index, value) => {
    set((state) => {
      const newCategories = [...state.categories];
      newCategories[index] = value;

      // Also update category name in questions
      const newQuestions = state.questions.map((categoryQuestions, catIdx) => {
        if (catIdx === index) {
          return categoryQuestions.map((q) => ({ ...q, category: value }));
        }
        return categoryQuestions;
      });

      return { categories: newCategories, questions: newQuestions };
    });
  },

  // Questions
  setQuestions: (questions) => set({ questions }),

  updateQuestion: (categoryIndex, pointIndex, updates) => {
    set((state) => {
      const newQuestions = state.questions.map((categoryQuestions, catIdx) => {
        if (catIdx === categoryIndex) {
          return categoryQuestions.map((q, pIdx) => {
            if (pIdx === pointIndex) {
              return { ...q, ...updates };
            }
            return q;
          });
        }
        return categoryQuestions;
      });
      return { questions: newQuestions };
    });
  },

  // Initialize empty question grid
  initializeEmptyQuestions: (categories) => {
    const questions = categories.map((category) =>
      POINT_VALUES.regular.map((points) => ({
        category,
        points,
        answer: '',
        question: '',
        options: ['', '', '', ''],
        revealed: false,
        ...MEDIA_DEFAULTS,
      }))
    );
    set({ questions, categories });
  },

  // Generate question structure from AI response
  setQuestionsFromAI: (aiResponse, categories) => {
    // aiResponse format: { categories: [{ name, questions: [{ points, answer, question }] }] }
    const questions = aiResponse.categories.map((cat, catIdx) => {
      return cat.questions.map((q) => ({
        category: categories[catIdx],
        points: q.points,
        answer: q.answer,
        question: q.question,
        options: q.options || ['', '', '', ''],
        revealed: false,
        ...MEDIA_DEFAULTS,
      }));
    });
    set({ questions });
  },

  // Import
  setImportedData: (data) => {
    if (data) {
      // Convert imported data to internal format
      const categories = data.categories.map((c) => c.name);
      const questions = data.categories.map((cat) =>
        cat.questions.map((q) => ({
          category: cat.name,
          points: q.points,
          answer: q.answer,
          question: q.question,
          options: q.options || ['', '', '', ''],
          revealed: false,
          ...MEDIA_DEFAULTS,
          // Preserve media fields from imported data if present
          ...(q.mediaType && { mediaType: q.mediaType }),
          ...(q.mediaData && { mediaData: q.mediaData }),
          ...(q.youtubeStart != null && { youtubeStart: q.youtubeStart }),
          ...(q.youtubeEnd != null && { youtubeEnd: q.youtubeEnd }),
          ...(q.audioOnly && { audioOnly: q.audioOnly }),
          ...(q.altText && { altText: q.altText }),
        }))
      );
      set({
        importedData: data,
        categories,
        questions,
        importError: null,
      });
    } else {
      set({ importedData: null, categories: [], questions: [] });
    }
  },

  setImportError: (error) => set({ importError: error }),

  clearImport: () =>
    set({
      importedData: null,
      importError: null,
      categories: [],
      questions: [],
    }),

  // Loading States
  setIsGenerating: (isGenerating, step = null) =>
    set({ isGenerating, generatingStep: step }),

  // Validation
  validateContent: () => {
    const { categories, questions, answerMode } = get();
    const errors = [];

    // Check categories
    if (categories.length !== 6) {
      errors.push('Must have exactly 6 categories');
    }
    categories.forEach((cat, idx) => {
      if (!cat || cat.trim() === '') {
        errors.push(`Category ${idx + 1} is empty`);
      }
    });

    // Check questions
    if (questions.length !== 6) {
      errors.push('Must have questions for all 6 categories');
    }
    questions.forEach((categoryQuestions, catIdx) => {
      if (categoryQuestions.length !== 5) {
        errors.push(`Category ${catIdx + 1} must have 5 questions`);
      }
      categoryQuestions.forEach((q, qIdx) => {
        if (!q.answer || q.answer.trim() === '') {
          errors.push(
            `Category ${catIdx + 1}, $${q.points}: Missing clue`
          );
        }
        if (!q.question || q.question.trim() === '') {
          errors.push(
            `Category ${catIdx + 1}, $${q.points}: Missing answer`
          );
        }
        // Validate media fields
        if (q.mediaType === 'youtube' && !q.mediaData) {
          errors.push(
            `Category ${catIdx + 1}, $${q.points}: YouTube video ID is missing`
          );
        }
        if (q.mediaType === 'youtube' && q.youtubeStart != null && q.youtubeEnd != null && q.youtubeEnd <= q.youtubeStart) {
          errors.push(
            `Category ${catIdx + 1}, $${q.points}: YouTube end time must be after start time`
          );
        }
        if (q.mediaType === 'image' && !q.mediaData) {
          errors.push(
            `Category ${catIdx + 1}, $${q.points}: Image data is missing`
          );
        }
        // Validate MC options if in MC mode
        if (answerMode === 'multiple_choice') {
          const validOptions = q.options?.filter((o) => o && o.trim() !== '');
          if (!validOptions || validOptions.length < 2) {
            errors.push(
              `Category ${catIdx + 1}, $${q.points}: Need at least 2 multiple choice options`
            );
          }
        }
      });
    });

    const isValid = errors.length === 0;
    set({ isValid, validationErrors: errors });
    return isValid;
  },

  // Get questions in format for server
  getQuestionsForServer: () => {
    const { categories, questions } = get();
    return {
      categories,
      questions: questions.map((categoryQuestions) =>
        categoryQuestions.map((q) => ({
          category: q.category,
          points: q.points,
          answer: q.answer,
          question: q.question,
          options: q.options,
          revealed: false,
          mediaType: q.mediaType || null,
          mediaData: q.mediaData || null,
          youtubeStart: q.youtubeStart ?? null,
          youtubeEnd: q.youtubeEnd ?? null,
          audioOnly: q.audioOnly || false,
          altText: q.altText || null,
        }))
      ),
    };
  },

  // Reset
  reset: () => set(initialState),

  // Reset content only (keep settings)
  resetContent: () =>
    set({
      contentSubPhase: null,
      genre: '',
      categories: [],
      questions: [],
      importedData: null,
      importError: null,
      isValid: false,
      validationErrors: [],
      isGenerating: false,
      generatingStep: null,
    }),
}));
