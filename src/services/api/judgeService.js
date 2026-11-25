/**
 * Is a typed response right? The same judge as everywhere else on the site
 * (server/services/answerJudge.js), with the first half run here: the shared
 * string matcher settles a right answer on the spot, and only one it marked
 * wrong goes to the server, where the model may still rule it right.
 *
 * Never rejects. Offline, slow, rate limited or out of credit, the letters
 * stand, and the clue screen still offers "I was right".
 */
import { gradeAnswer, judgeableResponse } from '@shared/answerMatch.js';

const API = import.meta.env.VITE_SOCKET_URL || '';
/* The server gives the model 1.5 seconds (JUDGE_WAIT_MS); this is that and
   the round trip. The model usually answers in about half a second, and a
   response somebody else already typed is answered from the server's memory. */
const WAIT_MS = 2500;

export const rightByLetters = (response, correct) => gradeAnswer(response, correct).isCorrect;

/** Whether a wrong-by-the-letters response is worth a trip to the server. */
export const worthAsking = (response, correct) => judgeableResponse(response) && !rightByLetters(response, correct);

export async function judgeResponse({ category = '', clue = '', correct, response }) {
  if (rightByLetters(response, correct)) return true;
  if (!judgeableResponse(response)) return false;
  try {
    const res = await fetch(`${API}/api/judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ category, clue, correct, response }] }),
      signal: AbortSignal.timeout(WAIT_MS),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.verdicts?.[0] === true;
  } catch {
    return false;
  }
}
