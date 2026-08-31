import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `phoneplay-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'PP', username: `pp${STAMP}` }),
})).json();
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, { ...o,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...o.headers } }).then((r) => r.json());

const POINTS = [200, 400, 600, 800, 1000];
const NAMES = ['RIVERS', 'MOUNTAINS', 'DESERTS', 'ISLANDS', 'CAPITALS', 'FLAGS'];
const board = {
  version: 1,
  categories: NAMES.map((name) => ({
    name,
    questions: POINTS.map((points) => ({
      points, answer: `${name} clue for $${points}`, question: `What is ${name.toLowerCase()}?`,
      options: null, mediaType: null, mediaData: null,
      youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
    })),
  })),
  finalJeopardy: null,
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Phone Play' }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board }) });
await A(`/${slug}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

// ---------- a phone gets the wheel, the same as the daily board ----------
const phone = await launch({ width: 393, height: 852, dpr: 3 });
try {
  console.log('\n-- playing a community board on a phone --');
  await phone.goto(`${APP}/boards/${slug}`);
  await phone.until("!!document.querySelector('.board-actions .btn-primary')");
  await phone.click('.board-actions .btn-primary');
  await phone.until("location.pathname === '/singleplayer'");
  await new Promise((r) => setTimeout(r, 1500));

  check('a community board plays as the wheel, not the desktop grid',
    await phone.evaluate("!!document.querySelector('.board-wheel, .wheel-row, [class*=wheel]')")
    && await phone.evaluate("!document.querySelector('.questions-grid')"),
    `wheel=${await phone.evaluate("!!document.querySelector('[class*=wheel]')")} grid=${await phone.evaluate("!!document.querySelector('.questions-grid')")}`);

  check('the document is held still while the wheel is up',
    await phone.evaluate("document.body.classList.contains('wheel-locked')"));
  check('and nothing spills sideways',
    await phone.evaluate('document.documentElement.scrollWidth <= innerWidth'),
    `${await phone.evaluate('document.documentElement.scrollWidth')} vs ${await phone.evaluate('innerWidth')}`);
  check('the page does not scroll behind it',
    await phone.evaluate('document.documentElement.scrollHeight <= innerHeight + 2'),
    `${await phone.evaluate('document.documentElement.scrollHeight')} vs ${await phone.evaluate('innerHeight')}`);

  // The wheel starts wherever it starts, so check the names on it belong to
  // my board rather than expecting a particular one to be centred.
  const cats = await phone.evaluate("[...document.querySelectorAll('[class*=wheel] [class*=name], [class*=wheel] [class*=category]')].map(e=>e.textContent.trim().toUpperCase()).filter(Boolean)");
  check('and it is my board on it',
    cats.length > 0 && cats.every((c) => NAMES.includes(c)), JSON.stringify(cats));

  // The stage is a locked viewport, so anything above the board comes out of
  // the board's height. Two lines of chrome was a third of the screen.
  const chrome = await phone.evaluate(
    "Math.round(document.querySelector('.game-header').getBoundingClientRect().height)");
  check('the header stays out of the board\'s way', chrome <= 70, `${chrome}px, daily board is 66`);
  check('and it is one line, not two',
    await phone.evaluate("getComputedStyle(document.querySelector('.game-header')).flexDirection") === 'row');
  await phone.shot('phone-community-play.png');

  // Leaving must release the lock, or every later page is stuck.
  await phone.goto(`${APP}/menu`);
  await new Promise((r) => setTimeout(r, 900));
  check('leaving releases the lock',
    await phone.evaluate("!document.body.classList.contains('wheel-locked')"));
  check('so the menu scrolls again',
    await phone.evaluate('document.documentElement.scrollHeight > innerHeight'),
    `${await phone.evaluate('document.documentElement.scrollHeight')} vs ${await phone.evaluate('innerHeight')}`);
} finally { phone.kill(); }

// ---------- a desktop still gets the grid ----------
const desk = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  console.log('\n-- and a desktop is unchanged --');
  await desk.goto(`${APP}/boards/${slug}`);
  await desk.until("!!document.querySelector('.board-actions .btn-primary')");
  await desk.click('.board-actions .btn-primary');
  await desk.until("location.pathname === '/singleplayer'");
  await new Promise((r) => setTimeout(r, 1200));

  check('a desktop still gets the flat board',
    await desk.evaluate("document.querySelectorAll('.question-cell').length") === 30);
  check('with no wheel', await desk.evaluate("!document.querySelector('[class*=wheel]')"));
  check('and no scroll lock left on the body',
    await desk.evaluate("!document.body.classList.contains('wheel-locked')"));
} finally { desk.kill(); }

// ---------- the daily board still works ----------
const daily = await launch({ width: 393, height: 852, dpr: 3 });
try {
  console.log('\n-- the daily board is unaffected --');
  await daily.goto(`${APP}/daily/board`);
  await new Promise((r) => setTimeout(r, 2500));
  const hasWheel = await daily.evaluate("!!document.querySelector('[class*=wheel]')");
  check('the daily board still turns on a phone', hasWheel);
  if (hasWheel) {
    check('and still holds the document still',
      await daily.evaluate("document.body.classList.contains('wheel-locked')"));
  }
} finally { daily.kill(); }

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
