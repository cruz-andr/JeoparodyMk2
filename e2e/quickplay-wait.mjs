/* Quickplay never leaves a lone player on a spinner.

   One browser joins the queue and is told it is looking for players, then,
   once the pairing threshold has passed, that two will do. A second browser
   joining then starts the game for both. A third, alone the whole way, is told
   nobody else is looking and offered a way forward. Slow by nature: the
   thresholds are 20 and 45 seconds, and the server checks every five. */
import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Guest, typed name, into the queue. */
async function queueUp(b, name) {
  await b.goto(`${APP}/quickplay`);
  await b.until("!!document.querySelector('.signature-mode-toggle .mode-btn:nth-child(2)')", { timeout: 15000 });
  await b.click('.signature-mode-toggle .mode-btn:nth-child(2)');
  await b.type('.signature-text-input', name);
  await b.until("(() => { const el = document.querySelector('.btn-primary.btn-large'); return !!el && !el.disabled; })()", { timeout: 15000 });
  await b.click('.btn-primary.btn-large');
}

const text = (b, sel) => b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() ?? ''`);

const a = await launch({ width: 1280, height: 800, dpr: 1 });
const b = await launch({ width: 1280, height: 800, dpr: 1 });
const c = await launch({ width: 1280, height: 800, dpr: 1 });
try {
  // --- two will do, after a wait ------------------------------------------
  const startedAt = Date.now();
  await queueUp(a, 'Ada');
  await a.until("document.querySelector('.search-state')?.dataset.state === 'looking'", { timeout: 10000 });
  check('a lone player is told it is looking for players', (await text(a, '.search-state')) === 'Looking for players');

  await sleep(2500);
  const shown = await text(a, '.queue-time');
  check('the elapsed wait is shown and moving', /^0:0[2-9]$/.test(shown), shown);

  await a.until("document.querySelector('.search-state')?.dataset.state === 'two'", { timeout: 30000 });
  const flipAt = (Date.now() - startedAt) / 1000;
  check('after the pairing threshold the screen says it will start with two', flipAt >= 19 && flipAt < 30, `${flipAt.toFixed(1)}s`);
  check('the hint says the next arrival starts it', (await text(a, '.search-hint')).includes('next player'));

  await queueUp(b, 'Bea');
  await Promise.all([
    a.until("!!document.querySelector('.match-badge')", { timeout: 12000 }),
    b.until("!!document.querySelector('.match-badge')", { timeout: 12000 }),
  ]);
  const seated = await a.evaluate("document.querySelectorAll('.match-player').length");
  check('a second arrival starts the game for both, with two seats', seated === 2, `${seated} seats`);

  // --- nobody at all --------------------------------------------------------
  const aloneAt = Date.now();
  await queueUp(c, 'Cy');
  await c.until("!!document.querySelector('.nomatch-title')", { timeout: 60000 });
  const gaveUpAt = (Date.now() - aloneAt) / 1000;
  check('alone past the give-up threshold, the player is told nobody else is looking',
    (await text(c, '.nomatch-title')) === 'Nobody else is looking right now', `${gaveUpAt.toFixed(1)}s`);
  check('and it did not give up early', gaveUpAt >= 44, `${gaveUpAt.toFixed(1)}s`);

  const actions = await c.evaluate("[...document.querySelectorAll('.nomatch-actions button.quiet-action')].map(b => b.textContent.trim())");
  check('two quiet actions: try again, host instead', JSON.stringify(actions) === JSON.stringify(['Try again', 'Host a game instead']), JSON.stringify(actions));

  const outlined = await c.evaluate(`[...document.querySelectorAll('button.quiet-action')]
    .filter(el => { const s = getComputedStyle(el); return s.borderTopWidth !== '0px' || s.borderTopStyle !== 'none'; }).length`);
  check('neither action is an outlined pill', outlined === 0);

  const copy = await c.evaluate("document.querySelector('.qp-nomatch').textContent");
  check('no em dashes in the copy', !copy.includes('—'));

  await c.click('.nomatch-actions button.quiet-action:first-child');
  await c.until("document.querySelector('.search-state')?.dataset.state === 'looking'", { timeout: 10000 });
  check('try again puts the player straight back in the queue', true);

  await c.click('.qp-searching .btn-ghost');
  await c.until("!!document.querySelector('.btn-primary.btn-large')", { timeout: 10000 });
  check('cancel returns to setup', true);
} catch (err) {
  bad++;
  console.log(' THREW', err.message);
} finally {
  a.kill();
  b.kill();
  c.kill();
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
