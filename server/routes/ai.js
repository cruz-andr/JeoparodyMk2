/**
 * The model, over HTTP.
 *
 * Every route here is one prompt the client used to send to Google itself,
 * carrying a key that shipped in the bundle. Now the browser sends the inputs
 * and the server, which holds the key, does the asking.
 *
 * Signed in only, the same as writing a board: a request here costs money on
 * somebody else's account, and an address is not a person. The budget on top
 * of that is in middleware/rateLimit.js.
 *
 * The shapes returned are exactly what the pages already read, so nothing
 * downstream of src/services/api/aiService.js knows the road changed.
 */
import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import * as model from '../services/gemini.js';

const router = Router();

const MAX_TOPIC = 200;
const MAX_TEXT = 2000;
const MAX_CATEGORIES = 6;

/** A short line of text, or a 400 that names the field. */
function line(value, field, max = MAX_TOPIC) {
  const text = String(value ?? '').trim();
  if (!text) throw new AppError(`${field} is required.`, 400, 'AI_BAD_INPUT');
  if (text.length > max) throw new AppError(`${field} is too long.`, 400, 'AI_BAD_INPUT');
  return text;
}

function names(value, field) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CATEGORIES) {
    throw new AppError(`${field} must be a list of 1 to ${MAX_CATEGORIES} names.`, 400, 'AI_BAD_INPUT');
  }
  return value.map((v) => line(v, field));
}

/**
 * The names already on a board, blanks and all.
 *
 * The pages send the board's headers verbatim, and a header a host has
 * cleared to rewrite by hand is an empty string in that list. It is not an
 * error: it is just nothing for the model to steer clear of, so it is kept
 * as a blank here (so the index still points at the same slot) and dropped
 * from the prompt in services/gemini.js.
 */
function headers(value, field) {
  if (!Array.isArray(value) || value.length > MAX_CATEGORIES) {
    throw new AppError(`${field} must be a list of up to ${MAX_CATEGORIES} names.`, 400, 'AI_BAD_INPUT');
  }
  return value.map((v) => {
    const text = String(v ?? '').trim();
    if (text.length > MAX_TOPIC) throw new AppError(`${field} is too long.`, 400, 'AI_BAD_INPUT');
    return text;
  });
}

function values(value) {
  if (!Array.isArray(value) || value.length !== 5 || !value.every((v) => Number.isFinite(Number(v)))) {
    throw new AppError('pointValues must be five numbers.', 400, 'AI_BAD_INPUT');
  }
  return value.map(Number);
}

/* Express 4 does not catch a rejected promise from a handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* Signed in or not. Single player has always worked without an account, and
   gating the model behind sign in would turn the front door into a wall. A
   guest is rate limited by address instead of by account, which is what the
   limiter's key already does when there is no user on the request. */
router.use(optionalAuth);

/** Six category names for a topic. Answers with a bare array of strings. */
router.post('/categories', wrap(async (req, res) => {
  const topic = line(req.body?.topic, 'topic');
  res.json(await model.generateCategories(topic));
}));

/** One replacement name, different from the others on the board. */
router.post('/category', wrap(async (req, res) => {
  const topic = line(req.body?.topic, 'topic');
  const existing = headers(req.body?.existing ?? [], 'existing');
  const index = Number(req.body?.index);
  if (!Number.isInteger(index) || index < 0 || index >= Math.max(existing.length, 1)) {
    throw new AppError('index must point at one of the existing names.', 400, 'AI_BAD_INPUT');
  }
  res.json({ category: await model.regenerateCategory(topic, existing, index) });
}));

/** Five clues for each named category. Answers with { categories: [...] }. */
router.post('/questions', wrap(async (req, res) => {
  const categories = names(req.body?.categories, 'categories');
  const pointValues = values(req.body?.pointValues);
  const round = Number(req.body?.round) === 2 ? 2 : 1;
  const difficulty = Object.hasOwn(model.DIFFICULTY_NOTES, req.body?.difficulty)
    ? req.body.difficulty
    : 'mixed';
  res.json(await model.generateQuestions(categories, pointValues, round, difficulty));
}));

/** A Final Jeopardy clue for a genre. */
router.post('/final', wrap(async (req, res) => {
  const genre = line(req.body?.genre, 'genre');
  res.json(await model.generateFinalJeopardyQuestion(genre));
}));

/** Three wrong answers for a clue, with the right one first. */
router.post('/mc-options', wrap(async (req, res) => {
  const response = line(req.body?.response, 'response', MAX_TEXT);
  const category = line(req.body?.category, 'category');
  const clue = line(req.body?.clue, 'clue', MAX_TEXT);
  res.json(await model.generateMCOptions(response, category, clue));
}));

/** Whether a typed answer is close enough to the right one. */
router.post('/validate', wrap(async (req, res) => {
  const playerAnswer = line(req.body?.playerAnswer, 'playerAnswer', MAX_TEXT);
  const correctAnswer = line(req.body?.correctAnswer, 'correctAnswer', MAX_TEXT);
  const strictness = ['lenient', 'moderate', 'strict'].includes(req.body?.strictness)
    ? req.body.strictness
    : 'moderate';
  res.json(await model.validateAnswer(playerAnswer, correctAnswer, strictness));
}));

export default router;
