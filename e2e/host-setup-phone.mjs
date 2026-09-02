/**
 * Writing a board on a phone.
 *
 * The setup screen has a narrow layout already: the board becomes one category
 * at a time behind a scrolling tab strip. What it did not have was a top bar
 * that fitted, or targets sized for a fingertip. This walks the whole screen at
 * phone width, including the two panels that open over it.
 */
import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `sp-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'S', username: `sp${STAMP}` }),
})).json();
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, { ...o,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...o.headers } }).then((r) => r.json());

const POINTS = [200, 400, 600, 800, 1000];
const NAMES = ['RIVERS', 'MOUNTAINS', 'DESERTS', 'ISLANDS', 'CAPITALS', 'FLAGS'];
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Phone Night' }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board: {
  version: 1,
  categories: NAMES.map((name) => ({ name, questions: POINTS.map((points) => ({
    points, answer: `${name} clue for $${points}`, question: `What is ${name.toLowerCase()}?`,
    options: null, mediaType: null, mediaData: null,
    youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null })) })),
  finalJeopardy: null } }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const box = (b, sel) => b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});
  if(!e) return null; const r=e.getBoundingClientRect();
  return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()`);

/* Anything a finger has to hit. 44px is the size a target has to be before a
   host tapping while talking to a room stops missing it. */
const SMALL = "[...document.querySelectorAll('button, a, input, textarea')]"
  + ".filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; })"
  + ".map(e => (e.className || e.tagName).toString().split(' ').pop() + '=' + Math.round(e.getBoundingClientRect().height))"
  + ".join(', ')";

const b = await launch({ width: 393, height: 852, dpr: 3 });
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/host`);
  await b.until("!!document.querySelector('.ge-board')", { timeout: 15000 });
  await wait(600);

  const fits = async (what) => {
    const wide = await b.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1");
    check(`${what} does not push the page sideways`, wide === false,
      await b.evaluate("`${document.documentElement.scrollWidth} in ${document.documentElement.clientWidth}`"));
  };

  // ---------- the bar ----------
  console.log('\n-- the top bar --');
  await fits('the setup screen');
  const top = await box(b, '.host-top');
  check('the bar is one row now the code has gone', top.h < 80, `${top.h}px tall`);
  check('no room code here, because there is no game yet',
    (await box(b, '.host-room')) === null);
  check('the title gives up its line rather than stranding one',
    (await b.evaluate("!!document.querySelector('.host-title')?.offsetParent")) === false);
  check('Game Settings is still on the first row',
    Math.abs((await box(b, '.host-settings')).y - (await box(b, '.host-back')).y) < 20);

  // ---------- the board ----------
  console.log('\n-- the board --');
  check('it becomes one category at a time',
    await b.evaluate("!!document.querySelector('.ge-narrow')") === true);
  check('with a tab for each of the six',
    await b.evaluate("document.querySelectorAll('.ge-tab').length") === 6);
  check('the strip scrolls, since six do not fit a phone',
    await b.evaluate("(()=>{const e=document.querySelector('.ge-pager');return e.scrollWidth > e.clientWidth && getComputedStyle(e).overflowX === 'auto'})()") === true);
  check('and snaps, so a swipe does not leave a name cut in half',
    (await b.evaluate("getComputedStyle(document.querySelector('.ge-pager')).scrollSnapType")).startsWith('x'));
  check('the keyboard hint is not offered to a phone',
    (await b.evaluate("document.querySelector('.ge-legend')?.textContent ?? ''")).includes('Arrow keys') === false);
  check('and it does not tell a phone to click',
    (await b.evaluate("document.querySelector('.host-write')?.textContent ?? '')".slice(0, -1))).includes('Click') === false,
    await b.evaluate("document.querySelector('.host-write')?.textContent"));
  await b.shot('setup-phone-board.png');

  // ---------- writing ----------
  console.log('\n-- writing a clue --');
  await b.evaluate("window.scrollTo(0,0)");
  await b.evaluate(`[...document.querySelectorAll('.ge-row')].find(e=>/\\$400/.test(e.textContent)).click()`);
  await wait(800);
  const clue = await box(b, 'textarea');
  check('picking a cell brings the writer to you, rather than leaving it below',
    clue.y > 0 && clue.y < 852, `y=${clue.y} of 852`);
  await b.type('textarea', 'The longest river in Africa');
  check('and it takes what you type',
    (await b.evaluate("document.querySelector('textarea').value")) === 'The longest river in Africa');

  // ---------- game settings ----------
  console.log('\n-- game settings --');
  await b.evaluate("window.scrollTo(0,0)");
  await b.click('.host-settings');
  await b.until("!!document.querySelector('.hs-sheet')", { timeout: 8000 });
  await fits('the settings sheet');
  const sheet = await box(b, '.hs-sheet');
  check('the sheet uses the whole phone', sheet.w >= 380 && sheet.h >= 800, `${sheet.w}x${sheet.h}`);
  const done = await box(b, '.hs-done');
  check('the way out is on screen without scrolling for it',
    done.y >= 0 && done.y + done.h <= 852, `y=${done.y}`);
  await b.shot('setup-phone-settings.png');
  await b.click('.hs-done');
  await wait(400);

  // ---------- filling from a board ----------
  console.log('\n-- duplicating a board --');
  await b.evaluate("window.scrollTo(0, document.body.scrollHeight)");
  await wait(300);
  const alts = await b.evaluate("[...document.querySelectorAll('.host-alt')].map(e=>Math.round(e.getBoundingClientRect().x)).join(',')");
  check('the two ways in line up under each other',
    new Set(alts.split(',')).size === 1, `x = ${alts}`);

  await b.evaluate(`[...document.querySelectorAll('.host-alt')].find(e=>/Duplicate/.test(e.textContent)).click()`);
  await b.until("!!document.querySelector('.hf-board')", { timeout: 10000 });
  await fits('the fill panel');
  check('it opens over the screen rather than beside it',
    (await b.evaluate("!!document.querySelector('.hf-scrim')")) === true);
  await b.shot('setup-phone-fill.png');
  await b.evaluate("document.querySelector('.hf-board').click()");
  await b.until("document.querySelector('.host-round.is-on .host-round-note')?.textContent === '30 of 30'", { timeout: 12000 });
  check('a duplicated board fills the round', true, '30 of 30');
  await fits('a full board');

  // ---------- every target ----------
  console.log('\n-- what a finger has to hit --');
  await b.evaluate("window.scrollTo(0,0)");
  const small = await b.evaluate(SMALL);
  check('nothing is smaller than a fingertip', small === '', small || 'all at least 44px');

  // ---------- the way out ----------
  console.log('\n-- creating the game --');
  await b.evaluate("window.scrollTo(0, document.body.scrollHeight)");
  await wait(300);
  const start = await box(b, '.host-start');
  check('the button says what it does', (await b.evaluate("document.querySelector('.host-start').textContent.trim()")) === 'Create game');
  check('and is full width on a phone', start.w > 340, `${start.w}px`);
  check('it says what is still missing rather than just refusing',
    (await b.evaluate("document.querySelector('.host-notready')?.textContent ?? '')".slice(0, -1))).includes('Double Jeopardy'),
    await b.evaluate("document.querySelector('.host-notready')?.textContent"));
  await b.shot('setup-phone-foot.png');

  // ---------- a smaller phone ----------
  console.log('\n-- a smaller phone --');
  await b.resize({ width: 360, height: 740, dpr: 3 });
  await fits('a small phone');
  check('and nothing shrinks below a fingertip on it',
    (await b.evaluate(SMALL)) === '', await b.evaluate(SMALL) || 'all at least 44px');
} finally {
  b.kill();
}
process.exit(bad ? 1 : 0);
