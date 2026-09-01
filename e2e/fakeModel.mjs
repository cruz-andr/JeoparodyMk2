/**
 * A model that answers instantly and costs nothing.
 *
 * Installed into the page before anything loads, it takes over the fetch the
 * Gemini SDK makes and answers it from here. Every screen that depends on a
 * model can then be driven offline, at whatever speed the test needs, with no
 * key and no quota.
 */

const HOST = 'generativelanguage.googleapis.com';

/** The envelope the SDK unwraps to reach response.text(). */
const reply = (text) => JSON.stringify({
  candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }],
});

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

const board = (names, values) => JSON.stringify({
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
    const values = ${JSON.stringify(values)};
    const delays = ${JSON.stringify(delays)};
    const failWith = ${JSON.stringify(failWith)};
    const catsBody = ${JSON.stringify(reply(JSON.stringify(NAMES)))};
    const boardBody = ${JSON.stringify(reply(board(NAMES, [200, 400, 600, 800, 1000])))};

    window.fetch = async (input, init) => {
      const url = String(typeof input === 'string' ? input : input?.url ?? '');
      if (!url.includes(${JSON.stringify(HOST)})) return real(input, init);

      /* The two calls differ by what the prompt asks for, which is the only
         thing this needs to tell them apart. */
      const sent = String(init?.body ?? '');
      const wantsCategories = sent.includes('Generate 6 unique');
      const wait = wantsCategories ? delays.categories : delays.questions;
      await new Promise((r) => setTimeout(r, wait));

      if (failWith) {
        return new Response(JSON.stringify({ error: { message: failWith.message } }),
          { status: failWith.status, headers: { 'Content-Type': 'application/json' } });
      }

      const body = wantsCategories
        ? catsBody
        : ${JSON.stringify(reply(board(NAMES, [200, 400, 600, 800, 1000])))};
      void names; void values; void boardBody;
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  })();`;
}
