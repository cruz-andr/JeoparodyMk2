/**
 * A Disney board, five categories wide.
 *
 * Inside the Magic's Disney Jeopardy plays five categories, and boards made
 * from it keep that shape. This publishes one through the API, finds it under
 * the Disney topic, and plays it: the board has to draw five columns across
 * its whole width, not five of six with a hole at the end.
 */
import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

const token = (await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `disney-${STAMP}@x.com`, password: 'hunter2hunter2', displayName: 'D', username: `disney${STAMP}` }),
})).json()).token;
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...o.headers },
}).then((r) => r.json());

const POINTS = [200, 400, 600, 800, 1000];
const board = {
  version: 1,
  categories: ['PIXAR', 'PRINCESSES', 'VILLAINS', 'PARKS', 'SONGS'].map((name) => ({
    name,
    questions: POINTS.map((points) => ({ points, answer: `${name} clue ${points}`, question: `What is ${name}?` })),
  })),
  finalJeopardy: { category: 'CLASSICS', answer: 'The first full-length Disney animated film', question: 'What is Snow White?' },
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: `Disney Jeopardy ${STAMP}` }) });
const saved = await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board, topic: 'disney', description: 'Used with permission.' }) });
const published = await A(`/${slug}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

check('a five-category board saves under Disney', saved.clueCount === 25, JSON.stringify(saved));
check('and publishes', published.visibility === 'public', JSON.stringify(published));

const b = await launch({ width: 1280, height: 800, dpr: 1 });
try {
  await b.goto(`${APP}/boards?topic=disney`);
  await b.until(`[...document.querySelectorAll('a, .bb-card')].some((e) => e.textContent.includes('Disney Jeopardy ${STAMP}'))`, { timeout: 15000 });
  check('it is found under the Disney topic', true);
  check('and the topic is named Disney', await b.evaluate("[...document.querySelectorAll('.bb-topic')].some((e) => e.textContent.trim() === 'Disney')"));

  await b.goto(`${APP}/boards/${slug}`);
  await b.until("!!document.querySelector('.board-actions .btn-primary')", { timeout: 15000 });
  await b.click('.board-actions .btn-primary');
  await b.until("document.querySelectorAll('.category-header').length > 0", { timeout: 15000 });
  await sleep(500);
  const headers = await b.evaluate("document.querySelectorAll('.category-header').length");
  check('played, the board has five categories', headers === 5, `${headers}`);
  /* Five columns across the whole board: the last column ends where the
     board does, rather than leaving a sixth column's gap. */
  const fit = await b.evaluate(`(() => {
    const row = document.querySelector('.categories-row').getBoundingClientRect();
    const last = [...document.querySelectorAll('.category-header')].at(-1).getBoundingClientRect();
    return Math.abs(row.right - last.right);
  })()`);
  check('and they fill its width', fit < 4, `${Math.round(fit)}px short`);
  await b.shot('disney-board.png');
} catch (err) {
  bad++;
  console.log(' THREW', err.message);
  try { await b.shot('disney-threw.png'); } catch { /* the browser is gone */ }
} finally {
  b.kill();
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
