/**
 * Boards the site publishes itself: the collabs.
 *
 * They are files in server/houseBoards, published when the server starts,
 * rather than boards typed into the editor under somebody's account. So they
 * carry no author, nobody's login is needed to put one up, and changing one
 * is a commit like any other change to the site.
 *
 * They belong to a house account with no username, no email and no password:
 * the board has an owner, as every board must, and nobody can sign in as it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
  MAX_DESCRIPTION, TOPICS, countClues, normalizeBoard, publishProblem, validateBoardStructure,
} from '../shared/boardFormat.js';

export const HOUSE_USER_ID = 'house';

// The file name is the slug, so it is read in links: short, plain, lower case.
const SLUG = /^[a-z0-9][a-z0-9-]{2,59}$/;

// A cover is an image file beside the board's, named by its `cover`.
const COVER_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
// The same limit as a cover put up from the board page.
const MAX_COVER_BYTES = 512 * 1024;

export function ensureHouseUser(db) {
  db.prepare('INSERT OR IGNORE INTO users (id, display_name) VALUES (?, ?)').run(HOUSE_USER_ID, 'Jeoparody');
}

/**
 * Publish every board file in `dir`. One that will not publish is reported
 * and skipped, never half applied, and never stops the others or the server.
 * Returns what happened to each: published, updated, unchanged, or an error.
 */
export function publishHouseBoards(db, dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  if (!files.length) return [];
  ensureHouseUser(db);

  return files.map((name) => {
    const slug = name.replace(/\.json$/, '');
    try {
      const file = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      return { slug, action: publishOne(db, slug, file, dir) };
    } catch (err) {
      return { slug, error: err.message };
    }
  });
}

/** The board's cover as the data URL boards keep, or undefined when the file names none. */
function readCover(dir, name) {
  if (name === undefined || name === null) return undefined;
  const type = COVER_TYPES[path.extname(String(name)).toLowerCase()];
  if (!type || path.basename(String(name)) !== name) throw new Error(`the cover "${name}" is not an image file beside the board`);
  const cover = `data:${type};base64,${fs.readFileSync(path.join(dir, name)).toString('base64')}`;
  if (Buffer.byteLength(cover) > MAX_COVER_BYTES) throw new Error(`the cover "${name}" is too large`);
  return cover;
}

function publishOne(db, slug, file, dir) {
  if (!SLUG.test(slug)) throw new Error('the file name is not a usable slug');

  const topic = file.topic ?? null;
  if (topic !== null && !TOPICS.includes(topic)) throw new Error(`unknown topic "${topic}"`);

  // The same checks as publishing from the editor.
  const check = validateBoardStructure(file.board, { topic });
  if (!check.valid) throw new Error(check.errors[0]);
  const board = normalizeBoard(file.board, { topic });
  const title = String(file.title ?? '').trim();
  const problem = publishProblem({ title, board, topic });
  if (problem) throw new Error(problem);

  const description = file.description ? String(file.description).trim().slice(0, MAX_DESCRIPTION) : null;
  const featured = file.featured ? 1 : 0;
  const data = JSON.stringify(board);
  const names = board.categories.map((c) => c.name.trim()).filter(Boolean).join('\u0000');
  // A file that names no cover leaves whatever cover the board has alone.
  const cover = readCover(dir, file.cover);

  const existing = db.prepare(`
    SELECT id, owner_id, title, description, topic, data, featured, cover_image FROM boards WHERE slug = ?
  `).get(slug);

  if (existing && existing.owner_id !== HOUSE_USER_ID) {
    throw new Error("that slug is somebody's own board, so it is left alone");
  }

  if (!existing) {
    db.prepare(`
      INSERT INTO boards (id, slug, owner_id, title, description, topic, data, clue_count,
                          category_names, category_count, visibility, published_at, featured, cover_image)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', datetime('now'), ?, ?)
    `).run(
      uuidv4(), slug, HOUSE_USER_ID, title, description, topic, data, countClues(board),
      names, board.categories.length, featured, cover ?? null
    );
    return 'published';
  }

  const same = existing.title === title && existing.description === description
    && existing.topic === topic && existing.data === data && existing.featured === featured
    && (cover === undefined || existing.cover_image === cover);
  if (same) return 'unchanged';

  // A new version of the same board: its plays and its link are kept.
  db.prepare(`
    UPDATE boards
    SET title = ?, description = ?, topic = ?, data = ?, clue_count = ?,
        category_names = ?, category_count = ?, visibility = 'public', featured = ?,
        cover_image = COALESCE(?, cover_image),
        published_at = COALESCE(published_at, datetime('now')),
        version = version + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title, description, topic, data, countClues(board), names, board.categories.length, featured,
    cover ?? null, existing.id
  );
  return 'updated';
}
