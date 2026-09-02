/**
 * A board being written, with the model answered from inside the page.
 *
 * The same screens as a live generation, at a speed chosen here so each stage
 * can be caught, and without a key or a token. See fakeModel.mjs.
 */
import { launch } from './driver.mjs';
import { fakeModel } from './fakeModel.mjs';
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `ao-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'O', username: `ao${STAMP}` }),
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
    boardBusy: !!board && board.className.includes('is-writing'),
    named: [...document.querySelectorAll('.ge-head')].filter(e => !/Name it/i.test(e.textContent)).length,
    written: document.querySelectorAll('.ge-cell.is-written').length,
  };})()`);

const ask = async (topic) => {
  await b.evaluate("document.querySelector('.host-ai').click()");
  await b.until("!!document.querySelector('.hf-scrim input')", { timeout: 8000 });
  await b.type('.hf-scrim input', topic);
  await b.evaluate("document.querySelector('.hf-scrim button[type=submit]').click()");
};

try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.onNewDocument(fakeModel());
  await b.goto(`${APP}/host`);
  await b.until("!!document.querySelector('.ge-board')", { timeout: 15000 });
  await b.shot('ai-1-before.png');

  await ask('Volcanoes');

  console.log('\n-- thinking of categories --');
  await wait(900);
  let s = await state();
  check('the line says which part is happening', /categories/i.test(s.line ?? ''), s.line);
  check('with something moving beside it', s.dot === true);
  check('the AI button is out of action and looks it', s.aiDisabled && s.aiDimmed,
    `disabled=${s.aiDisabled} dimmed=${s.aiDimmed}`);
  check('the board says it is busy', s.boardBusy === true);
  check('and nothing is on it yet', s.named === 0 && s.written === 0);
  await b.shot('ai-2-categories.png');

  console.log('\n-- the categories land --');
  await b.until("[...document.querySelectorAll('.ge-head')].some(e=>!/Name it/i.test(e.textContent))", { timeout: 20000 });
  await wait(300);
  s = await state();
  check('six names are on the board', s.named === 6, `${s.named} named`);
  check('before any clue is', s.written === 0, `${s.written} written`);
  check('and the line has moved on to the clues', /clues/i.test(s.line ?? ''), s.line);
  await b.shot('ai-3-clues.png');

  console.log('\n-- and it finishes --');
  await b.until("document.querySelectorAll('.ge-cell.is-written').length === 30", { timeout: 20000 });
  await wait(600);
  s = await state();
  check('all thirty clues are written', s.written === 30);
  check('the line is gone', s.line === null);
  check('the AI button is offered again', !s.aiDisabled && !s.aiDimmed);
  check('and the board takes clicks again', s.boardBusy === false);
  await b.shot('ai-4-done.png');

  console.log('\n-- what it wrote --');
  await b.evaluate("[...document.querySelectorAll('.ge-cell')].find(e=>/1000/.test(e.textContent)).click()");
  await b.until("!!document.querySelector('.ge-panel textarea')", { timeout: 8000 });
  const wrote = await b.evaluate(`(() => {
    const t = document.querySelector('.ge-panel textarea').value;
    const r = [...document.querySelectorAll('.ge-panel input')].map(i => i.value).find(v => /^what|^who/i.test(v));
    return JSON.stringify({ clue: t, response: r });})()`);
  check('a clue and its response are on the board', /Olympus Mons/.test(wrote), wrote);
  check('and the response names one answer, not two',
    !/\bor\b|aka|also known as/i.test(JSON.parse(wrote).response ?? ''), JSON.parse(wrote).response);
  await b.shot('ai-5-written.png');
} finally {
  b.kill();
}
process.exit(bad ? 1 : 0);
