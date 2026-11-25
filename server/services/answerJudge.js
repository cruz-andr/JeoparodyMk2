/**
 * The judge. Every typed response on the site that is graded for the player
 * is graded here, or by the same string matcher in the browser, which then
 * asks here about anything it marked wrong.
 *
 *   1. The letters (shared/answerMatch.js gradeAnswer): every form the
 *      board accepts, the question wrapper, typos in proportion. Instant.
 *   2. The model (services/judgeModel.js), only for a response the letters
 *      did not mark right: "Ali" for (Muhammad) Ali when the board did not
 *      bracket the first name, "JFK" for John F. Kennedy. It can turn a
 *      wrong into a right, never the reverse, and it is given `waitMs`.
 *      Slow, down, out of quota or switched off, the letters stand.
 *
 * A 'close' (a spelling slip the game asks again about) is the caller's to
 * handle first: the judge is asked only once the response would otherwise be
 * final and wrong.
 *
 * Every verdict the model gives is remembered, keyed by the clue, the correct
 * response and the typed one, all normalized. The daily games are the same
 * clues for everyone, so the second person to type "JFK" is answered from
 * memory, instantly and for free. A question already on its way to the model
 * is shared rather than asked twice, which is what lets a room start judging
 * an answer the moment it is typed (`judge([item])`, ignoring the result) and
 * find the verdict waiting when the clue closes.
 *
 * judge() never rejects.
 */
import { gradeAnswer, judgeableResponse, words } from '../shared/answerMatch.js';
import { modelFromEnv } from './judgeModel.js';

/* The longest anybody waits on the model. The bench's chosen model answered
   in about half a second and never took more than 0.7s, so this is room for a
   bad moment, not the usual case. */
export const JUDGE_WAIT_MS = 1500;
/* Verdicts remembered. A verdict is a few dozen bytes; this is a day of
   daily games and then some. */
export const CACHE_SIZE = 5000;

const keyOf = (item) => [item.clue, item.correct, item.response].map((t) => words(t).join(' ')).join('\u0000');

/**
 * secondOpinion(items) -> Promise<boolean[] | null>: the model, or null for
 * none. items are [{ category, clue, correct, response }].
 */
export function createAnswerJudge({
  secondOpinion = null,
  waitMs = JUDGE_WAIT_MS,
  cacheSize = CACHE_SIZE,
  setTimeout: schedule = setTimeout,
  clearTimeout: cancel = clearTimeout,
  log = () => {},
} = {}) {
  const remembered = new Map(); // key -> boolean, oldest first
  const inFlight = new Map(); // key -> Promise<boolean | null>
  const stats = { asked: 0, calls: 0, fromMemory: 0, shared: 0, unanswered: 0 };

  const byLetters = (item) => gradeAnswer(item.response, item.correct).isCorrect;

  /** Whether judge() would have to consult the model (or its memory) for this one. */
  const wouldAsk = (item) => Boolean(secondOpinion)
    && judgeableResponse(item.response) && !byLetters(item);

  function remember(key, verdict) {
    remembered.delete(key);
    remembered.set(key, verdict);
    if (remembered.size > cacheSize) remembered.delete(remembered.keys().next().value);
  }

  /* One batch to the model. Resolves to an array, or null if it was not back
     in time or went wrong; never rejects. */
  function ask(items) {
    stats.calls += 1;
    return new Promise((resolve) => {
      const timer = schedule(() => { log('answer judge: the model was too slow'); resolve(null); }, waitMs);
      Promise.resolve()
        .then(() => secondOpinion(items))
        .then(
          (verdicts) => { cancel(timer); resolve(Array.isArray(verdicts) ? verdicts : null); },
          (err) => { cancel(timer); log(`answer judge: ${err?.message ?? err}`); resolve(null); },
        );
    });
  }

  /** One boolean per item, in order. */
  async function judge(items) {
    const verdicts = items.map(byLetters);
    const waiting = []; // [index, Promise<boolean | null>]
    const fresh = new Map(); // key -> item, the ones nobody has asked about yet

    items.forEach((item, i) => {
      if (verdicts[i] || !wouldAsk(item)) return;
      stats.asked += 1;
      const key = keyOf(item);
      if (remembered.has(key)) {
        stats.fromMemory += 1;
        const verdict = remembered.get(key);
        remember(key, verdict); // most recently used
        verdicts[i] = verdict;
      } else if (inFlight.has(key)) {
        stats.shared += 1;
        waiting.push([i, inFlight.get(key)]);
      } else {
        if (fresh.has(key)) stats.shared += 1;
        else fresh.set(key, item);
        waiting.push([i, key]);
      }
    });

    const asking = new Map(); // key -> Promise<boolean | null>, this call's own
    if (fresh.size) {
      const keys = [...fresh.keys()];
      const batch = ask([...fresh.values()]);
      keys.forEach((key, k) => {
        const one = batch.then((said) => {
          inFlight.delete(key);
          const verdict = typeof said?.[k] === 'boolean' ? said[k] : null;
          /* Only an answer is remembered: a timeout is asked again next time. */
          if (verdict === null) stats.unanswered += 1;
          else remember(key, verdict);
          return verdict;
        });
        inFlight.set(key, one);
        asking.set(key, one);
      });
    }

    for (const [i, pending] of waiting) {
      const promise = typeof pending === 'string' ? asking.get(pending) : pending;
      if ((await promise) === true) verdicts[i] = true;
    }
    return verdicts;
  }

  return { judge, wouldAsk, byLetters, stats, remembered };
}

let shared = null;

/** The site's judge, made on first use so the environment is loaded by then. */
export function getAnswerJudge({ log } = {}) {
  shared ??= createAnswerJudge({
    /* The model's own request gives up a little before the judge does. */
    secondOpinion: modelFromEnv(process.env, { timeoutMs: JUDGE_WAIT_MS - 100 }),
    log,
  });
  return shared;
}
