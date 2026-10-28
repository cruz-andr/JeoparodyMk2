/**
 * One rule for a typed response, wherever one is typed: The Board, solo play,
 * and (on the server) a room.
 *
 * A response the grader calls close gets one more go at the spelling, once a
 * clue, without being told the answer; after that close is wrong. Everything
 * else is right or wrong as graded. The grader is passed in rather than
 * imported, so this stays a plain function a test can run without a bundler
 * to resolve the @shared alias.
 */
export const CLOSE_NOTE = 'Close. Check the spelling and try again.';

/**
 * @param grade      gradeAnswer from server/shared/answerMatch.js
 * @param given      what the player typed
 * @param response   the correct response
 * @param closeUsed  whether this clue's free retry has already been spent
 * @returns { retry: true } to ask for the spelling again, or { correct }
 */
export function judgeTyped(grade, given, response, { closeUsed = false } = {}) {
  const { verdict } = grade(given, response);
  if (verdict === 'close' && !closeUsed) return { retry: true };
  return { correct: verdict === 'correct' };
}
