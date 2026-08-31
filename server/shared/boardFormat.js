/**
 * The shape of a board, agreed once.
 *
 * This lives under server/ because the server image is built from that
 * directory alone: a module the API needs cannot sit in src/ or it simply is
 * not there in production. The client reaches it through the `@shared` alias
 * in vite.config.js.
 *
 * It exists so there is exactly one answer to "is this a board?" and "how many
 * clues are written?". Two validators drifting apart is how a board saves in
 * the browser and 400s on the server, and the two are far enough apart that
 * nobody would notice for weeks.
 *
 * The format is the one questionImport.js already accepts from a file, so a
 * board on disk, a board in the database and a board being played are the same
 * object. No conversion layer, nothing to keep in step.
 */

export const POINT_VALUES = [200, 400, 600, 800, 1000];
export const CATEGORY_COUNT = 6;
export const ROW_COUNT = POINT_VALUES.length;
export const CLUE_COUNT = CATEGORY_COUNT * ROW_COUNT;

export const VISIBILITIES = ['private', 'unlisted', 'public'];

/* Fixed, not free text. A free-text topic field becomes six spellings of
   "history" within a week and the filter stops working. */
export const TOPICS = [
  'history', 'film-tv', 'music', 'science', 'sport',
  'geography', 'wordplay', 'food-drink', 'games', 'everything-else',
];

export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 280;

/**
 * A clue counts when both halves are there.
 *
 * Half a clue is not a hard clue, it is a dead cell: the player picks it and
 * the game has nothing to show or nothing to accept. This one predicate is
 * what the progress meter counts and what the publish gate refuses on, so
 * those two can never disagree about what "finished" means.
 */
export function isWritten(question) {
  return Boolean(
    question &&
    typeof question.answer === 'string' && question.answer.trim() &&
    typeof question.question === 'string' && question.question.trim()
  );
}

export function countClues(board) {
  if (!board || !Array.isArray(board.categories)) return 0;
  let n = 0;
  for (const category of board.categories) {
    if (!Array.isArray(category?.questions)) continue;
    for (const question of category.questions) {
      if (isWritten(question)) n += 1;
    }
  }
  return n;
}

/** True when every category has been named. Empty names are legal in a draft. */
export function allCategoriesNamed(board) {
  return (
    Array.isArray(board?.categories) &&
    board.categories.length === CATEGORY_COUNT &&
    board.categories.every((c) => typeof c?.name === 'string' && c.name.trim())
  );
}

function blankQuestion(points) {
  return {
    points,
    answer: '',
    question: '',
    options: null,
    mediaType: null,
    mediaData: null,
    youtubeStart: null,
    youtubeEnd: null,
    audioOnly: false,
    altText: null,
  };
}

/** A new draft: the full 6x5, every cell empty. */
export function emptyBoard() {
  return {
    version: 1,
    categories: Array.from({ length: CATEGORY_COUNT }, () => ({
      name: '',
      questions: POINT_VALUES.map(blankQuestion),
    })),
    finalJeopardy: null,
  };
}

/**
 * Check the frame, not the contents.
 *
 * A draft is allowed to be empty; what it is not allowed to be is the wrong
 * shape, because everything downstream indexes into [category][row] and trusts
 * the grid is a grid. Whether it is finished is countClues's job, and the two
 * questions are deliberately separate: saving a half-written board must always
 * work, or people lose work.
 */
export function validateBoardStructure(data) {
  const errors = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['A board must be an object'] };
  }
  if (data.version != null && data.version !== 1) {
    errors.push(`Unsupported board version: ${data.version}`);
  }
  if (!Array.isArray(data.categories)) {
    return { valid: false, errors: ['A board must have a categories array'] };
  }
  if (data.categories.length !== CATEGORY_COUNT) {
    errors.push(`A board has ${CATEGORY_COUNT} categories, not ${data.categories.length}`);
  }

  data.categories.forEach((category, c) => {
    const where = `Category ${c + 1}`;

    if (!category || typeof category !== 'object') {
      errors.push(`${where}: not an object`);
      return;
    }
    if (category.name != null && typeof category.name !== 'string') {
      errors.push(`${where}: name must be text`);
    }
    if (typeof category.name === 'string' && category.name.length > 60) {
      errors.push(`${where}: name is too long`);
    }
    if (!Array.isArray(category.questions)) {
      errors.push(`${where}: missing questions`);
      return;
    }
    if (category.questions.length !== ROW_COUNT) {
      errors.push(`${where}: has ${category.questions.length} rows, not ${ROW_COUNT}`);
      return;
    }

    category.questions.forEach((question, r) => {
      const cell = `${where}, $${POINT_VALUES[r]}`;

      if (!question || typeof question !== 'object') {
        errors.push(`${cell}: not an object`);
        return;
      }
      /* Rows are positional. A points value that disagrees with its row would
         put a $1000 clue in the $200 slot on a board nobody re-imports. */
      if (question.points != null && question.points !== POINT_VALUES[r]) {
        errors.push(`${cell}: points say $${question.points}`);
      }
      for (const field of ['answer', 'question']) {
        if (question[field] != null && typeof question[field] !== 'string') {
          errors.push(`${cell}: ${field} must be text`);
        }
        if (typeof question[field] === 'string' && question[field].length > 1000) {
          errors.push(`${cell}: ${field} is too long`);
        }
      }
      if (question.options != null) {
        if (!Array.isArray(question.options) || question.options.length < 2) {
          errors.push(`${cell}: options must be a list of at least two`);
        }
      }
      if (question.mediaType != null && !['image', 'youtube'].includes(question.mediaType)) {
        errors.push(`${cell}: unknown media type "${question.mediaType}"`);
      }
      if (
        question.mediaType === 'youtube' &&
        question.youtubeStart != null && question.youtubeEnd != null &&
        question.youtubeEnd <= question.youtubeStart
      ) {
        errors.push(`${cell}: the clip ends before it starts`);
      }
    });
  });

  if (data.finalJeopardy != null) {
    const fj = data.finalJeopardy;
    if (typeof fj !== 'object' || Array.isArray(fj)) {
      errors.push('Final Jeopardy: not an object');
    } else {
      for (const field of ['category', 'answer', 'question']) {
        if (fj[field] != null && typeof fj[field] !== 'string') {
          errors.push(`Final Jeopardy: ${field} must be text`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Put a valid board into its canonical form.
 *
 * Rows are rebuilt positionally from POINT_VALUES rather than copied, so a
 * board that arrives with its rows shuffled comes out in board order, and
 * every cell has every field whether or not the sender bothered.
 */
function buildOptions(_clue, response, options) {
  if (!Array.isArray(options)) return null;

  const distractors = options.slice(1).map((o) => String(o ?? '').trim()).filter(Boolean);
  if (!distractors.length || !response) return null;

  return [response, ...distractors];
}

export function normalizeBoard(data) {
  const categories = Array.from({ length: CATEGORY_COUNT }, (_, c) => {
    const incoming = data?.categories?.[c] ?? {};
    const rows = Array.isArray(incoming.questions) ? incoming.questions : [];

    return {
      name: String(incoming.name ?? '').trim().toUpperCase().slice(0, 60),
      questions: POINT_VALUES.map((points, r) => {
        const q = rows[r] ?? {};
        const options = Array.isArray(q.options)
          ? q.options.map((o) => String(o ?? '').trim())
          : null;

        return {
          points,
          answer: String(q.answer ?? '').trim(),
          question: String(q.question ?? '').trim(),
          /* Multiple choice, and the one rule that keeps it correct.

             GameStateManager expects the correct answer at index 0 and
             shuffles the four before any player sees them, keeping the correct
             index server-side for scoring. So option zero is DERIVED from the
             response rather than stored beside it. Storing it twice means
             editing the response afterwards leaves a stale index 0, and the
             game marks a right answer wrong, silently, at play time.

             Everything after index 0 is a distractor. An all-blank array is
             the editor's idle state rather than a choice, so it becomes null:
             otherwise every clue would be a multiple-choice clue with four
             empty answers. */
          options: buildOptions(String(q.answer ?? '').trim(), String(q.question ?? '').trim(), options),
          mediaType: q.mediaType ?? null,
          mediaData: q.mediaData ?? null,
          youtubeStart: q.youtubeStart ?? null,
          youtubeEnd: q.youtubeEnd ?? null,
          audioOnly: Boolean(q.audioOnly),
          altText: q.altText ?? null,
        };
      }),
    };
  });

  const fj = data?.finalJeopardy;
  const finalJeopardy =
    fj && (fj.category || fj.answer || fj.question)
      ? {
          category: String(fj.category ?? '').trim().toUpperCase(),
          answer: String(fj.answer ?? '').trim(),
          question: String(fj.question ?? '').trim(),
        }
      : null;

  return { version: 1, categories, finalJeopardy };
}

/**
 * What stands between a board and Community Boards.
 *
 * Returns a human sentence or null. Deliberately one reason at a time and in
 * the order a person would fix them, rather than a list of everything wrong:
 * "name your last two categories" is actionable, a wall of thirty complaints
 * is not.
 */
/** 'none', 'partial' or 'complete'. Partial is the only one that is a problem. */
export function finalJeopardyState(board) {
  const fj = board?.finalJeopardy;
  const parts = [fj?.category, fj?.answer, fj?.question]
    .map((value) => Boolean(value && String(value).trim()));
  if (parts.every((part) => !part)) return 'none';
  return parts.every(Boolean) ? 'complete' : 'partial';
}

export function publishProblem({ title, board }) {
  if (!title || !title.trim()) return 'Give the board a title first.';
  if (title.trim().length > MAX_TITLE) return `Titles are ${MAX_TITLE} characters or fewer.`;

  if (!allCategoriesNamed(board)) {
    const unnamed = (board?.categories ?? []).filter((c) => !c?.name?.trim()).length;
    return unnamed === 1
      ? 'One category still needs a name.'
      : `${unnamed} categories still need names.`;
  }

  const written = countClues(board);
  if (written < CLUE_COUNT) {
    const left = CLUE_COUNT - written;
    return left === 1
      ? 'One clue is still empty. It is marked on your board.'
      : `${left} clues are still empty. They are marked on your board.`;
  }

  /* Final Jeopardy is optional: plenty of boards will not want one, and the
     player can turn the round off anyway. What is not allowed is half of one,
     because that is a clue with no answer waiting at the end of a game. */
  if (finalJeopardyState(board) === 'partial') {
    return 'Final Jeopardy is half written. Finish all three parts or clear it.';
  }

  return null;
}
