/**
 * A wrong address gets the app's own screen, never the router's.
 *
 * react-router's default error page says "Hey developer" and prints a stack
 * trace. This visits an address that does not exist, signed out and signed
 * in, and checks that what appears is ours: NOTHING HERE, a sentence, and a
 * way back that actually reaches the menu.
 */
import { launch } from './driver.mjs';
import { FORBIDDEN_WORDS } from '../src/components/common/errorReport.js';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `lost-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'Lost', username: `lost${STAMP}` }),
})).json();

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

/* The words a visitor must never read, the same list the unit test checks
   the copy against, so a word added there is looked for here too. Lower
   case; the page text is lowered before the search so "Developer" and
   "developer" are the same miss. The ticket's exact phrase is asserted by
   name as well, so a reader can see it. */
const FORBIDDEN = [...new Set([...FORBIDDEN_WORDS, 'unexpected application error'])];

const b = await launch({ width: 1280, height: 800, dpr: 2 });
try {
  const readPage = () => b.evaluate(`(() => ({
    text: document.body.innerText,
    title: (document.querySelector('.error-screen-title') || {}).textContent || '',
    backTarget: document.querySelector('.error-screen a.quiet-action')?.getAttribute('href') ?? '',
    ground: getComputedStyle(document.querySelector('.error-screen') || document.body).backgroundColor,
    hasPre: !!document.querySelector('pre'),
  }))()`);

  const lookAt = async (label) => {
    await b.goto(`${APP}/this-does-not-exist`);
    await b.until("!!document.querySelector('.error-screen-title')", { timeout: 15000 });
    const page = await readPage();
    const text = page.text.toLowerCase();

    check(`${label}: the page says NOTHING HERE`, page.title.trim().toUpperCase() === 'NOTHING HERE', JSON.stringify(page.title));
    check(`${label}: the title is drawn in uppercase`, await b.evaluate(
      "getComputedStyle(document.querySelector('.error-screen-title')).textTransform === 'uppercase'"));
    check(`${label}: on the navy ground, not the router's white`, page.ground === 'rgb(5, 8, 28)', page.ground);
    check(`${label}: no stack trace on the screen`, !page.hasPre);
    for (const word of FORBIDDEN) {
      check(`${label}: the page does not say "${word}"`, !text.includes(word));
    }
    check(`${label}: there is a way back`, page.backTarget === '/menu', page.backTarget);

    await b.click('.error-screen a.quiet-action');
    await b.until("location.pathname === '/menu' && !!document.querySelector('.menu')", { timeout: 15000 });
    check(`${label}: the way back reaches the menu`, await b.evaluate("location.pathname") === '/menu');
    await b.shot(`not-found-${label.replace(/\s+/g, '-')}.png`);
  };

  await lookAt('signed out');

  /* A deeper wrong address, with a signed-in visitor, so the catch-all is not
     only matching the top level. */
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/boards/nope/deeper/still-nothing`);
  await b.until("!!document.querySelector('.error-screen-title')", { timeout: 15000 });
  const deep = await readPage();
  check('signed in, deep path: still NOTHING HERE', deep.title.trim().toUpperCase() === 'NOTHING HERE', JSON.stringify(deep.title));
  check('signed in, deep path: none of the forbidden words',
    FORBIDDEN.every((w) => !deep.text.toLowerCase().includes(w)));

  await lookAt('signed in');
} catch (err) {
  bad++;
  console.log(' THREW ', err.message);
} finally {
  b.kill();
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
