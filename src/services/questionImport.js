/**
 * Question Import Service
 * Validates and parses JSON files containing Jeopardy questions
 */

const POINT_VALUES = [200, 400, 600, 800, 1000];
const REQUIRED_CATEGORIES = 6;
const REQUIRED_QUESTIONS_PER_CATEGORY = 5;

/**
 * Validates the structure of an imported question file
 * @param {Object} data - The parsed JSON data
 * @returns {{ valid: boolean, errors: string[], data: Object|null }}
 */
export function validateQuestionFile(data) {
  const errors = [];

  // Check basic structure
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid file format'], data: null };
  }

  // Check version (optional but recommended)
  if (data.version && data.version !== 1) {
    errors.push(`Unsupported file version: ${data.version}`);
  }

  // Check categories array
  if (!Array.isArray(data.categories)) {
    return { valid: false, errors: ['Missing categories array'], data: null };
  }

  if (data.categories.length !== REQUIRED_CATEGORIES) {
    errors.push(`Expected ${REQUIRED_CATEGORIES} categories, got ${data.categories.length}`);
  }

  // Validate each category
  data.categories.forEach((category, catIdx) => {
    if (!category.name || typeof category.name !== 'string') {
      errors.push(`Category ${catIdx + 1}: Missing or invalid name`);
    }

    if (!Array.isArray(category.questions)) {
      errors.push(`Category ${catIdx + 1}: Missing questions array`);
      return;
    }

    if (category.questions.length !== REQUIRED_QUESTIONS_PER_CATEGORY) {
      errors.push(
        `Category "${category.name || catIdx + 1}": Expected ${REQUIRED_QUESTIONS_PER_CATEGORY} questions, got ${category.questions.length}`
      );
    }

    // Validate each question
    category.questions.forEach((q, qIdx) => {
      const prefix = `Category "${category.name || catIdx + 1}", Q${qIdx + 1}`;

      if (!q.points || !POINT_VALUES.includes(q.points)) {
        errors.push(`${prefix}: Invalid or missing point value`);
      }

      if (!q.answer || typeof q.answer !== 'string') {
        errors.push(`${prefix}: Missing clue (answer field)`);
      }

      if (!q.question || typeof q.question !== 'string') {
        errors.push(`${prefix}: Missing correct answer (question field)`);
      }

      // Validate MC options if present
      if (q.options) {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          errors.push(`${prefix}: Options must be an array with at least 2 items`);
        }
      }
    });
  });

  // Validate Final Jeopardy if present
  if (data.finalJeopardy) {
    const fj = data.finalJeopardy;
    if (!fj.category || typeof fj.category !== 'string') {
      errors.push('Final Jeopardy: Missing category');
    }
    if (!fj.answer || typeof fj.answer !== 'string') {
      errors.push('Final Jeopardy: Missing clue');
    }
    if (!fj.question || typeof fj.question !== 'string') {
      errors.push('Final Jeopardy: Missing correct answer');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? normalizeData(data) : null,
  };
}

/**
 * Normalizes imported data to ensure consistent structure
 * @param {Object} data - The validated data
 * @returns {Object} Normalized data
 */
function normalizeData(data) {
  return {
    version: data.version || 1,
    categories: data.categories.map((cat) => ({
      name: cat.name.trim().toUpperCase(),
      questions: POINT_VALUES.map((points) => {
        const existing = cat.questions.find((q) => q.points === points);
        return {
          points,
          answer: existing?.answer?.trim() || '',
          question: existing?.question?.trim() || '',
          options: existing?.options?.map((o) => o?.trim() || '') || ['', '', '', ''],
        };
      }),
    })),
    finalJeopardy: data.finalJeopardy
      ? {
          category: data.finalJeopardy.category.trim().toUpperCase(),
          answer: data.finalJeopardy.answer.trim(),
          question: data.finalJeopardy.question.trim(),
        }
      : null,
  };
}

/**
 * Parses a JSON file and validates its contents
 * @param {File} file - The file to parse
 * @returns {Promise<{ valid: boolean, errors: string[], data: Object|null }>}
 */
export async function parseQuestionFile(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ valid: false, errors: ['No file provided'], data: null });
      return;
    }

    if (!file.name.endsWith('.json')) {
      resolve({ valid: false, errors: ['File must be a .json file'], data: null });
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const result = validateQuestionFile(data);
        resolve(result);
      } catch (error) {
        resolve({
          valid: false,
          errors: [`Invalid JSON: ${error.message}`],
          data: null,
        });
      }
    };

    reader.onerror = () => {
      resolve({
        valid: false,
        errors: ['Error reading file'],
        data: null,
      });
    };

    reader.readAsText(file);
  });
}

/**
 * Generates a sample template file for users to fill in
 * @returns {Object} Sample template
 */
export function generateSampleTemplate() {
  return {
    version: 1,
    categories: Array.from({ length: 6 }, (_, i) => ({
      name: `CATEGORY ${i + 1}`,
      questions: POINT_VALUES.map((points) => ({
        points,
        answer: `Clue for $${points} question`,
        question: 'What is the answer?',
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
      })),
    })),
    finalJeopardy: {
      category: 'FINAL CATEGORY',
      answer: 'This is the final clue',
      question: 'What is the final answer?',
    },
  };
}

/**
 * Downloads a sample template file
 */
export function downloadSampleTemplate() {
  const template = generateSampleTemplate();
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'jeopardy-template.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default {
  validateQuestionFile,
  parseQuestionFile,
  generateSampleTemplate,
  downloadSampleTemplate,
};
