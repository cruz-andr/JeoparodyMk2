import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const { token } = await (await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'fix@x.com', password: 'hunter2hunter2' }),
})).json();

const POINTS = [200,400,600,800,1000];
const board = { version: 1, categories: ['A','B','C','D','E','F'].map(n => ({
  name: n, questions: POINTS.map(points => ({ points, answer: `${n} ${points}`, question: `What is ${n}?`,
    options: null, mediaType: null, mediaData: null, youtubeStart: null, youtubeEnd: null,
    audioOnly: false, altText: null })) })), finalJeopardy: null };
const slug = (await (await fetch(`${API}/api/boards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title: 'Widths' }) })).json()).slug;
await fetch(`${API}/api/boards/${slug}`, { method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ board }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const seed = `localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
  JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
)});`;

// ---------- 4. the band that used to disagree ----------
console.log('\n-- one breakpoint, not two --');
for (const [w, expectNarrow, label] of [[1440, false, '1440'], [700, true, '700 (the old dead band)'], [393, true, '393']]) {
  const b = await launch({ width: w, height: 900, dpr: 2 });
  try {
    await b.onNewDocument(seed);
    await b.goto(`${APP}/boards/${slug}/edit`);
    await new Promise(r => setTimeout(r, 800));
    const narrowDom = await b.evaluate("!!document.querySelector('.ge-narrow')");
    const oneColumn = await b.evaluate(
      "getComputedStyle(document.querySelector('.grid-editor')).gridTemplateColumns.split(' ').length === 1");
    check(`${label}: the DOM and the CSS agree`, narrowDom === expectNarrow && oneColumn === expectNarrow,
      `dom narrow=${narrowDom} css one column=${oneColumn}`);
    check(`${label}: no sideways scroll`,
      await b.evaluate('document.documentElement.scrollWidth <= innerWidth'));
  } finally { b.kill(); }
}

// ---------- 7. only what changed gets sent ----------
console.log('\n-- payload --');
const b = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  await b.onNewDocument(seed);
  await b.onNewDocument(`
    window.__sent = [];
    const real = window.fetch;
    window.fetch = (u, o) => {
      if (o?.method === 'PUT' && String(u).includes('/api/boards/')) {
        try { window.__sent.push(Object.keys(JSON.parse(o.body)).sort().join(',')); } catch {}
      }
      return real(u, o);
    };`);
  await b.goto(`${APP}/boards/${slug}/edit`);
  await new Promise(r => setTimeout(r, 800));

  await b.type('.board-edit-title input', ' renamed');
  await new Promise(r => setTimeout(r, 2200));
  const afterTitle = await b.evaluate('window.__sent.slice()');
  check('a title edit sends the title, not the board',
    afterTitle.length === 1 && afterTitle[0] === 'baseVersion,title', JSON.stringify(afterTitle));

  await b.click('.ge-grid .ge-cell');
  await b.type('#ge-clue', '!');
  await new Promise(r => setTimeout(r, 2200));
  const afterClue = await b.evaluate('window.__sent.slice()');
  check('a clue edit does send the board',
    afterClue[afterClue.length - 1] === 'baseVersion,board', JSON.stringify(afterClue));

  const stored = await (await fetch(`${API}/api/boards/${slug}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check('and the title-only save left the board alone', stored.clueCount === 30, `clueCount=${stored.clueCount}`);
  check('while the title took', stored.title.endsWith('renamed'), stored.title);
} finally { b.kill(); }

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
