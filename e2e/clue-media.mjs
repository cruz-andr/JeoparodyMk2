/**
 * A clue with a picture, drawn the way the show draws one.
 *
 * The picture sits beside the clue inside the blue rather than stacked above
 * it, and on a phone the two stack. Final Jeopardy can carry a picture too,
 * and a community board plays as the one round its author wrote, then its own
 * Final: it is not handed a Double Jeopardy round nobody wrote.
 */
import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

const token = (await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `media-${STAMP}@x.com`, password: 'hunter2hunter2', displayName: 'M', username: `media${STAMP}` }),
})).json()).token;
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...o.headers },
}).then((r) => r.json());

// One blue pixel; the layout is what is being checked, not the picture.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const POINTS = [200, 400, 600, 800, 1000];
const NAMES = ['RIVERS', 'PEAKS', 'LAKES', 'DESERTS', 'ISLANDS', 'CAPES'];
const board = {
  version: 1,
  categories: NAMES.map((name, c) => ({
    name,
    questions: POINTS.map((points, r) => ({
      points, answer: `${name} clue ${points}`, question: `What is ${name}?`,
      ...(c === 0 && r === 0 ? { mediaType: 'image', mediaData: PIXEL, altText: 'A blue square' } : {}),
      // A two second clip: the clue's clock waits for it.
      ...(c === 2 && r === 0 ? { mediaType: 'youtube', mediaData: 'u4YFjksxPg0', youtubeStart: 895, youtubeEnd: 897 } : {}),
    })),
  })),
  finalJeopardy: {
    category: 'MAPS', answer: 'The river seen here', question: 'What is the Nile?',
    mediaType: 'image', mediaData: PIXEL, altText: 'A map',
  },
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: `Pictures ${STAMP}` }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board, topic: 'geography' }) });
await A(`/${slug}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const layout = `(() => {
  const img = document.querySelector('.clue-screen.has-media img')?.getBoundingClientRect();
  const text = document.querySelector('.clue-screen.has-media .clue-text')?.getBoundingClientRect();
  return img && text ? { imgRight: img.right, imgBottom: img.bottom, textLeft: text.left, textTop: text.top, imgWidth: img.width } : null;
})()`;

async function play(b) {
  await b.goto(`${APP}/boards/${slug}`);
  await b.until("!!document.querySelector('.board-actions .btn-primary')", { timeout: 15000 });
  await b.click('.board-actions .btn-primary');
  await b.until("document.querySelectorAll('.category-header, .wheel-band').length > 0", { timeout: 15000 });
  await sleep(2000);
}

const clickText = (b, scope, re) => b.evaluate(`(() => {
  const x = [...document.querySelectorAll('${scope} button')].find((e) => ${re}.test(e.textContent) && !e.disabled);
  if (x) { x.click(); return true; } return false; })()`);

// ---------- desktop: beside the clue, then the Final ----------
const d = await launch({ width: 1280, height: 800, dpr: 1 });
try {
  await play(d);
  const cell = (c, r) => d.evaluate(`(() => {
    const el = document.querySelectorAll('.questions-grid .question-row')[${r}]?.querySelectorAll('.question-cell')[${c}];
    if (!el || el.classList.contains('revealed')) return false; el.click(); return true; })()`);
  // Past a Daily Double's reveal to its clue, wagering the least.
  const open = async () => {
    for (let i = 0; i < 25; i++) {
      if (await d.evaluate("!!document.querySelector('.question-modal')")) return;
      if (await d.evaluate("!!document.querySelector('.daily-double-overlay')")) {
        await clickText(d, '.daily-double-overlay', '/skip/i');
        await clickText(d, '.daily-double-overlay', '/confirm/i');
      }
      await sleep(300);
    }
    throw new Error('no clue opened');
  };
  /* Typed and graded, as every clue is now. Right is the category's name,
     which is what each clue's response asks for; wrong is a pass, or on a
     Daily Double, which cannot be passed, a wrong answer. */
  const answer = async (right) => {
    if (right || !(await clickText(d, '.question-modal', '/^\\s*pass\\s*$/i'))) {
      const name = right ? await d.evaluate("document.querySelector('.question-category').textContent.trim()") : 'not it';
      // Once the box is there and settled: text sent while a clue animates in lands nowhere.
      await d.until("!!document.querySelector('.typed-input')", { timeout: 8000 });
      await sleep(300);
      await d.type('.typed-input', name);
      if (!(await d.evaluate(`document.querySelector('.typed-input').value === ${JSON.stringify(name)}`))) {
        await sleep(400);
        await d.type('.typed-input', name);
      }
      await d.click('.typed-submit');
      await d.until("!!document.querySelector('.typed-result')", { timeout: 8000 });
    }
    await sleep(300);
    await clickText(d, '.question-modal', '/continue/i');
    await d.until("!document.querySelector('.question-modal')", { timeout: 8000 });
    await sleep(250);
  };

  await cell(0, 0); await open();
  await d.until("!!document.querySelector('.clue-screen.has-media img')", { timeout: 8000 });
  const wide = await d.evaluate(layout);
  check('a picture clue puts the picture beside the clue', wide && wide.imgRight <= wide.textLeft, JSON.stringify(wide));
  check('and gives it a real share of the screen', wide && wide.imgWidth > 400, `${Math.round(wide?.imgWidth)}px`);
  await d.shot('clue-media-desktop.png');
  // Got right, because Final Jeopardy needs a score above $0.
  await answer(true);

  await cell(1, 0); await open();
  check('a clue with no media has no media column', await d.evaluate("!document.querySelector('.clue-screen.has-media') && !!document.querySelector('.clue-screen .clue-text')"));
  check('and its clock starts straight away', await d.evaluate("!!document.querySelector('.question-timer')"));
  await answer(false);

  // A clip is part of the clue: no clock until it has played.
  await cell(2, 0); await open();
  await sleep(800);
  check('a clip clue shows no clock while the clip plays', !(await d.evaluate("!!document.querySelector('.question-timer')")));
  await d.until("!!document.querySelector('.question-timer')", { timeout: 9000 });
  check('and starts it once the clip has played', true);
  await answer(false);

  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
    if (await cell(c, r)) { await open(); await answer(false); }
  }

  await d.until("[...document.querySelectorAll('button')].some((x) => /Play Final Jeopardy/i.test(x.textContent))", { timeout: 15000 });
  check('the round ends on its own Final, with no Double Jeopardy invented for it',
    !(await d.evaluate("[...document.querySelectorAll('button')].some((x) => /Double Jeopardy/i.test(x.textContent))")));
  await clickText(d, '', '/Play Final Jeopardy/i');
  await d.until("!!document.querySelector('.final-jeopardy-modal')", { timeout: 15000 });
  for (let i = 0; i < 30 && !(await d.evaluate("!!document.querySelector('.fj-clue-phase')")); i++) {
    await clickText(d, '.final-jeopardy-modal', '/wager|lock|confirm|submit|continue/i');
    await sleep(500);
  }
  check('Final Jeopardy shows its picture beside the clue',
    await d.evaluate("!!document.querySelector('.fj-clue-card .clue-screen.has-media img')"));
  await d.shot('clue-media-final.png');
} catch (err) {
  bad++;
  console.log(' THREW', err.message);
  try { await d.shot('clue-media-threw.png'); } catch { /* the browser is gone */ }
} finally {
  d.kill();
}

// ---------- phone: stacked ----------
const p = await launch({ width: 393, height: 852, dpr: 2 });
try {
  await play(p);
  // Only the band in the middle of the wheel takes a tap: bring RIVERS there first.
  const band = "[...document.querySelectorAll('.wheel-band')].find((x) => x.querySelector('.wheel-name')?.textContent.trim().toUpperCase() === 'RIVERS')";
  await p.evaluate(`${band}?.querySelector('.wheel-name')?.click()`);
  await sleep(1200);
  await p.evaluate("[...document.querySelectorAll('.wheel-band.playable')].find((x) => x.querySelector('.wheel-name')?.textContent.trim().toUpperCase() === 'RIVERS')?.querySelectorAll('.wheel-tile')[0]?.click()");
  await p.until("!!document.querySelector('.clue-screen.has-media img')", { timeout: 8000 });
  const narrow = await p.evaluate(layout);
  check('on a phone the picture stacks above the clue', narrow && narrow.imgBottom <= narrow.textTop, JSON.stringify(narrow));
  const scroll = await p.evaluate('document.documentElement.scrollWidth - window.innerWidth');
  check('without pushing the page sideways', scroll <= 0, `${scroll}px over`);
  await p.shot('clue-media-phone.png');
} catch (err) {
  bad++;
  console.log(' THREW', err.message);
  try { await p.shot('clue-media-phone-threw.png'); } catch { /* the browser is gone */ }
} finally {
  p.kill();
}

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
