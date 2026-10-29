/**
 * Grading a typed response against the board's correct response.
 *
 * One copy, for the server (quickplay, Final Jeopardy, hosted auto-grading)
 * and for the daily pages. There used to be two, a hand-port of the other,
 * and both were a single string compared with a containment test and an edit
 * distance. That took "Charles I" for Charles II, "Sophie Hawkins Dance" for
 * Sadie Hawkins Dance and "beach volleyball" for volleyball, and refused
 * "Batman" for "Bruce Wayne (Batman)", "Beethoven" for "(Ludwig van)
 * Beethoven" and "Henry 8" for Henry VIII.
 *
 * It works in three steps.
 *
 *   1. The board's response is expanded into the forms it accepts. J-Archive
 *      writes alternates into the response itself: an optional leading
 *      parenthetical, an alternate name in a trailing one, "(or ...)",
 *      "(... also accepted)", "(1 of)" lists, slashes.
 *   2. Both sides are reduced to words: accents, case, punctuation and the
 *      "What is" wrapper go; "&" is "and"; St. is Saint; three is 3; VIII is 8.
 *   3. Every significant word of a form must be matched by a word of the
 *      answer, with typos forgiven in proportion to the word's length. Numbers
 *      must match exactly. An answer may add a generic word ("the novel Moby
 *      Dick") but not one that changes it ("beach volleyball").
 *
 * An answer that misses only by spelling is 'close', which a game can use to
 * ask for the spelling again without saying what the answer is.
 *
 * Checked against 692 responses Jeopardy!'s judges ruled wrong (none may pass)
 * in server/test/answerMatch.test.js.
 */

// ------------------------------------------------------------ the forms

/* A trailing parenthetical that starts like one of these explains the
   response rather than naming it another way: "Nagano, Japan (this past
   winter)" does not make "this past winter" right. */
const EXPLAINS = new Set([
  'for', 'this', 'that', 'these', 'in', 'as', 'from', 'on', 'at', 'by', 'during', 'with', 'since',
  'after', 'before', 'which', 'who', 'when', 'where', 'ie', 'eg', 'not', 'but', 'its', 'his', 'her',
]);

const squash = (s) => s.replace(/\s+/g, ' ').replace(/\s+([,;:])/g, '$1').trim();
const firstWord = (s) => s.trim().toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/)[0] ?? '';

const tidy = (text) => {
  const s = squash(String(text ?? '').replace(/[“”]/g, '"'));
  return /^".*"$/.test(s) ? s.slice(1, -1) : s;
};

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, any: 1 };

/* "(1 of) Kentucky (Missouri, Maryland, Delaware)", "(2 of) Carter &
   Clinton": a list, and how many of it an answer has to name. */
function listOf(text) {
  const m = tidy(text).match(/^\(\s*(\d+|one|two|three|four|five|any)\s+of\s*\)\s*(.*)$/i);
  if (!m) return null;
  const need = Number(m[1]) || NUMBER_WORDS[m[1].toLowerCase()] || 1;
  /* A trailing bracket of more names is more of the list; any other bracket
     belongs to its item, "(Richard) Nixon", and is expanded with it. */
  const items = m[2]
    .replace(/\(\s*or\s+([^()]*)\)/gi, ', $1')
    .replace(/\(([^()]*[,&][^()]*)\)\s*$/, ', $1')
    .split(/,|&|\band\b|\bor\b/i)
    .map(squash).filter(Boolean);
  return { need, items };
}

function expand(text) {
  const s = tidy(text);
  if (!s) return [];

  const list = listOf(s);
  if (list) return list.items.flatMap(expand);

  /* A letter or two in brackets inside a word: Mo(o)re. */
  const partial = s.match(/(\w)\(([a-z]{1,3})\)|\(([a-z]{1,3})\)(\w)/i);
  if (partial) {
    return [
      ...expand(s.replace(partial[0], partial[0].replace(/[()]/g, ''))),
      ...expand(s.replace(partial[0], partial[0].replace(/\([a-z]{1,3}\)/i, ''))),
    ];
  }

  /* The first parenthetical, then whatever is left in the rest. */
  const paren = s.match(/\(([^()]*)\)/);
  if (paren) {
    const inner = squash(paren[1]);
    const without = squash(s.replace(paren[0], ' '));
    const withIt = squash(s.replace(paren[0], ` ${inner} `));
    const alternate = inner.match(/^(?:or|accept|also|or accept)\s+(.*)$/i)
      ?? inner.match(/^(.*?)\s+(?:is\s+)?(?:also\s+)?accepted$/i);
    if (alternate) {
      /* At the end it names the whole thing another way; in the middle, the
         word before it: "cash (or collect) on delivery". */
      const after = s.slice(s.indexOf(paren[0]) + paren[0].length).trim();
      if (!after) return [...expand(without), ...expand(alternate[1])];
      const before = s.slice(0, s.indexOf(paren[0])).trim().split(' ').slice(0, -1).join(' ');
      return [...expand(without), ...expand(`${before} ${alternate[1]} ${after}`)];
    }

    const leading = s.startsWith(paren[0]);
    const trailing = s.endsWith(paren[0]) && !leading;
    const forms = [...expand(without), ...expand(withIt)];
    if (trailing && inner && !EXPLAINS.has(firstWord(inner))) forms.push(...expand(inner));
    return forms;
  }

  const forms = [s];

  /* Slashes: Soviet Union/Russia, Tree/timber line. Never a short literal
     like AC/DC, where each side alone is not the answer. */
  if (s.includes('/')) {
    const [left, ...others] = s.split('/').map(squash);
    const right = others.join('/');
    if (left.length > 2 && right.length > 2) {
      forms.push(left, right);
      const leftWords = left.split(' ');
      const rightWords = right.split(' ');
      if (leftWords.length === 1 && rightWords.length > 1) {
        forms.push(`${left} ${rightWords.slice(1).join(' ')}`);
      }
    }
  }

  /* "Montgomery, Alabama": the place before the comma stands alone. Only one
     comma, so a list of three names is still three names. */
  const commas = s.split(',');
  if (commas.length === 2 && commas[0].trim()) forms.push(squash(commas[0]));

  return forms;
}

/**
 * What a judge lets a player leave off, beyond what the response's own
 * brackets say:
 *
 *   - whose it is, when the thing itself is named: "Trident" for "Poseidon's
 *     Trident". Only a one-word owner and a thing of five letters or more,
 *     so "Nest" is still not "Crow's Nest", nor "Revenge" Queen Anne's.
 *   - the first name of a person the response asks for by "Who is": "Dunst"
 *     for "Who is Kirsten Dunst?". Boards written that way (the site's own)
 *     name a person by both; a J-Archive response never says "Who is".
 */
function leftOff(response) {
  const text = tidy(response).replace(/[?.!]+$/, '');
  const asked = /^(who|what)\s+(?:is|are|was|were)\s+(.+)$/i.exec(text);
  const subject = asked ? asked[2] : text;
  if (/[()/,]/.test(subject)) return [];
  const forms = [];
  const owned = /^(?:the\s+)?([A-Za-z-]+)['’]s?\s+(.+)$/i.exec(subject);
  if (owned && owned[2].replace(/[^A-Za-z]/g, '').length >= 5) forms.push(owned[2]);
  const named = subject.split(/\s+/);
  if (asked && /^who$/i.test(asked[1]) && named.length === 2 && !/^(and|&)$/i.test(named[1])) forms.push(named[1]);
  return forms;
}

/** The forms of a board response the grader accepts, for display or tests. */
export function acceptedForms(response) {
  return [...new Set([...expand(response), ...leftOff(response)])].filter((f) => words(f).length > 0);
}

// ------------------------------------------------------------ words

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
  fortieth: 40, fiftieth: 50, hundredth: 100,
};
/* Both spellings of a word are the same word. The short form is kept. */
const SAME = {
  saint: 'st', mount: 'mt', doctor: 'dr', fort: 'ft', mister: 'mr', junior: 'jr', senior: 'sr',
  versus: 'vs', company: 'co', brothers: 'bros', avenue: 'ave', street: 'st',
};
const PAIRS = { 'united states': 'us', 'united kingdom': 'uk', 'new york city': 'nyc' };
const QUESTION = new Set(['what', 'who', 'where', 'when', 'which', 'whats', 'whos', 'wheres', 'whens', 'how']);
/* Small Roman numerals only, and never as the first word: "CD" and "mix" are
   words, and a numeral that matters follows a name (Henry VIII, World War II). */
const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/;
const romanValue = (r) => {
  const v = { i: 1, v: 5, x: 10 };
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const here = v[r[i]];
    const next = v[r[i + 1]] ?? 0;
    total += here < next ? -here : here;
  }
  return total;
};

/** Text as the words that decide whether it is right. */
export function words(text) {
  const raw = String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  let tokens = raw ? raw.split(' ') : [];

  // "What is", "Who were", "What's".
  // Only when something follows: "where" can be the response itself.
  if (QUESTION.has(tokens[0]) && tokens.length > 1) {
    tokens = tokens.slice(1);
    if (['is', 'are', 'was', 'were'].includes(tokens[0])) tokens = tokens.slice(1);
  }

  let joined = ` ${tokens.join(' ')} `;
  for (const [pair, short] of Object.entries(PAIRS)) joined = joined.replaceAll(` ${pair} `, ` ${short} `);
  tokens = joined.trim() ? joined.trim().split(' ') : [];

  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    let t = SAME[tokens[i]] ?? tokens[i];
    if (t in ORDINALS) t = String(ORDINALS[t]);
    else if (/^\d+(st|nd|rd|th)$/.test(t)) t = t.replace(/\D+$/, '');
    else if (t in TENS) {
      const next = tokens[i + 1];
      if (next in ONES && ONES[next] > 0 && ONES[next] < 10) { t = String(TENS[t] + ONES[next]); i++; }
      else t = String(TENS[t]);
    } else if (t in ONES) t = String(ONES[t]);
    else if (i > 0 && t.length <= 4 && ROMAN.test(t) && t !== '') t = String(romanValue(t));
    out.push(t);
  }
  return out;
}

// ------------------------------------------------------------ matching

/* Words that carry no answer of their own. "and" is not one: "Bright and
   Shining Lie" is not the title "A Bright Shining Lie". */
const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'is', 'are', 'was', 'were']);
/* Words an answer may add without changing it: what kind of thing it is. */
const GENERIC = new Set([
  'novel', 'book', 'books', 'movie', 'film', 'song', 'play', 'poem', 'opera', 'musical', 'album', 'show',
  'series', 'river', 'lake', 'mt', 'city', 'state', 'country', 'island', 'islands', 'isle', 'president',
  'king', 'queen', 'emperor', 'pope', 'sir', 'dame', 'dr', 'mr', 'mrs', 'ms', 'st', 'lord', 'lady',
  'general', 'captain', 'band', 'group', 'game', 'famous', 'called', 'named', 'it', 'its', 'that',
]);

const isNumber = (t) => /^\d+$/.test(t);
const significant = (t) => !STOP.has(t) && !(t.length === 1 && !isNumber(t));

function distance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/* One word for many, or many for one: Doc Marten for Doc Martens, Burnsides
   for Burnside. That is not a slip of the fingers, and judges rule it wrong,
   so it is only ever 'close'. */
const pluralOf = (a, b) => a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;

/* How many slips a word of this length forgives: none up to four letters,
   one up to nine, two up to fourteen. 'close' allows a few more. */
const allowance = (word, close) => (close ? Math.floor(word.length / 3) + 1 : Math.floor(word.length / 5));

/**
 * How an answer's words fare against one form's. Returns the total of the
 * slips forgiven, or null when it does not match.
 */
function matchForm(answer, form, close) {
  const needed = form.filter(significant);
  if (needed.length === 0) {
    return answer.join(' ') === form.join(' ') ? 0 : null;
  }

  const used = new Set();
  let slips = 0;
  const unmatched = [];
  for (const want of needed) {
    let best = null;
    answer.forEach((got, i) => {
      if (used.has(i)) return;
      if (isNumber(want) || isNumber(got)) {
        if (want === got) best = { i, d: 0 };
        return;
      }
      if (!close && pluralOf(got, want)) return;
      const d = distance(got, want);
      if (d <= allowance(want, close) && (!best || d < best.d)) best = { i, d };
    });
    if (best) { used.add(best.i); slips += best.d; } else unmatched.push(want);
  }

  /* A regnal number may be left off (Charles for Charles II), when the answer
     names no number of its own. */
  const extras = answer.filter((t, i) => !used.has(i) && significant(t) && !GENERIC.has(t));
  if (unmatched.length === 1 && isNumber(unmatched[0]) && needed.at(-1) === unmatched[0]
      && needed.length > 1 && !extras.some(isNumber)) {
    unmatched.pop();
  }
  if (unmatched.length) return null;
  if (extras.length) return null;
  return slips;
}

/**
 * Grade an answer.
 *
 * verdict: 'correct' | 'close' | 'wrong'. `isCorrect` is verdict === 'correct'.
 * `confidence` runs from 0 to 1, for screens that show one.
 */
export function gradeAnswer(answer, response) {
  const said = words(answer);
  const forms = acceptedForms(response).map(words);
  if (said.length === 0) {
    return { verdict: 'wrong', isCorrect: false, confidence: 0, reason: 'No answer given' };
  }
  if (forms.length === 0) {
    return { verdict: 'wrong', isCorrect: false, confidence: 0, reason: 'No response to match' };
  }

  /* A list that wants more than one: each named part must be on it, and
     there must be enough of them. */
  const list = listOf(response);
  if (list && list.need > 1) {
    const parts = String(answer ?? '').replace(/\?/g, '').split(/,|&|\band\b/i).map(words).filter((p) => p.length);
    const items = list.items.map((item) => acceptedForms(item).map(words));
    const named = new Set();
    const allOnIt = parts.length > 0 && parts.every((part) => {
      const hit = items.findIndex((forms, i) => !named.has(i) && forms.some((f) => matchForm(part, f, false) !== null));
      if (hit >= 0) named.add(hit);
      return hit >= 0;
    });
    const ok = allOnIt && named.size >= list.need;
    return ok
      ? { verdict: 'correct', isCorrect: true, confidence: 1, reason: 'Match' }
      : { verdict: 'wrong', isCorrect: false, confidence: 0, reason: `Needs ${list.need} from the list` };
  }

  let best = null;
  for (const form of forms) {
    const slips = matchForm(said, form, false);
    if (slips !== null && (best === null || slips < best)) best = slips;
  }
  if (best !== null) {
    const letters = Math.max(1, said.join('').length);
    return {
      verdict: 'correct',
      isCorrect: true,
      confidence: best === 0 ? 1 : Math.max(0.6, 1 - best / letters),
      reason: best === 0 ? 'Match' : 'Match, allowing for spelling',
    };
  }
  if (forms.some((form) => matchForm(said, form, true) !== null)) {
    return { verdict: 'close', isCorrect: false, confidence: 0.4, reason: 'Close: check the spelling' };
  }
  return { verdict: 'wrong', isCorrect: false, confidence: 0, reason: 'No match' };
}
