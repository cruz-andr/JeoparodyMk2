/**
 * What the host should be doing right now.
 *
 * A host running a room is not reading a screen, they are looking at people.
 * So the screen has one job: answer "what now?" without being studied. Every
 * moment of a clue is one of a handful of stages, and each stage has exactly
 * one obvious next action.
 *
 * Pure and import-free so it can be tested with plain node.
 */

/** Modes where players type or tap instead of buzzing and speaking. */
const WINDOW_MODES = ['typed', 'multiple_choice', 'auto_grade'];

export const isWindowMode = (answerMode) => WINDOW_MODES.includes(answerMode);

/**
 * @returns one of:
 *   'picking'      no clue is open; the board is the thing to look at
 *   'reading'      a clue is open and shut to answers; the host reads it out
 *   'waiting'      answers are open and nothing has come back yet
 *   'judging'      somebody is waiting on a verdict
 *   'wagering'     a Daily Double wager is being entered
 */
export function hostStage({
  currentQuestion,
  answerMode = 'verbal',
  isDailyDouble = false,
  dailyDoublePhase = null,
  buzzerOpen = false,
  answerWindowOpen = false,
  buzzedPlayerId = null,
  answers = [],
  judgedPlayerIds = [],
} = {}) {
  if (!currentQuestion) return 'picking';
  /* A Daily Double is not buzzed for. One player owns it, so it goes straight
     from naming them and their wager to judging them. */
  if (isDailyDouble) return dailyDoublePhase === 'wager' ? 'wagering' : 'judging';

  if (isWindowMode(answerMode)) {
    /* An answer already judged is not waiting on anything, so a host who has
       worked through every submission is not still "judging". */
    const pending = answers.filter((a) => !judgedPlayerIds.includes(a.playerId));
    if (pending.length) return 'judging';
    return answerWindowOpen ? 'waiting' : 'reading';
  }

  if (buzzedPlayerId) return 'judging';
  return buzzerOpen ? 'waiting' : 'reading';
}

/**
 * The line at the top of the rail. It names the moment rather than the screen,
 * because a host glancing down needs to be told what is happening, not where
 * they are.
 */
export function stageHeading(stage, answerMode = 'verbal') {
  switch (stage) {
    case 'picking': return 'Pick a clue';
    case 'reading': return 'Read the clue out';
    case 'waiting': return isWindowMode(answerMode) ? 'Waiting for answers' : 'Waiting for a buzz';
    case 'judging': return 'Was that right?';
    case 'wagering': return 'Daily Double';
    default: return '';
  }
}

/**
 * The one button that matters at this moment, or null when the next move is
 * not a button (picking from the board, judging a named person, waiting on a
 * wager). Returning null is what keeps the rail from growing a button that
 * does nothing.
 */
export function primaryAction(stage, answerMode = 'verbal') {
  const windowed = isWindowMode(answerMode);
  if (stage === 'reading') {
    /* "now", because the server opens it by itself a few seconds after the
       clue goes up. This button is for a host who has finished reading early,
       so a label promising to do something that was going to happen anyway
       would be a lie. */
    return windowed
      ? { event: 'host:open-answer-window', label: 'Open answers now' }
      : { event: 'host:open-buzzer', label: 'Open the buzzer now' };
  }
  if (stage === 'waiting') {
    return windowed
      ? { event: 'host:close-answer-window', label: 'Close answers' }
      : { event: 'host:close-buzzer', label: 'Close the buzzer' };
  }
  return null;
}

/** Scores, biggest first, with the host left out: they never have one. */
export function standings(players = []) {
  return players
    .filter((p) => !p.isHost)
    .map((p) => ({ ...p, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score || String(a.displayName ?? a.name ?? '')
      .localeCompare(String(b.displayName ?? b.name ?? '')));
}

/** "$1,200" and "-$200", never "$-200". */
export function money(score) {
  const n = Math.abs(score || 0);
  return `${(score || 0) < 0 ? '-' : ''}$${n.toLocaleString()}`;
}

/** A reaction time a person can read at a glance. */
export function reaction(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/** How far through the round the room is. */
export function cluesLeft(questions = [], revealed = new Set()) {
  let total = 0;
  for (const column of questions) total += column?.length ?? 0;
  return Math.max(0, total - revealed.size);
}
