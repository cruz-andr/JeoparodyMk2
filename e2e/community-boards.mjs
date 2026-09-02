import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

const register = async (who) => (await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `${who}-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: who, username: `${who}${STAMP}` }),
})).json()).token;

const ada = await register('cb');
/* A second account exists so the shelf has more than one author. */
await register('cbtwo');
const call = (t) => (p, o = {}) => fetch(`${API}/api/boards${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...o.headers },
}).then((r) => r.json());
const A = call(ada);

const POINTS = [200, 400, 600, 800, 1000];
const full = (names) => ({
  version: 1,
  categories: names.map((name) => ({
    name,
    questions: POINTS.map((points) => ({
      points, answer: `${name} clue for $${points}`, question: `What is ${name.toLowerCase()}?`,
      options: null, mediaType: null, mediaData: null,
      youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
    })),
  })),
  finalJeopardy: null,
});

async function publish(title, names, topic) {
  const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title }) });
  await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board: full(names), topic }) });
  await A(`/${slug}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) });
  return slug;
}

await publish('The Cold War', ['DETENTE', 'PROXY WARS', 'THE WALL', 'SPYCRAFT', 'SPACE RACE', '1989'], 'history');
await publish('Songs That Sample Songs', ['BREAKBEATS', 'DISCO', 'CLEARED?', 'ONE NOTE', 'SUED', 'THE AMEN'], 'music');

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

const b = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  // ---------- the way in ----------
  console.log('\n-- the way in --');
  await b.goto(`${APP}/menu`);
  const tiles = await b.evaluate("[...document.querySelectorAll('.menu-category')].map(e=>e.textContent.trim().replace(/\\s+/g,' '))");
  check('the menu is six tiles again', tiles.length === 6, tiles.join(' | '));
  check('and one of them is Community Boards', tiles.some((t) => /Community/i.test(t)));

  await b.evaluate(`[...document.querySelectorAll('.menu-category')].find(e=>/Community/i.test(e.textContent)).click()`);
  await new Promise((r) => setTimeout(r, 1200));
  check('it opens Community Boards', (await b.evaluate('location.pathname')) === '/boards');

  // ---------- the shelf ----------
  console.log('\n-- the shelf --');
  check('cards are on it', await b.evaluate("document.querySelectorAll('.bb-card').length") > 0,
    `${await b.evaluate("document.querySelectorAll('.bb-card').length")} cards`);
  check('every card shows its categories in the band',
    await b.evaluate(`[...document.querySelectorAll('.bb-band')].every(e => e.textContent.includes('·'))`),
    await b.evaluate("document.querySelector('.bb-band').textContent"));
  check('with no image, the board is the image',
    await b.evaluate("document.querySelectorAll('.bb-cover-board').length") > 0);
  const rowNames = await b.evaluate("[...document.querySelectorAll('.bb-row-head h2')].map(e=>e.textContent)");
  // Two boards, so every sort produces the same list. Three rows of the same
  // two boards reads as a bug, so there is one row and it says what it is.
  check('a small library shows one honest row', rowNames.join('|') === 'Every board', rowNames.join(' | '));
  check('an uncurated Featured row is never shown', !rowNames.includes('Featured'), rowNames.join(' | '));
  check('and no two rows are the same list',
    await b.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.bb-row')].map(r =>
        [...r.querySelectorAll('.bb-card-title')].map(t => t.textContent).join('|'));
      return new Set(rows).size === rows.length || rows.length < 2;
    })()`));
  await b.shot('cb-desktop.png');

  // ---------- topics ----------
  console.log('\n-- topics --');
  check('the topic filter is words, not outlined pills',
    await b.evaluate(`(()=>{const t=document.querySelector('.bb-topic');const s=getComputedStyle(t);
      return s.borderTopWidth === '0px' && s.borderLeftWidth === '0px' && s.borderRadius === '0px';})()`),
    await b.evaluate("(()=>{const s=getComputedStyle(document.querySelector('.bb-topic'));return `radius ${s.borderRadius}, border ${s.borderTopWidth}`;})()"));
  check('and the chosen one is underlined',
    await b.evaluate(`(()=>{const on=document.querySelector('.bb-topic.is-on');
      return getComputedStyle(on).borderBottomWidth === '2px';})()`));

  await b.evaluate(`[...document.querySelectorAll('.bb-topic')].find(e=>e.textContent === 'History').click()`);
  await new Promise((r) => setTimeout(r, 900));
  const titles = await b.evaluate("[...document.querySelectorAll('.bb-card-title')].map(e=>e.textContent)");
  check('picking a topic narrows the shelf', titles.every((t) => t === 'The Cold War'), titles.join(' | '));
  check('and it is in the URL, so it can be shared', (await b.evaluate('location.search')).includes('topic=history'));

  // ---------- search ----------
  console.log('\n-- search --');
  await b.evaluate(`[...document.querySelectorAll('.bb-topic')].find(e=>e.textContent === 'Everything').click()`);
  await new Promise((r) => setTimeout(r, 700));
  await b.type('.bb-search', 'sample');
  await new Promise((r) => setTimeout(r, 1400));
  const found = await b.evaluate("[...document.querySelectorAll('.bb-card-title')].map(e=>e.textContent)");
  check('search narrows to a match', found.length > 0 && found.every((t) => /Sample/i.test(t)), found.join(' | '));

  await b.evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const f = document.querySelector('.bb-search');
    set.call(f, 'zzzznothing'); f.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 1400));
  check('a search that matches nothing says so and offers a way back',
    await b.evaluate("!!document.querySelector('.bb-empty') && /Nothing here/.test(document.querySelector('.bb-empty h1').textContent)"),
    await b.evaluate("document.querySelector('.bb-empty h1')?.textContent"));

  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) {
  console.error('THREW:', err.message);
  await b.shot('cb-fail.png'); b.kill(); process.exit(1);
}
