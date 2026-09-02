import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

const register = async (who) => (await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `${who}-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: who, username: `${who}${STAMP}` }),
})).json()).token;

const ada = await register('rep');
const bob = await register('reptwo');
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ada}`, ...o.headers },
}).then((r) => r.json());

const POINTS = [200, 400, 600, 800, 1000];
const NAMES = ['RIVERS', 'MOUNTAINS', 'DESERTS', 'ISLANDS', 'CAPITALS', 'FLAGS'];
const board = {
  version: 1,
  categories: NAMES.map((name) => ({
    name,
    questions: POINTS.map((points) => ({
      points, answer: `${name} $${points}`, question: `What is ${name.toLowerCase()}?`,
      options: null, mediaType: null, mediaData: null,
      youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
    })),
  })),
  finalJeopardy: null,
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Reportable' }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board, topic: 'geography' }) });
await A(`/${slug}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const seed = (t) => `localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
  JSON.stringify({ state: { token: t, isAuthenticated: true, isGuest: false }, version: 0 })
)});`;

// ---------- reporting, as somebody else ----------
const reader = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  console.log('\n-- reporting --');
  await reader.onNewDocument(seed(bob));
  await reader.goto(`${APP}/boards/${slug}`);
  await new Promise((r) => setTimeout(r, 900));

  check('a visitor is offered a report', await reader.evaluate("!!document.querySelector('.board-report-open')"));
  await reader.click('.board-report-open');
  await new Promise((r) => setTimeout(r, 350));
  check('it asks why', await reader.evaluate("document.querySelectorAll('.board-report-form .board-choice').length") === 5);
  check('and will not send without a reason',
    await reader.evaluate(`[...document.querySelectorAll('.board-action')].find(e=>e.textContent.includes('Send the report')).disabled`) === true);

  await reader.evaluate(`[...document.querySelectorAll('.board-report-form .board-choice')].find(e=>/Copied from a real episode/.test(e.textContent)).click()`);
  await new Promise((r) => setTimeout(r, 250));
  await reader.evaluate(`[...document.querySelectorAll('.board-action')].find(e=>e.textContent.includes('Send the report')).click()`);
  await new Promise((r) => setTimeout(r, 900));
  check('it is sent, and says what happens next',
    await reader.evaluate("!!document.querySelector('.board-report-done')"),
    await reader.evaluate("document.querySelector('.board-report-done')?.textContent?.slice(0,60)"));

  const still = await (await fetch(`${API}/api/boards/${slug}`)).json();
  check('and the board is still there', still.visibility === 'public');
} finally { reader.kill(); }

// ---------- the owner sees no report button, but does see the cover ----------
const owner = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  console.log('\n-- covers --');
  await owner.onNewDocument(seed(ada));
  await owner.goto(`${APP}/boards/${slug}`);
  await new Promise((r) => setTimeout(r, 900));

  check('the owner is not offered a report on their own board',
    await owner.evaluate("!document.querySelector('.board-report')"));
  check('the cover shows the board when there is no image',
    await owner.evaluate("!!document.querySelector('.board-cover-none')"));
  check('with the categories across the bottom',
    (await owner.evaluate("document.querySelector('.board-cover-band').textContent")).includes('RIVERS'),
    await owner.evaluate("document.querySelector('.board-cover-band').textContent"));

  // Through the real file input, with the change event a browser would send.
  await owner.attachFile('.board-cover-pick input',
    new URL('./fixture-cover.png', import.meta.url).pathname);
  // Compress, upload, reload. Waited for rather than guessed at.
  await owner.until("!!document.querySelector('.board-cover-shot img')", { timeout: 15000 });
  check('the cover uploads and replaces the board art', true,
    await owner.evaluate("document.querySelector('.board-cover-shot img')?.src?.slice(0,60)"));
  const stored = await (await fetch(`${API}/api/boards/${slug}`)).json();
  check('the server agrees there is one', stored.hasCover === true);

  const img = await fetch(`${API}/api/boards/${slug}/cover`);
  check('and serves it as an image with cache headers',
    img.headers.get('content-type').startsWith('image/') && /max-age/.test(img.headers.get('cache-control')),
    `${img.headers.get('content-type')} / ${img.headers.get('cache-control')}`);

  const listed = await (await fetch(`${API}/api/boards?row=new`)).json();
  const card = listed.boards.find((b) => b.slug === slug);
  check('the card says there is a cover without carrying it',
    card.hasCover === true && card.coverImage === undefined);

  await owner.shot('cb-cover.png');
} finally { owner.kill(); }

// ---------- phone ----------
const phone = await launch({ width: 393, height: 852, dpr: 3 });
try {
  console.log('\n-- phone --');
  await phone.goto(`${APP}/boards`);
  await new Promise((r) => setTimeout(r, 1200));
  check('the shelf fits', await phone.evaluate('document.documentElement.scrollWidth <= innerWidth'),
    `${await phone.evaluate('document.documentElement.scrollWidth')} vs ${await phone.evaluate('innerWidth')}`);
  check('cards are still readable', await phone.evaluate("document.querySelectorAll('.bb-card').length") > 0);
  check('the topic row scrolls rather than wrapping',
    await phone.evaluate("getComputedStyle(document.querySelector('.bb-topics')).overflowX") === 'auto');
  await phone.shot('cb-phone.png');

  await phone.goto(`${APP}/guidelines`);
  await new Promise((r) => setTimeout(r, 700));
  check('the guidelines page opens', await phone.evaluate("!!document.querySelector('.guide h1')"));
  check('and it fits', await phone.evaluate('document.documentElement.scrollWidth <= innerWidth'));
} finally { phone.kill(); }

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
