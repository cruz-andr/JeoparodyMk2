import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'fix@x.com', password: 'hunter2hunter2', displayName: 'Fix', username: 'fixer' }),
})).json();
const { slug } = await (await fetch(`${API}/api/boards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title: 'Fixes' }),
})).json();

const b = await launch({ width: 1440, height: 900, dpr: 2 });
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const focused = () => b.evaluate("document.activeElement.id || document.activeElement.className || document.activeElement.tagName");
const where = () => b.evaluate("document.querySelector('.ge-where').textContent");

try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/boards/${slug}/edit`);
  await new Promise(r => setTimeout(r, 700));

  // ---------- 3. roving tabindex ----------
  console.log('\n-- focus and selection --');
  check('exactly one cell is tabbable',
    await b.evaluate("document.querySelectorAll('.ge-grid button[tabindex=\"0\"], .ge-final[tabindex=\"0\"]').length") === 1,
    `${await b.evaluate("document.querySelectorAll('.ge-grid button[tabindex=\"0\"]').length")} in the grid`);
  check('the grid itself is no longer tabbable',
    await b.evaluate("document.querySelector('.ge-grid').getAttribute('tabindex')") === null);
  check('and it is the selected one',
    await b.evaluate("document.querySelector('.ge-cell.is-on').getAttribute('tabindex')") === '0');

  await b.click('.ge-cell.is-on');
  await b.key('ArrowRight');
  check('after an arrow, focus is on the newly selected cell',
    await b.evaluate("document.activeElement.classList.contains('ge-cell') && document.activeElement.classList.contains('is-on')"),
    await focused());
  check('and still only one is tabbable',
    await b.evaluate("document.querySelectorAll('.ge-grid button[tabindex=\"0\"]').length") === 1);

  // ---------- 2. Final Jeopardy ----------
  console.log('\n-- final jeopardy --');
  check('there is a Final Jeopardy tile', await b.evaluate("!!document.querySelector('.ge-final')"));
  check('it starts unset', /Not set/.test(await b.evaluate("document.querySelector('.ge-final').textContent")),
    await b.evaluate("document.querySelector('.ge-final').textContent"));

  await b.click('.ge-final');
  check('clicking it opens the Final Jeopardy panel', (await where()) === 'Final Jeopardy', await where());
  await b.type('#ge-final-cat', 'RIVERS');
  await new Promise(r => setTimeout(r, 200));
  check('a part-written final says so',
    /Half written/.test(await b.evaluate("document.querySelector('.ge-final').textContent")),
    await b.evaluate("document.querySelector('.ge-final').textContent"));

  await b.type('#ge-final-clue', 'The longest river in Africa');
  await b.type('#ge-final-response', 'What is the Nile?');
  await new Promise(r => setTimeout(r, 300));
  check('a complete final shows its category',
    /RIVERS/.test(await b.evaluate("document.querySelector('.ge-final').textContent")),
    await b.evaluate("document.querySelector('.ge-final').textContent"));

  // arrow down from the last row reaches it
  await b.click('.ge-grid .ge-cell');
  for (let i = 0; i < 5; i++) await b.key('ArrowDown');
  check('arrowing off the last row reaches Final Jeopardy', (await where()) === 'Final Jeopardy', await where());
  await b.key('ArrowUp');
  check('and up comes back to the $1000', /\$1000/.test(await where()), await where());

  await new Promise(r => setTimeout(r, 2000));
  const stored = await (await fetch(`${API}/api/boards/${slug}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check('the final saved', stored.board.finalJeopardy?.question === 'What is the Nile?',
    JSON.stringify(stored.board.finalJeopardy));
  check('and the board carries a version', stored.version > 1, `version=${stored.version}`);

  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) {
  console.error('THREW:', err.message);
  await b.shot('fixes-fail.png'); b.kill(); process.exit(1);
}
