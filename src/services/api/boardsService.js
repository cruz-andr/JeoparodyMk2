/**
 * Talking to the boards endpoints.
 *
 * Same shape as authService: every call returns plain data or throws an Error
 * whose message is already fit to show someone. The server writes the sentence
 * because the server is the one that knows which of thirty clues is missing.
 */

const API = import.meta.env.VITE_SOCKET_URL || '';

export class BoardsError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'BoardsError';
    this.code = code;
    this.status = status;
  }
}

async function call(path, { method = 'GET', body, token, headers } = {}) {
  if (!API) throw new BoardsError('The server is not configured.', 'NO_SERVER', 0);

  let response;
  try {
    response = await fetch(`${API}/api/boards${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new BoardsError('Could not reach the server. Check your connection.', 'OFFLINE', 0);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    /* The rate limiter answers with a bare { error: "..." } string rather than
       the { error: { message, code } } every other endpoint uses, so it fell
       through to the generic sentence. It is worth its own words: it is not a
       thing that went wrong, it is a thing to wait out. */
    if (response.status === 429) {
      throw new BoardsError('Too many requests just now. Wait a moment and try again.', 'RATE_LIMITED', 429);
    }
    const error = new BoardsError(
      data?.error?.message || 'Something went wrong. Try again.',
      data?.error?.code,
      response.status
    );
    // A 409 carries the board that is actually there. See routes/boards.js.
    error.details = data?.error?.details;
    throw error;
  }
  return data;
}

const query = (params) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  return search ? `?${search}` : '';
};

export const createBoard = (token, title) =>
  call('/', { method: 'POST', token, body: { title } });

export const myBoards = (token) => call('/mine', { token });

export const getBoard = (slug, token) => call(`/${slug}`, { token });

/** Only send what changed. An undefined field is left alone by the server. */
export const saveBoard = (token, slug, patch) =>
  call(`/${slug}`, { method: 'PUT', token, body: patch });

export const setVisibility = (token, slug, visibility) =>
  call(`/${slug}/visibility`, { method: 'PUT', token, body: { visibility } });

export const copyBoard = (token, slug) =>
  call(`/${slug}/copy`, { method: 'POST', token });

export const deleteBoard = (token, slug) =>
  call(`/${slug}`, { method: 'DELETE', token });

export const browse = ({ row = 'popular', topic, q, limit } = {}, token) =>
  call(query({ row, topic, q, limit }), { token });

/**
 * A key for this browser, so a signed-out player is one player.
 *
 * Not an identifier for a person and not a security boundary: it is only what
 * lets the server tell a second play from the same visitor apart from a second
 * visitor. It is hashed before it is stored, it is never sent anywhere else,
 * and clearing site data mints a new one, which costs nothing but one
 * miscounted play.
 *
 * A signed-in player never needs it. The account is the better answer, and it
 * makes playing on a phone and then a laptop one person rather than two.
 */
const PLAYER_KEY = 'jeoparody-player-key';

function playerKey() {
  try {
    let key = localStorage.getItem(PLAYER_KEY);
    if (!key) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(PLAYER_KEY, key);
    }
    return key;
  } catch {
    /* Private windows and blocked storage both land here. The server falls
       back to the address, which is blunter but still better than counting
       every reload. */
    return null;
  }
}

/* Slugs already counted on this page load.

   React mounts, unmounts and mounts again under StrictMode, so the effect that
   starts a game runs twice. The server would refuse the second one anyway now
   that a play is a row rather than an increment; this just saves the round
   trip. */
const counted = new Set();

/**
 * Count a play.
 *
 * Deliberately never awaited by the caller and never surfaced: a board that
 * played fine but failed to increment a counter is not something to interrupt
 * someone's game over.
 */
export const countPlay = (slug, token) => {
  if (counted.has(slug)) return Promise.resolve(null);
  counted.add(slug);

  const key = playerKey();
  return call(`/${slug}/played`, {
    method: 'POST',
    token,
    headers: key ? { 'X-Player-Key': key } : undefined,
  }).catch(() => null);
};
