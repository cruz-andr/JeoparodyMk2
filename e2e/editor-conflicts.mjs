import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);
const register = async (who) => (await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `${who}-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: who, username: `${who}${STAMP}` }),
})).json()).token;

const token = await register('conflict');
const slug = (await (await fetch(`${API}/api/boards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title: 'Two Tabs' }),
})).json()).slug;

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const seed = (t) => `localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
  JSON.stringify({ state: { token: t, isAuthenticated: true, isGuest: false }, version: 0 })
)});`;

// Two real browsers, both with the editor open on the same board.
const one = await launch({ width: 1440, height: 900, dpr: 2 });
const two = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  console.log('\n-- two tabs on one board --');
  for (const b of [one, two]) {
    await b.onNewDocument(seed(token));
    await b.goto(`${APP}/boards/${slug}/edit`);
  }
  await new Promise(r => setTimeout(r, 800));

  // Tab one names a category and saves.
  await one.click('.ge-head');
  await one.type('#ge-name', 'TAB ONE WON');
  await new Promise(r => setTimeout(r, 2200));
  check('tab one saved', (await one.evaluate("document.querySelector('.board-save').textContent")) === 'Saved');

  // Tab two, still holding version 1, tries to save.
  await two.click('.ge-head');
  await two.type('#ge-name', 'TAB TWO');
  await new Promise(r => setTimeout(r, 2500));

  check('tab two is told rather than silently overwriting',
    await two.evaluate("!!document.querySelector('.board-conflict')"));
  check('and it stops saving', (await two.evaluate("document.querySelector('.board-save').textContent")) === 'Not saved');
  check('with both ways out offered',
    (await two.evaluate("[...document.querySelectorAll('.board-conflict button')].map(e=>e.textContent).join('|')"))
      === 'Load the other version|Keep what I have');
  await two.shot('fixes-conflict.png');

  // The board on the server is still tab one's.
  let stored = await (await fetch(`${API}/api/boards/${slug}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check('nothing was overwritten', stored.board.categories[0].name === 'TAB ONE WON',
    stored.board.categories[0].name);

  // Take theirs.
  await two.evaluate(`[...document.querySelectorAll('.board-conflict button')].find(e=>e.textContent.includes('Load the other')).click()`);
  await new Promise(r => setTimeout(r, 600));
  check('loading the other version shows it',
    (await two.evaluate("document.querySelector('.ge-head').textContent")) === 'TAB ONE WON',
    await two.evaluate("document.querySelector('.ge-head').textContent"));
  check('and the bar goes away', await two.evaluate("!document.querySelector('.board-conflict')"));

  // Now make a conflict again and keep mine instead.
  await one.click('.ge-head');
  await one.type('#ge-name', ' AGAIN');
  await new Promise(r => setTimeout(r, 2200));
  await two.click('.ge-head');
  await two.type('#ge-name', ' AND MINE');
  await new Promise(r => setTimeout(r, 2500));
  check('a second conflict is caught too', await two.evaluate("!!document.querySelector('.board-conflict')"));

  await two.evaluate(`[...document.querySelectorAll('.board-conflict button')].find(e=>e.textContent.includes('Keep what I have')).click()`);
  await new Promise(r => setTimeout(r, 2200));
  stored = await (await fetch(`${API}/api/boards/${slug}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check('keeping mine writes mine', stored.board.categories[0].name.includes('AND MINE'),
    stored.board.categories[0].name);
  check('and saving works again afterwards',
    (await two.evaluate("document.querySelector('.board-save').textContent")) === 'Saved',
    await two.evaluate("document.querySelector('.board-save').textContent"));

  console.log(bad ? `\n${bad} failed` : '\nall passed');
} catch (err) {
  console.error('THREW:', err.message);
  await two.shot('fixes3-fail.png'); bad = 1;
} finally { one.kill(); two.kill(); }
process.exit(bad ? 1 : 0);
