import { Router } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../config/database.js';
import { generateToken, verifyToken, authenticateToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Register a new user
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, displayName, username } = req.body;

    if (!email || !password || !displayName) {
      throw new AppError('Email, password, and display name are required', 400, 'INVALID_INPUT');
    }

    const db = getDatabase();

    if (username) {
      const problem = usernameProblem(username);
      if (problem) throw new AppError(problem, 400, 'INVALID_USERNAME');
    }

    // Check if email or username already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) {
      throw new AppError('Email or username already exists', 409, 'USER_EXISTS');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const userId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, username, is_guest)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(userId, email, passwordHash, displayName, username || null);

    // Create user stats
    db.prepare('INSERT INTO user_stats (user_id) VALUES (?)').run(userId);

    // Generate token
    const token = generateToken({ userId, isGuest: false });

    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.status(201).json({ token, user: publicUser(created) });
  } catch (error) {
    next(error);
  }
});

// Login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400, 'INVALID_INPUT');
    }

    const db = getDatabase();

    // Find user
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Update last active
    /* Single quotes. In SQLite a double quoted token is an identifier, so
       datetime("now") asks for a column called now, and better-sqlite3 does
       not fall back to treating it as a string. Every sign-in threw a 500. */
    db.prepare("UPDATE users SET last_active_at = datetime('now') WHERE id = ?").run(user.id);

    // Generate token
    const token = generateToken({ userId: user.id, isGuest: false });

    res.json({ token, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

// Guest login
router.post('/guest', (req, res, next) => {
  try {
    const { displayName } = req.body;

    if (!displayName) {
      throw new AppError('Display name is required', 400, 'INVALID_INPUT');
    }

    const db = getDatabase();

    // Create guest user
    const guestId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, display_name, is_guest)
      VALUES (?, ?, 1)
    `).run(guestId, displayName);

    // Create user stats
    db.prepare('INSERT INTO user_stats (user_id) VALUES (?)').run(guestId);

    // Generate token (short expiration for guests)
    const token = generateToken({ userId: guestId, isGuest: true }, '24h');

    res.status(201).json({
      token,
      user: {
        id: guestId,
        displayName,
        isGuest: true,
      },
      expiresIn: '24h',
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Sign in with Google
// ---------------------------------------------------------------------------

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

// Only what is needed to know who you are. Anything beyond these three is a
// "sensitive scope" and drags the whole app into Google's verification review.
const GOOGLE_SCOPES = 'openid email profile';

const clientUrl = () => process.env.CLIENT_URL || 'https://jeoparody.andrescruz.xyz';
const serverUrl = () => process.env.SERVER_URL || 'https://jeoparody-server.fly.dev';
const redirectUri = () => `${serverUrl()}/api/auth/google/callback`;

const googleConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** Is Google sign-in available? The button asks before it offers itself. */
router.get('/google/status', (req, res) => {
  res.json({ configured: googleConfigured() });
});

router.get('/google', (req, res, next) => {
  try {
    if (!googleConfigured()) {
      throw new AppError('Google sign-in is not configured', 503, 'GOOGLE_UNCONFIGURED');
    }

    /* The state is a short-lived signed token rather than a random string in a
       session store. It has to survive a round trip through Google and come
       back recognisable, and signing it means nothing has to be remembered
       between the two requests. */
    const state = generateToken({ purpose: 'google-oauth' }, '10m');

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      state,
      // Ask every time rather than silently reusing a stale grant.
      prompt: 'select_account',
    });
    res.redirect(`${GOOGLE_AUTH}?${params}`);
  } catch (error) {
    next(error);
  }
});

router.get('/google/callback', async (req, res) => {
  // Failures here send the player back to the sign-in page with a reason,
  // never a stack trace: they arrived from Google, not from our API.
  const fail = (reason) =>
    res.redirect(`${clientUrl()}/signin?error=${encodeURIComponent(reason)}`);

  try {
    const { code, state, error } = req.query;
    if (error) return fail(error === 'access_denied' ? 'cancelled' : 'google_error');
    if (!code || !state) return fail('missing_code');

    /* Checked for what it is, not merely that we signed it. Every token this
       server issues is signed with the same key, so verifying alone would
       accept a player's own session token as an OAuth state. */
    try {
      if (verifyToken(state).purpose !== 'google-oauth') return fail('bad_state');
    } catch {
      return fail('bad_state');
    }

    const tokenRes = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return fail('token_exchange_failed');
    const { access_token: accessToken } = await tokenRes.json();
    if (!accessToken) return fail('token_exchange_failed');

    const infoRes = await fetch(GOOGLE_USERINFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!infoRes.ok) return fail('profile_failed');
    const profile = await infoRes.json();
    if (!profile.sub) return fail('profile_failed');

    const db = getDatabase();
    const now = "datetime('now')";

    /* Matched on the Google subject first, then on email. The subject is the
       stable identifier; email is the bridge for someone who signed up with a
       password and later chooses the Google button, so they land in the account
       they already have rather than a second one. */
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.sub);

    if (!user && profile.email) {
      const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email);
      if (byEmail) {
        db.prepare(`UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url),
                    last_active_at = ${now} WHERE id = ?`)
          .run(profile.sub, profile.picture ?? null, byEmail.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(byEmail.id);
      }
    }

    if (!user) {
      const id = uuidv4();
      db.prepare(`INSERT INTO users (id, email, display_name, google_id, avatar_url, is_guest)
                  VALUES (?, ?, ?, ?, ?, 0)`)
        .run(id, profile.email ?? null, profile.name || profile.email || 'Player',
             profile.sub, profile.picture ?? null);
      db.prepare('INSERT INTO user_stats (user_id) VALUES (?)').run(id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    } else {
      db.prepare(`UPDATE users SET last_active_at = ${now} WHERE id = ?`).run(user.id);
    }

    const token = generateToken({ userId: user.id, isGuest: false });

    /* Handed back in the fragment, not the query. A fragment is never sent to a
       server, so the token stays out of access logs, out of the Referer header
       and out of anything sitting between here and the browser. */
    res.redirect(`${clientUrl()}/auth/callback#token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Google sign-in failed:', err);
    return fail('unexpected');
  }
});

// ---------------------------------------------------------------------------
// The account
// ---------------------------------------------------------------------------

/** What the client is allowed to know about a user, including itself. */
function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    signature: row.signature ?? null,
    avatarUrl: row.avatar_url ?? null,
    hasPassword: Boolean(row.password_hash),
    hasGoogle: Boolean(row.google_id),
    createdAt: row.created_at,
    isGuest: false,
  };
}

router.get('/me', authenticateToken, (req, res, next) => {
  try {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!user) throw new AppError('Account not found', 404, 'NOT_FOUND');
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

/* A drawn name is a PNG data URL. Capped because it is user supplied and goes
   in a database row: a 300 by 80 signature is a few kilobytes, so anything
   approaching this is not a signature.

   Below express.json's own 100KB limit, deliberately. At 256KB this check
   could never run: the body parser rejected the request first, with its own
   opaque error, and the test asserting a 413 was passing on express's refusal
   rather than on anything here. */
const MAX_SIGNATURE_BYTES = 64 * 1024;

router.put('/signature', authenticateToken, (req, res, next) => {
  try {
    const { signature } = req.body ?? {};
    if (typeof signature !== 'string' || !signature.startsWith('data:image/png;base64,')) {
      throw new AppError('A signature must be a PNG data URL', 400, 'INVALID_SIGNATURE');
    }
    if (Buffer.byteLength(signature, 'utf8') > MAX_SIGNATURE_BYTES) {
      throw new AppError('That drawing is too large', 413, 'SIGNATURE_TOO_LARGE');
    }

    const db = getDatabase();
    db.prepare('UPDATE users SET signature = ? WHERE id = ?').run(signature, req.user.userId);
    res.json({ signature });
  } catch (error) {
    next(error);
  }
});

/** Clearing it is its own verb, so "no signature" is a thing you can choose. */
router.delete('/signature', authenticateToken, (req, res, next) => {
  try {
    const db = getDatabase();
    db.prepare('UPDATE users SET signature = NULL WHERE id = ?').run(req.user.userId);
    res.json({ signature: null });
  } catch (error) {
    next(error);
  }
});

/* Promised by the privacy policy, so it deletes rather than deactivates.
   ON DELETE CASCADE takes the stats with it. */
router.delete('/account', authenticateToken, (req, res, next) => {
  try {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.user.userId);
    if (result.changes === 0) throw new AppError('Account not found', 404, 'NOT_FOUND');
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Usernames
// ---------------------------------------------------------------------------

/* Long enough to be a name, short enough to fit on a podium. Letters, digits
   and underscore only: anything else invites lookalike characters that let one
   player pass for another. */
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

/* Words that would let someone pass for the game itself or for a person
   answering for it. */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'moderator', 'mod', 'staff',
  'support', 'help', 'jeoparody', 'jeopardy', 'host', 'official', 'me', 'you',
  'null', 'undefined', 'anonymous', 'guest', 'player', 'deleted',
]);

/** Why this username cannot be used, or null if it can. */
export function usernameProblem(username) {
  if (typeof username !== 'string' || !username.trim()) return 'Pick a username.';
  const value = username.trim();
  if (value.length < 3) return 'At least 3 characters.';
  if (value.length > 20) return 'At most 20 characters.';
  if (!USERNAME_PATTERN.test(value)) return 'Letters, numbers and underscores only.';
  if (RESERVED.has(value.toLowerCase())) return 'That one is reserved.';
  return null;
}

/* Compared without case, so Ada and ada cannot both exist: two names that read
   the same are two ways to be mistaken for someone else. */
function usernameTaken(db, username, exceptUserId = null) {
  const row = db
    .prepare('SELECT id FROM users WHERE username IS NOT NULL AND lower(username) = lower(?)')
    .get(username.trim());
  return Boolean(row) && row.id !== exceptUserId;
}

router.get('/username-available', (req, res, next) => {
  try {
    const username = String(req.query.username ?? '');
    const problem = usernameProblem(username);
    if (problem) return res.json({ available: false, reason: problem });

    const db = getDatabase();
    if (usernameTaken(db, username)) {
      return res.json({ available: false, reason: 'That one is taken.' });
    }
    res.json({ available: true, reason: null });
  } catch (error) {
    next(error);
  }
});

router.put('/username', authenticateToken, (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const problem = usernameProblem(username);
    if (problem) throw new AppError(problem, 400, 'INVALID_USERNAME');

    const db = getDatabase();
    /* Checked here as well as in the availability call, because the two are
       separate requests and someone else can take the name in between. */
    if (usernameTaken(db, username, req.user.userId)) {
      throw new AppError('That one is taken.', 409, 'USERNAME_TAKEN');
    }

    db.prepare('UPDATE users SET username = ?, display_name = ? WHERE id = ?')
      .run(username, username, req.user.userId);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

export default router;
