/**
 * What the projector is allowed to know.
 *
 * In projector mode the host's screen used to be the screen on the wall, and
 * that same screen showed the correct answer. This splits them: the host keeps
 * their screen, and the board goes to a second window driven from here.
 *
 * The wall gets a deliberately narrow copy of the game. Everything is picked
 * out by hand rather than spread from the host's state, so a field added to a
 * clue later cannot quietly end up projected.
 *
 * Pure and import-free so it can be tested with plain node.
 */

export const CHANNEL = (roomCode) => `jeoparody-projector-${roomCode}`;

/** A clue as the room may see it: the text, never the response. */
export function clueForRoom(question) {
  if (!question) return null;
  return {
    category: question.category ?? '',
    points: question.points ?? 0,
    /* `answer` is the clue that is read out and `question` is the response,
       which is Jeopardy's naming and the source of this hazard. Only the
       first of them is ever copied. */
    text: question.answer ?? '',
    mediaType: question.mediaType ?? null,
    mediaData: question.mediaData ?? null,
    youtubeStart: question.youtubeStart ?? null,
    youtubeEnd: question.youtubeEnd ?? null,
    audioOnly: question.audioOnly ?? false,
    altText: question.altText ?? null,
    /* Multiple choice is shown to the room by design, and the options are
       already on every player's screen. Order is kept as sent. */
    options: Array.isArray(question.options) ? [...question.options] : null,
  };
}

export function forProjector({
  categories = [],
  questions = [],
  revealed = [],
  currentRound = 1,
  currentQuestion = null,
  players = [],
  buzzedPlayerId = null,
  buzzerOpen = false,
  showAnswer = false,
} = {}) {
  return {
    categories: categories.map((c) => (typeof c === 'string' ? c : c?.name ?? '')),
    /* Only what the board draws: a value and whether it is gone. The clue text
       for thirty cells has no business on the wall before it is picked. */
    grid: questions.map((column) => (column ?? []).map((q) => ({ points: q?.points ?? 0 }))),
    revealed: [...revealed],
    currentRound,
    clue: clueForRoom(currentQuestion),
    /* Revealed deliberately, at the end of a clue, and never any other time. */
    response: showAnswer && currentQuestion ? currentQuestion.question ?? '' : null,
    scores: players
      .filter((p) => !p.isHost)
      .map((p) => ({
        id: p.id,
        name: p.displayName || p.name || '',
        score: p.score || 0,
        signature: p.signature ?? null,
      })),
    buzzedName: buzzedPlayerId
      ? players.find((p) => p.id === buzzedPlayerId)?.displayName
        ?? players.find((p) => p.id === buzzedPlayerId)?.name ?? null
      : null,
    buzzerOpen,
  };
}
