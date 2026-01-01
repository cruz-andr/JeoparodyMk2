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

export async function generateQuestions(categories, pointValues) {
  const aiModel = getModel();

  const prompt = `You are a Jeopardy game assistant. Generate Jeopardy-style questions and answers for these categories: ${categories.join(', ')}.

For each category, create questions for point values: ${pointValues.join(', ')}.

IMPORTANT: In Jeopardy, the "answer" is shown to the player, and they respond with a question.
Example: If the answer is "This planet is known as the Red Planet", the correct question is "What is Mars?".

Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):
{
  "categories": [
    {
      "name": "CATEGORY_NAME",
      "questions": [
        {"points": 200, "answer": "THE_ANSWER_TEXT", "question": "What is...?"},
        {"points": 400, "answer": "THE_ANSWER_TEXT", "question": "What is...?"},
        {"points": 600, "answer": "THE_ANSWER_TEXT", "question": "What is...?"},
        {"points": 800, "answer": "THE_ANSWER_TEXT", "question": "What is...?"},
        {"points": 1000, "answer": "THE_ANSWER_TEXT", "question": "What is...?"}
      ]
    }
  ]
}

Make questions progressively harder as point values increase. Generate for all ${categories.length} categories.`;

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
