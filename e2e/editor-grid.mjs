import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'grid@x.com', password: 'hunter2hunter2', displayName: 'Grid', username: 'grid' }),
})).json();
const { slug } = await (await fetch(`${API}/api/boards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title: 'Grid Test' }),
})).json();

const b = await launch({ width: 1440, height: 900, dpr: 2 });
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/boards/${slug}/edit`);

  check('the grid is a 6x5 board', await b.evaluate("document.querySelectorAll('.ge-cell').length") === 30);
  check('plus six category headers', await b.evaluate("document.querySelectorAll('.ge-head').length") === 6);
  check('all thirty start empty', await b.evaluate("document.querySelectorAll('.ge-cell.is-empty').length") === 30);
  check('the legend counts them', /30 cells are still empty/.test(
    await b.evaluate("document.querySelector('.ge-legend').textContent")),
    await b.evaluate("document.querySelector('.ge-legend').textContent").then?.(x=>x) ?? '');

  // ---- name a category by clicking its header ----
  await b.click('.ge-head');
  check('the panel switches to the category', /Category 1/.test(
    await b.evaluate("document.querySelector('.ge-where').textContent")));
  await b.type('#ge-name', 'Rivers');
  check('the header shows the name as you type',
    (await b.evaluate("document.querySelector('.ge-head').textContent")) === 'Rivers',
    await b.evaluate("document.querySelector('.ge-head').textContent"));

  // ---- write a clue in the cell you clicked ----
  await b.click('.ge-cell');
  check('the panel says which cell', /Rivers · \$200/.test(
    await b.evaluate("document.querySelector('.ge-where').textContent")),
    await b.evaluate("document.querySelector('.ge-where').textContent"));
  await b.type('#ge-clue', 'The longest river in Africa');
  check('half a clue does not fill the cell',
    await b.evaluate("document.querySelectorAll('.ge-cell.is-empty').length") === 30);
  await b.type('#ge-response', 'What is the Nile?');
  check('a whole clue fills the cell',
    await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 1);
  check('and the legend drops to 29', /29 cells are still empty/.test(
    await b.evaluate("document.querySelector('.ge-legend').textContent")));

  await b.shot('s3-desktop-grid.png');
  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) {
  console.error('THREW:', err.message);
  await b.shot('s3-fail.png');
  b.kill(); process.exit(1);
}
