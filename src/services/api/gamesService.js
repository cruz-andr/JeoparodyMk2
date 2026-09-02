/**
 * Talking to the archive.
 *
 * Same shape as authService and boardsService: plain data back, or an Error
 * whose message is already fit to show someone. Every call needs a token; a
 * visitor with no account keeps their record in localStorage instead, and the
 * pages that read it never call this.
 */

const API = import.meta.env.VITE_SOCKET_URL || '';

export class GamesError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'GamesError';
    this.code = code;
    this.status = status;
  }
}

async function call(path, { method = 'GET', body, token } = {}) {
  if (!API) throw new GamesError('The server is not configured.', 'NO_SERVER', 0);
  if (!token) throw new GamesError('Sign in to keep a record of your games.', 'AUTH_REQUIRED', 401);

  let response;
  try {
    response = await fetch(`${API}/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GamesError('Could not reach the server. Check your connection.', 'OFFLINE', 0);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) {
      throw new GamesError('Too many requests just now. Wait a moment and try again.', 'RATE_LIMITED', 429);
    }
    throw new GamesError(
      data?.error?.message || 'Something went wrong. Try again.',
      data?.error?.code,
      response.status
    );
  }
  return data;
}

/**
 * File a single player game the browser just finished.
 *
 * Room games are filed by the server from its own scores the moment the
 * standings are shown, so nothing on the client sends those.
 */
export const finishGame = (token, { mode = 'single', score, correct, total, categories, genre, boardSlug }) =>
  call('/games/finish', {
    method: 'POST',
    token,
    body: { mode, score, correct, total, categories, genre, boardSlug },
  });

/** My recent games, newest first. */
export const gameHistory = (token, limit = 20) =>
  call(`/games/history?limit=${encodeURIComponent(limit)}`, { token });

/** My running totals. */
export const myStats = (token) => call('/users/me/stats', { token });
