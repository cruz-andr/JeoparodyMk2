import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';

const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);
const register = async (who) => (await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `${who}-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: who, username: `${who}${STAMP}` }),
})).json()).token;


const token = await register('autosave');
const { slug } = await (await fetch(`${API}/api/boards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title: 'Persistence' }),
})).json();

const b = await launch({ width: 1440, height: 900, dpr: 2 });
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/boards/${slug}/edit`);

  await b.click('.ge-head');
  await b.type('#ge-name', 'Rivers');
  await b.click('.ge-cell');
  await b.type('#ge-clue', 'The longest river in Africa');
  await b.type('#ge-response', 'What is the Nile?');

  check('it says it is saving', (await b.evaluate("document.querySelector('.board-save').textContent")) === 'Saving');
  await new Promise(r => setTimeout(r, 2200));
  check('then that it saved', (await b.evaluate("document.querySelector('.board-save').textContent")) === 'Saved');

  // The only test of a save that counts.
  await b.goto(`${APP}/boards/${slug}/edit`);
  check('the category name came back',
    (await b.evaluate("document.querySelector('.ge-head').textContent")) === 'RIVERS',
    await b.evaluate("document.querySelector('.ge-head').textContent"));
  check('the written cell came back',
    await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 1);
  await b.click('.ge-cell');
  check('the clue text came back',
    (await b.evaluate("document.querySelector('#ge-clue').value")) === 'The longest river in Africa',
    await b.evaluate("document.querySelector('#ge-clue').value"));
  check('the response came back',
    (await b.evaluate("document.querySelector('#ge-response').value")) === 'What is the Nile?');

  // And the server agrees.
  const stored = await (await fetch(`${API}/api/boards/${slug}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check('the server counted one clue', stored.clueCount === 1, `clueCount=${stored.clueCount}`);
  check('the server normalised the category to caps', stored.board.categories[0].name === 'RIVERS',
    stored.board.categories[0].name);

  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) {
  console.error('THREW:', err.message);
  b.kill(); process.exit(1);
}
