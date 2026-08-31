/**
 * The host's screen while the game runs.
 *
 * A real player joins over a socket rather than a second browser: joining
 * through the form needs a drawn signature, and driving a canvas would test
 * the canvas rather than the thing under test.
 */
import { io } from 'socket.io-client';
import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `live-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'L', username: `live${STAMP}` }),
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
const rail = (b) => b.evaluate("document.querySelector('.hl-stage')?.textContent ?? ''");

const b = await launch({ width: 1440, height: 900, dpr: 2 });
let player;
let other;
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/host`);
  await b.until("!!document.querySelector('.ge-cell')", { timeout: 15000 });

  // One round only, so the game can start from a single board.
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

  const join = async (roomCode, sessionId, displayName) => {
    const socket = io('http://127.0.0.1:3995', { auth: { sessionId }, transports: ['websocket'] });
    await new Promise((r, j) => { socket.on('connect', r); socket.on('connect_error', j); });
    await new Promise((r, j) => socket.emit('room:join',
      { roomCode, displayName, signature: null },
      (res) => (res?.success ? r(res) : j(new Error(res?.error ?? 'join refused')))));
    return socket;
  };

  /* The room does not exist until the game is created, so the code comes from
     the lobby and the players arrive there. */
  await b.until("!document.querySelector('.host-start').disabled", { timeout: 10000 });
  await b.click('.host-start');
  await b.until("!!document.querySelector('.room-code-badge span')", { timeout: 15000 });
  const roomCode = (await b.evaluate("document.querySelector('.room-code-badge span').textContent")).trim();
  player = await join(roomCode, `p-${STAMP}`, 'Ada');
  other = await join(roomCode, `q-${STAMP}`, 'Bo');

  await b.until("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Start Game')", { timeout: 15000 });
  await b.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Start Game').click()`);
  await b.until("!!document.querySelector('.hl')", { timeout: 15000 });

  // ---------- the screen the host gets ----------
  console.log('\n-- the host is not a player --');
  check('the host gets their own screen, not the player one',
    await b.evaluate("!document.querySelector('.host-control-panel')") === true,
    'no floating panel');
  check('the board is there to pick from',
    await b.evaluate("!!document.querySelector('.hl-board .game-board, .hl-board')") === true);
  check('the rail says what to do', (await rail(b)) === 'Pick a clue', await rail(b));
  check('the host has no score of their own',
    await b.evaluate("[...document.querySelectorAll('.hl-name')].map(e=>e.textContent).join('|')") === 'Ada|Bo',
    await b.evaluate("[...document.querySelectorAll('.hl-name')].map(e=>e.textContent).join('|')"));
  await b.shot('host-live-picking.png');

  // ---------- a clue ----------
  console.log('\n-- a clue --');
  await b.evaluate("document.querySelectorAll('.question-cell')[0].click()");
  await b.until("!!document.querySelector('.hl-clue')", { timeout: 10000 });
  check('picking a clue opens it on the host screen', true);
  check('the host can see the answer',
    (await b.evaluate("document.querySelector('.hl-answer')?.textContent ?? ''")).startsWith('What is rivers'),
    await b.evaluate("document.querySelector('.hl-answer')?.textContent"));
  check('and the clue it goes with',
    (await b.evaluate("document.querySelector('.hl-clue-text')?.textContent ?? ''")).includes('RIVERS clue'));
  await b.shot('host-live-clue.png');

  // ---------- buzz ----------
  console.log('\n-- the buzz --');
  /* The server opens the buzzer a few seconds after the clue goes up, so this
     waits rather than clicking. Catching the reading stage in between is a
     race against that timer; liveStage.test.js pins it instead. */
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Waiting for a buzz'", { timeout: 12000 });
  check('the buzzer opens by itself, so reading is not a race', true);
  check('and the rail now offers to close it',
    (await b.evaluate("document.querySelector('.hl-do')?.textContent ?? ''")) === 'Close the buzzer',
    await b.evaluate("document.querySelector('.hl-do')?.textContent"));

  player.emit('game:buzz-in', { roomCode, reactionTime: 412 });
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Was that right?'", { timeout: 10000 });
  check('a buzz turns the rail into a verdict', true);
  check('it names who buzzed',
    (await b.evaluate("document.querySelector('.hl-buzzed')?.textContent ?? ''")).includes('Ada'));
  check('and how fast they were',
    /^\d+(ms|\.\d+s)$/.test(await b.evaluate("document.querySelector('.hl-react')?.textContent ?? ''")),
    /* The server times the buzz itself rather than trusting the client, so the
       number is whatever it measured, not the one sent. */
    await b.evaluate("document.querySelector('.hl-react')?.textContent"));
  check('right and wrong are the same size, because the host is the referee',
    await b.evaluate(`(() => {
      const a = document.querySelector('.hl-right').getBoundingClientRect();
      const c = document.querySelector('.hl-wrong').getBoundingClientRect();
      return Math.abs(a.width - c.width) < 2 && Math.abs(a.height - c.height) < 2;
    })()`) === true);
  check('each says what it is worth',
    (await b.evaluate("document.querySelector('.hl-right').textContent")).includes('+$200'),
    await b.evaluate("document.querySelector('.hl-right').textContent"));
  await b.shot('host-live-judging.png');

  // ---------- wrong, and the clue stays up ----------
  console.log('\n-- a wrong answer --');
  await b.click('.hl-wrong');
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Waiting for a buzz'", { timeout: 10000 });
  check('a wrong answer does not end the clue', true, 'the buzzer reopened');
  check('the rail says why it is waiting again',
    (await b.evaluate("document.querySelector('.hl-again')?.textContent ?? ''")).includes('Ada was wrong'),
    await b.evaluate("document.querySelector('.hl-again')?.textContent"));
  check('and who is left to try',
    (await b.evaluate("document.querySelector('.hl-again')?.textContent ?? ''")).includes('Bo can still buzz'));
  check('the wrong answer cost them',
    (await b.evaluate("[...document.querySelectorAll('.hl-money')].map(e=>e.textContent).join('|')")) === '$0|-$200',
    await b.evaluate("[...document.querySelectorAll('.hl-money')].map(e=>e.textContent).join('|')"));
  await b.shot('host-live-rebound.png');

  // The one who was wrong is locked out; the other is not.
  player.emit('game:buzz-in', { roomCode, reactionTime: 300 });
  await wait(600);
  check('the player who was wrong cannot buzz again',
    (await b.evaluate("document.querySelector('.hl-stage')?.textContent")) === 'Waiting for a buzz');

  other.emit('game:buzz-in', { roomCode, reactionTime: 300 });
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Was that right?'", { timeout: 10000 });
  check('somebody who has not had a go still can', true);
  check('and the rail is about them now',
    (await b.evaluate("document.querySelector('.hl-buzzed')?.textContent ?? ''")).includes('Bo'));

  // ---------- the verdict ----------
  console.log('\n-- the verdict --');
  await b.click('.hl-right');
  await b.until("document.querySelector('.hl-stage')?.textContent === 'Pick a clue'", { timeout: 8000 });
  check('judging returns the host to the board', true);
  check('the score moved',
    (await b.evaluate("[...document.querySelectorAll('.hl-money')].map(e=>e.textContent).join('|')")) === '$200|-$200',
    await b.evaluate("[...document.querySelectorAll('.hl-money')].map(e=>e.textContent).join('|')"));

  // ---------- fixing a score ----------
  console.log('\n-- fixing a score --');
  await b.evaluate(`[...document.querySelectorAll('.hl-score')][0].querySelector('.hl-adjust button').click()`);
  await b.until("!!document.querySelector('.hl-delta')");
  await b.evaluate("document.querySelector('.hl-delta').focus()");
  await b.type('.hl-delta', '-50');
  await b.evaluate(`[...document.querySelectorAll('.hl-adjust button')].find(e=>e.textContent==='Apply').click()`);
  await b.until("document.querySelector('.hl-money')?.textContent === '$150'", { timeout: 8000 });
  check('an adjustment is a change, not a replacement', true, '$200 - 50 = $150');

  console.log('\n-- removing somebody --');
  await b.evaluate(`[...document.querySelectorAll('.hl-score')][0].querySelector('.hl-adjust button:nth-of-type(2)').click()`);
  await b.until("!!document.querySelector('.hl-sure')");
  check('removing asks first, in the page rather than the browser',
    (await b.evaluate("document.querySelector('.hl-sure').textContent")) === 'Remove them?');
  await b.evaluate(`[...document.querySelectorAll('.hl-adjust button')].find(e=>e.textContent==='Keep').click()`);
  await wait(200);
  check('and backing out leaves them alone',
    await b.evaluate("document.querySelectorAll('.hl-score').length") === 2);
} finally {
  try { player?.close(); } catch { /* already gone */ }
  try { other?.close(); } catch { /* already gone */ }
  b.kill();
}
process.exit(bad ? 1 : 0);
