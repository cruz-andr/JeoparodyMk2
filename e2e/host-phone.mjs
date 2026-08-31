/**
 * The host's screen on a phone.
 *
 * It walks to the live screen on a desktop and then becomes a phone, because
 * getting there involves screens with their own phone behaviour and this suite
 * is about the live one.
 */
import { io } from 'socket.io-client';
import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `hp-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'L', username: `hp${STAMP}` }),
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
      points, answer: `${name} clue for $${points}`, question: `What is ${name.toLowerCase()} ${points}?`,
      options: null, mediaType: null, mediaData: null,
      youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
    })),
  })),
  finalJeopardy: null,
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Live Night' }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const box = (b, sel) => b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});
  if(!e) return null; const r=e.getBoundingClientRect();
  return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()`);
/* A hidden element still answers getBoundingClientRect, with zeros, so asking
   whether it is there is not the same as asking whether it is on screen. */
const shown = async (b, sel) => {
  const r = await box(b, sel);
  return Boolean(r && r.w > 0 && r.h > 0);
};
const PHONE = { width: 393, height: 852, dpr: 3 };

const b = await launch({ width: 1440, height: 900, dpr: 2 });
let player;
let other;
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/host`);
  await b.until("/^[A-Z0-9]{4,8}$/.test(document.querySelector('.host-room-code')?.textContent ?? '')", { timeout: 15000 });
  const roomCode = (await b.evaluate("document.querySelector('.host-room-code').textContent")).trim();

  await b.click('.host-settings');
  await b.until("!!document.querySelector('.hs-sheet')");
  for (const label of ['Double Jeopardy', 'Final Jeopardy']) {
    await b.evaluate(`[...document.querySelectorAll('.hs-toggle')].find(t=>t.textContent.startsWith(${JSON.stringify(label)})).querySelector('input').click()`);
  }
  await b.click('.hs-done');
  await wait(300);

  await b.evaluate(`[...document.querySelectorAll('.host-alt')].find(e=>/Duplicate/.test(e.textContent)).click()`);
  await b.until("!!document.querySelector('.hf-board')", { timeout: 10000 });
  await b.click('.hf-board');
  await b.until("document.querySelectorAll('.ge-cell.is-written').length === 30", { timeout: 10000 });

  const join = async (sessionId, displayName) => {
    const socket = io('http://127.0.0.1:3995', { auth: { sessionId }, transports: ['websocket'] });
    await new Promise((r, j) => { socket.on('connect', r); socket.on('connect_error', j); });
    await new Promise((r, j) => socket.emit('room:join',
      { roomCode, displayName, signature: null },
      (res) => (res?.success ? r(res) : j(new Error(res?.error ?? 'join refused')))));
    return socket;
  };
  player = await join(`hpa-${STAMP}`, 'Ada');
  other = await join(`hpb-${STAMP}`, 'Bo');

  await b.until("!document.querySelector('.host-start').disabled", { timeout: 10000 });
  await b.click('.host-start');
  await b.until("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Start Game')", { timeout: 15000 });
  await b.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Start Game').click()`);
  await b.until("!!document.querySelector('.hl')", { timeout: 15000 });

  // ---------- becomes a phone ----------
  await b.resize(PHONE);
  const fits = async (what) => {
    const wide = await b.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1");
    check(`${what} does not push the page sideways`, wide === false,
      await b.evaluate("`${document.documentElement.scrollWidth} in ${document.documentElement.clientWidth}`"));
  };

  console.log('\n-- picking, on a phone --');
  await fits('the board');
  check('the rail is above the board, because it says what to do',
    (await box(b, '.hl-rail')).y < (await box(b, '.hl-board')).y);
  check('and sits right under the top bar, with no gap to scroll past',
    (await box(b, '.hl-rail')).y < 110, `y=${(await box(b, '.hl-rail')).y}`);
  check('the board is there to pick from',
    (await shown(b, '.hl-board')) && await b.evaluate("document.querySelectorAll('.question-cell').length") === 30);
  check('its cells are big enough for a thumb',
    (await b.evaluate("Math.round(document.querySelector('.question-cell').getBoundingClientRect().height)")) >= 44,
    `${await b.evaluate("Math.round(document.querySelector('.question-cell').getBoundingClientRect().height)")}px tall`);
  check('scores stay on one line rather than eating the screen',
    (await box(b, '.hl-scores')).h < 70, `${(await box(b, '.hl-scores')).h}px tall`);
  const board = await box(b, '.hl-board');
  const strip = await box(b, '.hl-scores');
  check('the board fills the screen rather than floating in the top half',
    strip.y - (board.y + board.h) < 120,
    `${Math.round(strip.y - (board.y + board.h))}px of dead space`);
  check('and the whole board is reachable without a long scroll',
    board.h < 852, `${board.h}px tall`);

  /* The board fades in row by row, so a shot taken the instant it mounts
     catches it half drawn. */
  await wait(1200);
  await b.evaluate("window.scrollTo(0,0)");
  await b.shot('phone-picking.png');

  // ---------- a clue ----------
  console.log('\n-- a clue, on a phone --');
  await b.evaluate("document.querySelectorAll('.question-cell')[0].click()");
  await b.until("!!document.querySelector('.hl-clue')", { timeout: 10000 });
  await fits('an open clue');
  check('the board goes away, because it cannot be picked from anyway',
    (await shown(b, '.hl-board')) === false, 'one thing at a time');
  check('the answer is legible without zooming',
    (await b.evaluate("parseFloat(getComputedStyle(document.querySelector('.hl-answer')).fontSize)")) >= 17,
    `${await b.evaluate("getComputedStyle(document.querySelector('.hl-answer')).fontSize")}`);
  check('the clue is above the fold',
    (await box(b, '.hl-answer')).y < 852);
  await b.shot('phone-clue.png');

  console.log('\n-- judging, on a phone --');
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Waiting for a buzz'", { timeout: 12000 });
  player.emit('game:buzz-in', { roomCode, reactionTime: 300 });
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Was that right?'", { timeout: 10000 });
  await fits('the verdict');

  const right = await box(b, '.hl-right');
  const wrong = await box(b, '.hl-wrong');
  check('the verdict buttons are thumb sized', right.h >= 56, `${right.w}x${right.h}`);
  check('and still the same size as each other',
    Math.abs(right.w - wrong.w) < 2 && Math.abs(right.h - wrong.h) < 2);
  check('both are reachable without scrolling',
    right.y + right.h < 852 && wrong.y + wrong.h < 852,
    `bottom at ${right.y + right.h} of 852`);
  check('the buzzer name is on screen too',
    (await b.evaluate("document.querySelector('.hl-buzzed')?.textContent ?? '')".slice(0, -1))).includes('Ada'));
  await b.shot('phone-judging.png');

  console.log('\n-- and back --');
  await b.click('.hl-right');
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Pick a clue'", { timeout: 10000 });
  check('the board comes back when the clue is done',
    (await shown(b, '.hl-board')) === true);
  check('the score is on the strip',
    (await b.evaluate("[...document.querySelectorAll('.hl-money')].map(e=>e.textContent).join('|')")).includes('$200'),
    await b.evaluate("[...document.querySelectorAll('.hl-money')].map(e=>e.textContent).join('|')"));
  await fits('the board again');

  console.log('\n-- a wider phone --');
  await b.resize({ width: 430, height: 932, dpr: 3 });
  await fits('a bigger phone');
  await b.resize({ width: 360, height: 740, dpr: 3 });
  await fits('a small phone');
  check('and the board still fits a thumb on the smallest',
    (await b.evaluate("Math.round(document.querySelector('.question-cell').getBoundingClientRect().height)")) >= 44);
} finally {
  try { player?.close(); } catch { /* already gone */ }
  try { other?.close(); } catch { /* already gone */ }
  b.kill();
}
process.exit(bad ? 1 : 0);
