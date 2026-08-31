/**
 * Community Boards.
 *
 * A board is one row with an owner and a dial on it. The dial has three
 * positions and they are not a permission system, they are three different
 * answers to "who can open this link":
 *
 *   private    only the owner. Missing to everyone else, 404 not 403, because
 *              a 403 confirms the board exists and that is itself a leak.
 *   unlisted   anyone holding the slug. The slug is random for exactly this
 *              reason: it is the whole of the security.
 *   public     anyone, listed, and copyable.
 *
 * Saving never validates whether a board is finished, only whether it is the
 * right shape. Half-written boards are the normal state of a board and losing
 * someone's work to a validation error would be the worst bug in here.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../config/database.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { clientAddress } from '../middleware/rateLimit.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  CLUE_COUNT,
  MAX_DESCRIPTION,
  MAX_TITLE,
  TOPICS,
  VISIBILITIES,
  countClues,
  emptyBoard,
  normalizeBoard,
  publishProblem,
  validateBoardStructure,
} from '../shared/boardFormat.js';

const router = Router();

/* Every column except the two big ones. A list of twenty boards must not carry
   twenty serialised boards and twenty cover images with it. */
const CARD_COLUMNS = `
  b.id, b.slug, b.owner_id, b.title, b.description, b.topic,
  b.visibility, b.clue_count, b.plays, b.copied_from,
  b.created_at, b.updated_at, b.published_at,
  b.cover_image IS NOT NULL AS has_cover
`;

const AUTHOR_JOIN = `
  LEFT JOIN users u ON u.id = b.owner_id
`;
const AUTHOR_COLUMNS = `u.username AS author_username, u.signature AS author_signature`;

/**
 * Crockford-ish base32 over 60 bits of randomness.
 *
 * No vowels, so a slug cannot accidentally spell something, and no characters
 * that look like each other when someone reads a link aloud.
 */
const SLUG_ALPHABET = '0123456789bcdfghjkmnpqrstvwxyz';
function makeSlug() {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

function uniqueSlug(db) {
  /* A collision at 12 characters of this alphabet is not going to happen, but
     "not going to happen" silently overwriting someone's board is a bad trade
     against one indexed lookup. */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = makeSlug();
    if (!db.prepare('SELECT 1 FROM boards WHERE slug = ?').get(slug)) return slug;
  }
  throw new AppError('Could not create the board. Try again.', 500, 'SLUG_EXHAUSTED');
}

function cardFromRow(row) {
  return {
    slug: row.slug,
    version: row.version ?? 1,
    title: row.title,
    description: row.description,
    topic: row.topic,
    visibility: row.visibility,
    clueCount: row.clue_count,
    plays: row.plays,
    hasCover: Boolean(row.has_cover),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    author: row.author_username
      ? { username: row.author_username, signature: row.author_signature ?? null }
      : null,
  };
}

/** Read a board, or throw the error the caller is allowed to see. */
function readable(db, slug, viewerId) {
  const row = db.prepare(`
    SELECT b.*, ${AUTHOR_COLUMNS} FROM boards b ${AUTHOR_JOIN} WHERE b.slug = ?
  `).get(slug);

  if (!row) throw new AppError('That board does not exist.', 404, 'NOT_FOUND');
  /* Private boards are missing, not forbidden. Same status, same sentence, so
     the response cannot be used to test whether a slug is real. */
  if (row.visibility === 'private' && row.owner_id !== viewerId) {
    throw new AppError('That board does not exist.', 404, 'NOT_FOUND');
  }
  return row;
}

/**
 * A guest is a real row in users, so nothing here would fail. It would just
 * quietly build boards nobody can ever get back to: a guest cannot sign in
 * again, so the shelf is gone the moment the tab closes. Better to say so.
 */
function requireAccount(req) {
  if (req.user?.isGuest) {
    throw new AppError('Create an account to build a board.', 403, 'GUEST_ACCOUNT');
  }
  return req.user.userId;
}

function owned(db, slug, userId) {
  const row = db.prepare('SELECT * FROM boards WHERE slug = ?').get(slug);
  if (!row || row.owner_id !== userId) {
    throw new AppError('That board does not exist.', 404, 'NOT_FOUND');
  }
  return row;
}

function parseBoard(row) {
  try {
    return JSON.parse(row.data);
  } catch {
    /* A row that will not parse is a bug on the way in, not a bad request on
       the way out. Serving an empty grid would silently eat someone's work. */
    throw new AppError('That board could not be read.', 500, 'CORRUPT_BOARD');
  }
}

function text(value, max) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new AppError('Expected text.', 400, 'INVALID_INPUT');
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// ---------------------------------------------------------------- create

router.post('/', authenticateToken, (req, res, next) => {
  try {
    const ownerId = requireAccount(req);
    const db = getDatabase();
    const board = emptyBoard();
    const slug = uniqueSlug(db);
    const title = text(req.body?.title, MAX_TITLE);

    db.prepare(`
      INSERT INTO boards (id, slug, owner_id, title, data, clue_count, visibility)
      VALUES (?, ?, ?, ?, ?, 0, 'private')
    `).run(uuidv4(), slug, ownerId, title ?? '', JSON.stringify(board));

    res.status(201).json({ slug, title: title ?? '', board });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- my shelf

router.get('/mine', authenticateToken, (req, res, next) => {
  try {
    const rows = getDatabase().prepare(`
      SELECT ${CARD_COLUMNS}, ${AUTHOR_COLUMNS}
      FROM boards b ${AUTHOR_JOIN}
      WHERE b.owner_id = ?
      ORDER BY b.updated_at DESC
    `).all(req.user.userId);

    res.json({ boards: rows.map(cardFromRow) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- browse

const ROWS = {
  featured: `AND b.clue_count = ${CLUE_COUNT} ORDER BY b.plays DESC, b.published_at DESC`,
  popular: 'ORDER BY b.plays DESC, b.published_at DESC',
  new: 'ORDER BY b.published_at DESC',
};

router.get('/', optionalAuth, (req, res, next) => {
  try {
    const row = ROWS[req.query.row] ? req.query.row : 'popular';
    const topic = TOPICS.includes(req.query.topic) ? req.query.topic : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 48);

    const where = ["b.visibility = 'public'"];
    const params = [];
    if (topic) { where.push('b.topic = ?'); params.push(topic); }
    if (q) {
      /* Title or author. Searching inside `data` would mean a full scan over
         every clue on every board on every keystroke. */
      where.push('(b.title LIKE ? OR u.username LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    const rows = getDatabase().prepare(`
      SELECT ${CARD_COLUMNS}, ${AUTHOR_COLUMNS}
      FROM boards b ${AUTHOR_JOIN}
      WHERE ${where.join(' AND ')}
      ${ROWS[row]}
      LIMIT ?
    `).all(...params, limit);

    res.json({ row, boards: rows.map(cardFromRow) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- one board

router.get('/:slug', optionalAuth, (req, res, next) => {
  try {
    const db = getDatabase();
    const row = readable(db, req.params.slug, req.user?.userId);
    const board = parseBoard(row);

    let adaptedFrom = null;
    if (row.copied_from) {
      const source = db.prepare(`
        SELECT b.slug, b.title, b.visibility, u.username
        FROM boards b ${AUTHOR_JOIN} WHERE b.id = ?
      `).get(row.copied_from);
      /* Attribution survives the original going private: the credit is a fact
         about where the clues came from, not a link that has to resolve. */
      if (source?.username) {
        adaptedFrom = {
          username: source.username,
          title: source.title,
          slug: source.visibility === 'public' ? source.slug : null,
        };
      }
    }

    res.json({
      ...cardFromRow(row),
      board,
      isOwner: row.owner_id === req.user?.userId,
      adaptedFrom,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- save

router.put('/:slug', authenticateToken, (req, res, next) => {
  try {
    const db = getDatabase();
    const existing = owned(db, req.params.slug, req.user.userId);
    const incoming = req.body ?? {};

    /* Optimistic locking. A client that read version 4 and is saving against
       version 7 has been open in another tab, or in another browser, while
       somebody changed it. Refuse, and hand back what is actually there so the
       client can show the two and let a person choose, rather than making a
       second request at the exact moment the network is already unhappy.

       baseVersion is optional so an older client, or a deliberate overwrite,
       still works. */
    if (incoming.baseVersion !== undefined && incoming.baseVersion !== existing.version) {
      const current = db.prepare(`
        SELECT b.*, ${AUTHOR_COLUMNS} FROM boards b ${AUTHOR_JOIN} WHERE b.id = ?
      `).get(existing.id);
      const err = new AppError(
        'This board was changed somewhere else.', 409, 'STALE_BOARD'
      );
      err.details = { ...cardFromRow(current), board: parseBoard(current) };
      throw err;
    }

    let board = null;
    let clueCount = existing.clue_count;

    if (incoming.board !== undefined) {
      const check = validateBoardStructure(incoming.board);
      if (!check.valid) {
        throw new AppError(check.errors[0], 400, 'INVALID_BOARD');
      }
      board = normalizeBoard(incoming.board);
      clueCount = countClues(board);
    }

    const topic =
      incoming.topic === undefined ? existing.topic
      : incoming.topic === null ? null
      : TOPICS.includes(incoming.topic) ? incoming.topic
      : (() => { throw new AppError('Unknown topic.', 400, 'INVALID_TOPIC'); })();

    const title = incoming.title === undefined
      ? existing.title
      : (text(incoming.title, MAX_TITLE) ?? '');
    const description = incoming.description === undefined
      ? existing.description
      : text(incoming.description, MAX_DESCRIPTION);

    /* A board that has gone quietly incomplete cannot stay in Community
       Boards. Dropping it to unlisted keeps the link working for whoever
       already has it rather than breaking it outright. */
    let visibility = existing.visibility;
    let publishedAt = existing.published_at;
    if (visibility === 'public' && publishProblem({ title, board: board ?? parseBoard(existing) })) {
      visibility = 'unlisted';
      publishedAt = null;
    }

    db.prepare(`
      UPDATE boards
      SET title = ?, description = ?, topic = ?,
          data = COALESCE(?, data), clue_count = ?,
          visibility = ?, published_at = ?,
          version = version + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title, description, topic,
      board ? JSON.stringify(board) : null, clueCount,
      visibility, publishedAt, existing.id
    );

    res.json({
      slug: existing.slug, version: existing.version + 1,
      title, description, topic,
      clueCount, visibility,
      unpublished: visibility !== existing.visibility,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- the dial

router.put('/:slug/visibility', authenticateToken, (req, res, next) => {
  try {
    const db = getDatabase();
    const existing = owned(db, req.params.slug, req.user.userId);
    const wanted = req.body?.visibility;

    if (!VISIBILITIES.includes(wanted)) {
      throw new AppError('Unknown visibility.', 400, 'INVALID_VISIBILITY');
    }

    if (wanted === 'public') {
      const problem = publishProblem({ title: existing.title, board: parseBoard(existing) });
      if (problem) throw new AppError(problem, 400, 'NOT_READY');
    }

    /* published_at is when it first went public, and it is what the New row
       sorts on. Flipping public, unlisted, public should not send a board back
       to the top of New. */
    const publishedAt = wanted === 'public'
      ? (existing.published_at ?? new Date().toISOString())
      : existing.published_at;

    db.prepare(`
      UPDATE boards SET visibility = ?, published_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(wanted, publishedAt, existing.id);

    res.json({ slug: existing.slug, visibility: wanted });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- copy

router.post('/:slug/copy', authenticateToken, (req, res, next) => {
  try {
    const ownerId = requireAccount(req);
    const db = getDatabase();
    const source = db.prepare('SELECT * FROM boards WHERE slug = ?').get(req.params.slug);

    if (!source) throw new AppError('That board does not exist.', 404, 'NOT_FOUND');
    /* Only public boards are copyable. Unlisted means "I chose who sees this",
       and a link forwarded once should not become a fork. */
    if (source.visibility !== 'public' && source.owner_id !== req.user.userId) {
      throw new AppError('That board cannot be copied.', 403, 'NOT_COPYABLE');
    }

    const slug = uniqueSlug(db);
    const title = source.title ? `${source.title} (my copy)`.slice(0, MAX_TITLE) : '';

    db.prepare(`
      INSERT INTO boards (id, slug, owner_id, title, description, topic,
                          data, clue_count, visibility, copied_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'private', ?)
    `).run(
      uuidv4(), slug, ownerId, title, source.description, source.topic,
      source.data, source.clue_count,
      /* Credit the original author, not the person you copied from. Otherwise
         a copy of a copy quietly reassigns the work to the middleman. */
      source.copied_from ?? source.id
    );

    res.status(201).json({ slug });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- plays

/**
 * Who is playing, for the purpose of counting them once.
 *
 * Signed in, it is the account, so playing on a phone and then a laptop is one
 * person. Signed out, it is a key the browser generated and kept, hashed so
 * the database never holds it in the clear; failing that, the address and the
 * browser string, which is a blunter instrument but better than counting every
 * reload.
 */
function playerKey(req) {
  if (req.user?.userId) return `u:${req.user.userId}`;

  const given = req.get('x-player-key');
  const material = given && /^[A-Za-z0-9_-]{16,64}$/.test(given)
    ? `k:${given}`
    : `f:${clientAddress(req)}|${req.get('user-agent') ?? ''}`;

  return `a:${crypto.createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}

router.post('/:slug/played', optionalAuth, (req, res, next) => {
  try {
    const db = getDatabase();
    const row = readable(db, req.params.slug, req.user?.userId);

    /* Your own plays do not count. Otherwise the first thing anyone learns is
       that the ranking is a reload button with your name on it. */
    if (row.owner_id && row.owner_id === req.user?.userId) {
      return res.json({ plays: row.plays, counted: false });
    }

    /* The insert is the deduplication. OR IGNORE means a second play by the
       same person changes nothing, and `changes` tells us whether this was the
       first time, so the counter and the table can never drift apart. Both
       statements in one transaction for the same reason. */
    const record = db.transaction((boardId, viewer) => {
      const result = db.prepare(
        'INSERT OR IGNORE INTO board_plays (board_id, viewer) VALUES (?, ?)'
      ).run(boardId, viewer);

      if (result.changes === 0) return false;
      db.prepare('UPDATE boards SET plays = plays + 1 WHERE id = ?').run(boardId);
      return true;
    });

    const counted = record(row.id, playerKey(req));
    res.json({ plays: row.plays + (counted ? 1 : 0), counted });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- delete

router.delete('/:slug', authenticateToken, (req, res, next) => {
  try {
    const db = getDatabase();
    const existing = owned(db, req.params.slug, req.user.userId);
    db.prepare('DELETE FROM boards WHERE id = ?').run(existing.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
