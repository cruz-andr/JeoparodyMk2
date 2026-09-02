/**
 * Watching a board actually get written.
 *
 * host-ai-offline drives these same screens against a model answered from
 * inside the page, and that is the one the ordinary run uses. This one exists
 * to check the fake still matches the real service: if Google changes the
 * shape of what it sends, this fails and the offline suite would not.
 *
 * Opt in with E2E_REAL_AI=1. It spends real quota, so without it this does
 * nothing.
 */
import { launch } from './driver.mjs';

if (process.env.E2E_REAL_AI !== '1') {
  console.log('  skipped, needs E2E_REAL_AI=1 and a model key');
  process.exit(0);
}

const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `aw-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'W', username: `aw${STAMP}` }),
})).json();

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1500, height: 950, dpr: 1 });
const state = () => b.evaluate(`(() => {
  const ai = getComputedStyle(document.querySelector('.host-ai'));
  const board = document.querySelector('.host-board');
  return {
    line: document.querySelector('.host-writing')?.innerText.replace(/\\n/g, ' ') ?? null,
    dot: !!document.querySelector('.host-writing-dot'),
    aiDisabled: document.querySelector('.host-ai').disabled,
    aiDimmed: Number(ai.opacity) < 0.9,
    boardDimmed: !!board && board.className.includes('is-writing'),
    named: [...document.querySelectorAll('.ge-head')].filter(e => !/Name it/i.test(e.textContent)).length,
    written: document.querySelectorAll('.ge-cell.is-written').length,
  };})()`);

try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/host`);
  await b.until("!!document.querySelector('.ge-board')", { timeout: 15000 });
  await b.evaluate("document.querySelector('.host-ai').click()");
  await b.until("!!document.querySelector('.hf-scrim input')", { timeout: 8000 });
  await b.type('.hf-scrim input', 'Volcanoes');
  await b.evaluate("document.querySelector('.hf-scrim button[type=submit]').click()");

  console.log('\n-- thinking of categories --');
  await wait(1200);
  let s = await state();
  check('the line says which part is happening', /categories/i.test(s.line ?? ''), s.line);
  check('with something moving beside it', s.dot === true);
  check('the AI button is out of action and looks it', s.aiDisabled && s.aiDimmed,
    `disabled=${s.aiDisabled} dimmed=${s.aiDimmed}`);
  check('and the board says it is busy', s.boardDimmed === true);
  check('nothing is on the board yet', s.named === 0 && s.written === 0);
  await b.shot('ai-watch-categories.png');

  console.log('\n-- the categories land --');
  await b.until("[...document.querySelectorAll('.ge-head')].some(e=>!/Name it/i.test(e.textContent))", { timeout: 90000 });
  await wait(400);
  s = await state();
  check('six category names are on the board', s.named === 6, `${s.named} named`);
  check('before any clue is', s.written === 0, `${s.written} written`);
  check('and the line has moved on to the clues', /clues/i.test(s.line ?? ''), s.line);
  await b.shot('ai-watch-clues.png');

  console.log('\n-- and it finishes --');
  await b.until("document.querySelectorAll('.ge-cell.is-written').length === 30", { timeout: 120000 });
  await wait(800);
  s = await state();
  check('all thirty clues are written', s.written === 30);
  check('the line is gone', s.line === null);
  check('and the AI button is offered again', !s.aiDisabled && !s.aiDimmed);
  check('the board takes clicks again', s.boardDimmed === false);

  await b.shot('ai-watch-done.png');
} finally {
  b.kill();
}
process.exit(bad ? 1 : 0);
