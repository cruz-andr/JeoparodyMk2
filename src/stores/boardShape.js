/**
 * Between the stored board and the store the editors already speak.
 *
 * hostStore holds a board as two parallel things: `categories`, a list of six
 * names, and `questions`, a 6x5 grid of clue objects that repeat the category
 * name on every cell. A stored board nests instead, one category owning its
 * five clues, because that is the shape questionImport has always read from a
 * file and there was no reason to invent a second one.
 *
 * Neither shape is wrong, and converting is four lines each way, so this is the
 * whole of the seam. It is kept free of imports on purpose: it is pure, so it
 * is tested by running it, and a test that needs a bundler to resolve an alias
 * is a test nobody runs.
 */

/** Stored board to what hostStore, QuestionEditor and the game all expect. */
export function boardToHost(board) {
  const categories = (board?.categories ?? []).map((c) => c?.name ?? '');

  const questions = (board?.categories ?? []).map((category, categoryIndex) =>
    (category?.questions ?? []).map((q) => ({
      /* Repeated on every cell because that is what the game reads when it
         puts a clue on screen. It is derived, never edited: renaming a
         category has to go through categories[], or the tile and the clue
         header start disagreeing. */
      category: categories[categoryIndex] ?? '',
      points: q?.points ?? null,
      answer: q?.answer ?? '',
      question: q?.question ?? '',
      options: q?.options ?? null,
      revealed: false,
      mediaType: q?.mediaType ?? null,
      mediaData: q?.mediaData ?? null,
      youtubeStart: q?.youtubeStart ?? null,
      youtubeEnd: q?.youtubeEnd ?? null,
      audioOnly: q?.audioOnly ?? false,
      altText: q?.altText ?? null,
    }))
  );

  return { categories, questions };
}

/**
 * Back the other way.
 *
 * `categories` wins over the category name carried on each clue, because the
 * name a person typed lives in categories[] and the copy on the clue is a
 * stale echo of it the moment they retype it.
 */
export function hostToBoard(categories, questions, finalJeopardy = null) {
  return {
    version: 1,
    categories: (categories ?? []).map((name, categoryIndex) => ({
      name: name ?? '',
      questions: (questions?.[categoryIndex] ?? []).map((q) => ({
        points: q?.points ?? null,
        answer: q?.answer ?? '',
        question: q?.question ?? '',
        options: q?.options ?? null,
        mediaType: q?.mediaType ?? null,
        mediaData: q?.mediaData ?? null,
        youtubeStart: q?.youtubeStart ?? null,
        youtubeEnd: q?.youtubeEnd ?? null,
        audioOnly: q?.audioOnly ?? false,
        altText: q?.altText ?? null,
      })),
    })),
    finalJeopardy: finalJeopardy ?? null,
  };
}

/**
 * Which cells are written, as a flat 6x5 of booleans in board order.
 *
 * The editor draws this as a miniature of the board, so the progress meter and
 * the thing it measures are the same picture. It uses the same rule as the
 * server: a clue needs both halves or it is a cell a player would pick and
 * find nothing behind.
 */
export function writtenGrid(board) {
  return (board?.categories ?? []).map((category) =>
    (category?.questions ?? []).map((q) =>
      Boolean(q?.answer?.trim() && q?.question?.trim())
    )
  );
}
