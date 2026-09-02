/**
 * Asking a model to write the board.
 *
 * Two things were wrong. The panel stayed open and the board sat unchanged for
 * as long as the model took, so a slow success and an outright failure looked
 * identical: nothing. And when it did fail, the message rendered on the page
 * underneath the panel that was covering it, so nobody ever saw it.
 *
 * The model is answered from inside the page with the refusal Google sends for
 * a key it will not accept, so this covers a real failure without a key, a
 * token, or a request that leaves the machine.
 */
import { launch } from './driver.mjs';
import { fakeModel } from './fakeModel.mjs';
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `af-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'A', username: `af${STAMP}` }),
})).json();

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1440, height: 900, dpr: 1 });
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.onNewDocument(fakeModel({
    delays: { categories: 200, questions: 200 },
    failWith: { status: 400, message: 'API key not valid. Please pass a valid API key.' },
  }));
  await b.goto(`${APP}/host`);
  await b.until("!!document.querySelector('.ge-board')", { timeout: 15000 });

  /* Something of the host's own on the board first, so a failure has work to
     lose. The names land before the clues do, so a model that answers the
     first call and fails the second must put back what it replaced. */
  console.log('\n-- with work already on the board --');
  await b.evaluate("document.querySelector('.ge-head').click()");
  await b.until("!!document.querySelector('.ge-field')", { timeout: 8000 });
  await b.type('.ge-field', 'MY OWN CATEGORY');
  await wait(300);
  check('a category the host named is on the board',
    (await b.evaluate("document.querySelector('.ge-head').textContent")).includes('MY OWN CATEGORY'));

  console.log('\n-- asking --');
  await b.evaluate("document.querySelector('.host-ai').click()");
  await b.until("!!document.querySelector('.hf-scrim')", { timeout: 8000 });
  check('the AI button opens a panel that asks for a topic',
    await b.evaluate("!!document.querySelector('.hf-scrim input')") === true);
  await b.type('.hf-scrim input', 'Rivers of Europe');
  await b.evaluate("document.querySelector('.hf-scrim button[type=submit]').click()");

  console.log('\n-- while it works --');
  /* The panel goes at once so the board is what you are looking at, rather
     than a dialog with a disabled button on it. */
  await b.until("!document.querySelector('.hf-scrim')", { timeout: 8000 });
  check('the panel closes as soon as it is asked, so the board is in view', true);

  console.log('\n-- when it cannot --');
  await b.until("!!document.querySelector('.host-error')", { timeout: 15000 });
  const words = await b.evaluate("document.querySelector('.host-error').textContent");
  check('the failure is said out loud rather than swallowed', Boolean(words), words);
  check('and not in the language of a build script',
    !/API_KEY|env|environment variable|undefined|null|\[object/i.test(words), words);
  check('it says what to do instead',
    /yourself|upload|duplicate|try again/i.test(words), words);

  /* The reason this went unseen: the panel is a fixed overlay, and the message
     renders on the page under it. */
  check('the message is actually on top of the page, not behind a panel',
    await b.evaluate(`(() => {
      const e = document.querySelector('.host-error');
      const r = e.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (e.contains(hit) || hit.contains(e));
    })()`) === true);

  check('the AI button is offered again rather than stuck',
    await b.evaluate("document.querySelector('.host-ai').disabled") === false);
  check('and says what it does again, not what it was doing',
    (await b.evaluate("document.querySelector('.host-ai').textContent")).includes('use AI'),
    await b.evaluate("document.querySelector('.host-ai').textContent"));
  check('nothing was written to the board',
    await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 0);
  check('and the work the host had done is still there',
    (await b.evaluate("document.querySelector('.ge-head').textContent")).includes('MY OWN CATEGORY'),
    await b.evaluate("document.querySelector('.ge-head').textContent"));
  await b.shot('ai-failed.png');

  console.log('\n-- and when it is simply out of requests --');
  /* The other failure a host actually meets, and the one a key that works
     until it does not produces. It must not read like the setup failure. */
  await b.evaluate(fakeModel({
    delays: { categories: 150, questions: 150 },
    failWith: { status: 429, message: 'Resource has been exhausted (e.g. check quota).' },
  }));
  await b.evaluate("document.querySelector('.host-ai').click()");
  await b.until("!!document.querySelector('.hf-scrim input')", { timeout: 8000 });
  await b.type('.hf-scrim input', 'Volcanoes');
  await b.evaluate("document.querySelector('.hf-scrim button[type=submit]').click()");
  /* Waits for the words to change rather than for the element to appear: it is
     already on screen from the failure before, and pulling it out of the DOM by
     hand leaves React updating a node that is no longer there. */
  await b.until("/out of requests/i.test(document.querySelector('.host-error')?.textContent ?? '')", { timeout: 15000 });
  const quota = await b.evaluate("document.querySelector('.host-error').textContent");
  check('running out of requests says so, and says to come back',
    /out of requests/i.test(quota) && /again/i.test(quota), quota);
  check('and does not blame the setup, which is fine',
    !/not set up/i.test(quota), quota);

  console.log('\n-- the ways in that do not need a model --');
  await wait(300);
  const alts = await b.evaluate("[...document.querySelectorAll('.host-alt')].map(e=>e.textContent.trim()).join(' / ')");
  check('are still right there', alts.includes('Upload') && alts.includes('Duplicate'), alts);
} finally {
  b.kill();
}
process.exit(bad ? 1 : 0);
