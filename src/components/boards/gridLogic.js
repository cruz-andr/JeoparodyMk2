/**
 * Where the selection is, and where a key sends it.
 *
 * Split out of BoardGridEditor because it is arithmetic, and arithmetic is
 * exactly the kind of thing that breaks without looking broken: an arrow key
 * that moves the wrong way, or a walk that skips a cell, looks fine in a
 * screenshot. Kept free of imports so it runs under plain node, like the rest
 * of this repo's logic tests.
 *
 * The selection has three kinds because the board has three kinds of thing on
 * it: the six category headers, the thirty clues, and Final Jeopardy, which is
 * one clue on a board of its own.
 *
 *   { kind: 'category', c }        a header
 *   { kind: 'clue', c, r }         a cell
 *   { kind: 'final', c }           the tile underneath
 *
 * `c` is carried on 'final' so that going back up returns to the column you
 * came down from, rather than dumping you at the left edge.
 */

export const POINTS = [200, 400, 600, 800, 1000];
export const CATEGORIES = 6;
export const ROWS = POINTS.length;
export const CLUES = CATEGORIES * ROWS;

/** A clue counts when both halves are there. The same rule as the server. */
export const isWritten = (question) => Boolean(
  question
  && typeof question.answer === 'string' && question.answer.trim()
  && typeof question.question === 'string' && question.question.trim()
);

export function countWritten(board) {
  let n = 0;
  for (const category of board?.categories ?? []) {
    for (const question of category?.questions ?? []) {
      if (isWritten(question)) n += 1;
    }
  }
  return n;
}

/** How much of Final Jeopardy is filled in: 'none', 'partial' or 'complete'. */
export function finalState(board) {
  const fj = board?.finalJeopardy;
  const parts = [fj?.category, fj?.answer, fj?.question].map((v) => Boolean(v && String(v).trim()));
  if (parts.every((p) => !p)) return 'none';
  return parts.every(Boolean) ? 'complete' : 'partial';
}

const clamp = (n, low, high) => Math.min(Math.max(n, low), high);

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Where an arrow key sends the selection, or null if the key is not one.
 *
 * The board is read as a column per category, so up and down walk a category
 * and left and right change which one. Off the top of the clues is the header;
 * off the bottom is Final Jeopardy. Off the sides is nothing, because there is
 * no seventh category and wrapping to the other end of the board is
 * disorienting in a grid you are looking at.
 */
export function moveSelection(at, key, { hasFinal = true } = {}) {
  const move = ARROWS[key];
  if (!move) return null;

  const [dc, dr] = move;
  const c = clamp((at.c ?? 0) + dc, 0, CATEGORIES - 1);

  if (at.kind === 'category') {
    return dr > 0 ? { kind: 'clue', c, r: 0 } : { kind: 'category', c };
  }

  if (at.kind === 'final') {
    /* Sideways on the final tile does nothing: it is one tile, and moving
       within it would only change which column you return to, invisibly. */
    if (dc !== 0) return { kind: 'final', c: at.c ?? 0 };
    return dr < 0 ? { kind: 'clue', c: at.c ?? 0, r: ROWS - 1 } : { kind: 'final', c: at.c ?? 0 };
  }

  const r = at.r + dr;
  if (r < 0) return { kind: 'category', c };
  if (r >= ROWS) return hasFinal ? { kind: 'final', c } : { kind: 'clue', c, r: ROWS - 1 };
  return { kind: 'clue', c, r };
}

/**
 * The next empty clue, walking the board the way it is read.
 *
 * Down the current category and on to the next, wrapping once, so it follows
 * the order somebody is writing in rather than jumping to whichever hole
 * happens to be first. Returns null when there are none left, which is what
 * disables the button rather than leaving it to do nothing.
 */
export function nextEmptyFrom(board, at) {
  const from = at.kind === 'clue' ? at.c * ROWS + at.r : (at.c ?? 0) * ROWS - 1;

  for (let step = 1; step <= CLUES; step += 1) {
    const flat = ((from + step) % CLUES + CLUES) % CLUES;
    const c = Math.floor(flat / ROWS);
    const r = flat % ROWS;
    if (!isWritten(board?.categories?.[c]?.questions?.[r])) {
      return { kind: 'clue', c, r };
    }
  }
  return null;
}

/** A blank clue, for clearing one without leaving media behind. */
export const emptyClue = () => ({
  answer: '',
  question: '',
  options: null,
  mediaType: null,
  mediaData: null,
  youtubeStart: null,
  youtubeEnd: null,
  audioOnly: false,
  altText: null,
});
