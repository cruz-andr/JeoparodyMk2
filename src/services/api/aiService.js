import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

let genAI = null;
let model = null;

function getModel() {
  if (!model) {
    if (!API_KEY) {
      throw new Error('VITE_GEMINI_API_KEY is not set in environment variables');
    }
    genAI = new GoogleGenerativeAI(API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  }
  return model;
}

export async function generateCategories(genre) {
  const aiModel = getModel();

  const prompt = `You are a Jeopardy game assistant. Generate 6 unique, diverse, and interesting Jeopardy categories related to the genre: ${genre}.

Return ONLY a valid JSON array of 6 strings, with no additional text, markdown, or explanation. Example format:
["CATEGORY 1", "CATEGORY 2", "CATEGORY 3", "CATEGORY 4", "CATEGORY 5", "CATEGORY 6"]`;

  const result = await aiModel.generateContent(prompt);
  const response = await result.response;
  const text = response.text().trim();

  // Extract JSON from response (handle potential markdown code blocks)
  let jsonStr = text;
  if (text.includes('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  return JSON.parse(jsonStr);
}

export async function generateQuestions(categories, pointValues, round = 1) {
  const aiModel = getModel();

  const difficultyNote = round === 2
    ? 'This is Double Jeopardy - make all questions significantly harder and more detailed than a regular round.'
    : 'Scale difficulty appropriately with point values - $200 questions should be easy, $1000 questions should be challenging.';

  const prompt = `You are a Jeopardy game assistant. Generate Jeopardy-style questions and answers for these categories: ${categories.join(', ')}.

For each category, create questions for point values: ${pointValues.join(', ')}.

${difficultyNote}

IMPORTANT: In Jeopardy, the "answer" is shown to the player (as a clue), and they respond with a question.
Example: If the answer/clue is "This planet is known as the Red Planet", the correct question is "What is Mars?".

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

Generate for all ${categories.length} categories with progressively harder questions.`;

  const result = await aiModel.generateContent(prompt);
  const response = await result.response;
  const text = response.text().trim();

  // Extract JSON from response (handle potential markdown code blocks)
  let jsonStr = text;
  if (text.includes('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  return JSON.parse(jsonStr);
}

export async function generateFinalJeopardyQuestion(genre) {
  const aiModel = getModel();

  const prompt = `You are a Jeopardy game assistant. Generate a Final Jeopardy question related to the genre: ${genre}.

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

  const result = await aiModel.generateContent(prompt);
  const response = await result.response;
  const text = response.text().trim();

  let jsonStr = text;
  if (text.includes('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  return JSON.parse(jsonStr);
}

// Generate multiple choice options (3 incorrect + 1 correct)
export async function generateMCOptions(correctAnswer, category, clue) {
  const aiModel = getModel();

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

  try {
    const result = await aiModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    let jsonStr = text;
    if (text.includes('```')) {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Correct answer must be first (index 0) - server expects this
    const allOptions = [correctAnswer, ...parsed.options.slice(0, 3)];

    return {
      options: allOptions,
    };
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
  const aiModel = getModel();

  const strictnessGuidelines = {
    lenient: 'Accept partial answers, common misspellings, and close approximations.',
    moderate: 'Accept reasonable variations and minor misspellings, but the core answer must be correct.',
    strict: 'Require precise, accurate responses with correct spelling of key terms.',
  };

  const prompt = `You are a Jeopardy answer judge. Determine if the player's response is acceptable.

Correct Answer: "${correctAnswer}"
Player Response: "${playerAnswer}"

Rules:
- In Jeopardy, players must phrase their answer as a question (What is, Who is, etc.) - be lenient on this format requirement
- ${strictnessGuidelines[strictness]}

Respond with ONLY a valid JSON object:
{"isCorrect": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}`;

  try {
    const result = await aiModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    let jsonStr = text;
    if (text.includes('```')) {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
    }

    return JSON.parse(jsonStr);
  } catch (error) {
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
