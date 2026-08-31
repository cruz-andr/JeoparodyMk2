/**
 * Playing a Daily Double in a hosted room.
 *
 * Every other path ties a Daily Double to whoever picked the clue and scores
 * them. The host picks every clue here and has no score, so the host names the
 * player it belongs to and enters their wager. Before that existed the clue
 * opened and nothing on any screen could move the game on.
 */
import { io } from 'socket.io-client';
import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `dd-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'L', username: `ddp${STAMP}` }),
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
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Daily Night' }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rail = (b) => b.evaluate("document.querySelector('.hl-stage')?.textContent ?? ''");

const b = await launch({ width: 1440, height: 900, dpr: 2 });
let player;
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/host`);
  await b.until("/^[A-Z0-9]{4,8}$/.test(document.querySelector('.host-room-code')?.textContent ?? '')", { timeout: 15000 });
  const roomCode = (await b.evaluate("document.querySelector('.host-room-code').textContent")).trim();

  // One round, Daily Doubles on, and the host places the one in round one.
  await b.click('.host-settings');
  await b.until("!!document.querySelector('.hs-sheet')");
  for (const label of ['Double Jeopardy', 'Final Jeopardy']) {
    await b.evaluate(`[...document.querySelectorAll('.hs-toggle')].find(t=>t.textContent.startsWith(${JSON.stringify(label)})).querySelector('input').click()`);
  }
  await b.evaluate(`[...document.querySelectorAll('.hs-seg.hs-under .hs-seg-btn')].find(e=>/I will place/.test(e.textContent)).click()`);
  await b.click('.hs-done');
  await wait(300);

  await b.evaluate(`[...document.querySelectorAll('.host-alt')].find(e=>/Duplicate/.test(e.textContent)).click()`);
  await b.until("!!document.querySelector('.hf-board')", { timeout: 10000 });
  await b.click('.hf-board');
  await b.until("document.querySelectorAll('.ge-cell.is-written').length === 30", { timeout: 10000 });

  // Mark the very first cell, so the suite knows which one to open.
  await b.evaluate(`[...document.querySelectorAll('.host-ai')].find(e=>/Place the Daily/.test(e.textContent)).click()`);
  await b.until("!!document.querySelector('.ge-marking')");
  await b.evaluate("document.querySelectorAll('.ge-cell')[0].click()");
  await b.until("document.querySelectorAll('.ge-cell.is-double').length === 1", { timeout: 8000 });

  player = io('http://127.0.0.1:3995', { auth: { sessionId: `dd-${STAMP}` }, transports: ['websocket'] });
  await new Promise((r, j) => { player.on('connect', r); player.on('connect_error', j); });
  await new Promise((r, j) => player.emit('room:join',
    { roomCode, displayName: 'Ada', signature: null },
    (res) => (res?.success ? r(res) : j(new Error(res?.error ?? 'join refused')))));

  await b.until("!document.querySelector('.host-start').disabled", { timeout: 10000 });
  await b.click('.host-start');
  await b.until("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Start Game')", { timeout: 15000 });
  await b.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Start Game').click()`);
  await b.until("!!document.querySelector('.hl')", { timeout: 15000 });

  // ---------- the marked cell plays as one ----------
  console.log('\n-- the marked cell --');
  await b.evaluate("document.querySelectorAll('.question-cell')[0].click()");
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Daily Double'", { timeout: 10000 });
  check('the cell the host marked opens as a Daily Double', true, await rail(b));
  check('and the host is asked whose it is',
    (await b.evaluate("document.querySelectorAll('.hl-who-btn').length")) === 1,
    'one player in the room');
  check('the clue does not move on until they say',
    (await b.evaluate("document.querySelector('.hl-do').disabled")) === true,
    'nothing chosen yet');
  await b.shot('daily-double-wager.png');

  // ---------- naming a player and a wager ----------
  console.log('\n-- the wager --');
  await b.evaluate("document.querySelector('.hl-who-btn').click()");
  await b.evaluate("document.querySelector('.hl-wager-field input').focus()");
  await b.type('.hl-wager-field input', '600');
  check('with a player and an amount it will go',
    (await b.evaluate("document.querySelector('.hl-do').disabled")) === false);
  await b.click('.hl-do');

  await b.until("document.querySelector('.hl-stage')?.textContent === 'Was that right?'", { timeout: 10000 });
  check('setting the wager opens the clue, rather than hanging', true);
  check('the rail says who owns it and for how much',
    (await b.evaluate("document.querySelector('.hl-buzzed')?.textContent ?? ''")).includes('Ada')
    && (await b.evaluate("document.querySelector('.hl-buzzed')?.textContent ?? ''")).includes('600'),
    await b.evaluate("document.querySelector('.hl-buzzed')?.textContent"));
  check('and the verdict is worth the wager, not the clue',
    (await b.evaluate("document.querySelector('.hl-right').textContent")).includes('$600'),
    await b.evaluate("document.querySelector('.hl-right').textContent"));
  check('nobody is asked to buzz for a Daily Double',
    (await b.evaluate("!!document.querySelector('.hl-do')")) === false);
  await b.shot('daily-double-judging.png');

  // ---------- the payout ----------
  console.log('\n-- the payout --');
  await b.click('.hl-right');
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Pick a clue'", { timeout: 10000 });
  check('the clue is over either way', true);
  check('the wager is paid to the player, not the clue value',
    (await b.evaluate("document.querySelector('.hl-money')?.textContent ?? ''")) === '$600',
    await b.evaluate("document.querySelector('.hl-money')?.textContent"));
  check('and the host still has no score of their own',
    (await b.evaluate("document.querySelectorAll('.hl-score').length")) === 1);

  // ---------- an ordinary clue afterwards ----------
  console.log('\n-- and back to normal --');
  await b.evaluate("document.querySelectorAll('.question-cell')[1].click()");
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Waiting for a buzz'", { timeout: 14000 });
  check('the next clue is buzzed for as usual', true);
} finally {
  try { player?.close(); } catch { /* already gone */ }
  b.kill();
}
process.exit(bad ? 1 : 0);
