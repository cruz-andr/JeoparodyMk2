/**
 * Watching along with one of the show's episodes: the video plays, and stops
 * a moment before each answer for the player's own.
 *
 * Plain functions over the board's timeline (the `watch` the server sends
 * with a house board), so the rules can be tested without a video.
 */

// How far past a stop the video can be and still stop there: a poll every
// quarter second at normal speed is never later than this.
const CATCH = 1.5;

/** The stops in the order they come: each clue, then Final. */
export function stopsFor(watch, board) {
  const clues = watch.clues
    .filter((c) => board.categories[c.column]?.questions[c.row])
    .map((c) => ({
      key: `${c.column}:${c.row}`,
      column: c.column,
      row: c.row,
      at: c.at,
      pause: c.pause,
      category: board.categories[c.column].name,
      clue: board.categories[c.column].questions[c.row],
    }));
  const final = watch.final && board.finalJeopardy
    ? [{ key: 'final', final: true, at: watch.final.at, pause: watch.final.pause, category: board.finalJeopardy.category, clue: board.finalJeopardy }]
    : [];
  return [...clues.sort((a, b) => a.pause - b.pause), ...final];
}

/** Where a square on the board takes the video: a second before its clue comes up, to see it come. */
export function startOf(stop) {
  return Math.max(0, stop.at - 1);
}

/**
 * Where the video is now, against the stops: the one to stop at, and the
 * ones it went past without stopping (skipped ahead), which do not count.
 * Stops already settled are left alone, so going back never asks again.
 */
export function reached(stops, settled, t) {
  let ask = null;
  const skipped = [];
  for (const stop of stops) {
    if (settled.has(stop.key) || stop.pause > t) continue;
    if (t - stop.pause <= CATCH && !ask) ask = stop;
    else if (t - stop.pause > CATCH) skipped.push(stop);
  }
  return { ask, skipped };
}

/** What a response is worth: the clue's points, or the wager on Final. Wrong takes it away. */
export function scored(stop, correct, wager = 0) {
  const worth = stop.final ? wager : stop.clue.points;
  return correct ? worth : -worth;
}
