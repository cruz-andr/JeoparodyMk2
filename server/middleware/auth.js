import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler.js';

/*
 * Tokens are only worth anything if the key that signs them is a secret.
 *
 * This used to fall back to a literal string, which is committed to a public
 * repository, so the deployed server was signing tokens with a key anybody
 * could read: forging a token for any account was a one-liner. In production
 * the server now refuses to start rather than run with a known key.
 */
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start: every session token would be ' +
      'forgeable. Set it with: fly secrets set JWT_SECRET=$(openssl rand -hex 32)'
    );
  }
  console.warn('[auth] JWT_SECRET is not set; using a development key. Never ship this.');
  return 'development-only-key-not-for-production';
})();

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return next(new AppError('Invalid or expired token', 403, 'AUTH_INVALID'));
  }
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (err) {
      // Token invalid, continue without user
    }
  }

  next();
}

export function generateToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
