import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

// A finished board on the shelf, so "duplicate a community board" has something.
const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `host-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'H', username: `host${STAMP}` }),
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
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Geography Night' }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

const b = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/host`);

  // ---------- one screen, and a room from the first second ----------
  console.log('\n-- the screen --');
  await b.until("/^[A-Z0-9]{4,8}$/.test(document.querySelector('.host-room-code')?.textContent ?? '')", { timeout: 15000 });
  check('a room opens before anything is written', true,
    await b.evaluate("document.querySelector('.host-room-code').textContent"));
  check('the board is editable immediately',
    await b.evaluate("document.querySelectorAll('.ge-cell').length") === 30);
  check('settings is a labelled button in the corner',
    (await b.evaluate("document.querySelector('.host-settings')?.textContent ?? ''")).includes('Game Settings'));
  check('no wordmark competing with the board',
    await b.evaluate("!document.body.innerText.includes('JEOPARODY!')"));
  check('start refuses an empty board',
    await b.evaluate("document.querySelector('.host-start').disabled") === true,
    await b.evaluate("document.querySelector('.host-notready')?.textContent"));
  await b.shot('host-empty.png');

  // ---------- settings ----------
  console.log('\n-- game settings --');
  await b.click('.host-settings');
  await b.until("!!document.querySelector('.hs-sheet')");
  const modes = await b.evaluate("[...document.querySelectorAll('.hs-pick-name')].map(e=>e.textContent)");
  check('answer modes are sentences, not jargon',
    modes[0] === 'They buzz in and say it out loud', modes.join(' | '));
  check('every mode says what happens',
    await b.evaluate("document.querySelectorAll('.hs-pick-note').length") === 4);

  await b.shot('host-settings.png');
  await b.click('.hs-done');
  await new Promise((r) => setTimeout(r, 400));

  console.log('\n-- rounds --');
  // Double Jeopardy and Final are on by default, so a fresh game already asks
  // for both. That is the cost of writing them instead of having a model
  // invent one mid-game.
  const tabs = await b.evaluate("[...document.querySelectorAll('.host-round-name')].map(e=>e.textContent)");
  check('a round that is on has somewhere to write it',
    tabs.join('|') === 'Round one|Double Jeopardy|Final', tabs.join(' | '));

  // And turning one off takes its tab away again.
  await b.click('.host-settings');
  await b.until("!!document.querySelector('.hs-sheet')");
  await b.evaluate(`[...document.querySelectorAll('.hs-toggle')].find(t=>/Double Jeopardy/.test(t.textContent)).querySelector('input').click()`);
  await b.click('.hs-done');
  await new Promise((r) => setTimeout(r, 400));
  check('turning a round off takes its tab away',
    (await b.evaluate("[...document.querySelectorAll('.host-round-name')].map(e=>e.textContent).join('|')")) === 'Round one|Final');

  // Back on for the rest of the walk.
  await b.click('.host-settings');
  await b.until("!!document.querySelector('.hs-sheet')");
  await b.evaluate(`[...document.querySelectorAll('.hs-toggle')].find(t=>/Double Jeopardy/.test(t.textContent)).querySelector('input').click()`);
  await b.click('.hs-done');
  await new Promise((r) => setTimeout(r, 400));

  check('start names what is missing, and how to avoid it',
    /turn it off in Game Settings|clues left/.test(await b.evaluate("document.querySelector('.host-notready').textContent")),
    await b.evaluate("document.querySelector('.host-notready').textContent"));

  // ---------- fill round one from a community board ----------
  console.log('\n-- duplicate a community board --');
  await b.evaluate(`[...document.querySelectorAll('.host-alt')].find(e=>/Duplicate/.test(e.textContent)).click()`);
  await b.until("!!document.querySelector('.hf-board')", { timeout: 10000 });
  check('my finished boards are offered',
    (await b.evaluate("document.querySelector('.hf-board-name').textContent")) === 'Geography Night');
  await b.click('.hf-board');
  await b.until("document.querySelectorAll('.ge-cell.is-written').length === 30", { timeout: 10000 });
  check('it fills round one', true, '30 written');
  check('and the tab count agrees',
    (await b.evaluate("document.querySelector('.host-round.is-on .host-round-note').textContent")) === '30 of 30');

  // ---------- round two ----------
  console.log('\n-- double jeopardy --');
  await b.evaluate(`[...document.querySelectorAll('.host-round')].find(e=>/Double/.test(e.textContent)).click()`);
  await new Promise((r) => setTimeout(r, 400));
  check('round two is its own empty board',
    await b.evaluate("document.querySelectorAll('.ge-cell.is-empty').length") === 30);
  check('at doubled values',
    (await b.evaluate("document.querySelector('.ge-cell').textContent")) === '$400',
    await b.evaluate("[...document.querySelectorAll('.ge-cell')].slice(0,6).map(e=>e.textContent).join(' ')"));

  await b.evaluate(`[...document.querySelectorAll('.host-alt')].find(e=>/Duplicate/.test(e.textContent)).click()`);
  await b.until("!!document.querySelector('.hf-board')");
  await b.click('.hf-board');
  await b.until("document.querySelectorAll('.ge-cell.is-written').length === 30", { timeout: 10000 });
  check('a duplicated board takes the round it lands in',
    (await b.evaluate("document.querySelector('.ge-cell').textContent")) === '$400',
    'round two values, not round one');

  // ---------- final ----------
  console.log('\n-- final jeopardy --');
  await b.evaluate(`[...document.querySelectorAll('.host-round')].find(e=>/Final/.test(e.textContent)).click()`);
  await b.until("!!document.querySelector('.host-final')");
  check('final is three fields, not a board',
    await b.evaluate("document.querySelectorAll('.host-final .host-field').length") === 3);

  const fields = await b.evaluate("[...document.querySelectorAll('.host-final input, .host-final textarea')].length");
  check('all three are writable', fields === 3);
  await b.type('[data-field="category"] input', 'THE COLD WAR');
  await b.type('[data-field="clue"] textarea', 'Signed in 1968, this treaty has been ratified by more countries than any other.');
  await b.type('[data-field="response"] input', 'What is the Non-Proliferation Treaty?');
  await new Promise((r) => setTimeout(r, 400));
  check('the tab says it is written',
    (await b.evaluate(`[...document.querySelectorAll('.host-round')].find(e=>/Final/.test(e.textContent)).querySelector('.host-round-note').textContent`)) === 'Written');

  check('the two board fills are hidden on a round that is not a board',
    await b.evaluate("document.querySelectorAll('.host-alt').length") === 0);

  check('and start is finally allowed',
    await b.evaluate("document.querySelector('.host-start').disabled") === false,
    await b.evaluate("document.querySelector('.host-notready')?.textContent ?? 'nothing missing'"));
  await b.shot('host-ready.png');

  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) {
  console.error('THREW:', err.message);
  await b.shot('host-fail.png'); b.kill(); process.exit(1);
}
