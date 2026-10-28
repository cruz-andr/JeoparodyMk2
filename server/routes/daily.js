/**
 * How everyone did on the Sixer, over HTTP.
 *
 *   POST /api/daily/sixer/result   a finished run, recorded anonymously;
 *                                  answers with the day's spread
 *   GET  /api/daily/sixer/stats    the day's spread
 *
 * No account needed: the Sixer is played without one. See services/sixerResults.js.
 */
import { Router } from 'express';
import { getDatabase } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { isValidDateString } from '../shared/archiveWindow.js';
import { recordSixerResult, sixerStats, validateSixerResult } from '../services/sixerResults.js';

const router = Router();

router.post('/sixer/result', writeLimiter, (req, res, next) => {
  try {
    const { entry, error } = validateSixerResult(req.body);
    if (error) throw new AppError(error, 400, 'INVALID_RESULT');
    const db = getDatabase();
    const { recorded } = recordSixerResult(db, entry);
    res.status(201).json({ recorded, score: entry.score, stats: sixerStats(db, entry.date) });
  } catch (err) {
    next(err);
  }
});

router.get('/sixer/stats', (req, res, next) => {
  try {
    const { date } = req.query;
    if (!isValidDateString(date)) throw new AppError('Expected a date as YYYY-MM-DD.', 400, 'INVALID_DATE');
    res.json(sixerStats(getDatabase(), date));
  } catch (err) {
    next(err);
  }
});

export default router;
