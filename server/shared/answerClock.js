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

/* A clip is part of its clue, so nobody rings in on it, and no clock runs,
   until it has played: its length, and a moment for it to load. Capped, so
   a long clip cannot hold a room for minutes. A clip with no end set is of
   no known length, and waits for nothing. */
export const CLIP_LOAD_MS = 1500;
export const CLIP_WAIT_CAP_MS = 30000;

export function clipWaitMs(clue) {
  if (clue?.mediaType !== 'youtube' || !clue.mediaData) return 0;
  if (clue.youtubeStart == null || clue.youtubeEnd == null) return 0;
  const ms = (clue.youtubeEnd - clue.youtubeStart) * 1000 + CLIP_LOAD_MS;
  return Math.min(Math.max(ms, 0), CLIP_WAIT_CAP_MS);
}
