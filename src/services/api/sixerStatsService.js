/* How everyone did on the Sixer. A finished run is sent once, anonymously,
   and the day's spread comes back with it; see server/routes/daily.js. */

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

async function asJson(response) {
  if (!response.ok) throw new Error(`Sixer stats: ${response.status}`);
  return response.json();
}

/** Record a finished run. Answers with { recorded, score, stats }. */
export async function postSixerResult({ date, player, marks, values }) {
  return asJson(await fetch(`${SOCKET_URL}/api/daily/sixer/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, player, marks, values }),
  }));
}

/** The day's spread: { players, average, scores, clues }. */
export async function getSixerStats(date) {
  return asJson(await fetch(`${SOCKET_URL}/api/daily/sixer/stats?date=${encodeURIComponent(date)}`));
}
