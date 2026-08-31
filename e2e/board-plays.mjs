import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';

const reg = async (email, username) => (await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'hunter2hunter2', displayName: username, username }),
})).json()).token;

const ada = await reg(`plays-${STAMP}@x.com`, `plays${STAMP}`);
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ada}`, ...o.headers },
}).then(r => r.json());

const POINTS = [200, 400, 600, 800, 1000];
const board = {
  version: 1,
  categories: ['A','B','C','D','E','F'].map((n) => ({
    name: n, questions: POINTS.map((points) => ({
      points, answer: `${n} clue ${points}`, question: `What is ${n}?`,
      options: null, mediaType: null, mediaData: null,
      youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null })),
  })),
  finalJeopardy: null,
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Counter Test' }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board }) });
await A(`/${slug}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) });

const plays = async () => (await (await fetch(`${API}/api/boards/${slug}`)).json()).plays;
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

// A signed-out visitor, in a real browser, playing three times.
const v = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  check('starts at zero', await plays() === 0, `plays=${await plays()}`);

  for (const round of [1, 2, 3]) {
    await v.goto(`${APP}/boards/${slug}`);
    await v.click('.board-actions .btn-primary');
    await new Promise(r => setTimeout(r, 1800));
    const n = await plays();
    check(`play ${round} through the browser`, round === 1 ? n === 1 : n === 1, `plays=${n}`);
  }
  const key = await v.evaluate("localStorage.getItem('jeoparody-player-key')");
  check('the browser kept a player key', typeof key === 'string' && key.length === 32, key);

  // A different browser is a different person.
  const w = await launch({ width: 1440, height: 900, dpr: 2 });
  try {
    await w.goto(`${APP}/boards/${slug}`);
    await w.click('.board-actions .btn-primary');
    await new Promise(r => setTimeout(r, 1800));
    check('a second visitor counts', await plays() === 2, `plays=${await plays()}`);
  } finally { w.kill(); }

  // The owner, however many times.
  const o = await launch({ width: 1440, height: 900, dpr: 2 });
  try {
    await o.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
      JSON.stringify({ state: { token: ada, isAuthenticated: true, isGuest: false }, version: 0 })
    )});`);
    await o.goto(`${APP}/boards/${slug}`);
    await o.click('.board-actions .btn-primary');
    await new Promise(r => setTimeout(r, 1800));
    check('the owner still does not count', await plays() === 2, `plays=${await plays()}`);
  } finally { o.kill(); }

  console.log(bad ? `\n${bad} failed` : '\nall passed');
} finally { v.kill(); }
process.exit(bad ? 1 : 0);
