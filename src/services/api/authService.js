/**
 * Talking to the account endpoints.
 *
 * Every call returns plain data or throws an Error whose message is already
 * fit to show someone: the server sends a human sentence, and inventing a
 * second one here would only ever be worse than the one it sent.
 */

const API = import.meta.env.VITE_SOCKET_URL || '';

class AuthError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

async function call(path, { method = 'GET', body, token } = {}) {
  if (!API) throw new AuthError('The server is not configured.', 'NO_SERVER', 0);

  let response;
  try {
    response = await fetch(`${API}/api/auth${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // A dead server and a dead connection look identical from here.
    throw new AuthError('Could not reach the server. Check your connection.', 'OFFLINE', 0);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AuthError(
      data?.error?.message || 'Something went wrong. Try again.',
      data?.error?.code,
      response.status
    );
  }
  return data;
}

export const register = (email, password, displayName) =>
  call('/register', { method: 'POST', body: { email, password, displayName } });

export const login = (email, password) =>
  call('/login', { method: 'POST', body: { email, password } });

export const me = (token) => call('/me', { token });

export const saveSignature = (token, signature) =>
  call('/signature', { method: 'PUT', token, body: { signature } });

export const clearSignature = (token) =>
  call('/signature', { method: 'DELETE', token });

export const deleteAccount = (token) =>
  call('/account', { method: 'DELETE', token });

/** Whether the Google button should offer itself at all. */
export async function googleAvailable() {
  try {
    const { configured } = await call('/google/status');
    return Boolean(configured);
  } catch {
    return false;
  }
}

/** Google owns the next page, so this is a navigation rather than a fetch. */
export const googleSignInUrl = () => `${API}/api/auth/google`;

/**
 * What the server means, said to a person.
 *
 * The sign-in failure is deliberately the same sentence whichever half was
 * wrong: naming the email would tell a stranger whether it has an account.
 */
export function readableError(error) {
  switch (error?.code) {
    case 'USER_EXISTS':
      return 'There is already an account with that email.';
    case 'INVALID_CREDENTIALS':
      return 'That email and password do not match.';
    case 'SIGNATURE_TOO_LARGE':
      return 'That drawing is too large to save.';
    case 'OFFLINE':
    case 'NO_SERVER':
      return 'Could not reach the server. Check your connection.';
    default:
      return error?.message || 'Something went wrong. Try again.';
  }
}

/** What the sign-in page says when Google sends someone back unhappy. */
export function readableGoogleError(reason) {
  switch (reason) {
    case 'cancelled':
      return null; // they changed their mind; that is not an error
    case 'bad_state':
      return 'That sign-in link expired. Try again.';
    case 'token_exchange_failed':
    case 'profile_failed':
    case 'google_error':
      return 'Google could not sign you in. Try again, or use your email.';
    default:
      return 'Something went wrong signing in with Google.';
  }
}
