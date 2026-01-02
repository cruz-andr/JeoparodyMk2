import { Router } from 'express';
import { getDatabase } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Get user stats
router.get('/:id/stats', authenticateToken, (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const stats = db.prepare(`
      SELECT * FROM user_stats WHERE user_id = ?
    `).get(id);

    if (!stats) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Calculate derived stats
    const totalAnswers = stats.correct_answers + stats.incorrect_answers;
    const accuracy = totalAnswers > 0
      ? Math.round((stats.correct_answers / totalAnswers) * 100)
      : 0;
    const winRate = stats.games_played > 0
      ? Math.round((stats.games_won / stats.games_played) * 100)
      : 0;
    const avgScore = stats.games_played > 0
      ? Math.round(stats.total_score / stats.games_played)
      : 0;

    res.json({
      gamesPlayed: stats.games_played,
      gamesWon: stats.games_won,
      winRate,
      totalScore: stats.total_score,
      highestScore: stats.highest_score,
      avgScore,
      correctAnswers: stats.correct_answers,
      incorrectAnswers: stats.incorrect_answers,
      accuracy,
    });
  } catch (error) {
    next(error);
  }
});

// Get user profile
router.get('/:id/profile', authenticateToken, (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const user = db.prepare(`
      SELECT id, username, display_name, is_guest, created_at
      FROM users WHERE id = ?
    `).get(id);

    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(id);

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      isGuest: Boolean(user.is_guest),
      createdAt: user.created_at,
      stats: stats || null,
    });
  } catch (error) {
    next(error);
  }
});

// Update user profile
router.patch('/:id', authenticateToken, (req, res, next) => {
  try {
    const { id } = req.params;

    // Only allow users to update their own profile
    if (req.user.userId !== id) {
      throw new AppError('Not authorized', 403, 'NOT_AUTHORIZED');
    }

    const { displayName, username } = req.body;
    const db = getDatabase();

    const updates = [];
    const params = [];

    if (displayName) {
      updates.push('display_name = ?');
      params.push(displayName);
    }

    if (username) {
      // Check if username is taken
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
      if (existing) {
        throw new AppError('Username already taken', 409, 'USERNAME_EXISTS');
      }
      updates.push('username = ?');
      params.push(username);
    }

    if (updates.length === 0) {
      throw new AppError('No valid fields to update', 400, 'INVALID_INPUT');
    }

    params.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const user = db.prepare('SELECT id, username, display_name, email FROM users WHERE id = ?').get(id);

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
