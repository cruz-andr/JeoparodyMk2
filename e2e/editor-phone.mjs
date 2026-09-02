import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

const { token } = await (await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'grid@x.com', password: 'hunter2hunter2' }),
})).json();
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...o.headers },
}).then(r => r.json());

// A part-written board, so the empty cells are visible next to the full ones.
const POINTS = [200, 400, 600, 800, 1000];
const NAMES = ['RIVERS', 'MOUNTAINS', 'DESERTS', 'ISLANDS', 'CAPITALS', 'FLAGS'];
let left = 19;
const board = {
  version: 1,
  categories: NAMES.map((name, c) => ({
    name: c === 5 ? '' : name,
    questions: POINTS.map((points) => {
      const fill = left-- > 0;
      return { points,
        answer: fill ? `${name} clue worth $${points}` : '',
        question: fill ? `What is ${name.toLowerCase()}?` : '',
        options: null, mediaType: null, mediaData: null,
        youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null };
    }),
  })),
  finalJeopardy: null,
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Half Written' }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

for (const [w, h, dpr, tag] of [[1440, 900, 2, 'desktop'], [393, 852, 3, 'phone']]) {
  const b = await launch({ width: w, height: h, dpr });
  try {
    await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
      JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
    )});`);
    await b.goto(`${APP}/boards/${slug}/edit`);
    await new Promise(r => setTimeout(r, 600));

    const wide = await b.evaluate("!!document.querySelector('.ge-grid')");
    const narrow = await b.evaluate("!!document.querySelector('.ge-narrow')");
    check(`${tag}: shows the right board`, tag === 'desktop' ? (wide && !narrow) : (narrow && !wide),
      `grid=${wide} pager=${narrow}`);
    check(`${tag}: no sideways scroll`,
      await b.evaluate('document.documentElement.scrollWidth <= innerWidth'));

    if (tag === 'phone') {
      check('phone: six categories in the pager',
        await b.evaluate("document.querySelectorAll('.ge-tab').length") === 6);
      check('phone: five rows for the category',
        await b.evaluate("document.querySelectorAll('.ge-row').length") === 5);
      const tap = await b.evaluate(`(()=>{const r=document.querySelector('.ge-row').getBoundingClientRect();
        return Math.round(r.height);})()`);
      check('phone: rows clear the 44px a thumb needs', tap >= 44, `${tap}px`);
      // Move to another category.
      await b.evaluate("document.querySelectorAll('.ge-tab')[2].click()");
      await new Promise(r => setTimeout(r, 250));
      check('phone: the pager changes category',
        (await b.evaluate("document.querySelector('.ge-head-wide').textContent")) === 'DESERTS',
        await b.evaluate("document.querySelector('.ge-head-wide').textContent"));
      // Click and read in the same expression is reading before React has
      // re-rendered. The wait is the point, not padding.
      await b.evaluate("document.querySelectorAll('.ge-tab')[5].click()");
      await new Promise(r => setTimeout(r, 250));
      check('phone: an unnamed category says so',
        (await b.evaluate("document.querySelector('.ge-head-wide').textContent")) === 'Name this category',
        await b.evaluate("document.querySelector('.ge-head-wide').textContent"));
      check('phone: and its tab says so too',
        (await b.evaluate("document.querySelectorAll('.ge-tab')[5].textContent")).includes('Name it'));
    } else {
      check('desktop: 19 written, 11 empty',
        await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 19 &&
        await b.evaluate("document.querySelectorAll('.ge-cell.is-empty').length") === 11);
      check('desktop: the unnamed header reads as empty',
        await b.evaluate("document.querySelectorAll('.ge-head.is-empty').length") === 1);
    }
    await b.shot(`s3-${tag}-editor.png`);
  } finally { b.kill(); }
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
