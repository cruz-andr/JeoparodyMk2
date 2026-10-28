/**
 * Solo play, typed and graded the way The Board does it.
 *
 * Every clue is answered by typing, graded by the shared grader: a close
 * spelling gets one more go, a miss can be overruled with "I was right", a
 * pass shows the response and scores nothing. Final Jeopardy is graded the
 * moment the answer is locked in, and can be overruled too.
 */
import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

const token = (await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `typed-${STAMP}@x.com`, password: 'hunter2hunter2', displayName: 'T', username: `typed${STAMP}` }),
})).json()).token;
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...o.headers },
}).then((r) => r.json());

const POINTS = [200, 400, 600, 800, 1000];
/* One response throughout, so the close spelling below is close whichever
   clue the checks land on: the grader's own tests call "Beethavan" close. */
const RESPONSES = Array(6).fill('Who is Beethoven?');
const board = {
  version: 1,
  categories: RESPONSES.map((question, c) => ({
    name: `CAT ${c}`,
    questions: POINTS.map((points) => ({ points, answer: `Clue ${c} for $${points}`, question })),
  })),
  finalJeopardy: { category: 'COMPOSERS', answer: 'He wrote the Ninth Symphony while deaf', question: 'Who is Beethoven?' },
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: `Typed ${STAMP}` }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board, topic: 'music' }) });
await A(`/${slug}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1280, height: 800, dpr: 1 });
const text = (sel) => b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() ?? null`);
const score = () => b.evaluate("document.querySelector('.score-display span')?.textContent");
const press = (scope, re) => b.evaluate(`(() => { const x = [...document.querySelectorAll('${scope} button')].find((e) => ${re}.test(e.textContent) && !e.disabled); if (x) { x.click(); return true; } return false; })()`);
const cell = (c, r) => b.evaluate(`(() => {
  const el = document.querySelectorAll('.questions-grid .question-row')[${r}]?.querySelectorAll('.question-cell')[${c}];
  if (!el || el.classList.contains('revealed')) return false; el.click(); return true; })()`);
// Past a Daily Double's reveal to its clue, wagering the least.
const open = async () => {
  for (let i = 0; i < 25; i++) {
    if (await b.evaluate("!!document.querySelector('.question-modal')")) return true;
    if (await b.evaluate("!!document.querySelector('.daily-double-overlay')")) {
      await press('.daily-double-overlay', '/skip/i');
      await press('.daily-double-overlay', '/confirm/i');
    }
    await sleep(300);
  }
  throw new Error('no clue opened');
};
const isDouble = () => b.evaluate("/Wager/.test(document.querySelector('.question-points')?.textContent ?? '')");
/* Typed once the box is there and settled: a clue opening animates in, and
   text sent before it mounts lands nowhere. */
const submit = async (given) => {
  await b.until("!!document.querySelector('.typed-input')", { timeout: 8000 });
  await sleep(300);
  await b.type('.typed-input', given);
  if (!(await b.evaluate(`document.querySelector('.typed-input').value === ${JSON.stringify(given)}`))) {
    await sleep(400);
    await b.type('.typed-input', given);
  }
  await b.click('.typed-submit');
  await sleep(400);
};
/* The next unplayed clue that is not a Daily Double, left open. The board
   places those at random, so one met on the way is answered and passed by. */
// The score shows on the board, not over a clue, so it is read on the way in.
let scoreBefore = null;
const money = (t) => Number(String(t).replace(/[$,]/g, ''));
const openPlain = async () => {
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
    const here = await score();
    if (!(await cell(c, r))) continue;
    scoreBefore = money(here);
    await open();
    if (!(await isDouble())) return;
    await submit('not it');
    await next();
  }
  throw new Error('no plain clue left');
};
const next = async () => {
  await press('.question-modal', '/^\\s*continue\\s*$/i');
  await b.until("!document.querySelector('.question-modal')", { timeout: 8000 });
  await sleep(250);
};

try {
  await b.goto(`${APP}/boards/${slug}`);
  await b.until("!!document.querySelector('.board-actions .btn-primary')", { timeout: 15000 });
  await b.click('.board-actions .btn-primary');
  await b.until("document.querySelectorAll('.category-header').length > 0", { timeout: 15000 });
  await sleep(2000);

  await openPlain();
  check('a clue is answered by typing, not by revealing and marking yourself',
    await b.evaluate("!!document.querySelector('.typed-input') && ![...document.querySelectorAll('button')].some((e) => /Reveal Answer|I Got It/i.test(e.textContent))"));
  check('and the per-clue clock still runs', await b.evaluate("!!document.querySelector('.question-timer')"));

  const before = scoreBefore;
  const word = 'Beethoven';
  const value = Number((await text('.question-points')).replace(/[$,]/g, ''));

  // ---------- close, then right ----------
  await submit('Beethavan');
  const noteShown = await text('.typed-note');
  check('a close spelling asks for it again, without giving the answer',
    /spelling/i.test(noteShown ?? '') && !(await b.evaluate("!!document.querySelector('.typed-result')")) && !/Beethoven/.test(noteShown ?? ''), noteShown);
  check('and keeps what was typed to fix', await b.evaluate("document.querySelector('.typed-input').value === 'Beethavan'"));
  await b.evaluate("(() => { const i = document.querySelector('.typed-input'); i.focus(); i.select(); })()");
  await b.evaluate("document.execCommand('delete')");
  await submit(word);
  check('the right answer is graded right, for the clue\'s value', /Correct \+\$/.test(await text('.typed-badge') ?? ''), await text('.typed-badge'));
  check('and shows what was said and the correct response',
    (await text('.typed-said'))?.includes(word) && (await text('.typed-truth'))?.includes(word));
  await next();
  check('the score goes up by the clue', Number((await score()).replace(/[$,]/g, '')) === before + value, `${before} -> ${await score()}`);

  // ---------- wrong, then "I was right" ----------
  await openPlain();
  const mid = scoreBefore;
  const v2 = Number((await text('.question-points')).replace(/[$,]/g, ''));
  await submit('Napoleon Bonaparte');
  check('a wrong answer is graded wrong', /Incorrect -\$/.test(await text('.typed-badge') ?? ''), await text('.typed-badge'));
  check('and can be overruled', await press('.question-modal', '/I was right/'));
  await sleep(300);
  check('overruled, it reads as right', /Correct/.test(await text('.typed-badge') ?? ''));
  await next();
  check('and scores as right', Number((await score()).replace(/[$,]/g, '')) === mid + v2, `${mid} -> ${await score()} (clue ${v2})`);

  // ---------- pass ----------
  await openPlain();
  const pre = scoreBefore;
  await press('.question-modal', '/^\\s*pass\\s*$/i');
  await sleep(300);
  check('a pass shows the response before moving on', (await text('.typed-badge')) === 'Passed' && !!(await text('.typed-truth')));
  await next();
  check('and scores nothing', money(await score()) === pre, `${pre} -> ${await score()}`);
  await b.shot('solo-typed-board.png');

  // ---------- the rest, then Final Jeopardy ----------
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
    if (await cell(c, r)) {
      await open();
      if (await isDouble() || !(await press('.question-modal', '/^\\s*pass\\s*$/i'))) await submit('not it');
      await sleep(250);
      await next();
    }
  }
  await b.until("[...document.querySelectorAll('button')].some((x) => /Play Final Jeopardy|See Final Results/i.test(x.textContent))", { timeout: 15000 });
  if (!(await press('', '/Play Final Jeopardy/i'))) {
    check('the score is above $0, so Final Jeopardy is offered', false, await b.evaluate("document.body.innerText.slice(0, 200)"));
  } else {
    await b.until("!!document.querySelector('.fj-wager-input')", { timeout: 15000 });
    await press('.final-jeopardy-modal', '/Lock In Wager/i');
    await b.until("!!document.querySelector('.fj-clue-phase')", { timeout: 8000 });
    await press('.final-jeopardy-modal', "/I'm Ready/i");
    await b.until("!!document.querySelector('.fj-answer-input')", { timeout: 8000 });
    await b.type('.fj-answer-input', 'Mozart');
    await press('.final-jeopardy-modal', '/Submit Answer/i');
    await b.until("!!document.querySelector('.fj-result-badge')", { timeout: 8000 });
    check('Final Jeopardy is graded for you, with no "were you correct?"',
      /Incorrect/.test(await text('.fj-result-badge')) && !(await b.evaluate("/Were you correct/.test(document.body.innerText)")));
    check('it shows what you said and the correct response',
      (await b.evaluate("document.querySelector('.fj-answers-compare').textContent")).includes('Beethoven'));
    check('and can be overruled', await press('.final-jeopardy-modal', '/I was right/'));
    await sleep(300);
    check('overruled, it reads as right', /Correct/.test(await text('.fj-result-badge')));
    await b.shot('solo-typed-final.png');
    await press('.final-jeopardy-modal', '/^\\s*Continue\\s*$/');
    await b.until("!document.querySelector('.final-jeopardy-modal')", { timeout: 10000 });
    check('Continue moves on to the results', true);
  }
} catch (err) {
  bad++;
  console.log(' THREW', err.message);
  try { await b.shot('solo-typed-threw.png'); } catch { /* the browser is gone */ }
} finally {
  b.kill();
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
