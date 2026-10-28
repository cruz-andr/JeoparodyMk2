/**
 * A community board, played in a private room.
 *
 * The server reads the board itself rather than taking a grid from the host's
 * page: the host cannot rewrite somebody else's clues on the way in, a host
 * who reloads still has the board, and its Final Jeopardy is waiting at the
 * end without the page having to carry it there.
 */
import { getDatabase } from '../config/database.js';
import { clueTarget, countClues, finalJeopardyState } from '../shared/boardFormat.js';

/**
 * A board a room may play: one its author has let other people play (public
 * or unlisted, the same as anyone with the link), and finished. A private
 * board is not lent to a room, because everyone in it would be sent the clues.
 */
export function findPlayableBoard(db, slug) {
  const row = db.prepare(`
    SELECT slug, title, data FROM boards
    WHERE slug = ? AND visibility IN ('public', 'unlisted')
  `).get(String(slug ?? ''));
  if (!row) return null;

  let board;
  try {
    board = JSON.parse(row.data);
  } catch {
    return null;
  }
  if (!Array.isArray(board?.categories) || countClues(board) < clueTarget(board)) return null;

  return {
    slug: row.slug,
    title: row.title,
    board,
    // Only a whole one. Half a Final is a clue with no answer at the end.
    finalJeopardy: finalJeopardyState(board) === 'complete' ? board.finalJeopardy : null,
  };
}

/** The room's grid, in the shape every board the game plays is in. */
export function roomGrid(board) {
  const categories = board.categories.map((c) => c.name);
  const questions = board.categories.map((category) =>
    category.questions.map((q) => ({
      category: category.name,
      points: q.points,
      answer: q.answer,
      question: q.question,
      options: q.options ?? null,
      revealed: false,
      mediaType: q.mediaType ?? null,
      mediaData: q.mediaData ?? null,
      youtubeStart: q.youtubeStart ?? null,
      youtubeEnd: q.youtubeEnd ?? null,
      audioOnly: Boolean(q.audioOnly),
      altText: q.altText ?? null,
    }))
  );
  return { categories, questions };
}

/** What the lobby shows of it: enough to know what is about to be played. */
export function boardSummary(found) {
  if (!found) return null;
  return {
    slug: found.slug,
    title: found.title,
    categories: found.board.categories.map((c) => c.name),
    hasFinal: Boolean(found.finalJeopardy),
  };
}

/** One room playing it is one play, however many people are in the room. */
export function countRoomPlay(db, slug) {
  db.prepare('UPDATE boards SET plays = plays + 1 WHERE slug = ?').run(slug);
}

/** The default, against the real database. Tests pass their own. */
export const roomBoards = {
  find: (slug) => findPlayableBoard(getDatabase(), slug),
  counted: (slug) => countRoomPlay(getDatabase(), slug),
};
