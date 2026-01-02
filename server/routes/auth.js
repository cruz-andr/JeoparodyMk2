import { Router } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../config/database.js';
import { generateToken } from '../middleware/auth.js';
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

    res.status(201).json({
      token,
      user: {
        id: userId,
        email,
        displayName,
        username,
        isGuest: false,
      },
    });
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
    db.prepare('UPDATE users SET last_active_at = datetime("now") WHERE id = ?').run(user.id);

    // Generate token
    const token = generateToken({ userId: user.id, isGuest: false });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        username: user.username,
        isGuest: false,
      },
    });
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

export default router;
