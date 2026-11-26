/**
 * Pictures for the archive's picture clues.
 *
 * About one clue in ten on the show came with a picture ("Check out the
 * 130-foot Rain Vortex..."), and J-Archive no longer serves any of them: its
 * media links all answer 404, and the Internet Archive kept only a few. What
 * is left is the clue's own words, which say what the picture was of. So for
 * each picture clue:
 *
 *   1. A model (Groq, the answer judge's) reads the clue, the linked words and
 *      the response, and names the English Wikipedia article whose main photo
 *      best stands in for the picture, or none. It also says whether that
 *      photo would give the response away when the clue is not asking the
 *      player to identify the picture: a picture of the answer is the clue
 *      for "This funny man...", and a spoiler for "the egg seen here was
 *      made for his coronation".
 *   2. Wikipedia gives that article's lead image, free licences only, and
 *      Wikimedia Commons its author and licence, which are shown with it.
 *
 * Decided once per clue and remembered (the clue_pictures table), so a board
 * costs this only the first time anybody is dealt it. A clue with no picture
 * found plays as text, as it did before. Video and audio clues are not asked
 * about: a still photo does not stand in for a clip, and the clues read whole
 * without one. Off without GROQ_API_KEY, under NODE_ENV=test, and with
 * CLUE_PICTURES=off.
 */
import { createHash } from 'node:crypto';
import { getDatabase } from '../config/database.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';
/* Wikimedia asks automated clients to say who they are. */
const WIKI_HEADERS = { 'User-Agent': 'JeoparodyBot/1.0 (https://jeoparody.app)' };
const PLAN_MS = 5000;
const WIKI_MS = 4000;
const PICTURE_WIDTH = 800;

// ---------------------------------------------------------------- the model

export function picturePrompt({ category, clue, link, response }) {
  return `A Jeopardy! clue was shown on the show with a picture that is no longer available. Pick the English Wikipedia article whose main photo would best stand in for that picture.

Category: ${String(category ?? '').slice(0, 80)}
Clue: ${String(clue ?? '').slice(0, 400)}
The words in the clue that linked to the picture: ${String(link ?? '').slice(0, 120)}
Correct response: ${String(response ?? '').slice(0, 120)}

Step 1. What did the picture show?
- "response": the clue points at the picture to ask what it is ("This man", "she", "this bird", "seen here", "this plant"). The picture showed the correct response itself, and recognising it is the clue. That is fine to show.
- "other": the picture showed something else the clue names or describes (a building, a sculpture, an object, a person mentioned in the clue).

Step 2. Pick the article about exactly that thing: a particular person, place, building, artwork, object, animal breed or plant. Never a broad topic standing in for one particular thing (not "Footwear" for one pair of shoes, not "Portrait" for one painting). If no article is about that particular thing, the article is null.

Step 3. "spoils" is true only if:
- the photo would probably show the correct response written out (a title on a book cover or poster, a sign, a label, a flag or logo spelling it), or
- the picture was "other" but the article you picked is about the correct response itself, or something that names it.
A photo of the correct response for a "response" clue does not spoil it.

Reply with ONLY a JSON object, no other text:
{"shows": "response" or "other", "article": "<exact English Wikipedia article title>" or null, "spoils": true or false}`;
}

/** The plan out of the model's reply, or null if it is not one. */
export function planFrom(reply) {
  const text = String(reply ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const article = typeof parsed.article === 'string' && parsed.article.trim() ? parsed.article.trim().slice(0, 200) : null;
    return { article, spoils: parsed.spoils === true, shows: parsed.shows === 'other' ? 'other' : 'response' };
  } catch {
    return null;
  }
}

/* The words that pointed at the picture to ask what it is: "This", "here". */
const POINTING = /^(this|these|that|those|here|it|she|he|they|him|her|seen here|shown here)$/i;
const wordsOf = (text) => String(text ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').match(/[a-z0-9]+/g) ?? [];
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'for']);

/** Whether an article is, near enough, about the correct response: "Inch" for
    inch, "Tattoo" for tattooing, "Red" for red. */
export function aboutTheResponse(article, response) {
  const said = wordsOf(response).filter((w) => !STOP.has(w));
  const title = wordsOf(article).filter((w) => !STOP.has(w));
  return said.some((r) => title.some((t) => t === r || (t.length >= 4 && r.length >= 4 && (r.startsWith(t) || t.startsWith(r)))));
}

/**
 * The model's pick, checked. It is told not to stand the correct response in
 * for a picture of something else, and mostly does not; when it does anyway
 * ("Inch" for the Le Pouce sculpture, "Tattoo" for Edison's needle pen), that
 * is caught here rather than shown. A picture of the response is only kept
 * where the clue pointed at the picture to ask what it is.
 */
export function keepPlan(plan, item) {
  if (!plan?.article || plan.spoils) return false;
  if (!aboutTheResponse(plan.article, item.response)) return true;
  const pointed = String(item.link ?? '').split('|').some((w) => POINTING.test(w.trim()));
  return pointed && plan.shows === 'response';
}

export async function askGroqForPicture(item, { apiKey, model = MODEL, timeoutMs = PLAN_MS, fetch: get = fetch }) {
  const res = await get(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      messages: [{ role: 'user', content: picturePrompt(item) }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`groq ${res.status}: ${data?.error?.message ?? 'no reason given'}`);
  const plan = planFrom(data?.choices?.[0]?.message?.content);
  if (!plan) throw new Error('groq: no plan in the reply');
  return plan;
}

// ---------------------------------------------------------------- Wikipedia

const stripTags = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/* Commons' author field is free text: often a link, sometimes a paragraph,
   sometimes the same words twice ("Unknown authorUnknown author"). The
   credit line wants a name, so it gets the first short, whole phrase. */
export function authorOf(html) {
  let text = stripTags(html);
  const half = text.length / 2;
  if (Number.isInteger(half) && text.slice(0, half) === text.slice(half)) text = text.slice(0, half);
  text = text.replace(/^(.{3,}?) \1$/, '$1');
  if (/unknown author/i.test(text)) return 'Unknown author';
  if (text.length <= 60) return text || 'Unknown author';
  const cut = text.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).replace(/[,;:\s]+$/, '')}…`;
}

async function wikiQuery(host, params, { fetch: get, timeoutMs }) {
  const url = new URL(`https://${host}/w/api.php`);
  for (const [k, v] of Object.entries({ action: 'query', format: 'json', ...params })) url.searchParams.set(k, v);
  const res = await get(url, { headers: WIKI_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  return res.json();
}

/**
 * An article's lead photo, freely licensed, with what showing it requires:
 * { url, credit: { author, license, source } }, or null when it has none.
 */
export async function wikipediaPicture(article, { fetch: get = fetch, timeoutMs = WIKI_MS } = {}) {
  const page = Object.values((await wikiQuery('en.wikipedia.org', {
    titles: article, redirects: '1', prop: 'pageimages', piprop: 'name', pilicense: 'free',
  }, { fetch: get, timeoutMs }))?.query?.pages ?? {})[0];
  const file = page?.pageimage;
  if (!file || page.missing !== undefined) return null;

  // Free files nearly all live on Commons; a few are on Wikipedia itself.
  for (const host of ['commons.wikimedia.org', 'en.wikipedia.org']) {
    const info = Object.values((await wikiQuery(host, {
      titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(PICTURE_WIDTH),
    }, { fetch: get, timeoutMs }))?.query?.pages ?? {})[0]?.imageinfo?.[0];
    if (!info) continue;
    const meta = info.extmetadata ?? {};
    const license = stripTags(meta.LicenseShortName?.value);
    if (!license) return null;
    return {
      url: info.thumburl || info.url,
      credit: {
        author: authorOf(meta.Artist?.value),
        license,
        source: info.descriptionurl,
      },
    };
  }
  return null;
}

// ---------------------------------------------------------------- memory

/** Decisions kept in SQLite (the clue_pictures table, config/database.js),
    or in memory if the database is not there. */
export function cluePictureStore(getDb = getDatabase) {
  const memory = new Map();
  const db = () => { try { return getDb(); } catch { return null; } };
  return {
    get(key) {
      if (memory.has(key)) return memory.get(key);
      try {
        const row = db()?.prepare('SELECT data FROM clue_pictures WHERE key = ?').get(key);
        if (!row) return undefined;
        const value = JSON.parse(row.data);
        memory.set(key, value);
        return value;
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        db()?.prepare('INSERT OR REPLACE INTO clue_pictures (key, data) VALUES (?, ?)').run(key, JSON.stringify(value));
      } catch { /* remembered in memory, which is enough until a restart */ }
    },
  };
}

// ---------------------------------------------------------------- the whole

const keyOf = (item) => createHash('sha256')
  .update([item.category, item.clue, item.response].map((s) => String(s ?? '').trim().toLowerCase()).join('\u0000'))
  .digest('hex');

/**
 * plan(item) -> { article, spoils } (throws on failure);
 * picture(article) -> { url, credit } | null (throws on failure).
 */
export function createCluePictures({ plan = null, picture = wikipediaPicture, store = cluePictureStore(), log = () => {}, concurrency = 2 } = {}) {
  /* One clue's picture, or null. A decision (a picture, or none to be had) is
     remembered; a failure is not, so the clue is asked about again later. */
  async function resolve(item) {
    if (item.kind !== 'image') return null;
    const key = keyOf(item);
    // Decided before, with or without the model to hand now.
    const known = store.get(key);
    if (known !== undefined) return known;
    if (!plan) return null;
    try {
      const decided = await plan(item);
      const found = keepPlan(decided, item) ? await picture(decided.article) : null;
      store.set(key, found);
      return found;
    } catch (err) {
      log(`clue pictures: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Fill in the picture clues among `questions`, in place: mediaType,
   * mediaData, altText and mediaCredit, the fields every clue screen already
   * draws a picture from. The marker the scraper left (sourceMedia) is taken
   * off either way. clueOf and responseOf read a question of either shape:
   * the board's (answer is the clue) or the Sixer's (clue is the clue).
   */
  async function attach(questions, { clueOf = (q) => q.answer, responseOf = (q) => q.question } = {}) {
    const todo = (questions ?? []).filter((q) => q?.sourceMedia);
    let next = 0;
    async function worker() {
      while (next < todo.length) {
        const q = todo[next++];
        const found = await resolve({
          kind: q.sourceMedia.kind, link: q.sourceMedia.link,
          category: q.category, clue: clueOf(q), response: responseOf(q),
        });
        if (found) {
          q.mediaType = 'image';
          q.mediaData = found.url;
          q.altText = 'The picture for this clue';
          q.mediaCredit = found.credit;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    for (const q of todo) delete q.sourceMedia;
    return questions;
  }

  return { attach, resolve, enabled: Boolean(plan) };
}

let shared = null;

/** The site's, made on first use so the environment is loaded by then. */
export function getCluePictures({ env = process.env, log } = {}) {
  if (shared) return shared;
  const on = env.NODE_ENV !== 'test' && env.CLUE_PICTURES !== 'off' && Boolean(env.GROQ_API_KEY);
  shared = createCluePictures({
    plan: on ? (item) => askGroqForPicture(item, { apiKey: env.GROQ_API_KEY }) : null,
    log,
  });
  return shared;
}
