/**
 * The screen behind the host.
 *
 * Two halves, both checked here: the host's window sends a feed, and the
 * projector window draws it. The point of the whole thing is that the response
 * is on the first screen and never on the second, so that is asserted against
 * the real DOM rather than only against the payload.
 *
 * BroadcastChannel does not deliver a message back to the channel object that
 * sent it, but it does deliver to a second channel object in the same page.
 * That is what lets one browser stand in for two windows.
 */
import { io } from 'socket.io-client';
import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `proj-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'P', username: `proj${STAMP}` }),
})).json();
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, { ...o,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...o.headers } }).then((r) => r.json());

const POINTS = [200, 400, 600, 800, 1000];
const NAMES = ['RIVERS', 'MOUNTAINS', 'DESERTS', 'ISLANDS', 'CAPITALS', 'FLAGS'];
const SECRET = 'What is the Nile?';
await (async () => {
  const board = {
    version: 1,
    categories: NAMES.map((name) => ({
      name,
      questions: POINTS.map((points) => ({
        points, answer: `${name} clue for $${points}`, question: SECRET,
        options: null, mediaType: null, mediaData: null,
        youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
      })),
    })),
    finalJeopardy: null,
  };
  const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Projector Night' }) });
  await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board }) });
})();

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1440, height: 900, dpr: 2 });
let player;
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/host`);
  await b.until("!!document.querySelector('.ge-cell')", { timeout: 15000 });

  // One round, and the board on the wall.
  await b.click('.host-settings');
  await b.until("!!document.querySelector('.hs-sheet')");
  for (const label of ['Double Jeopardy', 'Final Jeopardy']) {
    await b.evaluate(`[...document.querySelectorAll('.hs-toggle')].find(t=>t.textContent.startsWith(${JSON.stringify(label)})).querySelector('input').click()`);
  }
  await b.evaluate(`[...document.querySelectorAll('.hs-toggle')].find(t=>/Projector mode/.test(t.textContent)).querySelector('input').click()`);
  await b.click('.hs-done');
  await wait(300);

  await b.evaluate(`[...document.querySelectorAll('.host-alt')].find(e=>/Duplicate/.test(e.textContent)).click()`);
  await b.until("!!document.querySelector('.hf-board')", { timeout: 10000 });
  await b.click('.hf-board');
  await b.until("document.querySelectorAll('.ge-cell.is-written').length === 30", { timeout: 10000 });

  const joinPlayers = async (roomCode) => {
    player = io('http://127.0.0.1:3995', { auth: { sessionId: `pp-${STAMP}` }, transports: ['websocket'] });
    await new Promise((r, j) => { player.on('connect', r); player.on('connect_error', j); });
    await new Promise((r, j) => player.emit('room:join',
      { roomCode, displayName: 'Ada', signature: null },
      (res) => (res?.success ? r(res) : j(new Error(res?.error ?? 'join refused')))));
  };

  /* The room does not exist until the game is created, so the code is read
     from the lobby and players join there. */
  await b.until("!document.querySelector('.host-start').disabled", { timeout: 10000 });
  await b.click('.host-start');
  await b.until("!!document.querySelector('.room-code-badge span')", { timeout: 15000 });
  const roomCode = (await b.evaluate("document.querySelector('.room-code-badge span').textContent")).trim();
  await joinPlayers(roomCode);
  await b.until("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Start Game')", { timeout: 15000 });
  await b.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Start Game').click()`);
  await b.until("!!document.querySelector('.hl')", { timeout: 15000 });

  // ---------- the host sends ----------
  console.log('\n-- what the host sends --');
  check('projector mode offers to open the second window',
    (await b.evaluate("document.querySelector('.hl-project')?.textContent ?? ''")).includes('projector'),
    await b.evaluate("document.querySelector('.hl-project')?.textContent"));

  // Listen the way the projector window would, from a second channel object.
  await b.evaluate(`
    window.__feeds = [];
    window.__spy = new BroadcastChannel('jeoparody-projector-${roomCode}');
    window.__spy.onmessage = (e) => { if (!e.data?.ask) window.__feeds.push(e.data); };
  `);
  await b.evaluate("document.querySelectorAll('.question-cell')[0].click()");
  await b.until("window.__feeds.length > 0", { timeout: 10000 });
  check('a clue is broadcast to the wall', true);

  const last = "window.__feeds[window.__feeds.length-1]";
  check('the clue text travels',
    (await b.evaluate(`${last}.clue.text`)).includes('RIVERS clue'));
  check('the response does not',
    await b.evaluate(`JSON.stringify(${last}).includes(${JSON.stringify(SECRET)})`) === false);
  check('nor does any unplayed clue on the board',
    await b.evaluate(`JSON.stringify(${last}.grid)`) === JSON.stringify(
      Array.from({ length: 6 }, () => POINTS.map((points) => ({ points })))));
  check('scores travel, without the host',
    await b.evaluate(`${last}.scores.map(s=>s.name).join('|')`) === 'Ada');

  // ---------- the projector draws ----------
  console.log('\n-- what the wall draws --');
  await b.goto(`${APP}/project/${roomCode}`);
  await b.until("!!document.querySelector('.pj')", { timeout: 10000 });
  check('with no host on the other end it says so, rather than showing a blank board',
    /waiting for the host/i.test(await b.evaluate("document.body.innerText")),
    /* innerText comes back through the page's text-transform, so this reads it
       case insensitively rather than asserting the CSS. */
    await b.evaluate("document.body.innerText.split('\\n')[0]"));

  const feed = {
    categories: NAMES,
    grid: Array.from({ length: 6 }, () => POINTS.map((points) => ({ points }))),
    revealed: ['0-0'],
    currentRound: 1,
    clue: { category: 'RIVERS', points: 600, text: 'It is long', mediaType: null, options: null },
    response: null,
    scores: [{ id: 'a', name: 'Ada', score: 1200 }, { id: 'b', name: 'Bo', score: -200 }],
    buzzedName: null,
    buzzerOpen: true,
  };
  await b.evaluate(`
    window.__send = new BroadcastChannel('jeoparody-projector-${roomCode}');
    window.__send.postMessage(${JSON.stringify(feed)});
  `);
  await b.until("!!document.querySelector('.pj-clue')", { timeout: 8000 });
  check('a clue fills the wall',
    (await b.evaluate("document.querySelector('.pj-clue-text').textContent")) === 'It is long');
  check('nothing on the wall is clickable',
    await b.evaluate("document.querySelectorAll('.pj button, .pj a, .pj input').length") === 0);
  check('an open buzzer is announced',
    (await b.evaluate("document.querySelector('.pj-buzz')?.textContent ?? ''")) === 'Buzz in');
  check('scores are on the wall, negatives readable',
    (await b.evaluate("[...document.querySelectorAll('.pj-money')].map(e=>e.textContent).join('|')")) === '$1,200|-$200');
  await b.shot('projector-clue.png');

  // Revealing is deliberate.
  await b.evaluate(`window.__send.postMessage(${JSON.stringify({ ...feed, response: SECRET })});`);
  await b.until("!!document.querySelector('.pj-response')", { timeout: 8000 });
  check('a revealed response does reach the wall, when the host reveals it',
    (await b.evaluate("document.querySelector('.pj-response').textContent")) === SECRET);

  // And back to the board.
  await b.evaluate(`window.__send.postMessage(${JSON.stringify({ ...feed, clue: null, response: null })});`);
  await b.until("!!document.querySelector('.pj-board')", { timeout: 8000 });
  check('with nothing open the wall shows the board',
    await b.evaluate("document.querySelectorAll('.pj-cell').length") === 30);
  check('and a played cell is a hole in it',
    await b.evaluate("document.querySelectorAll('.pj-cell.is-gone').length") === 1);
  check('the board on the wall carries no clue text',
    await b.evaluate(`!document.body.innerText.includes(${JSON.stringify(SECRET)})`) === true);
  await b.shot('projector-board.png');
} finally {
  try { player?.close(); } catch { /* already gone */ }
  b.kill();
}
process.exit(bad ? 1 : 0);
