/**
 * Who a request is, for the purposes of counting it.
 *
 * The old limiter counted by req.ip with `trust proxy` left at its default of
 * false. Behind Fly's proxy that is not the visitor's address, it is the
 * proxy's, and it is the same one for everybody: the whole site shared a
 * single bucket of 100 requests per fifteen minutes. Production logs carried
 * ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every boot saying exactly this.
 *
 * Two things are wrong with counting by address even once it is the right
 * address. A school or an office is one address and dozens of people, so they
 * share a budget they cannot see. And an IPv6 customer is handed a whole /64,
 * so anyone who wants to evade a limit can simply use the next address.
 *
 * So: an account is counted as an account, and only an anonymous visitor is
 * counted by address, with IPv6 collapsed to its subnet.
 */
import { rateLimit } from 'express-rate-limit';
import { verifyToken } from './auth.js';

/* Fly injects this into every Machine. A request that never reached Fly cannot
   mint it, so it is a reliable way to ask "am I actually behind that proxy?"
   before believing a header that claims to come from it. */
export const ON_FLY = Boolean(process.env.FLY_APP_NAME);

/**
 * Collapse an address to the unit a person actually controls.
 *
 * IPv4 is one address per person, near enough. IPv6 hands a single customer a
 * /64 at minimum and often a /48, so limiting the full address limits nothing:
 * rotating to the next one is free. The first four groups are the /64.
 */
export function normaliseAddress(raw) {
  if (!raw) return 'unknown';
  let ip = String(raw).trim();

  // ::ffff:1.2.3.4 is IPv4 wearing an IPv6 coat.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];

  if (!ip.includes(':')) return ip;

  // Expand :: only as far as we need to read the first four groups.
  const [head] = ip.split('%'); // strip any zone index
  const parts = head.split('::');
  const left = (parts[0] || '').split(':').filter(Boolean);
  if (parts.length > 1 && left.length < 4) {
    const right = (parts[1] || '').split(':').filter(Boolean);
    const gap = 8 - left.length - right.length;
    ip = [...left, ...Array(Math.max(gap, 0)).fill('0'), ...right].join(':');
  } else {
    ip = left.join(':');
  }

  return `${ip.split(':').slice(0, 4).join(':')}::/64`;
}

/** The address we believe, and why we believe it. */
export function clientAddress(req) {
  /* Fly writes Fly-Client-IP itself from the socket it accepted, so a client
     cannot forge it. X-Forwarded-For can be forged: Fly appends to whatever
     arrived, so a request that turns up carrying one leaves the attacker's
     value sitting where `trust proxy: 1` would read it. */
  const flyIp = ON_FLY ? req.headers['fly-client-ip'] : null;
  return normaliseAddress(flyIp || req.ip || req.socket?.remoteAddress);
}

/**
 * An account is one person wherever they are sitting. An address is a guess.
 *
 * Reading the token here rather than running authenticateToken first keeps the
 * limiter in front of everything, including the routes that do not authenticate
 * at all. A bad token is not an error here, it just means we fall back to the
 * address: rejecting it is the route's job, not the counter's.
 */
export function clientKey(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = verifyToken(header.slice(7));
      if (decoded?.userId) return `u:${decoded.userId}`;
    } catch { /* expired or forged; count it as an address */ }
  }
  return `ip:${clientAddress(req)}`;
}

const shared = {
  windowMs: 15 * 60 * 1000,
  keyGenerator: clientKey,
  /* We deliberately never read X-Forwarded-For, so the library's warning about
     it is telling us about a header we ignore on purpose. IPv6 normalisation
     is handled in normaliseAddress rather than by the library's helper, which
     this version does not export. */
  validate: { xForwardedForHeader: false },
  /* RateLimit-* headers, so a client can see its own budget and say something
     useful instead of guessing. */
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many requests just now. Wait a moment and try again.', code: 'RATE_LIMITED' } },
};

/* Reading is what people spend a session doing: opening a board, browsing,
   coming back. One person clicking around Community Boards can easily make a
   few dozen requests in a few minutes, and the old ceiling of 100 for
   everything was low enough to hit by using the site normally. */
export const readLimiter = rateLimit({ ...shared, max: 600 });

/* Writing is rarer and more expensive, and a board can be four megabytes. */
export const writeLimiter = rateLimit({ ...shared, max: 150 });

/* Signing in is where a limit is actually a security control rather than a
   politeness, and it is counted by address even for a valid token, because the
   whole point is the attacker does not have one. */
export const authLimiter = rateLimit({
  ...shared,
  max: 30,
  keyGenerator: (req) => `auth:${clientAddress(req)}`,
  /* A successful sign-in should not spend the budget that exists to slow down
     guessing. Only failures count. */
  skipSuccessfulRequests: true,
});

/* Asking the model is the one thing here that costs money on every call, and
   it is paid from one key for the whole site. A board is two calls and a
   reroll is two more, so thirty an hour is a full evening of hosting and a
   short one of running a loop against somebody else's quota. */
export const aiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: { message: 'The AI has used up its quota for you this hour. Try again later.', code: 'AI_QUOTA' } },
});

/** Reads and writes have different shapes, so they get different budgets. */
export function apiLimiter(req, res, next) {
  const read = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  return read ? readLimiter(req, res, next) : writeLimiter(req, res, next);
}
