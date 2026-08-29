import * as cheerio from 'cheerio';
import { buildDailyChallenge } from './dailyBuilder.js';

const JARCHIVE_BASE = 'https://www.j-archive.com';

// Generate a daily seed from the date (same for everyone worldwide)
export function getDailySeed() {
  const today = new Date();
  return (
    today.getUTCFullYear() * 10000 +
    (today.getUTCMonth() + 1) * 100 +
    today.getUTCDate()
  );
}

// Get today's date string in YYYY-MM-DD format
export function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

// Fetch a game by its ID
export async function fetchGameById(gameId) {
  const url = `${JARCHIVE_BASE}/showgame.php?game_id=${gameId}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch game ${gameId}`);
  }

  const html = await response.text();
  return parseGamePage(html, gameId);
}

// Parse the game page HTML to extract clues
function parseGamePage(html, gameId) {
  const $ = cheerio.load(html);

  const categories = [];
  const clues = [];

  // Get Jeopardy round categories
  $('#jeopardy_round .category_name').each((i, el) => {
    categories.push($(el).text().trim());
  });

  // Get Jeopardy round clues
  $('#jeopardy_round .clue').each((i, el) => {
    const $clue = $(el);
    // Filter out response elements (IDs ending in _r) - they also have class clue_text
    const $clueText = $clue.find('.clue_text').filter(function() {
      const id = $(this).attr('id') || '';
      return !id.endsWith('_r');
    }).first();

    if ($clueText.length === 0) return;

    // Get clue ID to find the correct response
    const clueId = $clueText.attr('id');
    if (!clueId) return;

    // The clue element contains only the clue text (response is in separate _r element)
    const clueText = $clueText.text().trim();
    if (!clueText) return;

    // Find the corresponding answer
    // Answers are in elements with id like "clue_J_1_1_r" (clue response)
    const responseId = clueId + '_r';
    const $response = $(`#${responseId}`);

    let answer = '';
    if ($response.length > 0) {
      // Answer is in <em class="correct_response">
      answer = $response.find('.correct_response').text().trim();
    }

    // If answer not found in response element, try finding it in the toggle
    if (!answer) {
      const $toggle = $clue.find('[onmouseover]');
      if ($toggle.length > 0) {
        const mouseover = $toggle.attr('onmouseover') || '';
        // Extract answer from the toggle script
        const match = mouseover.match(/correct_response[^>]*>([^<]+)</);
        if (match) {
          answer = match[1].trim();
        }
      }
    }

    // Get the value from the clue header
    const $valueEl = $clue.find('.clue_value, .clue_value_daily_double');
    let value = 200;
    if ($valueEl.length > 0) {
      const valueText = $valueEl.text().replace(/[$,DD:\s]/g, '');
      value = parseInt(valueText, 10) || 200;
    }

    // Determine category index based on clue position
    const categoryIndex = i % 6;

    if (clueText && categoryIndex < categories.length) {
      clues.push({
        category: categories[categoryIndex] || 'UNKNOWN',
        clue: clueText,
        answer: cleanAnswer(answer),
        value,
        round: 'jeopardy',
      });
    }
  });

  // Also try to get Double Jeopardy clues
  const djCategories = [];
  $('#double_jeopardy_round .category_name').each((i, el) => {
    djCategories.push($(el).text().trim());
  });

  $('#double_jeopardy_round .clue').each((i, el) => {
    const $clue = $(el);
    // Filter out response elements (IDs ending in _r) - they also have class clue_text
    const $clueText = $clue.find('.clue_text').filter(function() {
      const id = $(this).attr('id') || '';
      return !id.endsWith('_r');
    }).first();

    if ($clueText.length === 0) return;

    const clueId = $clueText.attr('id');
    if (!clueId) return;

    // The clue element contains only the clue text (response is in separate _r element)
    const clueText = $clueText.text().trim();
    if (!clueText) return;

    const responseId = clueId + '_r';
    const $response = $(`#${responseId}`);

    let answer = '';
    if ($response.length > 0) {
      answer = $response.find('.correct_response').text().trim();
    }

    if (!answer) {
      const $toggle = $clue.find('[onmouseover]');
      if ($toggle.length > 0) {
        const mouseover = $toggle.attr('onmouseover') || '';
        const match = mouseover.match(/correct_response[^>]*>([^<]+)</);
        if (match) {
          answer = match[1].trim();
        }
      }
    }

    const $valueEl = $clue.find('.clue_value, .clue_value_daily_double');
    let value = 400;
    if ($valueEl.length > 0) {
      const valueText = $valueEl.text().replace(/[$,DD:\s]/g, '');
      value = parseInt(valueText, 10) || 400;
    }

    const categoryIndex = i % 6;

    if (clueText && categoryIndex < djCategories.length) {
      clues.push({
        category: djCategories[categoryIndex] || 'UNKNOWN',
        clue: clueText,
        answer: cleanAnswer(answer),
        value,
        round: 'double_jeopardy',
      });
    }
  });

  return {
    gameId,
    categories: [...categories, ...djCategories],
    clues,
  };
}

// Clean answer text
function cleanAnswer(answer) {
  if (!answer) return '';
  return answer
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\/g, '')
    .replace(/^(a |an |the )/i, '') // Remove leading articles for matching
    .trim();
}

// How many J-Archive games to try before giving up. Many ids in the range are
// missing or non-standard, and a game that cannot produce a complete pair is
// skipped rather than served short.
const CANDIDATE_ATTEMPTS = 6;

// A deterministic spread of game ids for a given day. The stride is coprime
// with the range so the candidates never repeat within an attempt.
export function candidateGameIds(seed, attempts = CANDIDATE_ATTEMPTS) {
  const ids = [];
  for (let i = 0; i < attempts; i++) {
    ids.push(((seed + i * 977) % 8000) + 1000);
  }
  return ids;
}

// Get a deterministic pair of boards for today's daily challenge
export async function getDailyChallenge() {
  const seed = getDailySeed();
  const dateString = getTodayDateString();
  const problems = [];

  for (const gameId of candidateGameIds(seed)) {
    try {
      const gameData = await fetchGameById(gameId);
      const challenge = buildDailyChallenge(gameData.clues, {
        seed,
        date: dateString,
        gameId,
      });

      if (challenge) return challenge;
      problems.push(`${gameId}: incomplete rounds`);
    } catch (error) {
      problems.push(`${gameId}: ${error.message}`);
    }
  }

  // Returning a short or empty board would be cached by the client for the
  // rest of the day, so fail loudly instead.
  throw new Error(`Could not build a daily challenge. Tried ${problems.join('; ')}`);
}
