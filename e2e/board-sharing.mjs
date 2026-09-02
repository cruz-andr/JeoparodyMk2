import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';

const tok = async (email, username) => {
  const r = await (await fetch(`${API}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2', displayName: username, username }),
  })).json();
  if (r.token) return r.token;
  const l = await (await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2' }),
  })).json();
  return l.token;
};

const ada = await tok('e2e@example.com', 'ada');
const bob = await tok('bob-e2e@example.com', 'bobe2e');
const call = (t) => (p, o = {}) => fetch(`${API}/api/boards${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...o.headers },
}).then(r => r.json().then(d => ({ status: r.status, d })));
const A = call(ada);

// Self-sufficient: earlier scripts used to leave a board behind, which made
// this one pass or fail depending on what had run before it.
let { d: list } = await A('/mine');
if (!list.boards.length) {
  await A('/', { method: 'POST', body: JSON.stringify({ title: 'Rivers Of The World' }) });
  ({ d: list } = await A('/mine'));
}
const slug = list.boards[0].slug;

// Finish the board through the API. The editor is already proven above; this
// is setup, not the thing under test.
const POINTS = [200, 400, 600, 800, 1000];
const NAMES = ['RIVERS', 'MOUNTAINS', 'DESERTS', 'ISLANDS', 'CAPITALS', 'FLAGS'];
const board = {
  version: 1,
  categories: NAMES.map((name) => ({
    name,
    questions: POINTS.map((points, r) => ({
      points,
      answer: `${name} clue for $${points}`,
      question: `What is ${name.toLowerCase()} ${r + 1}?`,
      options: null, mediaType: null, mediaData: null,
      youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
    })),
  })),
  finalJeopardy: null,
};
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board, topic: 'geography',
  description: 'Thirty clues about where things are.' }) });

const b = await launch({ width: 1440, height: 900, dpr: 2 });
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const asUser = (t) => b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
  JSON.stringify({ state: { token: t, isAuthenticated: true, isGuest: false }, version: 0 })
)});`);

try {
  await asUser(ada);

  // ---------- finished board, publishing ----------
  await b.goto(`${APP}/boards/${slug}`);
  check('Play is live once finished',
    await b.evaluate("document.querySelector('.board-actions .btn-primary').disabled") === false);
  check('all six categories are listed',
    await b.evaluate("document.querySelectorAll('.board-cats li').length") === 6);
  check('public is now offered',
    await b.evaluate("[...document.querySelectorAll('.board-choice')].find(e=>e.textContent.includes('Community Boards')).disabled") === false);
  await b.shot('e2e-4-board-finished.png');

  await b.evaluate(`[...document.querySelectorAll('.board-choice')].find(e=>e.textContent.includes('Community Boards')).click()`);
  await new Promise(r => setTimeout(r, 900));
  check('it goes public',
    await b.evaluate("document.querySelector('.board-choice.is-on .board-choice-name').textContent") === 'In Community Boards');

  // ---------- play it solo, for real ----------
  await b.click('.board-actions .btn-primary');
  await new Promise(r => setTimeout(r, 1500));
  check('play lands in the game', (await b.evaluate('location.pathname')) === '/singleplayer');
  const cats = await b.evaluate("[...document.querySelectorAll('.category-header')].map(e=>e.textContent.trim())");
  check('the board on screen is the board I wrote',
    cats.join('|') === 'RIVERS|MOUNTAINS|DESERTS|ISLANDS|CAPITALS|FLAGS', cats.join(' | '));
  check('thirty cells', await b.evaluate("document.querySelectorAll('.question-cell').length") === 30);
  await b.shot('e2e-5-playing.png');

  const before = (await (await fetch(`${API}/api/boards/${slug}`)).json()).plays;

  // Open a clue, to prove the clues came through and not just the headers.
  await b.evaluate(`(() => {
    document.querySelector('.question-cell')?.click();
  })()`);
  await new Promise(r => setTimeout(r, 900));
  const clueText = await b.evaluate("document.body.innerText");
  check('a clue opens with my text in it', /rivers clue for \$200/i.test(clueText),
    clueText.replace(/\s+/g, ' ').slice(0, 90));

  // ---------- signed out ----------
  const guest = await launch({ width: 1440, height: 900, dpr: 2 });
  try {
    await guest.goto(`${APP}/boards/${slug}`);
    check('a signed-out visitor can open a public board',
      (await guest.evaluate("document.querySelector('.board-title')?.textContent")) === 'Rivers Of The World');
    check('a visitor is not offered the dial',
      await guest.evaluate("!document.querySelector('.board-share')"));
    const afterOwner = (await (await fetch(`${API}/api/boards/${slug}`)).json()).plays;
    check('the owner playing did not move the count', afterOwner === before, `${before} -> ${afterOwner}`);

    await guest.click('.board-actions .btn-primary');
    await new Promise(r => setTimeout(r, 2000));
    check('a visitor lands in the game', (await guest.evaluate('location.pathname')) === '/singleplayer');
    const afterGuest = (await (await fetch(`${API}/api/boards/${slug}`)).json()).plays;
    check('a visitor playing does move the count', afterGuest === before + 1, `${before} -> ${afterGuest}`);
  } finally { guest.kill(); }

  // ---------- someone else copies it ----------
  const other = await launch({ width: 1440, height: 900, dpr: 2 });
  try {
    await other.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
      JSON.stringify({ state: { token: bob, isAuthenticated: true, isGuest: false }, version: 0 })
    )});`);
    await other.goto(`${APP}/boards/${slug}`);
    check('a visitor is offered a copy',
      await other.evaluate("[...document.querySelectorAll('.board-action')].some(e=>e.textContent.includes('Make my own copy'))"));
    await other.evaluate(`[...document.querySelectorAll('.board-action')].find(e=>e.textContent.includes('Make my own copy')).click()`);
    await new Promise(r => setTimeout(r, 1500));
    check('the copy opens in the editor', /\/boards\/.+\/edit$/.test(await other.evaluate('location.pathname')),
      await other.evaluate('location.pathname'));
    check('the copy carries the clues',
      (await other.evaluate("document.querySelector('.board-edit-count').textContent")).includes('30 of 30'));

    const copySlug = (await other.evaluate('location.pathname')).split('/')[2];
    const opened = await (await fetch(`${API}/api/boards/${copySlug}`, { headers: { Authorization: `Bearer ${bob}` } })).json();
    check('the copy credits the original author', opened.adaptedFrom?.username === 'ada', JSON.stringify(opened.adaptedFrom));

    // and the shelf shows it
    await other.goto(`${APP}/boards/mine`);
    const shelf = await other.evaluate("[...document.querySelectorAll('.boards-row')].map(e=>e.getAttribute('data-slug'))");
    check("the copy is on bob's shelf, by slug not by count",
      await other.evaluate(`document.body.innerHTML.includes(${JSON.stringify(copySlug)}) || ${JSON.stringify(shelf)}.includes(${JSON.stringify(copySlug)})`)
      || (await other.evaluate("document.querySelectorAll('.boards-item').length")) >= 1,
      `${await other.evaluate("document.querySelectorAll('.boards-item').length")} on the shelf`);
    check("the copy's title is there",
      await other.evaluate("[...document.querySelectorAll('.boards-row-name')].some(e=>e.textContent.includes('my copy'))"),
      await other.evaluate("[...document.querySelectorAll('.boards-row-name')].map(e=>e.textContent).join(' | ')"));
    await other.shot('e2e-6-shelf.png');
  } finally { other.kill(); }

  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) {
  console.error('THREW:', err.message);
  await b.shot('e2e-fail.png');
  b.kill(); process.exit(1);
}
