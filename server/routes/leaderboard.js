import { Router } from 'express';
import { getDatabase } from '../config/database.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// Get global leaderboard
router.get('/', optionalAuth, (req, res, next) => {
  try {
    const { type = 'all_time', limit = 100 } = req.query;
    const db = getDatabase();

    let dateFilter = '';
    switch (type) {
      case 'daily':
        dateFilter = "AND achieved_at >= datetime('now', '-1 day')";
        break;
      case 'weekly':
        dateFilter = "AND achieved_at >= datetime('now', '-7 days')";
        break;
      case 'monthly':
        dateFilter = "AND achieved_at >= datetime('now', '-30 days')";
        break;
      default:
        dateFilter = '';
    }

    const leaderboard = db.prepare(`
      SELECT
        h.id,
        h.score,
        h.genre,
        h.achieved_at,
        u.id as user_id,
        u.display_name,
        u.is_guest
      FROM highscores h
      JOIN users u ON h.user_id = u.id
      WHERE 1=1 ${dateFilter}
      ORDER BY h.score DESC
      LIMIT ?
    `).all(parseInt(limit, 10));

    // Add rank
    const rankedLeaderboard = leaderboard.map((entry, index) => ({
      rank: index + 1,
      userId: entry.user_id,
      displayName: entry.display_name,
      score: entry.score,
      genre: entry.genre,
      isGuest: Boolean(entry.is_guest),
      achievedAt: entry.achieved_at,
    }));

    // Get user's rank if authenticated
    let userRank = null;
    if (req.user) {
      const userBestScore = db.prepare(`
        SELECT score FROM highscores
        WHERE user_id = ? ${dateFilter}
        ORDER BY score DESC LIMIT 1
      `).get(req.user.userId);

      if (userBestScore) {
        const higherScores = db.prepare(`
          SELECT COUNT(*) as count FROM highscores
          WHERE score > ? ${dateFilter}
        `).get(userBestScore.score);

        userRank = {
          rank: higherScores.count + 1,
          score: userBestScore.score,
        };
      }
    }

    res.json({
      leaderboard: rankedLeaderboard,
      userRank,
      type,
    });
  } catch (error) {
    next(error);
  }
});

// Get leaderboard by genre
router.get('/genre/:genre', (req, res, next) => {
  try {
    const { genre } = req.params;
    const { limit = 50 } = req.query;
    const db = getDatabase();

    const leaderboard = db.prepare(`
      SELECT
        h.score,
        h.achieved_at,
        u.id as user_id,
        u.display_name
      FROM highscores h
      JOIN users u ON h.user_id = u.id
      WHERE LOWER(h.genre) = LOWER(?)
      ORDER BY h.score DESC
      LIMIT ?
    `).all(genre, parseInt(limit, 10));

    const rankedLeaderboard = leaderboard.map((entry, index) => ({
      rank: index + 1,
      userId: entry.user_id,
      displayName: entry.display_name,
      score: entry.score,
      achievedAt: entry.achieved_at,
    }));

    res.json({
      leaderboard: rankedLeaderboard,
      genre,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
