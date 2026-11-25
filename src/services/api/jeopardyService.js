// J-Archive integration for Daily Jeopardy
// Backend handles scraping, this just calls the API

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

// Get today's date string in YYYY-MM-DD format
export function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

// Fetch daily challenge from our backend (which scrapes J-Archive)
export async function getDailyChallenge() {
  if (!SOCKET_URL) {
    throw new Error('Backend server URL not configured. Set VITE_SOCKET_URL in .env');
  }

  const response = await fetch(`${SOCKET_URL}/api/daily/challenge`);

  if (!response.ok) {
    throw new Error('Failed to fetch daily challenge');
  }

  return response.json();
}

// Cache key for localStorage. Bumped when the payload shape changed to carry
// both formats, so a cached single-format challenge is never read back.
const CACHE_KEY = 'jeoparody-daily-cache-v2';

// Get cached challenge if available and still valid for today
export function getCachedChallenge() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const data = JSON.parse(cached);
    const todayDate = getTodayDateString();

    // Return cached data only if it's from today and actually usable
    if (data.date === todayDate && isCompleteChallenge(data)) {
      return data;
    }

    return null;
  } catch {
    return null;
  }
}

// Cache the challenge for today. A challenge missing either format is never
// cached: an incomplete one would then be served for the rest of the day.
export function cacheChallenge(challenge) {
  if (!isCompleteChallenge(challenge)) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(challenge));
  } catch {
    // Ignore cache errors
  }
}

// A challenge is only usable with both formats present and correctly sized.
export function isCompleteChallenge(challenge) {
  return Boolean(
    challenge &&
    challenge.board?.questions?.length === 30 &&
    challenge.board?.categories?.length === 6 &&
    challenge.sixer?.questions?.length === 6
  );
}

/* The request on its way, shared: the app starts one as it loads (see
   warmUp), and the menu or the Sixer asking a moment later joins it rather
   than sending a second. */
let inFlight = null;

// Main function to get daily challenge (with caching)
export async function getOrFetchDailyChallenge() {
  // Try cache first
  const cached = getCachedChallenge();
  if (cached) {
    return cached;
  }

  inFlight ??= getDailyChallenge()
    .then((challenge) => {
      if (!isCompleteChallenge(challenge)) {
        throw new Error('The daily challenge came back incomplete. Try again shortly.');
      }
      cacheChallenge(challenge);
      return challenge;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Called once as the app loads, on whatever page it opens on. The server
 * sleeps when nobody is using it, and the first request wakes it; this makes
 * that request now, while the page is still drawing, rather than when the
 * menu or the Sixer gets round to asking. Without today's board cached it is
 * that board, so it is waiting by the time it is wanted; with it cached, a
 * bare ping, so the judge and the day's scores find the server up. Never
 * throws: a server that is down is the pages' to report.
 */
export function warmUp() {
  if (!SOCKET_URL) return;
  if (getCachedChallenge()) {
    fetch(`${SOCKET_URL}/health`).catch(() => {});
    return;
  }
  getOrFetchDailyChallenge().catch(() => {});
}

/* The archive.

   Held in memory for the session rather than in localStorage: the cached
   today's challenge is one board and turns over daily, but ninety days of
   boards would fill the quota and evict the thing the player actually came
   back for. A reload paying for one more fetch is the cheaper mistake. */
const archiveCache = new Map();

/**
 * The challenge for a past day.
 *
 * The server enforces the window; a date outside it comes back 404 and the
 * message it gives is worth showing, because "the archive stops at ninety
 * days" is a different problem from "the scrape failed".
 */
export async function getChallengeForDate(date) {
  if (!SOCKET_URL) {
    throw new Error('Backend server URL not configured. Set VITE_SOCKET_URL in .env');
  }

  if (archiveCache.has(date)) return archiveCache.get(date);

  const response = await fetch(
    `${SOCKET_URL}/api/daily/challenge?date=${encodeURIComponent(date)}`
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Failed to fetch that day from the archive');
  }

  const challenge = await response.json();

  if (!isCompleteChallenge(challenge)) {
    throw new Error('That day came back incomplete. Try again shortly.');
  }

  archiveCache.set(date, challenge);
  return challenge;
}
