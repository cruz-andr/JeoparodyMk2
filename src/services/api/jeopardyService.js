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

// Cache key for localStorage
const CACHE_KEY = 'jeoparody-daily-cache';

// Get cached challenge if available and still valid for today
export function getCachedChallenge() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const data = JSON.parse(cached);
    const todayDate = getTodayDateString();

    // Return cached data only if it's from today
    if (data.date === todayDate) {
      return data;
    }

    return null;
  } catch {
    return null;
  }
}

// Cache the challenge for today
export function cacheChallenge(challenge) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(challenge));
  } catch {
    // Ignore cache errors
  }
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

  // Cache it
  cacheChallenge(challenge);

  return challenge;
}
