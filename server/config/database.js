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
      /* Three names, three jobs, and they are not interchangeable:
           username     the handle. Unique, typed, how you are found and added.
           signature    the drawing. What players actually see, everywhere a
                        player is shown: the lobby, the podium, Quickplay.
                        Multiplayer will not let you join without one.
           display_name text, and it is read far less than it looks. Every
                        player list renders the drawing; this is the alt text
                        on it, the host control panel's plain list, and the
                        fallback wherever a drawing is missing. Guests are
                        given one, which is why it stays NOT NULL.

         There is no leaderboard showing other players: the highscores page is
         your own local stats, and the /api/leaderboard routes are called by
         nothing. Worth knowing before building anything that assumes one. */
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

    /* Boards built by players.

       The data column holds the board itself as the JSON that boardFormat.js
       validates, which is the same shape questionImport.js already accepts from
       a file. So a board on disk, a board in this column and a board being
       played are one object with no conversion between them.

       Two columns are denormalised on purpose:
         clue_count   the publish gate and the progress meter both need it, and
                      neither should parse 30 clues of JSON to get it.
         plays        the only ranking signal, so it is read constantly.

       cover_image and data are both large and are never selected by any list
       query. See the SELECTs in routes/boards.js. */
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      /* What a shared link carries. Random, never derived from the title:
         "anyone with the link" is only private if the link cannot be guessed. */
      slug TEXT UNIQUE NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      topic TEXT,
      cover_image TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      data TEXT NOT NULL,
      clue_count INTEGER NOT NULL DEFAULT 0,
      plays INTEGER NOT NULL DEFAULT 0,
      /* The attribution. A copy keeps the pointer home, and ON DELETE SET NULL
         means deleting an original orphans its copies rather than taking them
         down with it. */
      copied_from TEXT REFERENCES boards(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      published_at TEXT
    );

    /* One row per person per board, which is what makes the plays column
       mean something.

       A bare counter is a reload button: the number it produces says how many
       times a page was opened, and the thing anyone actually wants to know is
       how many people played. Distinct players cannot be inflated by
       refreshing, and it is the honest answer to "did anyone finish this".

       viewer is 'u:<user id>' for someone signed in, and 'a:<hash>' for
       everyone else. An account is one person wherever they sit; an anonymous
       key is a per-browser id, which is a deduplicator rather than a security
       boundary, and the rate limiter is what stops anyone minting them fast. */
    CREATE TABLE IF NOT EXISTS board_plays (
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      viewer TEXT NOT NULL,
      first_played_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (board_id, viewer)
    ) WITHOUT ROWID;

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
    CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
    CREATE INDEX IF NOT EXISTS idx_highscores_score ON highscores(score DESC);

    -- The two queries that run most: my shelf, and the popular row.
    CREATE INDEX IF NOT EXISTS idx_boards_owner ON boards(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_boards_public ON boards(visibility, plays DESC);
    CREATE INDEX IF NOT EXISTS idx_boards_new ON boards(visibility, published_at DESC);
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
