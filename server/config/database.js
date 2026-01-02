import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DATABASE_PATH || join(__dirname, '../db/jeopardy.sqlite');

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

export async function initializeDatabase() {
  const database = getDatabase();

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

  return database;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
