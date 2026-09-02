/**
 * The model, behind the server.
 *
 * The key used to ship in the client bundle as VITE_GEMINI_API_KEY, which
 * means anyone who opened the network tab could lift it and spend the quota
 * from anywhere. Now the browser asks this server, the server holds the key,
 * and the key never leaves the machine.
 *
 * The prompts are the ones the client used to build, moved here word for word.
 * The tidying that ran on what came back moved with them, because the shape a
 * page receives should not change just because the request took a different
 * road.
 *
 * The one call that actually leaves the machine is `generateContent`, and it
 * can be swapped for a fake with `useGenerateContent`, so the routes and the
 * parsing can be tested without a key, a quota or a network.
 */
import { AppError } from '../middleware/errorHandler.js';

const MODEL = 'gemini-3-flash-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/* A board has six columns. */
const BOARD_CATEGORIES = 6;

/* How long to wait on the model. A full board is thirty clues and can take a
   while; a request that hangs forever would hold a connection and a limiter
   slot for nothing. */
const TIMEOUT_MS = 90 * 1000;

/* Read per call rather than at import, so a test can set the environment
   before asking and a server can be told it has no key without restarting. */
const apiKey = () => (process.env.GEMINI_API_KEY || '').trim();

export const isConfigured = () => Boolean(apiKey());

// ------------------------------------------------------------- errors

/**
 * What the model, or the road to it, said. Carries the status the route
 * should answer with and a sentence a person can read. The client matches on
 * a few words in these ("not set up", "quota") to say what to do next, so
 * they are load bearing.
 */
export const NOT_SET_UP = 'The AI is not set up on this site.';
export const OUT_OF_QUOTA = 'The AI has used up its quota for now. Try again in a few minutes.';
export const UNREACHABLE = 'Could not reach the AI. Try again in a moment.';
export const UNUSABLE = 'The AI sent back something unusable. Try again.';

/** Turn whatever the transport threw into a status and a sentence. */
function modelError(err) {
  if (err instanceof AppError) return err;
  const status = Number(err?.status ?? 0);
  const said = String(err?.message ?? '');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(said)) {
    return new AppError(OUT_OF_QUOTA, 429, 'AI_QUOTA');
  }
  /* A key the model refuses is the same problem as no key at all: the site is
     not set up. Nothing a host does will fix it. */
  if ([400, 401, 403].includes(status) && /API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(said)) {
    return new AppError(NOT_SET_UP, 503, 'AI_NOT_CONFIGURED');
  }
  /* Nothing at the address the server asks: the model name in this file has
     been retired or the endpoint moved. That is a setup problem, not a bad
     answer, and telling a host to try again would only have them try again. */
  if (status === 404) {
    return new AppError(NOT_SET_UP, 503, 'AI_NOT_CONFIGURED');
  }
  if (status >= 400 && status < 500) {
    return new AppError(UNUSABLE, 502, 'AI_BAD_REPLY');
  }
  return new AppError(UNREACHABLE, 502, 'AI_UNREACHABLE');
}

// ---------------------------------------------------------- transport

/**
 * The real call. One prompt in, the model's text out.
 *
 * Plain fetch against the REST endpoint rather than the SDK, so the server
 * carries no new dependency for what is one POST.
 */
async function realGenerateContent(prompt) {
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const failed = new Error(`network: ${err?.message ?? 'could not reach the model'}`);
    failed.status = 0;
    throw failed;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failed = new Error(data?.error?.message || `The model answered ${response.status}`);
    failed.status = response.status;
    throw failed;
  }

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p?.text ?? '').join('');
}

let generateContent = realGenerateContent;

/**
 * Swap the call that leaves the machine for one that does not.
 * Pass nothing to put the real one back.
 */
export function useGenerateContent(fn) {
  generateContent = typeof fn === 'function' ? fn : realGenerateContent;
}

/** One prompt, answered and parsed, or an AppError the route can send. */
async function ask(prompt) {
  if (!isConfigured()) throw new AppError(NOT_SET_UP, 503, 'AI_NOT_CONFIGURED');

  let text;
  try {
    text = String(await generateContent(prompt) ?? '').trim();
  } catch (err) {
    throw modelError(err);
  }

  // Extract JSON from response (handle potential markdown code blocks)
  let jsonStr = text;
  if (text.includes('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new AppError(UNUSABLE, 502, 'AI_BAD_REPLY');
  }
}

function generateSeed() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// ------------------------------------------------------------ tidying

/* "Ada (or Bo)", "Ada, also known as Bo", "Ada / Bo". A response carrying two
   answers is one the host has to adjudicate mid-game, and more often it is the
   model hedging because it was not sure. */
const ALTERNATIVES = [
  /\s*\((?:or|also|a\.?k\.?a\.?|aka|alternatively)\b[^)]*\)/gi,
  /\s*,?\s*(?:or|also known as|a\.k\.a\.|aka)\s+.*$/i,
  /\s*\/\s*.+$/,
];

/**
 * One answer, not two.
 *
 * Keeps the model's first answer, which is the one it led with, and drops the
 * alternative it tacked on. The trailing question mark is put back so the
 * response still reads as a response.
 */
export function singleResponse(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';

  /* Only the part after "What is", so a clue about "Bonnie and Clyde" or a
     title with a slash in it is left alone. */
  const opener = raw.match(/^((?:what|who|where|when)(?:'s|s)?\s+(?:is|are|was|were)\s+)/i);
  if (!opener) return raw;

  const head = opener[1];
  let tail = raw.slice(head.length).replace(/\?+\s*$/, '');

  for (const pattern of ALTERNATIVES) {
    const cut = tail.replace(pattern, '');
    /* Only if something is left. "What is A or B" where the whole tail is the
       alternative means the split was wrong, so it is left as it was. */
    if (cut.trim()) tail = cut;
  }

  return `${head}${tail.trim()}?`;
}

/** Every response on a generated board, tidied. */
export function tidyBoard(board) {
  if (!board?.categories) return board;
  return {
    ...board,
    categories: board.categories.map((category) => ({
      ...category,
      questions: (category.questions ?? []).map((q) => ({
        ...q,
        question: singleResponse(q.question),
      })),
    })),
  };
}

/**
 * Responses that still carry more than one answer after tidying, so a host can
 * be told which clues to read before they play them. Costs nothing: it is a
 * look at text that has already arrived.
 */
export function hedged(board) {
  const out = [];
  for (const category of board?.categories ?? []) {
    for (const q of category.questions ?? []) {
      if (/\bor\b|\baka\b|a\.k\.a|also known as|\//i.test(String(q.question ?? ''))) {
        out.push({ category: category.name, points: q.points, response: q.question });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ prompts

export async function generateCategories(genre) {
  const seed = generateSeed();

  const prompt = `You are a Jeopardy game assistant. Generate 6 unique, diverse, and interesting Jeopardy categories related to the genre: ${genre}.

Variation seed: ${seed}
Use this seed to ensure variety — explore unexpected, lesser-known, or creative angles within this genre. Avoid overly common or obvious categories.

Return ONLY a valid JSON array of 6 strings, with no additional text, markdown, or explanation. Example format:
["CATEGORY 1", "CATEGORY 2", "CATEGORY 3", "CATEGORY 4", "CATEGORY 5", "CATEGORY 6"]`;

  const names = await ask(prompt);
  if (!Array.isArray(names)) throw new AppError(UNUSABLE, 502, 'AI_BAD_REPLY');
  /* Asked for six, not forced to six. A seventh would not fit the board and
     would be refused by the /questions route that follows. */
  return names.slice(0, BOARD_CATEGORIES).map((n) => String(n ?? ''));
}

export async function regenerateCategory(genre, existingCategories, indexToReplace) {
  const seed = generateSeed();
  /* A header the host has cleared is an empty string in the list. There is
     nothing there to be different from, so it stays out of the prompt. */
  const otherCategories = existingCategories
    .filter((name, i) => i !== indexToReplace && String(name ?? '').trim())
    .join(', ');

  const prompt = `You are a Jeopardy game assistant. Generate 1 unique and interesting Jeopardy category related to the genre: ${genre}.

The category must be DIFFERENT from these existing categories: ${otherCategories}

Variation seed: ${seed}
Be creative and explore lesser-known or unexpected angles within this genre.

Return ONLY a valid JSON object with no additional text:
{"category": "CATEGORY_NAME"}`;

  const parsed = await ask(prompt);
  const category = parsed?.category;
  if (typeof category !== 'string' || !category.trim()) {
    throw new AppError(UNUSABLE, 502, 'AI_BAD_REPLY');
  }
  return category;
}

/* `difficulty` is the player's setting. It used to be collected in Settings,
   written by every preset, and then never read by anything, so choosing Easy
   or Hard changed nothing about the questions you were served. */
export const DIFFICULTY_NOTES = {
  easy: 'Pitch every clue at a general audience: recognisable people, places and events, nothing requiring specialist knowledge.',
  medium: 'Pitch clues at a well read general audience, harder than a pub quiz but short of specialist knowledge.',
  hard: 'Pitch every clue at a competitive quiz player: precise dates, secondary figures and less obvious works are fair game.',
  mixed: 'Scale difficulty with the point values: $200 questions should be easy, $1000 questions should be challenging.',
};

export async function generateQuestions(categories, pointValues, round = 1, difficulty = 'mixed') {
  const seed = generateSeed();

  const chosen = DIFFICULTY_NOTES[difficulty] ?? DIFFICULTY_NOTES.mixed;
  const difficultyNote = round === 2
    ? `${chosen} This is also Double Jeopardy, so make every clue harder and more detailed again than a regular round.`
    : chosen;

  const prompt = `You are a Jeopardy game assistant. Generate Jeopardy-style questions and answers for these categories: ${categories.join(', ')}.

Variation seed: ${seed}

For each category, create questions for point values: ${pointValues.join(', ')}.

${difficultyNote}

IMPORTANT: In Jeopardy, the "answer" is shown to the player (as a clue), and they respond with a question.
Example: If the answer/clue is "This planet is known as the Red Planet", the correct question is "What is Mars?".

Every response must name exactly one answer. Never offer an alternative in
brackets, never write "or", "aka" or "also known as", and never separate two
answers with a slash. If you are not confident enough in a fact to give one
answer, write a different clue you are sure of.

Difficulty is set by the point value, not by position in the list. Take each
row as its own brief:
- ${pointValues[0]}: almost everyone who knows the topic gets this.
- ${pointValues[1]}: a regular quiz player gets this.
- ${pointValues[2]}: someone who follows the subject gets this.
- ${pointValues[3]}: needs real knowledge of the subject.
- ${pointValues[4]}: the hardest clue on the board, and it must be harder than the ${pointValues[3]} one.
Never put a household name at ${pointValues[4]} or an obscure one at ${pointValues[0]}.

Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):
{
  "categories": [
    {
      "name": "CATEGORY_NAME",
      "questions": [
        {"points": ${pointValues[0]}, "answer": "THE_CLUE_TEXT", "question": "What is...?"},
        {"points": ${pointValues[1]}, "answer": "THE_CLUE_TEXT", "question": "What is...?"},
        {"points": ${pointValues[2]}, "answer": "THE_CLUE_TEXT", "question": "What is...?"},
        {"points": ${pointValues[3]}, "answer": "THE_CLUE_TEXT", "question": "What is...?"},
        {"points": ${pointValues[4]}, "answer": "THE_CLUE_TEXT", "question": "What is...?"}
      ]
    }
  ]
}

Generate for all ${categories.length} categories.`;

  const board = await ask(prompt);
  if (!Array.isArray(board?.categories)) throw new AppError(UNUSABLE, 502, 'AI_BAD_REPLY');

  /* Tidied on the way out, so nothing downstream has to know the model
     sometimes hedges. This is a pass over text that already arrived: it asks
     the model nothing and costs nothing. */
  return tidyBoard(board);
}

export async function generateFinalJeopardyQuestion(genre) {
  const seed = generateSeed();

  const prompt = `You are a Jeopardy game assistant. Generate a Final Jeopardy question related to the genre: ${genre}.

Variation seed: ${seed}

Final Jeopardy questions should be:
- Challenging but fair
- Have a definitive correct answer
- Be appropriate for the stakes of Final Jeopardy

Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):
{
  "category": "CATEGORY_NAME",
  "answer": "THE_CLUE_TEXT",
  "question": "What is...?"
}`;

  const parsed = await ask(prompt);
  if (!parsed || typeof parsed !== 'object') throw new AppError(UNUSABLE, 502, 'AI_BAD_REPLY');
  return {
    category: String(parsed.category ?? ''),
    answer: String(parsed.answer ?? ''),
    question: String(parsed.question ?? ''),
  };
}

/** Three plausible wrong answers, with the right one first. */
export async function generateMCOptions(correctAnswer, category, clue) {
  const prompt = `You are a Jeopardy game assistant. Generate 3 plausible but incorrect multiple choice options for a question.

Category: ${category}
Clue: ${clue}
Correct Answer: ${correctAnswer}

Requirements:
- Generate exactly 3 INCORRECT options that are plausible distractors
- Options should be similar in format/length to the correct answer
- Options should be related to the category but clearly wrong
- Make them challenging but not tricky - they should be believable

Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):
{
  "options": ["incorrect option 1", "incorrect option 2", "incorrect option 3"]
}`;

  const parsed = await ask(prompt);
  if (!Array.isArray(parsed?.options)) throw new AppError(UNUSABLE, 502, 'AI_BAD_REPLY');

  // Correct answer must be first (index 0) - server expects this
  return { options: [correctAnswer, ...parsed.options.slice(0, 3).map((o) => String(o ?? ''))] };
}

const STRICTNESS = {
  lenient: 'Accept partial answers, common misspellings, and close approximations.',
  moderate: 'Accept reasonable variations and minor misspellings, but the core answer must be correct.',
  strict: 'Require precise, accurate responses with correct spelling of key terms.',
};

export async function validateAnswer(playerAnswer, correctAnswer, strictness = 'moderate') {
  const prompt = `You are a Jeopardy answer judge. Determine if the player's response is acceptable.

Correct Answer: "${correctAnswer}"
Player Response: "${playerAnswer}"

Rules:
- In Jeopardy, players must phrase their answer as a question (What is, Who is, etc.) - be lenient on this format requirement
- ${STRICTNESS[strictness] ?? STRICTNESS.moderate}

Respond with ONLY a valid JSON object:
{"isCorrect": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}`;

  const parsed = await ask(prompt);
  if (!parsed || typeof parsed !== 'object') throw new AppError(UNUSABLE, 502, 'AI_BAD_REPLY');
  return {
    isCorrect: Boolean(parsed.isCorrect),
    confidence: Number(parsed.confidence ?? 0),
    reason: String(parsed.reason ?? ''),
  };
}
