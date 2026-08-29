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

// Main function to get daily challenge (with caching)
export async function getOrFetchDailyChallenge() {
  // Try cache first
  const cached = getCachedChallenge();
  if (cached) {
    return cached;
  }

  // Fetch fresh data from backend
  const challenge = await getDailyChallenge();

  if (!isCompleteChallenge(challenge)) {
    throw new Error('The daily challenge came back incomplete. Try again shortly.');
  }

  cacheChallenge(challenge);

  return challenge;
}
