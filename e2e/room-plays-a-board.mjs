/**
 * Friends playing a community board together, in a private room.
 *
 * From the board's own page, "Play with friends" opens a room for it. The
 * lobby names the board for everyone, including someone who joins by the
 * code, and drops the rules a board does not have. Starting deals the
 * board's own clues, five categories wide, its pictures with them.
 */
import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

// One blue pixel, as a drawn name and as a clue's picture.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function account(name) {
  const { token, user } = await (await fetch(`${API}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${name}-${STAMP}@x.com`, password: 'hunter2hunter2', displayName: name, username: `${name}${STAMP}` }),
  })).json();
  // A name already drawn, so neither screen asks for one.
  await fetch(`${API}/api/auth/signature`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ signature: PIXEL }),
  });
  return { token, user: { ...user, signature: PIXEL } };
}
const host = await account('lender');
const guest = await account('friend');

const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}`, ...o.headers },
}).then((r) => r.json());
const POINTS = [200, 400, 600, 800, 1000];
const NAMES = ['MULAN', 'INSIDE OUT', 'BLUEY', 'BIG THUNDER MOUNTAIN', 'ONCE UPON A STUDIO'];
const TITLE = `Disney Night ${STAMP}`;
const board = {
  version: 1,
  categories: NAMES.map((name, c) => ({
    name,
    questions: POINTS.map((points, r) => ({
      points, answer: `${name} clue ${points}`, question: `What is ${name}?`,
      ...(c === 2 && r === 0 ? { mediaType: 'image', mediaData: PIXEL, altText: 'Two grannies' } : {}),
      // A three second clip, which nobody rings in on until it has played.
      ...(c === 0 && r === 4 ? { mediaType: 'youtube', mediaData: 'u4YFjksxPg0', youtubeStart: 895, youtubeEnd: 898 } : {}),
    })),
  })),
  finalJeopardy: { category: 'NO-SHAVE NOVEMBER', answer: 'This moustache', question: "Who is Tarzan's dad?" },
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: TITLE }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board, topic: 'disney' }) });
await A(`/${slug}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) });
const playsBefore = (await A(`/${slug}`)).plays;

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signIn = (b, who) => b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
  JSON.stringify({ state: { token: who.token, user: who.user, isAuthenticated: true, isGuest: false }, version: 0 })
)});`);
const buttonText = (b, re) => b.evaluate(`[...document.querySelectorAll('button')].some((e) => ${re}.test(e.textContent))`);
const press = (b, re) => b.evaluate(`[...document.querySelectorAll('button')].find((e) => ${re}.test(e.textContent) && !e.disabled)?.click()`);

const h = await launch({ width: 1280, height: 800, dpr: 1 });
const g = await launch({ width: 1280, height: 800, dpr: 1 });
try {
  await signIn(h, host);
  await signIn(g, guest);

  // ---------- from the board's page ----------
  await h.goto(`${APP}/boards/${slug}`);
  await h.until("!!document.querySelector('.board-play-friends')", { timeout: 15000 });
  await h.click('.board-play-friends');
  await h.until("!!document.querySelector('.mp-open-btn') && !document.querySelector('.mp-open-btn').disabled", { timeout: 15000 });
  check('the room page says which board it is opening for', (await h.evaluate("document.querySelector('.mp-open').textContent")).includes(TITLE));
  await h.click('.mp-open-btn');

  await h.until("document.querySelectorAll('.st-code .st-money').length === 6", { timeout: 15000 });
  const roomCode = (await h.evaluate("[...document.querySelectorAll('.st-code .st-money')].map((e) => e.textContent).join('')")).trim();
  await h.until("!!document.querySelector('.lobby-board-title')", { timeout: 10000 });
  check("the host's lobby names the board", (await h.evaluate("document.querySelector('.lobby-board-title').textContent")) === TITLE);
  check('and lists its categories', (await h.evaluate("document.querySelector('.lobby-board').textContent")).includes('ONCE UPON A STUDIO'));
  check('with no Double Jeopardy to switch on: the board is one round',
    !(await h.evaluate("[...document.querySelectorAll('[aria-label]')].some((e) => e.getAttribute('aria-label') === 'Double Jeopardy')")));
  check('the host is offered the start, not the topic picker', await buttonText(h, '/^\\s*Start the game\\s*$/'));
  await h.shot('room-board-lobby.png');

  // ---------- a friend joins by the code ----------
  await g.goto(`${APP}/join/${roomCode}`);
  await g.until("!!document.querySelector('.join-form .btn-primary') && !document.querySelector('.join-form .btn-primary').disabled", { timeout: 15000 });
  await g.click('.join-form .btn-primary');
  await g.until("!!document.querySelector('.lobby-board-title')", { timeout: 15000 });
  check('a friend who joins by the code sees the same board', (await g.evaluate("document.querySelector('.lobby-board-title').textContent")) === TITLE);
  check('and is told it is one round', (await g.evaluate("document.querySelector('.lobby').textContent")).includes('One round'));
  await press(g, '/I am ready/');

  // ---------- dealt ----------
  await h.until("!![...document.querySelectorAll('button')].find((e) => /^\\s*Start the game\\s*$/.test(e.textContent) && !e.disabled)", { timeout: 15000 });
  await press(h, '/^\\s*Start the game\\s*$/');
  await h.until("document.querySelectorAll('.category-header').length > 0", { timeout: 15000 });
  await g.until("document.querySelectorAll('.category-header').length > 0", { timeout: 15000 });
  await sleep(1500);
  const heads = async (b) => b.evaluate("[...document.querySelectorAll('.category-header')].map((e) => e.textContent.trim())");
  check('everyone gets the board, five categories wide', (await heads(h)).length === 5 && (await heads(g)).length === 5, JSON.stringify(await heads(g)));
  check('its own categories, in its order', (await heads(g)).join('|') === NAMES.join('|'));
  const fit = await g.evaluate(`(() => {
    const row = document.querySelector('.categories-row').getBoundingClientRect();
    const last = [...document.querySelectorAll('.category-header')].at(-1).getBoundingClientRect();
    return Math.abs(row.right - last.right);
  })()`);
  check('across the whole width', fit < 4, `${Math.round(fit)}px short`);
  check('a room playing it counts as a play', (await A(`/${slug}`)).plays === playsBefore + 1, `plays ${(await A(`/${slug}`)).plays}`);

  // Whoever has the pick opens Bluey's $200, which has a picture.
  for (const b of [h, g]) {
    await b.evaluate("document.querySelectorAll('.questions-grid .question-row')[0]?.querySelectorAll('.question-cell')[2]?.click()");
  }
  await g.until("!!document.querySelector('.clue-screen.has-media img')", { timeout: 15000 });
  const side = await g.evaluate(`(() => {
    const img = document.querySelector('.clue-screen.has-media img').getBoundingClientRect();
    const text = document.querySelector('.clue-screen.has-media .clue-text').getBoundingClientRect();
    return img.right <= text.left;
  })()`);
  check("the clue's picture is up for the room, beside the clue", side);
  await g.shot('room-board-clue.png');

  // ---------- typed, graded, and the same verdict on every screen ----------
  check('nobody in the room is offered "Reveal Answer" or "I got it right"',
    !(await h.evaluate("[...document.querySelectorAll('button')].some((b) => /Reveal Answer|I Got It/i.test(b.textContent))"))
    && !(await g.evaluate("[...document.querySelectorAll('button')].some((b) => /Reveal Answer|I Got It/i.test(b.textContent))")));
  await g.until("!!document.querySelector('.buzzer-button')", { timeout: 15000 });
  await g.click('.buzzer-button');
  await g.until("!!document.querySelector('.typed-input')", { timeout: 10000 });
  check('the friend who rang in gets a box to type in', true);
  check('and nobody has been sent the response', !(await h.evaluate("/what is bluey/i.test(document.body.innerText)"))
    && !(await g.evaluate("/what is bluey/i.test(document.body.innerText)")));
  await sleep(300);
  await g.type('.typed-input', 'bluey');
  await g.click('.typed-submit');
  await h.until("!!document.querySelector('.typed-badge')", { timeout: 10000 });
  await g.until("!!document.querySelector('.typed-badge')", { timeout: 10000 });
  const verdict = async (b) => b.evaluate(`({
    badge: document.querySelector('.typed-badge')?.textContent.trim(),
    said: document.querySelector('.typed-said')?.textContent.trim(),
    truth: document.querySelector('.typed-truth')?.textContent.trim(),
  })`);
  const [mine, theirs] = [await verdict(g), await verdict(h)];
  check('graded right, for what the clue was worth, on both screens',
    mine.badge === 'Correct +$200' && theirs.badge === 'Correct +$200', `${mine.badge} / ${theirs.badge}`);
  check('the friend sees what they said', /^You said: bluey$/.test(mine.said ?? ''), mine.said);
  check('and so does the host', /said: bluey$/.test(theirs.said ?? '') && !/^You/.test(theirs.said ?? ''), theirs.said);
  check('with the correct response, now the clue is over', /What is BLUEY\?/i.test(mine.truth ?? '') && /What is BLUEY\?/i.test(theirs.truth ?? ''));
  await h.shot('room-board-verdict.png');

  // ---------- a clip clue: the buzzer waits for it, for everyone ----------
  await h.until("!document.querySelector('.mp-question-overlay')", { timeout: 10000 });
  await g.until("!document.querySelector('.mp-question-overlay')", { timeout: 10000 });
  for (const b of [h, g]) {
    await b.evaluate("document.querySelectorAll('.questions-grid .question-row')[4]?.querySelectorAll('.question-cell')[0]?.click()");
  }
  await g.until("!!document.querySelector('.mp-question-overlay')", { timeout: 10000 });
  await h.until("!!document.querySelector('.mp-question-overlay')", { timeout: 10000 });
  const waiting = async (b) => b.evaluate("document.body.innerText.includes('Buzzers open when the clip ends') && !document.querySelector('.buzzer-button')");
  check('while the clip plays, nobody can ring in, and both are told why', (await waiting(g)) && (await waiting(h)));
  await g.until("!!document.querySelector('.buzzer-button')", { timeout: 10000 });
  await h.until("!!document.querySelector('.buzzer-button')", { timeout: 5000 });
  check('then the buzzer opens for everyone', true);
} catch (err) {
  bad++;
  console.log(' THREW', err.message);
  try { await h.shot('room-board-threw-host.png'); await g.shot('room-board-threw-guest.png'); } catch { /* the browser is gone */ }
} finally {
  h.kill();
  g.kill();
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
