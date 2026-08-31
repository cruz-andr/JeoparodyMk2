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

async function call(path, { method = 'GET', body, token } = {}) {
  if (!API) throw new BoardsError('The server is not configured.', 'NO_SERVER', 0);

  let response;
  try {
    response = await fetch(`${API}/api/boards${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new BoardsError('Could not reach the server. Check your connection.', 'OFFLINE', 0);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new BoardsError(
      data?.error?.message || 'Something went wrong. Try again.',
      data?.error?.code,
      response.status
    );
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
 * Count a play.
 *
 * Deliberately never awaited by the caller and never surfaced: a board that
 * played fine but failed to increment a counter is not something to interrupt
 * someone's game over.
 */
export const countPlay = (slug, token) =>
  call(`/${slug}/played`, { method: 'POST', token }).catch(() => null);
