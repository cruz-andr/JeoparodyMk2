/**
 * Builds the two daily formats out of one scraped J-Archive game.
 *
 *   The Board  - the full Jeopardy round, 6 categories x 5 clues.
 *   The Sixer  - one clue from each Double Jeopardy category.
 *
 * They come from different rounds on purpose, so neither spoils the other:
 * playing the Sixer must not hand you any of the Board's clues or categories.
 *
 * Pure and side-effect free so it can be tested without touching the network.
 *
 * NAMING, WHICH IS A TRAP: the scraper calls the text shown to the player
 * `clue` and the correct response `answer`. The game components use the show's
 * convention, where `answer` is what is displayed and `question` is the correct
 * response. Board questions are emitted in the component convention; Sixer
 * questions keep the scraper convention that DailyPage already reads.
 */

export const BOARD_CATEGORIES = 6;
export const BOARD_ROWS = 5;
export const SIXER_CLUES = 6;

/** Row values are normalised so older episodes still look like a modern board. */
export const ROW_VALUES = [200, 400, 600, 800, 1000];

const isUsable = (c) => Boolean(c && c.clue && c.answer);

/**
 * J-Archive emits clues row-major: row 1 across all six categories, then row 2.
 * Re-orders to category-major so a column is contiguous.
 */
export function orderCategoryMajor(clues, { categories = BOARD_CATEGORIES, rows = BOARD_ROWS } = {}) {
  const out = [];
  for (let c = 0; c < categories; c++) {
    for (let r = 0; r < rows; r++) {
      out.push(clues[r * categories + c]);
    }
  }
  return out;
}

/** Build the 6x5 board from one round. Returns null unless it is complete. */
export function buildBoard(roundClues) {
  const needed = BOARD_CATEGORIES * BOARD_ROWS;
  if (!Array.isArray(roundClues) || roundClues.length < needed) return null;

  const grid = roundClues.slice(0, needed);
  if (!grid.every(isUsable)) return null;

  const categories = [];
  for (let c = 0; c < BOARD_CATEGORIES; c++) {
    const name = grid[c]?.category;
    if (!name) return null;
    categories.push(String(name).toUpperCase());
  }

  const ordered = orderCategoryMajor(grid);
  if (ordered.some((c) => !isUsable(c))) return null;

  const questions = ordered.map((clue, i) => ({
    category: String(clue.category).toUpperCase(),
    // component convention: `answer` is shown, `question` is the response
    answer: clue.clue,
    question: clue.answer,
    points: ROW_VALUES[i % BOARD_ROWS],
    revealed: false,
  }));

  return { categories, questions };
}

/**
 * One clue from each category of the other round, chosen deterministically so
 * every player worldwide gets the same six.
 */
export function buildSixer(roundClues, seed = 0) {
  if (!Array.isArray(roundClues)) return null;

  const byCategory = new Map();
  for (const clue of roundClues) {
    if (!isUsable(clue)) continue;
    const key = String(clue.category);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(clue);
  }

  const picked = [];
  for (const [, clues] of byCategory) {
    if (picked.length >= SIXER_CLUES) break;
    picked.push(clues[(seed + picked.length) % clues.length]);
  }

  // Not enough distinct categories: top up from whatever is left over.
  if (picked.length < SIXER_CLUES) {
    for (const clue of roundClues) {
      if (picked.length >= SIXER_CLUES) break;
      if (isUsable(clue) && !picked.includes(clue)) picked.push(clue);
    }
  }

  if (picked.length < SIXER_CLUES) return null;

  return {
    questions: picked.slice(0, SIXER_CLUES).map((clue) => ({
      category: String(clue.category).toUpperCase(),
      // scraper convention, which DailyPage already reads
      clue: clue.clue,
      answer: clue.answer,
      value: clue.value,
    })),
  };
}

/**
 * Assemble both formats from a scraped game.
 * Returns null when the game cannot produce a complete pair, so the caller can
 * move on to another game rather than serving a half board.
 */
export function buildDailyChallenge(gameClues, { seed = 0, date, gameId } = {}) {
  if (!Array.isArray(gameClues)) return null;

  const jeopardy = gameClues.filter((c) => c.round === 'jeopardy');
  const doubleJeopardy = gameClues.filter((c) => c.round === 'double_jeopardy');

  const board = buildBoard(jeopardy);
  if (!board) return null;

  // The Sixer comes from the round the Board did not use.
  const sixer = buildSixer(doubleJeopardy, seed);
  if (!sixer) return null;

  return { date, seed, gameId, board, sixer };
}
