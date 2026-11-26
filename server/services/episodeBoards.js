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
import { toDateString } from '../shared/archiveWindow.js';
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

/* What a room's board is called. A day from the archive is named for the day
   picked, the way the archive names it ("Today's Board", "Thu, Nov 26"), not
   for when its episode aired, which would read as the date it was picked. A
   random episode has no day picked, so it goes by its air date instead:
   "March 5, 2019 Board". */
const pickedDayTitle = (date, today = toDateString()) => (date === today
  ? "Today's Board"
  : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }));

const airedTitle = (airDate) => (airDate
  ? `${new Date(`${airDate}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })} Board`
  : 'A random Board');

export function createEpisodeBoards({ fetchGame = fetchGameById, mode = 'archive', random = Math.random, log = () => {} } = {}) {
  const source = createBoardSource({ mode, fetchGame, random, log });

  return {
    async forDate(date) {
      const { gameId } = await getDailyChallenge({ date, fetchGame });
      const game = gameFromDay(await fetchGame(gameId));
      if (!game) throw new Error(`episode ${gameId} has no Jeopardy round`);
      return episodeRoomBoard(game, { title: pickedDayTitle(date) });
    },

    async random() {
      const game = await source.take();
      const real = String(game.source ?? '').startsWith('j-archive:');
      return episodeRoomBoard(game, { title: real ? airedTitle(game.airDate) : 'The house board' });
    },
  };
}
