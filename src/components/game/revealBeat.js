/**
 * The beat between submitting a typed response and the ruling, while the
 * form sits greyed out.
 *
 * Every response gets the same beat, whether the string matcher settled it
 * in a millisecond or the judge's model took half a second. A pause that only
 * came on the doubtful ones gave the ruling away before it landed: if it
 * hesitates, you were probably wrong. The beat covers the model on a normal
 * day (Groq measured 250 to 550ms) and stays well inside the second that
 * keeps a player's flow. When the judge is slower still, the form simply
 * stays greyed a little longer.
 */
export const REVEAL_BEAT_MS = 550;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The verdict, no sooner than the beat. */
export async function afterRevealBeat(verdict) {
  const [value] = await Promise.all([verdict, pause(REVEAL_BEAT_MS)]);
  return value;
}
