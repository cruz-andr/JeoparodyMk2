/**
 * One shape for a person's record, wherever it came from.
 *
 * Signed in, the record is the server's archive. Signed out, it is whatever
 * localStorage has kept, which is an older shape with different names. The
 * pages that show a record should not know which they are looking at, so
 * both are turned into this:
 *
 *   {
 *     stats: { gamesPlayed, gamesWon, bestScore, avgScore, correct, total, accuracy },
 *     games: [{ id, mode, score, correct, total, categories, genre, playedAt }],
 *   }
 *
 * Pure functions only, so the file runs under plain node for its test.
 */

export const MODE_LABELS = {
  single: 'Solo',
  multiplayer: 'Multiplayer',
  quickplay: 'Quickplay',
  host: 'Hosted',
};

export function modeLabel(mode) {
  return MODE_LABELS[mode] || 'Game';
}

/** "$1,200", "-$400". Nothing is shown as "$0" rather than a dash. */
export function money(n) {
  const value = Number.isFinite(n) ? n : 0;
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US')}`;
}

export function accuracyOf(correct, total) {
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

/**
 * The stored time, as a Date.
 *
 * SQLite's datetime('now') writes "YYYY-MM-DD HH:MM:SS" in UTC with no zone
 * marker, which a browser would read as local time and place a few hours off.
 * ISO strings with a zone pass through as they are.
 */
export function parsePlayedAt(value) {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || !value) return null;
  const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  const date = new Date(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "Today", "Yesterday", "4 days ago", then a short date. Relative words only
 * for the first week: beyond that a date is quicker to read than "23 days".
 */
export function whenPlayed(value, now = new Date()) {
  const date = parsePlayedAt(value);
  if (!date) return '';
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * What a game was about, in a few words.
 *
 * The genre when there was one, else the first few category names with a
 * count for the rest, else the mode. The AI path has a genre; a community
 * board has a title in the genre slot; a room has only its categories.
 */
export function describeGame(game, { shown = 3 } = {}) {
  if (game?.genre && game.genre.trim()) return game.genre.trim();
  const names = (game?.categories || []).filter((c) => typeof c === 'string' && c.trim());
  if (names.length === 0) return modeLabel(game?.mode);
  if (names.length <= shown) return names.join(', ');
  const rest = names.length - shown;
  return `${names.slice(0, shown).join(', ')} and ${rest} more`;
}

const emptyStats = () => ({
  gamesPlayed: 0, gamesWon: 0, totalScore: 0, bestScore: 0, avgScore: 0,
  correct: 0, total: 0, accuracy: 0, lastPlayedAt: null,
});

/**
 * The localStorage record, in the common shape.
 *
 * The old store kept its top fifty by score and called them highscores. As a
 * list of recent games that order is wrong, so they are re-sorted by date. A
 * local entry has no mode unless a room game wrote one; the ones written
 * before that field existed were all solo.
 */
export function localRecord({ stats, localHighscores } = {}) {
  const s = stats || {};
  const games = (localHighscores || [])
    .map((entry) => ({
      id: entry.id,
      mode: entry.mode || 'single',
      score: entry.score || 0,
      correct: entry.questionsCorrect ?? null,
      total: entry.questionsTotal ?? null,
      categories: Array.isArray(entry.categories) ? entry.categories : [],
      genre: entry.genre || null,
      playedAt: entry.date || null,
    }))
    .sort((a, b) => (parsePlayedAt(b.playedAt)?.getTime() || 0) - (parsePlayedAt(a.playedAt)?.getTime() || 0));

  const gamesPlayed = s.gamesPlayed || 0;
  const correct = s.correctAnswers || 0;
  const total = s.totalAnswers || 0;
  return {
    stats: {
      ...emptyStats(),
      gamesPlayed,
      gamesWon: s.gamesWon || 0,
      totalScore: s.totalScore || 0,
      bestScore: s.highestScore || 0,
      avgScore: gamesPlayed ? Math.round((s.totalScore || 0) / gamesPlayed) : 0,
      correct,
      total,
      accuracy: accuracyOf(correct, total),
      lastPlayedAt: games[0]?.playedAt || null,
    },
    games,
  };
}

/** The server's answer, in the common shape. Mostly a guard against gaps. */
export function apiRecord({ stats, games } = {}) {
  return {
    stats: { ...emptyStats(), ...(stats || {}) },
    games: (games || []).map((g) => ({
      id: g.id,
      mode: g.mode || 'single',
      score: g.score || 0,
      correct: g.correct ?? null,
      total: g.total ?? null,
      categories: Array.isArray(g.categories) ? g.categories : [],
      genre: g.genre || null,
      playedAt: g.playedAt || null,
    })),
  };
}
