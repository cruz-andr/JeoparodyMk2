/**
 * Tidying what the model sends back.
 *
 * All of this runs on the text that already arrived. Nothing here asks the
 * model anything, so it costs no tokens and cannot fail on its own.
 *
 * Pure and import-free so it can be tested with plain node.
 */

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
