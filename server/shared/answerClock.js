/**
 * How long a player has to answer, shared by the server that runs the clock
 * and the page that draws it, so the two cannot disagree about when it ends.
 */

/* A private room types its response, and seven seconds is a time for saying
   an answer, not typing one: it gets at least quickplay's twelve. */
export const TYPING_ANSWER_MS = 12000;

/* A Daily Double's clue is read before it is answered, so its clock is the
   reading as well as the typing. */
export const DAILY_DOUBLE_READ_MS = 10000;

/** The answer window for a room of this type, given its setting. */
export function answerWindowFor(roomType, settingMs) {
  return roomType === 'multiplayer' ? Math.max(settingMs, TYPING_ANSWER_MS) : settingMs;
}
