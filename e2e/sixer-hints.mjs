/**
 * The Sixer, played for dollars with a hint after a miss.
 *
 * Six clues are seeded into the page's own saved run, so the suite plays a
 * known day without reaching the archive. One clue is played each way: right
 * first time, right after the hint (with a reload in between, which must not
 * hand the full value back), a spelling slip, wrong twice, a pass, and "I was
 * right" from the hint. The results then have to add up.
 */
import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const today = new Date().toISOString().split('T')[0];
const clues = [
  ['CAPITALS', 'This city on the Seine', 'Paris', 400],
  ['NOVELS', 'Melville wrote it', 'Moby Dick', 400],
  ['COMPOSERS', 'Deaf when he wrote his Ninth', 'Beethoven', 800],
  ['RIVERS', "Egypt's river", 'Nile', 800],
  ['HEROES', 'Gotham\'s caped crusader', 'Bruce Wayne (Batman)', 1200],
  ['PLANETS', 'Closest to the Sun', 'Mercury', 1200],
];
const run = {
  date: today,
  questions: clues.map(([category, clue, answer, value]) => ({ category, clue, answer, value })),
  categories: null,
  currentIndex: 0,
  answers: clues.map(() => ({ correct: null, revealed: false, passed: false, playerAnswer: '' })),
  userAnswers: clues.map(() => ''),
  isComplete: false,
  timing: { elapsedMs: 0, startedAt: null },
};
const seed = JSON.stringify(JSON.stringify({ state: { sixer: run }, version: 3 }));

const text = (b, sel) => b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() ?? ''`);
const answer = async (b, words) => {
  await b.until("!!document.querySelector('.typed-input')", { timeout: 10000 });
  await b.evaluate(`(() => { const i = document.querySelector('.typed-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '');
    i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await b.type('.typed-input', words);
  await b.click('.typed-submit');
  await sleep(250);
};
const onwards = async (b) => {
  await b.click('.typed-continue');
  await sleep(400);
};

const b = await launch({ width: 1280, height: 800, dpr: 1 });
try {
  // Seeded once: a reload must find the run as play left it, not as seeded.
  await b.onNewDocument(`if (!localStorage.getItem('jeoparody-daily')) localStorage.setItem('jeoparody-daily', ${seed});`);
  await b.goto(`${APP}/daily`);
  await b.until("!!document.querySelector('.typed-input')", { timeout: 15000 });
  check('the day says where it sits in the week, and that it climbs',
    /Easy to hard/.test(await text(b, '.daily-week-note')), await text(b, '.daily-week-note'));

  // 1. Right first time: the full value.
  await answer(b, 'What is Paris?');
  check('right first time pays the clue', (await text(b, '.typed-badge')) === 'Correct +$400', await text(b, '.typed-badge'));
  check('and the winnings on screen go up with it', (await text(b, '.sixer-winnings')) === '$400', await text(b, '.sixer-winnings'));
  await onwards(b);

  // 2. A miss brings up the hint, and the response stays hidden.
  await answer(b, 'Hamlet');
  check('a miss brings up the hint', (await text(b, '.typed-hint')) === 'M _ _ _   D _ _ _', await text(b, '.typed-hint'));
  check('and says the next try is for half', (await text(b, '.typed-note')).includes('$200'), await text(b, '.typed-note'));
  check('without showing the response', !(await b.evaluate("document.body.innerText.includes('Moby')")));
  await b.shot('sixer-hint.png');
  await b.evaluate('location.reload()');
  await sleep(1500);
  await b.until("!!document.querySelector('.typed-hint')", { timeout: 15000 });
  check('a reload keeps the hint up, so the clue still pays only half', true);
  await answer(b, 'Moby Dick');
  check('right after the hint pays half', (await text(b, '.typed-badge')) === 'Correct +$200 with the hint', await text(b, '.typed-badge'));
  check('the winnings add up as the run goes', (await text(b, '.sixer-winnings')) === '$600', await text(b, '.sixer-winnings'));
  await onwards(b);

  // 3. A spelling slip is a free retype, not a miss.
  await answer(b, 'Beethavan');
  check('a near spelling asks again', (await text(b, '.typed-note')).startsWith('Close'), await text(b, '.typed-note'));
  check('with no hint spent', !(await b.evaluate("!!document.querySelector('.typed-hint')")));
  await answer(b, 'Beethoven');
  check('and the retype pays in full', (await text(b, '.typed-badge')) === 'Correct +$800', await text(b, '.typed-badge'));
  await onwards(b);

  // 4. Wrong twice: nothing won, nothing taken.
  await answer(b, 'Amazon');
  check('a short answer\'s hint is blanks only', (await text(b, '.typed-hint')) === '_ _ _ _', await text(b, '.typed-hint'));
  await answer(b, 'Thames');
  check('wrong twice is just Incorrect, with no money taken', (await text(b, '.typed-badge')) === 'Incorrect', await text(b, '.typed-badge'));
  check('and only then is the response shown', (await text(b, '.typed-truth')).includes('Nile'));
  await onwards(b);

  // 5. A pass.
  await b.click('.close-button');
  await sleep(250);
  check('a pass is a pass', (await text(b, '.typed-badge')) === 'Passed');
  await onwards(b);

  // 6. The grader said no; the player says otherwise from the hint, in full.
  await answer(b, 'Hermes');
  await b.until("!!document.querySelector('.typed-claim')", { timeout: 5000 });
  await b.click('.typed-claim');
  await sleep(250);
  check('"I was right" at the hint pays in full', (await text(b, '.typed-badge')) === 'Correct +$1,200', await text(b, '.typed-badge'));
  await onwards(b);

  // The results.
  await b.until("!!document.querySelector('.daily-results')", { timeout: 10000 });
  const score = (await b.evaluate("document.querySelector('.results-score').innerText")).replace(/\s+/g, ' ').trim();
  check('the day is scored in dollars, out of what it was worth', score === '$2,600 of $4,800', score);
  const marks = await b.evaluate("[...document.querySelectorAll('.emoji-grid .result-mark')].map(m => m.className.replace('result-mark', '').trim())");
  check('the grid shows the hint as its own square',
    JSON.stringify(marks) === JSON.stringify(['correct', 'hinted', 'correct', 'wrong', 'passed', 'correct']), JSON.stringify(marks));
  check('the count rides beside the money', (await text(b, '.score-percentage')).startsWith('4 of 6 right, 1 with the hint'),
    await text(b, '.score-percentage'));
  await b.shot('sixer-results.png');

  /* The pass square's sign is a dash drawn as a glyph, the Board's too; the
     rule is about the words. */
  check('no em dashes in the words on the page', !(await b.evaluate(`(() => {
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll('.review-mark').forEach((m) => m.remove());
    return copy.innerText.includes('\\u2014');
  })()`)));
} catch (err) {
  bad++;
  console.log(' THREW', err.message);
  try { await b.shot('sixer-threw.png'); } catch { /* the browser is gone */ }
} finally {
  b.kill();
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
