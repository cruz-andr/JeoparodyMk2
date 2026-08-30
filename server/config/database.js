import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/*
 * Where the database actually lives.
 *
 * The fly machine mounts a volume at /data, and the Dockerfile sets
 * DATABASE_URL, but this file read DATABASE_PATH, a different name that
 * nothing set. So it fell back to a path inside the container image: the
 * volume sat empty and every deploy silently destroyed every account.
 *
 * All three are accepted now, and production defaults onto the volume rather
 * than into the image, so getting the variable name wrong cannot cost data
 * again.
 */
function fileFromUrl(url) {
  if (!url) return null;
  if (url.startsWith('file://')) return fileURLToPath(url);
  return url.startsWith('/') ? url : null;
}

/** Exported so the rule can be tested without opening a database. */
export function resolveDatabasePath(env = process.env, devPath = join(__dirname, '../db/jeopardy.sqlite')) {
  return (
    env.DATABASE_PATH ||
    fileFromUrl(env.DATABASE_URL) ||
    (env.NODE_ENV === 'production' ? '/data/jeopardy.sqlite' : devPath)
  );
}

const DB_PATH = resolveDatabasePath();

let db = null;

export function getDatabase() {
  if (!db) {
    // Ensure directory exists
    const dbDir = dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}


/**
 * Add a column to a table that already exists.
 *
 * CREATE TABLE IF NOT EXISTS does nothing to a table that is already there, so
 * a new column in the schema above never reaches a database that has been
 * running. That matters now the file lives on a volume and survives deploys:
 * the production users table predates every column added from here on.
 *
 * Idempotent, so it is safe to run on every boot.
 */
export function addColumnIfMissing(database, table, column, definition) {
  const existing = database.prepare(`PRAGMA table_info(${table})`).all();
  if (existing.some((c) => c.name === column)) return false;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

export async function initializeDatabase() {
  const database = getDatabase();

  // Columns added after the first release. See addColumnIfMissing.
  const migrations = [
    // Sign in with Google: the subject claim, stable for the life of the account.
    ['users', 'google_id', 'TEXT'],
    // The drawn name, as a PNG data URL. This is what other players see.
    ['users', 'signature', 'TEXT'],
    // Google's profile picture, when they sign in that way.
    ['users', 'avatar_url', 'TEXT'],
  ];

  // Create tables
  database.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      is_guest INTEGER DEFAULT 0,
      display_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_active_at TEXT DEFAULT (datetime('now'))
    );

    -- User statistics table
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      games_played INTEGER DEFAULT 0,
      games_won INTEGER DEFAULT 0,
      total_score INTEGER DEFAULT 0,
      highest_score INTEGER DEFAULT 0,
      correct_answers INTEGER DEFAULT 0,
      incorrect_answers INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Rooms table
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('quickplay', 'multiplayer', 'host')),
      creator_id TEXT REFERENCES users(id),
      settings TEXT,
      status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting', 'in_progress', 'completed')),
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      ended_at TEXT
    );

    -- Room participants table
    CREATE TABLE IF NOT EXISTS room_participants (
      room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'player' CHECK(role IN ('player', 'host', 'spectator')),
      joined_at TEXT DEFAULT (datetime('now')),
      final_score INTEGER DEFAULT 0,
      placement INTEGER,
      PRIMARY KEY (room_id, user_id)
    );

    -- Game history table
    CREATE TABLE IF NOT EXISTS game_history (
      id TEXT PRIMARY KEY,
      room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      genre TEXT,
      categories TEXT,
      final_scores TEXT,
      winner_id TEXT REFERENCES users(id),
      played_at TEXT DEFAULT (datetime('now'))
    );

    -- Highscores table
    CREATE TABLE IF NOT EXISTS highscores (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      genre TEXT,
      game_id TEXT REFERENCES game_history(id),
      achieved_at TEXT DEFAULT (datetime('now'))
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
    CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
    CREATE INDEX IF NOT EXISTS idx_highscores_score ON highscores(score DESC);
  `);

  for (const [table, column, definition] of migrations) {
    try {
      if (addColumnIfMissing(database, table, column, definition)) {
        console.log(`[db] added ${table}.${column}`);
      }
    } catch (err) {
      console.error(`[db] could not add ${table}.${column}:`, err.message);
    }
  }

  /* Two accounts must never share a Google identity. A UNIQUE column will not
     do: google_id is null for everyone who signed up with a password, and
     SQLite treats each null as distinct, so the constraint would be pointless
     for them and a nuisance to reason about. A partial index constrains only
     the rows that actually have one. */
  database.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS users_google_id ' +
    'ON users(google_id) WHERE google_id IS NOT NULL'
  );

  return database;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
