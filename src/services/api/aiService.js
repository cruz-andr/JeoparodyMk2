/**
 * Asking the model, through the server.
 *
 * This used to hold a Gemini key and call Google from the browser, which put
 * the key in the bundle for anyone to lift. The prompts now live in
 * server/services/gemini.js and the key never leaves the server. The functions
 * here keep their names and signatures, so every page that asked before asks
 * exactly the same way.
 *
 * Each throws an Error whose message a page can show or match. HostPage reads
 * a few words out of it ("not set up", "quota", "network") to say what to do
 * next, so the sentences here are chosen for those words.
 */
import { useUserStore } from '../../stores/userStore';

const API = import.meta.env.VITE_SOCKET_URL || '';

export class AiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
  }
}

const token = () => {
  try {
    return useUserStore.getState()?.token ?? null;
  } catch {
    return null;
  }
};

/** What to tell somebody for a status, when the server's own words will not do. */
function wording(status, said) {
  if (status === 401 || status === 403) return 'Sign in to use the AI.';
  /* Either the site's key is out, or this account has spent its hour. Both
     are "quota" to the page, which is the word HostPage looks for. */
  if (status === 429) return 'The AI has used up its quota for now. Try again in a few minutes.';
  if (status === 503) return said || 'The AI is not set up on this site.';
  return said || 'The AI could not answer. Try again.';
}

async function call(path, body) {
  if (!API) throw new AiError('The AI is not set up on this site: no server is configured.', 'NO_SERVER', 0);

  let response;
  try {
    response = await fetch(`${API}/api/ai${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiError('Network error: could not reach the server. Check your connection.', 'OFFLINE', 0);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const said = typeof data?.error?.message === 'string' ? data.error.message : '';
    throw new AiError(wording(response.status, said), data?.error?.code, response.status);
  }
  return data;
}

export async function generateCategories(genre) {
  return call('/categories', { topic: genre });
}

export async function regenerateCategory(genre, existingCategories, indexToReplace) {
  const { category } = await call('/category', {
    topic: genre, existing: existingCategories, index: indexToReplace,
  });
  return category;
}

export async function generateQuestions(
  categories,
  pointValues,
  round = 1,
  difficulty = 'mixed'
) {
  return call('/questions', { categories, pointValues, round, difficulty });
}

export async function generateFinalJeopardyQuestion(genre) {
  return call('/final', { genre });
}

// Generate multiple choice options (3 incorrect + 1 correct)
export async function generateMCOptions(correctAnswer, category, clue) {
  try {
    return await call('/mc-options', { response: correctAnswer, category, clue });
  } catch (error) {
    console.error('Error generating MC options:', error);
    // Fallback: return correct answer with placeholder options
    return {
      options: [correctAnswer, 'Option B', 'Option C', 'Option D'],
      correctIndex: 0,
    };
  }
}

// Validate if an answer is correct using AI
export async function validateAnswer(playerAnswer, correctAnswer, strictness = 'moderate') {
  try {
    return await call('/validate', { playerAnswer, correctAnswer, strictness });
  } catch {
    // Fallback to simple string matching
    const normalize = (s) => s.toLowerCase()
      .replace(/^(what|who|where|when|why|how)\s+(is|are|was|were)\s+/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

    const normalizedPlayer = normalize(playerAnswer);
    const normalizedCorrect = normalize(correctAnswer);

    return {
      isCorrect: normalizedPlayer === normalizedCorrect,
      confidence: normalizedPlayer === normalizedCorrect ? 1.0 : 0.0,
      reason: 'Fallback string matching used',
    };
  }
}
