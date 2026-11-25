/**
 * The answer judge, over HTTP, for the pages that grade in the browser (the
 * Sixer and The Board). They settle what the shared string matcher can on the
 * spot and only ask here about what it marked wrong. Open to anyone, signed in
 * or not, because the daily games are; its budget is judgeLimiter.
 *
 * POST { items: [{ category, clue, correct, response }] } -> { verdicts: [bool] }
 */
import { Router } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { getAnswerJudge } from '../services/answerJudge.js';

/* A clue at a time, in practice. Room for a few, never a board's worth. */
const MAX_ITEMS = 6;
const MAX_TEXT = 1000;

const text = (value, field) => {
  const t = String(value ?? '').trim();
  if (t.length > MAX_TEXT) throw new AppError(`${field} is too long.`, 400, 'JUDGE_BAD_INPUT');
  return t;
};

export function createJudgeRouter({ judge = (items) => getAnswerJudge().judge(items) } = {}) {
  const router = Router();
  router.post('/', async (req, res, next) => {
    try {
      const raw = req.body?.items;
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ITEMS) {
        throw new AppError(`items must be a list of 1 to ${MAX_ITEMS}.`, 400, 'JUDGE_BAD_INPUT');
      }
      const items = raw.map((item) => ({
        category: text(item?.category, 'category'),
        clue: text(item?.clue, 'clue'),
        correct: text(item?.correct, 'correct'),
        response: text(item?.response, 'response'),
      }));
      if (items.some((i) => !i.correct)) throw new AppError('correct is required.', 400, 'JUDGE_BAD_INPUT');
      res.json({ verdicts: await judge(items) });
    } catch (err) {
      next(err);
    }
  });
  return router;
}

export default createJudgeRouter();
