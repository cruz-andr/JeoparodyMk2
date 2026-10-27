/**
 * Wager rules for the single-player screens, as on the show.
 *
 * The server has its own copy for rooms (clampDailyDoubleWager and
 * submitFJWager in GameStateManager.js); these are the client's, kept apart
 * from the components so they can be tested without a browser.
 */

const whole = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : 0;
};

/** Final Jeopardy is for players with more than $0. */
export const canPlayFinalJeopardy = (score) => score > 0;

/** You can wager anything from $0 up to your score. */
export const finalWagerLimit = (score) => Math.max(whole(score), 0);
export const clampFinalWager = (wager, score) =>
  Math.min(Math.max(whole(wager), 0), finalWagerLimit(score));

/** At least $5, at most the greater of your score and the round's top value. */
export const dailyDoubleLimit = (score, round) =>
  Math.max(whole(score), round === 1 ? 1000 : 2000, 5);
export const clampDailyDoubleWager = (wager, limit) =>
  Math.min(Math.max(whole(wager), 5), limit);

/**
 * What a wager box holds while it is being typed into: digits only, otherwise
 * as typed. Clamping on every keystroke turned the first digit of "300" into
 * the $5 minimum, so the box read 500. Limits apply when the wager is locked.
 */
export const wagerEntry = (text) => String(text ?? '').replace(/\D/g, '');
