import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);
const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `scroll-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'Scroll', username: `scroll${STAMP}` }),
})).json();

/* Its own part-written board, rather than hunting for one another suite left
   behind. Nineteen of thirty, so empty cells sit next to full ones. */
const POINTS = [200, 400, 600, 800, 1000];
const NAMES = ['RIVERS', 'MOUNTAINS', 'DESERTS', 'ISLANDS', 'CAPITALS', 'FLAGS'];
let left = 19;
const board = {
  version: 1,
  categories: NAMES.map((name, c) => ({
    name: c === 5 ? '' : name,
    questions: POINTS.map((points) => {
      const fill = left-- > 0;
      return {
        points,
        answer: fill ? `${name} clue worth $${points}` : '',
        question: fill ? `What is ${name.toLowerCase()}?` : '',
        options: null, mediaType: null, mediaData: null,
        youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
      };
    }),
  })),
  finalJeopardy: null,
};
const slug = (await (await fetch(`${API}/api/boards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title: 'Half Written' }),
})).json()).slug;
await fetch(`${API}/api/boards/${slug}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ board }),
});

const b = await launch({ width: 393, height: 852, dpr: 3 });
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const panelTop = () => b.evaluate("Math.round(document.querySelector('.ge-panel').getBoundingClientRect().top)");

try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/boards/${slug}/edit`);
  await new Promise(r => setTimeout(r, 500));

  check('the page opens at the top, not scrolled', await b.evaluate('window.scrollY') === 0,
    `scrollY=${await b.evaluate('window.scrollY')}`);
  const before = await panelTop();

  // Tap a clue row the way a thumb would.
  await b.click('.ge-rows .ge-row:nth-child(3)');
  await new Promise(r => setTimeout(r, 900));
  const after = await panelTop();
  check('tapping a row moves the panel up toward the top', after < before, `${before} -> ${after}`);
  check('and its fields are on screen', after > -200 && after < 500, `top=${after}`);
  check('and the panel is showing that clue', /\$600/.test(
    await b.evaluate("document.querySelector('.ge-where').textContent")),
    await b.evaluate("document.querySelector('.ge-where').textContent"));

  // The active tab has to be visible.
  await b.evaluate("document.querySelectorAll('.ge-tab')[5].click()");
  await new Promise(r => setTimeout(r, 900));
  check('moving to the last category scrolls its tab into view',
    await b.evaluate(`(()=>{const t=document.querySelectorAll('.ge-tab')[5].getBoundingClientRect();
      const p=document.querySelector('.ge-pager').getBoundingClientRect();
      return t.left >= p.left - 2 && t.right <= p.right + 2;})()`));
  check('the active tab is marked with the gold rule',
    (await b.evaluate("getComputedStyle(document.querySelectorAll('.ge-tab')[5]).boxShadow")).includes('rgb(214, 159, 76)'),
    await b.evaluate("getComputedStyle(document.querySelectorAll('.ge-tab')[5]).boxShadow"));

  await b.evaluate('window.scrollTo(0,0)');
  await new Promise(r => setTimeout(r, 300));
  await b.shot('s3-phone-editor.png');
  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) { console.error('THREW:', err.message); b.kill(); process.exit(1); }
