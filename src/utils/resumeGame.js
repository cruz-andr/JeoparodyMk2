/**
 * The game screen as it should be, from what the server says when a page
 * comes back to a room: a reload, a dropped connection, a late join, or a
 * player rejoining by the code.
 *
 * The page used to rebuild only the board. Anyone who came back during a
 * wager, a Continue or Final Jeopardy found no controls, and the room sat
 * waiting on an answer they had no way to give. Everything the page needs is
 * worked out here, so it can be checked without a browser, and the page only
 * has to apply it.
 *
 * `result` is the reconnect or join payload: { status, gameState }. The
 * gameState is the player's view of the room (GameStateManager.
 * publicGameState), with `you` saying where this player stands in whatever
 * the room is waiting on. The host of a hosted room is sent the room's own
 * record instead, which has no `you`.
 */

const LIVE_PHASES = new Set(['playing', 'questionActive', 'dailyDouble', 'dailyDoubleQuestion']);

function screenFor(status, gs) {
  if (status === 'finished' || gs?.phase === 'finished') return 'finished';
  if (!gs || status === 'waiting') return 'lobby';
  if (gs.phase === 'finalJeopardy') return 'finalJeopardy';
  if (gs.phase === 'roundEnd') return 'roundEnd';
  if (LIVE_PHASES.has(gs.phase) || gs.questions?.length) return 'playing';
  return 'lobby';
}

function revealedCells(questions) {
  const cells = [];
  (questions ?? []).forEach((column, c) => {
    (column ?? []).forEach((clue, r) => {
      if (clue?.revealed) cells.push(`${c}-${r}`);
    });
  });
  return cells;
}

function finalJeopardyView(fj, you) {
  if (!fj) return null;
  /* The host's copy says outright whether the clue is up; a player's copy
     only carries the clue once it is. */
  const clueUp = fj.clueShown ?? Boolean(fj.clue);
  const scored = Array.isArray(fj.results);
  const mine = you?.fj;
  return {
    data: {
      category: fj.category,
      clue: clueUp ? (fj.clue ?? null) : null,
      answer: scored ? (fj.answer ?? null) : null,
      // A picture or a clip goes up with the clue, never before it.
      media: clueUp ? (fj.media ?? null) : null,
    },
    phase: scored ? 'reveal' : clueUp ? 'clue' : 'wager',
    wager: mine?.wager ?? 0,
    wagerSubmitted: mine?.wager !== null && mine?.wager !== undefined,
    answerSubmitted: Boolean(mine?.answered),
    results: scored ? fj.results : null,
  };
}

function dailyDoubleView(gs) {
  if (!gs.isDailyDouble || !gs.currentQuestion) return { phase: null, wager: 0, ownerId: null };
  return {
    phase: gs.phase === 'dailyDoubleQuestion' ? 'question' : 'wager',
    wager: gs.dailyDoubleWager || 0,
    ownerId: gs.dailyDoubleOwnerId ?? null,
  };
}

export function resumeView(result) {
  const gs = result?.gameState ?? null;
  const phase = screenFor(result?.status, gs);
  const you = gs?.you ?? {};
  const question = gs?.currentQuestion ?? null;
  const timedOut = Boolean(question && gs?.awaitingContinue);

  return {
    phase,
    categories: gs?.categories ?? null,
    questions: gs?.questions ?? null,
    revealed: revealedCells(gs?.questions),
    currentPickerId: gs?.currentPickerId ?? null,
    currentRound: gs?.currentRound ?? 1,
    currentQuestion: question,
    buzzerWinnerId: gs?.buzzedPlayerId ?? null,
    hostBuzzerOpen: Boolean(gs?.buzzWindowOpen),
    hostAnswerWindowOpen: Boolean(gs?.answerWindowOpen),
    canBuzz: Boolean(question && gs.buzzWindowOpen && !gs.buzzedPlayerId && !you.buzzed && !you.skipped
      && !you.waiting && !gs.isDailyDouble && !timedOut),
    hasAlreadyBuzzed: Boolean(you.buzzed),
    hasSkipped: Boolean(you.skipped),
    hasSubmitted: Boolean(you.submitted),
    buzzTimedOut: timedOut,
    hasContinued: Boolean(timedOut && you.continued),
    dailyDouble: gs ? dailyDoubleView(gs) : { phase: null, wager: 0, ownerId: null },
    finalJeopardy: phase === 'finalJeopardy' || phase === 'finished' ? finalJeopardyView(gs?.finalJeopardy, you) : null,
  };
}
