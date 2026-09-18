/**
 * The three mode screens: single player, a private room, quickplay.
 *
 * They are drawn in the archive's theme, because there is one app and it
 * should look like it. This walks each at desktop and phone width and checks
 * the things a screenshot cannot. Nothing pushes the page sideways, every target is a fingertip tall,
 * the one gold button is unlit until the screen has what it needs, and no
 * screen offers a table or a seat, because this is a quiz show. Then it takes
 * the screenshot anyway, because the shots are how anyone looks at what these
 * suites saw.
 */
import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SMALL = "[...document.querySelectorAll('button, a, input:not([type=hidden]), textarea')]"
  + ".filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.opacity !== '0' && r.height < 44; })"
  + ".map(e => (e.className || e.tagName).toString().split(' ').pop() + '=' + Math.round(e.getBoundingClientRect().height))"
  + ".join(', ')";

/* The words this app does not use. It has no tables and nobody sits down. */
const CARD_ROOM = /\b(table|seat|seated|sit down)\b/i;

const SCREENS = [
  { path: '/singleplayer', name: 'single-player', title: 'Single Player', cta: '.solo-write' },
  { path: '/multiplayer', name: 'multiplayer', title: 'Multiplayer', cta: '.mp-open-btn' },
  { path: '/quickplay', name: 'quickplay', title: 'Quickplay', cta: '.qp-find' },
];

const b = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  for (const screen of SCREENS) {
    console.log(`\n-- ${screen.name} --`);
    await b.goto(`${APP}${screen.path}`);
    await b.until("!!document.querySelector('.st-body')", { timeout: 15000 });
    await wait(500);

    check('the title is set in board type',
      (await b.evaluate("document.querySelector('.st-title')?.textContent")) === screen.title);
    check('the way back is a word, the way host mode writes it',
      (await b.evaluate("document.querySelector('.st-back')?.textContent.trim() ?? ''")).includes('Back'));
    /* One app, one theme. The archive is flat #05081c with hairline rules and
       no gradients anywhere, and these screens are the same surface. */
    check('the page is flat, with no gradient anywhere on it',
      (await b.evaluate(`[...document.querySelectorAll('.st, .st *')]
        .filter(el => getComputedStyle(el).backgroundImage.includes('gradient')).length`)) === 0);
    check('and it is the same navy the archive uses',
      (await b.evaluate("getComputedStyle(document.querySelector('.st')).backgroundColor")) === 'rgb(5, 8, 28)');
    check('the one gold button is unlit until the screen has what it needs',
      (await b.evaluate(`document.querySelector(${JSON.stringify(screen.cta)})?.disabled`)) === true);
    check('and it is the archive\'s gold button: square, in the board\'s face',
      (await b.evaluate(`(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(screen.cta)}));
        return s.borderRadius === '0px' && s.fontFamily.includes('Big Shoulders'); })()`)) === true);

    const copy = await b.evaluate("document.querySelector('.st').innerText");
    check('no em dashes in the copy', !copy.includes('—'));
    check('no tables and nobody sits down', !CARD_ROOM.test(copy), (copy.match(CARD_ROOM) || [])[0]);

    check('nothing pushes the page sideways',
      (await b.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true);
    const small = await b.evaluate(SMALL);
    check('nothing to press is smaller than a fingertip', small === '', small || 'all at least 44px');
    await b.shot(`mode-${screen.name}-desktop.png`);

    await b.resize({ width: 393, height: 852, dpr: 3 });
    await wait(400);
    check('on a phone, nothing pushes the page sideways',
      (await b.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")) === true,
      await b.evaluate("`${document.documentElement.scrollWidth} in ${document.documentElement.clientWidth}`"));
    check('on a phone, the two columns become one',
      (await b.evaluate("getComputedStyle(document.querySelector('.st-two')).gridTemplateColumns.split(' ').length")) === 1);
    const smallPhone = await b.evaluate(SMALL);
    check('on a phone, nothing to press is smaller than a fingertip', smallPhone === '', smallPhone || 'all at least 44px');
    await b.shot(`mode-${screen.name}-phone.png`);
    await b.resize({ width: 1440, height: 900, dpr: 2 });
    await wait(300);
  }

  // ---------- single player: the board is on screen the whole time ----------
  console.log('\n-- single player, in use --');
  await b.goto(`${APP}/singleplayer`);
  await b.until("!!document.querySelector('.solo-input')", { timeout: 15000 });
  check('the board is there before you have typed anything',
    (await b.evaluate("document.querySelectorAll('.st-board .st-cell').length")) === 36);
  check('with nothing written in it yet',
    (await b.evaluate("document.querySelectorAll('.st-board .st-cell.is-blank').length")) === 36);
  check('the question is asked in words, not labelled',
    (await b.evaluate("document.querySelector('.st-field-label')?.textContent")) === "What is tonight's board about?");
  await b.type('.solo-input', 'The Roman Empire');
  check('naming a topic lights the button',
    (await b.evaluate("document.querySelector('.solo-write').disabled")) === false);

  /* On a desk there is room for the rules, so they are simply there. */
  check('the rules are switches on a desk, with nothing to press first',
    (await b.evaluate("document.querySelectorAll('.st-toggle').length")) >= 3
    && (await b.evaluate("document.querySelectorAll('.st-rules-open').length")) === 0);
  const before = await b.evaluate("document.querySelector('.st-toggle').getAttribute('aria-pressed')");
  await b.click('.st-toggle');
  await wait(200);
  check('a switch turns', (await b.evaluate("document.querySelector('.st-toggle').getAttribute('aria-pressed')")) !== before);
  await b.click('.st-toggle');
  await b.shot('mode-single-player-rules.png');

  /* On a phone six switches in front of somebody who wants to play is a
     settings screen with a game attached, so they fold back to one line. */
  await b.resize({ width: 393, height: 852, dpr: 3 });
  await wait(400);
  check('on a phone they fold back to one line with a way in',
    (await b.evaluate("document.querySelectorAll('.st-toggle').length")) === 0
    && (await b.evaluate("document.querySelector('.st-rules-line')?.textContent ?? ''")).includes('rounds'));
  await b.click('.st-rules-open');
  await wait(300);
  check('and that way in still opens them', (await b.evaluate("document.querySelectorAll('.st-toggle').length")) >= 3);
  await b.resize({ width: 1440, height: 900, dpr: 2 });
  await wait(300);

  // ---------- the name pad stays under the pen ----------
  /* Drawing a name creates a signature, and the pad used to be hidden the
     moment one existed: the first stroke swapped the pad for "your name is on
     your card". Whether the pad shows turns on the SAVED name only. */
  for (const [name, path] of [['multiplayer', '/multiplayer'], ['quickplay', '/quickplay']]) {
    console.log(`\n-- the name pad on ${name} --`);
    await b.goto(`${APP}${path}`);
    await b.until("!!document.querySelector('.signature-canvas')", { timeout: 15000 });
    const padWidth = await b.evaluate("document.querySelector('.signature-canvas').getBoundingClientRect().width");
    check('the pad is drawn at a size a mouse can use on a desk', padWidth >= 400, `${Math.round(padWidth)}px`);
    await b.click('.signature-mode-toggle .mode-btn:nth-child(2)');
    await b.type('.signature-text-input', 'Ada');
    await wait(400);
    check('writing a name leaves the pad where it is',
      (await b.evaluate("!!document.querySelector('.signature-canvas')")) === true,
      await b.evaluate("document.querySelector('.st-rules-line')?.innerText ?? ''"));
    check('and it does not tell a guest their name is already on a card',
      !(await b.evaluate("document.querySelector('.st').innerText")).includes('on your card'));
  }

  // ---------- multiplayer: the code is board cells ----------
  console.log('\n-- multiplayer, in use --');
  await b.goto(`${APP}/multiplayer`);
  await b.until("!!document.querySelector('.st-tabs')", { timeout: 15000 });
  check('the two sides are folder tabs, the way the archive picks a daily',
    (await b.evaluate("document.querySelectorAll('.st-tab').length")) === 2);
  await b.evaluate("[...document.querySelectorAll('.st-tab')].find(t => t.textContent.includes('Join')).click()");
  await b.until("!!document.querySelector('.st-code')", { timeout: 5000 });
  check('six cells for six letters', (await b.evaluate("document.querySelectorAll('.st-code .st-cell').length")) === 6);
  check('the button waits for all six', (await b.evaluate("document.querySelector('.mp-join-btn').disabled")) === true);
  check('and says how many are left',
    (await b.evaluate("document.querySelector('.mp-join')?.innerText ?? ''")).includes('6 more letters'));
  await b.click('.st-code .st-cell:nth-child(3)');
  check('a click on a cell puts the caret in the code',
    (await b.evaluate("document.activeElement?.className ?? ''")).includes('st-code-input'));
  await b.send('Input.insertText', { text: 'abc234' });
  await wait(250);
  check('typing fills the cells in capitals',
    (await b.evaluate("[...document.querySelectorAll('.st-code .st-money')].map(e => e.textContent).join('')")) === 'ABC234');
  check('and lights the button', (await b.evaluate("document.querySelector('.mp-join-btn').disabled")) === false);
  await b.shot('mode-multiplayer-join.png');

  // ---------- quickplay: the mode changes what the game will be ----------
  console.log('\n-- quickplay, in use --');
  await b.goto(`${APP}/quickplay`);
  await b.until("!!document.querySelector('.st-seg')", { timeout: 15000 });
  check('the choice is a mode, not a table',
    (await b.evaluate("document.querySelector('.st-field-label')?.textContent")) === 'Which mode?');
  await b.evaluate("[...document.querySelectorAll('.st-seg-item')].find(t => t.textContent.includes('Speed')).click()");
  await wait(250);
  check('picking Speed says what Speed is',
    (await b.evaluate("document.querySelector('.st-hint')?.textContent ?? ''")).includes('15 second clock'),
    await b.evaluate("document.querySelector('.st-hint')?.textContent"));
  check('three players, and your row is first',
    (await b.evaluate("document.querySelector('.st-count')?.textContent ?? ''")).includes('1 of 3'));
  check('it says what happens if nobody turns up',
    (await b.evaluate("document.querySelector('.st').innerText")).includes('other players join you after about twenty seconds'));
  check('and promises no exact moment',
    !(await b.evaluate("document.querySelector('.st').innerText")).includes('0:20'));
} catch (err) {
  bad++;
  console.log(' THREW', err.message);
} finally {
  b.kill();
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
