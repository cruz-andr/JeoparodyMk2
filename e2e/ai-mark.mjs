/**
 * Anything a model does wears the same mark.
 *
 * The board can be filled by hand, from a file, or by asking a model, and the
 * third is a feature rather than the main attraction. So the buttons that ask
 * one carry the four pointed star the menu cards use, and a host can tell at a
 * glance which is which. "Suggest three wrong answers" was the odd one out.
 */
import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `ai-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'A', username: `aim${STAMP}` }),
})).json();

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

const b = await launch({ width: 1600, height: 1000, dpr: 1 });
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/host`);
  await b.until("!!document.querySelector('.ge-cell')", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 700));

  /* Every button whose words say a model will do something. Matched on the
     words rather than a class, so a new one has to opt out on purpose. */
  const AI_WORDS = /use ai|suggest|another category|finding another/i;
  const marked = (b2) => b2.evaluate(`(()=>{
    const words = ${AI_WORDS.toString()};
    return [...document.querySelectorAll('button')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .filter(e => words.test(e.textContent))
      .map(e => ({
        text: e.textContent.trim().slice(0, 34),
        star: !!e.querySelector('svg'),
        first: e.firstElementChild?.tagName ?? '-',
      }));})()`);

  console.log('\n-- on the board --');
  let found = await marked(b);
  check('the AI board button is there', found.length > 0, found.map((f) => f.text).join(' / '));
  check('and it wears the mark', found.every((f) => f.star), JSON.stringify(found));
  check('with the mark to the left of the words',
    found.every((f) => f.first === 'svg'), JSON.stringify(found.map((f) => f.first)));

  console.log('\n-- multiple choice --');
  await b.evaluate("document.querySelector('.ge-choices-toggle').click()");
  await new Promise((r) => setTimeout(r, 400));
  found = await marked(b);
  const suggest = found.find((f) => /suggest/i.test(f.text));
  check('suggesting wrong answers is offered', Boolean(suggest), found.map((f) => f.text).join(' / '));
  check('it wears the same mark', suggest?.star === true, JSON.stringify(suggest));
  check('to the left of its words, like the other one', suggest?.first === 'svg');
  check('every AI action on screen agrees', found.every((f) => f.star && f.first === 'svg'),
    JSON.stringify(found));

  console.log('\n-- and nothing else wears it --');
  const strays = await b.evaluate(`(()=>{
    const words = ${AI_WORDS.toString()};
    return [...document.querySelectorAll('button svg')]
      .map(s => s.closest('button'))
      .filter(e => e && !words.test(e.textContent))
      .filter(e => e.querySelector('path')?.getAttribute('d')?.startsWith('M12 0 L14.4 9.6'))
      .map(e => e.textContent.trim().slice(0, 30));})()`);
  check('the star is not on buttons that ask no model', strays.length === 0, strays.join(' / '));
} finally {
  b.kill();
}
process.exit(bad ? 1 : 0);
