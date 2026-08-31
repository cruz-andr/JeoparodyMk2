/**
 * Placing the Daily Doubles by hand.
 *
 * The default has always been that the server drops them at random. A quiz
 * night host wants them on the clues they chose, so this walks that path: turn
 * it on, mark the cells, and check the board says what it did.
 */
import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `dd-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'D', username: `dd${STAMP}` }),
})).json();

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

const sheet = async (b) => {
  await b.click('.host-settings');
  await b.until("!!document.querySelector('.hs-sheet')");
};
const marks = (b) => b.evaluate("document.querySelectorAll('.ge-cell.is-double').length");
const placeBtn = "[...document.querySelectorAll('.host-ai')].find(e=>/Place the Daily|Done placing/.test(e.textContent))";

const b = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/host`);
  await b.until("document.querySelectorAll('.ge-cell').length === 30", { timeout: 15000 });

  // ---------- the choice is hidden until it matters ----------
  console.log('\n-- the setting --');
  await sheet(b);
  check('random is the default, so the board offers no marking',
    await b.evaluate(`!${placeBtn}`) === true);
  check('the choice sits under the toggle it belongs to',
    await b.evaluate("document.querySelectorAll('.hs-seg.hs-under .hs-seg-btn').length") === 2);
  check('and says what happens in both cases',
    (await b.evaluate("[...document.querySelectorAll('.hs-seg.hs-under .hs-seg-btn')].map(e=>e.textContent).join('|')"))
      === 'Placed at random|I will place them');

  // Turning Daily Doubles off should take the question away entirely: there is
  // nothing to place.
  await b.evaluate(`[...document.querySelectorAll('.hs-toggle')].find(t=>/Daily Doubles/.test(t.textContent)).querySelector('input').click()`);
  await new Promise((r) => setTimeout(r, 250));
  check('turning Daily Doubles off takes the question away',
    await b.evaluate("document.querySelectorAll('.hs-seg.hs-under').length") === 0);
  await b.evaluate(`[...document.querySelectorAll('.hs-toggle')].find(t=>/Daily Doubles/.test(t.textContent)).querySelector('input').click()`);
  await new Promise((r) => setTimeout(r, 250));

  await b.evaluate(`[...document.querySelectorAll('.hs-seg.hs-under .hs-seg-btn')].find(e=>/I will place/.test(e.textContent)).click()`);
  check('the choice is held', await b.evaluate(
    `[...document.querySelectorAll('.hs-seg.hs-under .hs-seg-btn')].find(e=>e.getAttribute('aria-pressed')==='true').textContent`
  ) === 'I will place them');
  await b.click('.hs-done');
  await new Promise((r) => setTimeout(r, 400));

  // ---------- marking round one ----------
  console.log('\n-- round one --');
  check('the board now offers to place them',
    (await b.evaluate(`${placeBtn}?.textContent ?? ''`)).includes('Place the Daily Double'), 'singular in round one');
  check('nothing is marked before you ask', await marks(b) === 0);

  await b.evaluate(`${placeBtn}.click()`);
  await b.until("!!document.querySelector('.ge-marking')");
  check('marking says how many are left',
    (await b.evaluate("document.querySelector('.ge-marking').textContent")).includes('Click 1 more cell'),
    await b.evaluate("document.querySelector('.ge-marking').textContent"));

  await b.evaluate("document.querySelectorAll('.ge-cell')[8].click()");
  await new Promise((r) => setTimeout(r, 200));
  check('a marked cell is marked', await marks(b) === 1);
  check('and it says so to a screen reader',
    (await b.evaluate("document.querySelectorAll('.ge-cell')[8].getAttribute('aria-label')")).includes('Daily Double'));
  check('the count turns into an invitation to move it',
    (await b.evaluate("document.querySelector('.ge-marking').textContent")).includes('Click one to move it'));

  // One marker in round one, so a second click moves it rather than adding.
  await b.evaluate("document.querySelectorAll('.ge-cell')[14].click()");
  await new Promise((r) => setTimeout(r, 200));
  check('round one holds exactly one', await marks(b) === 1);
  check('and it moved to the new cell',
    await b.evaluate("document.querySelectorAll('.ge-cell')[14].classList.contains('is-double')") === true);

  await b.evaluate("document.querySelectorAll('.ge-cell')[14].click()");
  await new Promise((r) => setTimeout(r, 200));
  check('clicking it again takes it off', await marks(b) === 0);
  await b.evaluate("document.querySelectorAll('.ge-cell')[14].click()");
  await new Promise((r) => setTimeout(r, 200));
  await b.shot('host-daily-doubles.png');

  // ---------- round two wants two ----------
  console.log('\n-- double jeopardy --');
  await b.evaluate(`[...document.querySelectorAll('.host-round')].find(e=>/Double/.test(e.textContent)).click()`);
  await new Promise((r) => setTimeout(r, 400));
  check('leaving the round leaves marking mode',
    await b.evaluate("!document.querySelector('.ge-marking')") === true);
  check('round two starts unmarked, not with round one’s cell', await marks(b) === 0);

  await b.evaluate(`${placeBtn}.click()`);
  await b.until("!!document.querySelector('.ge-marking')");
  check('round two asks for two',
    (await b.evaluate("document.querySelector('.ge-marking').textContent")).includes('Click 2 more cells'),
    await b.evaluate("document.querySelector('.ge-marking').textContent"));

  await b.evaluate("document.querySelectorAll('.ge-cell')[3].click()");
  await new Promise((r) => setTimeout(r, 150));
  await b.evaluate("document.querySelectorAll('.ge-cell')[20].click()");
  await new Promise((r) => setTimeout(r, 200));
  check('both are marked', await marks(b) === 2);
  await b.evaluate("document.querySelectorAll('.ge-cell')[27].click()");
  await new Promise((r) => setTimeout(r, 200));
  check('a third click still leaves two', await marks(b) === 2);
  check('and the oldest is the one that moved',
    await b.evaluate("!document.querySelectorAll('.ge-cell')[3].classList.contains('is-double')") === true);

  // ---------- and back ----------
  console.log('\n-- going back --');
  await b.evaluate(`[...document.querySelectorAll('.host-round')].find(e=>/Round one/.test(e.textContent)).click()`);
  await new Promise((r) => setTimeout(r, 400));
  check('round one kept its own marker', await marks(b) === 1);

  // Turning the whole thing back to random should stop offering to place, and
  // must not leave a half-marked board behind on screen.
  await sheet(b);
  await b.evaluate(`[...document.querySelectorAll('.hs-seg.hs-under .hs-seg-btn')].find(e=>/random/.test(e.textContent)).click()`);
  await b.click('.hs-done');
  await new Promise((r) => setTimeout(r, 400));
  check('going back to random takes the button away', await b.evaluate(`!${placeBtn}`) === true);
  check('and stops drawing markers', await marks(b) === 0);
} finally {
  b.kill();
}
process.exit(bad ? 1 : 0);
