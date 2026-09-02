/**
 * The archive, over HTTP.
 *
 *   POST /api/games/finish     a single player game the browser just played
 *   GET  /api/games/history    my recent games, newest first
 *
 * Both need an account. A visitor with no token is refused with a 401 and the
 * client keeps its localStorage record, as it always has; a guest token (an
 * account that will be gone in a day) is refused too, because an archive
 * written to a disposable account is a promise the app cannot keep.
 *
 * Only single player games are accepted here. A room's result is written by
 * the socket layer from the server's own scores; taking it from the client as
 * well would count every game twice and let anyone post a score they never
 * earned.
 */
import { Router } from 'express';
import { getDatabase } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  historyRow, recordFinishedGame, validateFinish,
} from '../services/gameHistory.js';

const router = Router();

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

function requireAccount(req) {
  if (req.user?.isGuest) {
    throw new AppError('Sign in to keep a record of your games.', 403, 'GUEST');
  }
  return req.user.userId;
}

router.post('/finish', authenticateToken, (req, res, next) => {
  try {
    const userId = requireAccount(req);
    const { entry, error } = validateFinish(req.body);
    if (error) throw new AppError(error, 400, 'INVALID_GAME');
    if (entry.mode !== 'single') {
      throw new AppError('Only single player games are recorded this way.', 400, 'WRONG_MODE');
    }

    const db = getDatabase();
    const { id } = recordFinishedGame(db, { userId, ...entry });
    const row = db.prepare('SELECT * FROM game_history WHERE id = ?').get(id);
    res.status(201).json({ game: historyRow(row) });
  } catch (err) {
    next(err);
  }
});

router.get('/history', authenticateToken, (req, res, next) => {
  try {
    const userId = requireAccount(req);
    const asked = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;

    const rows = getDatabase().prepare(`
      SELECT * FROM game_history
      WHERE user_id = ?
      ORDER BY played_at DESC, rowid DESC
      LIMIT ?
    `).all(userId, limit);

    res.json({ games: rows.map(historyRow) });
  } catch (err) {
    next(err);
  }
});

export default router;
