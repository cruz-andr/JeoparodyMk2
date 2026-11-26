/**
 * Real episodes for private rooms: the boards a room can play without anyone
 * writing them, and without a model to write them either.
 *
 *   forDate(date)  the episode a day from the archive was drawn from: its
 *                  Jeopardy round is that day's Board, then its Double
 *                  Jeopardy round when J-Archive has all of it, and its Final.
 *   random()       a random episode, the way quickplay deals one, or the house
 *                  board when the archive cannot be reached.
 */
import { fetchGameById, getDailyChallenge } from './jarchiveScraper.js';
import { buildBoard, DOUBLE_ROW_VALUES } from './dailyBuilder.js';
import { createBoardSource, toGrid } from '../socket/quickplay.js';
import { episodeRoomBoard } from './roomBoards.js';

/* An episode's rounds, as far as it has them. The Jeopardy round always
   builds for a day in the archive (it is that day's Board), but some aired
   Double Jeopardy rounds are missing clues J-Archive never recorded, and the
   day still plays: one round and the Final, as a community board does. */
function gameFromDay(episode) {
  const clues = episode?.clues ?? [];
  const first = buildBoard(clues.filter((c) => c.round === 'jeopardy'));
  if (!first) return null;
  const second = buildBoard(clues.filter((c) => c.round === 'double_jeopardy'), { values: DOUBLE_ROW_VALUES });
  return {
    round1: { categories: first.categories, questions: toGrid(first) },
    round2: second ? { categories: second.categories, questions: toGrid(second) } : null,
    final: episode.final
      ? { category: episode.final.category, answer: episode.final.clue, question: episode.final.answer }
      : null,
  };
}

const dayName = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
});

export function createEpisodeBoards({ fetchGame = fetchGameById, mode = 'archive', random = Math.random, log = () => {} } = {}) {
  const source = createBoardSource({ mode, fetchGame, random, log });

  return {
    async forDate(date) {
      const { gameId } = await getDailyChallenge({ date, fetchGame });
      const game = gameFromDay(await fetchGame(gameId));
      if (!game) throw new Error(`episode ${gameId} has no Jeopardy round`);
      return episodeRoomBoard(game, { title: `The episode from ${dayName(date)}` });
    },

    async random() {
      const game = await source.take();
      const real = String(game.source ?? '').startsWith('j-archive:');
      return episodeRoomBoard(game, { title: real ? 'A random real episode' : 'The house board' });
    },
  };
}
