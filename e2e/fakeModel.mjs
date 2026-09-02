/**
 * A model that answers instantly and costs nothing.
 *
 * Installed into the page before anything loads, it takes over the fetch the
 * app makes to the server's /api/ai routes and answers it from here. Every
 * screen that depends on a model can then be driven offline, at whatever
 * speed the test needs, with no key and no quota.
 *
 * It answers in the shape the server answers in: the JSON the page reads on
 * success, and { error: { message } } with a status on failure. The server
 * itself is never asked, so this covers the page and not the route; the route
 * has its own suite in server/test/aiRoutes.test.js.
 */

const PATH = '/api/ai/';

export const NAMES = [
  'VOLCANIC VITICULTURE', 'CRYOVOLCANOLOGY', 'LAVA IN THE LIBRARY',
  'OFF-WORLD ERUPTIONS', 'SUBMARINE SEAMOUNTS', 'TEPHRA & TUFF',
];

const CLUES = {
  200: ['This Italian volcano buried Pompeii in 79 AD', 'What is Vesuvius?'],
  400: ['This Sicilian peak is the tallest active volcano in Europe', 'What is Etna?'],
  600: ['The 1883 eruption of this Indonesian island was heard 3,000 miles away', 'What is Krakatoa?'],
  800: ['This Icelandic eruption grounded European flights for six days in 2010', 'What is Eyjafjallajokull?'],
  1000: ['This shield volcano on Mars is the tallest in the solar system', 'What is Olympus Mons?'],
};

const board = (names, values) => ({
  categories: names.map((name) => ({
    name,
    questions: values.map((points) => ({
      points,
      answer: CLUES[points]?.[0] ?? `A clue worth $${points}`,
      question: CLUES[points]?.[1] ?? 'What is it?',
    })),
  })),
});

/**
 * @param names    what the first call answers with
 * @param values   the row values the second call fills
 * @param delays   how long each call takes, so a screen can be caught mid work
 * @param failWith optional { status, message } to answer with instead
 */
export function fakeModel({ names = NAMES, values = [200, 400, 600, 800, 1000],
  delays = { categories: 1500, questions: 2500 }, failWith = null } = {}) {
  return `(() => {
    const real = window.fetch.bind(window);
    const names = ${JSON.stringify(names)};
    const clues = ${JSON.stringify(CLUES)};
    const delays = ${JSON.stringify(delays)};
    const failWith = ${JSON.stringify(failWith)};
    const fallbackValues = ${JSON.stringify(values)};

    const json = (body, status) => new Response(JSON.stringify(body),
      { status, headers: { 'Content-Type': 'application/json' } });

    window.fetch = async (input, init) => {
      const url = String(typeof input === 'string' ? input : input?.url ?? '');
      const at = url.indexOf(${JSON.stringify(PATH)});
      if (at < 0) return real(input, init);
      const route = url.slice(at + ${PATH.length}).split(/[?#]/)[0];

      let sent = {};
      try { sent = JSON.parse(String(init?.body ?? '{}')); } catch { /* not JSON */ }

      const wait = route === 'categories' ? delays.categories : delays.questions;
      await new Promise((r) => setTimeout(r, wait));

      if (failWith) return json({ error: { message: failWith.message, code: 'AI_FAKE' } }, failWith.status);

      if (route === 'categories') return json(names, 200);
      if (route === 'category') return json({ category: names[Number(sent.index) || 0] ?? names[0] }, 200);
      if (route === 'questions') {
        /* The page tells the server which names and values it wants written,
           and gets back a board for exactly those. */
        const asked = Array.isArray(sent.categories) && sent.categories.length ? sent.categories : names;
        const values = Array.isArray(sent.pointValues) && sent.pointValues.length === 5
          ? sent.pointValues : fallbackValues;
        return json({
          categories: asked.map((name) => ({
            name,
            questions: values.map((points) => ({
              points,
              answer: clues[points]?.[0] ?? 'A clue worth $' + points,
              question: clues[points]?.[1] ?? 'What is it?',
            })),
          })),
        }, 200);
      }
      if (route === 'final') {
        return json({ category: 'FINAL ERUPTIONS', answer: clues[1000][0], question: clues[1000][1] }, 200);
      }
      if (route === 'mc-options') {
        return json({ options: [sent.response ?? '', 'What is Etna?', 'What is Krakatoa?', 'What is Vesuvius?'] }, 200);
      }
      if (route === 'validate') {
        return json({ isCorrect: true, confidence: 1, reason: 'fake' }, 200);
      }
      return json({ error: { message: 'No such route.', code: 'NOT_FOUND' } }, 404);
    };
  })();`;
}

/* Kept for anything that wants the answer shape without the page. */
export const fakeBoard = board;
