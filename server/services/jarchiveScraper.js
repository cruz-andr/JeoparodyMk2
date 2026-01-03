import * as cheerio from 'cheerio';

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

// Get a deterministic game for today's daily challenge
export async function getDailyChallenge() {
  const seed = getDailySeed();
  const dateString = getTodayDateString();

  // Use seed to pick a game ID (games range roughly from 1 to 9000+)
  // We'll use a subset of known good game IDs
  const gameId = (seed % 8000) + 1000; // Games 1000-9000

  try {
    const gameData = await fetchGameById(gameId);

    // Filter to only clues that have both clue text and answer
    const validClues = gameData.clues.filter(c => c.clue && c.answer);

    if (validClues.length < 6) {
      throw new Error('Not enough valid clues in this game');
    }

    // Pick 6 clues deterministically (one per category if possible)
    const selectedClues = [];
    const usedCategories = new Set();

    // First, try to get one clue per unique category
    for (const clue of validClues) {
      if (!usedCategories.has(clue.category) && selectedClues.length < 6) {
        selectedClues.push(clue);
        usedCategories.add(clue.category);
      }
    }

    // If we don't have 6 yet, add more from any category
    for (const clue of validClues) {
      if (selectedClues.length >= 6) break;
      if (!selectedClues.includes(clue)) {
        selectedClues.push(clue);
      }
    }

    // Shuffle deterministically using the seed
    const shuffled = selectedClues.sort((a, b) => {
      const hashA = (seed + a.clue.length) % 100;
      const hashB = (seed + b.clue.length) % 100;
      return hashA - hashB;
    });

    return {
      date: dateString,
      seed,
      gameId,
      questions: shuffled.slice(0, 6).map(clue => ({
        category: clue.category.toUpperCase(),
        clue: clue.clue,
        answer: clue.answer,
        value: clue.value,
      })),
    };
  } catch (error) {
    console.error(`Failed to fetch game ${gameId}:`, error);

    // Try a fallback game ID
    const fallbackId = ((seed + 500) % 8000) + 1000;
    try {
      const gameData = await fetchGameById(fallbackId);
      const validClues = gameData.clues.filter(c => c.clue && c.answer);

      return {
        date: dateString,
        seed,
        gameId: fallbackId,
        questions: validClues.slice(0, 6).map(clue => ({
          category: clue.category.toUpperCase(),
          clue: clue.clue,
          answer: clue.answer,
          value: clue.value,
        })),
      };
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      throw new Error('Failed to fetch daily challenge from J-Archive');
    }
  }
}
