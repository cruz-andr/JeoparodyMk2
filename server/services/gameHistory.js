/**
 * The archive: what gets written when a game ends.
 *
 * Two tables, one write. game_history is the list a person reads back, and
 * user_stats is the running totals on top of it. They are updated together in
 * one transaction so the totals can never disagree with the rows they are
 * supposed to summarise.
 *
 * Single player games arrive over HTTP from the results screen, because the
 * whole game is played in the browser and the server never saw it. Socket
 * games are written by the server itself from the room it was running: the
 * scores are the server's, so nobody can post themselves a better one.
 */
import { v4 as uuidv4 } from 'uuid';

export const MODES = ['single', 'multiplayer', 'quickplay', 'host'];
export const MAX_CATEGORIES = 12;
export const MAX_CATEGORY_LENGTH = 80;
export const MAX_GENRE_LENGTH = 120;
/* Every clue on both boards plus a final, so nothing legitimate is refused. */
export const MAX_TOTAL = 61;

const isInt = (n) => Number.isInteger(n);

/**
 * Check a finished game as the client describes it. Returns the cleaned entry
 * or a sentence saying what was wrong with it. Pure, so it is testable without
 * a database.
 */
export function validateFinish(body) {
  if (!body || typeof body !== 'object') return { error: 'Send the game as JSON.' };
  const { mode, score, correct, total, categories, boardSlug, genre } = body;

  if (!MODES.includes(mode)) return { error: 'That is not a game mode.' };
  if (!isInt(score) || Math.abs(score) > 10_000_000) return { error: 'The score must be a whole number.' };
  if (!isInt(correct) || !isInt(total) || correct < 0 || total < 0) {
    return { error: 'Correct and total must be whole numbers.' };
  }
  if (correct > total) return { error: 'Correct cannot exceed total.' };
  if (total > MAX_TOTAL) return { error: 'That is more clues than a game has.' };

  let names = [];
  if (categories !== undefined && categories !== null) {
    if (!Array.isArray(categories)) return { error: 'Categories must be a list of names.' };
    names = categories
      .map((c) => (typeof c === 'string' ? c : c?.name))
      .filter((c) => typeof c === 'string' && c.trim())
      .map((c) => c.trim().slice(0, MAX_CATEGORY_LENGTH))
      .slice(0, MAX_CATEGORIES);
  }

  if (boardSlug !== undefined && boardSlug !== null && typeof boardSlug !== 'string') {
    return { error: 'The board slug must be text.' };
  }
  if (genre !== undefined && genre !== null && typeof genre !== 'string') {
    return { error: 'The genre must be text.' };
  }

  return {
    entry: {
      mode,
      score,
      correct,
      total,
      categories: names,
      boardSlug: boardSlug ? boardSlug.slice(0, 64) : null,
      genre: genre && genre.trim() ? genre.trim().slice(0, MAX_GENRE_LENGTH) : null,
    },
  };
}

/**
 * Write one person's result in one game.
 *
 * `won` defaults to true for a single player game, which is the convention the
 * local stats have always used: there is nobody to lose to. For a room the
 * caller says.
 */
export function recordFinishedGame(db, {
  userId, mode, score, correct, total, categories = [], boardSlug = null,
  genre = null, roomId = null, finalScores = null, winnerId = null, won = true,
}) {
  const id = uuidv4();
  const insertHistory = db.prepare(`
    INSERT INTO game_history
      (id, user_id, mode, score, correct, total, categories, board_slug,
       genre, room_id, final_scores, winner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  /* highest_score only ever rises, which is the one thing a "best" must do.
     games_won counts the games this person finished on top of, and for a solo
     game that is every game, as it has always been locally. */
  const bumpStats = db.prepare(`
    INSERT INTO user_stats
      (user_id, games_played, games_won, total_score, highest_score,
       correct_answers, incorrect_answers, updated_at, last_played_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      games_played = games_played + 1,
      games_won = games_won + excluded.games_won,
      total_score = total_score + excluded.total_score,
      highest_score = MAX(highest_score, excluded.highest_score),
      correct_answers = correct_answers + excluded.correct_answers,
      incorrect_answers = incorrect_answers + excluded.incorrect_answers,
      updated_at = datetime('now'),
      last_played_at = datetime('now')
  `);

  db.transaction(() => {
    insertHistory.run(
      id, userId, mode, score, correct, total,
      JSON.stringify(categories), boardSlug, genre, roomId,
      finalScores ? JSON.stringify(finalScores) : null, winnerId
    );
    bumpStats.run(userId, won ? 1 : 0, score, score, correct, total - correct);
  })();

  return { id };
}

/**
 * Write a finished room for everyone in it who is signed in.
 *
 * Called from the socket layer at the moment the standings are shown. Marks
 * the room so a second game:end, which the client can send twice on the way
 * to the results screen, does not write the archive twice.
 *
 * The host of a hosted room is running the game, not playing it, and has no
 * score to record. In a multiplayer room the host is a player like any other.
 */
export function recordRoomGame(db, room) {
  if (!room || room.historyRecorded) return [];
  room.historyRecorded = true;

  const players = Array.from(room.players.values())
    .filter((p) => !(room.type === 'host' && p.id === room.hostId));
  if (players.length === 0) return [];

  const standings = players
    .map((p) => ({ id: p.id, name: p.displayName || p.name || '', score: p.score || 0 }))
    .sort((a, b) => b.score - a.score);
  const top = standings[0].score;
  const winner = players.find((p) => (p.score || 0) === top && p.userId);

  const categories = (room.gameState?.categories || [])
    .map((c) => (typeof c === 'string' ? c : c?.name))
    .filter(Boolean)
    .slice(0, MAX_CATEGORIES);

  /* Socket rooms live in memory and are only sometimes written to the rooms
     table (the HTTP route does, room:create does not). The column is a
     foreign key and foreign keys are enforced, so pointing at a room that
     was never written would refuse the whole game. */
  const roomId = room.id && db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(room.id)
    ? room.id
    : null;

  const written = [];
  for (const p of players) {
    if (!p.userId) continue;
    const total = p.answered || 0;
    const { id } = recordFinishedGame(db, {
      userId: p.userId,
      mode: room.type,
      score: p.score || 0,
      correct: Math.min(p.correct || 0, total),
      total,
      categories,
      genre: room.gameState?.genre || null,
      roomId,
      finalScores: standings,
      winnerId: winner?.userId || null,
      /* On top, or tied for it. A game two people drew is not a game either
         of them lost. */
      won: (p.score || 0) === top,
    });
    written.push({ userId: p.userId, id });
  }
  return written;
}

/** The row as the client sees it. */
export function historyRow(row) {
  let categories = [];
  try { categories = JSON.parse(row.categories || '[]'); } catch { /* an old row */ }
  return {
    id: row.id,
    mode: row.mode,
    score: row.score,
    correct: row.correct,
    total: row.total,
    categories: Array.isArray(categories) ? categories : [],
    genre: row.genre,
    boardSlug: row.board_slug,
    playedAt: row.played_at,
  };
}

/** The totals as the client sees them, with the derived numbers worked out. */
export function statsRow(stats) {
  if (!stats) {
    return {
      gamesPlayed: 0, gamesWon: 0, totalScore: 0, bestScore: 0, avgScore: 0,
      correct: 0, total: 0, accuracy: 0, lastPlayedAt: null,
    };
  }
  const total = stats.correct_answers + stats.incorrect_answers;
  return {
    gamesPlayed: stats.games_played,
    gamesWon: stats.games_won,
    totalScore: stats.total_score,
    bestScore: stats.highest_score,
    avgScore: stats.games_played > 0 ? Math.round(stats.total_score / stats.games_played) : 0,
    correct: stats.correct_answers,
    total,
    accuracy: total > 0 ? Math.round((stats.correct_answers / total) * 100) : 0,
    lastPlayedAt: stats.last_played_at || null,
  };
}
