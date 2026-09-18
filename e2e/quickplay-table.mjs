/**
 * Quickplay finds a game and plays it, whoever turned up.
 *
 * One browser looks for a game alone. It is told what is happening, with a
 * clock counting UP so the wait is measured rather than promised, and a
 * cancel the whole way. Somewhere past twenty seconds two other players join,
 * one at a time; the game page opens, the board is dealt without anybody
 * pressing anything, and a clue gets picked, rung in on and answered by
 * somebody who is not the person watching. Slow by nature: the window is 20
 * to 22 seconds and the server checks every five, and then a hand of the game
 * is played at a human pace.
 */
import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (b, sel) => b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() ?? ''`);

/* Guest, typed name, looking for a game. */
async function lookForGame(b, name) {
  await b.until("!!document.querySelector('.signature-mode-toggle .mode-btn:nth-child(2)')", { timeout: 15000 });
  await b.click('.signature-mode-toggle .mode-btn:nth-child(2)');
  await b.type('.signature-text-input', name);
  await b.until("(() => { const el = document.querySelector('.qp-find'); return !!el && !el.disabled; })()", { timeout: 15000 });
  await b.click('.qp-find');
}

const a = await launch({ width: 1280, height: 800, dpr: 1 });
try {
  await a.goto(`${APP}/quickplay`);

  // --- looking, and out again -----------------------------------------------
  await lookForGame(a, 'Ada');
  await a.until("document.querySelector('.qp-state')?.dataset.state === 'looking'", { timeout: 10000 });
  check('a lone player is told it is looking for players', (await text(a, '.qp-state')) === 'Looking for players');
  check('your name is up and two players are still to come',
    (await a.evaluate("document.querySelectorAll('.st-plate').length")) === 3
    && (await a.evaluate("document.querySelectorAll('.st-plate.is-open').length")) === 2);
  check('the count is in words a person understands',
    (await text(a, '.st-count')).replace(/\s+/g, ' ').includes('1 of 3'));
  await sleep(2500);
  const shown = await text(a, '.st-clock-time');
  check('the clock counts up', /^0:0[2-9]$/.test(shown), shown);
  check('and nothing on screen promises a moment',
    !(await a.evaluate("document.querySelector('.st').innerText")).includes('0:20'));
  await a.shot('quickplay-looking.png');

  await a.click('.qp-cancel');
  await a.until("!!document.querySelector('.qp-find')", { timeout: 10000 });
  check('cancel goes back', true);

  // --- other players join ---------------------------------------------------
  const startedAt = Date.now();
  await a.click('.qp-find');
  /* Generous at the top end on purpose. The window is 20 to 22 seconds and the
     server settles the queue every five, but this runs alongside thirty other
     suites on one machine, and a loaded box adds seconds that say nothing
     about the product. The floor is what the check is really about. */
  await a.until("document.querySelector('.qp-state')?.dataset.state === 'found'", { timeout: 75000 });
  const filledAt = (Date.now() - startedAt) / 1000;
  check('alone past twenty seconds, other players join', filledAt >= 19 && filledAt < 60, `${filledAt.toFixed(1)}s`);
  check('and not on a round number', Math.abs(filledAt - Math.round(filledAt)) > 0.02, `${filledAt.toFixed(2)}s`);
  /* They arrive one at a time, so a beat after the first there is still a
     player to come. */
  const partway = await a.evaluate("document.querySelectorAll('.st-plate.is-open').length");
  await a.until("document.querySelectorAll('.st-plate.is-open').length === 0", { timeout: 15000 });
  check('one at a time, not all at once', partway >= 1, `${partway} still to come at the first reveal`);
  check('one of the three is you', (await a.evaluate("document.querySelectorAll('.st-plate.is-you').length")) === 1);
  const names = await a.evaluate("[...document.querySelectorAll('.st-plate:not(.is-you) .st-name')].map(e => e.textContent.trim())");
  check('the others have names, like people', names.length === 2 && names.every((n) => /^[A-Z][a-z]+$/.test(n)), JSON.stringify(names));
  await a.shot('quickplay-everyone-in.png');

  // --- the game page, and the board dealt by the house ----------------------
  await a.until("location.pathname.startsWith('/game/')", { timeout: 10000 });
  await a.until("!!document.querySelector('.lobby-quickplay') || !!document.querySelector('.category-header')", { timeout: 15000 });
  const lobbyShown = await a.evaluate("!!document.querySelector('.lobby-quickplay')");
  if (lobbyShown) {
    check('the wait for the board says what is happening, with nothing to press but Leave',
      (await a.evaluate("document.querySelector('.lobby-headline')?.textContent ?? ''")).includes('board')
      && (await a.evaluate("document.querySelectorAll('.lobby .st-btn').length")) === 0);
    check('and no room code, because there is nobody to read one to',
      (await a.evaluate("document.querySelectorAll('.lobby .st-code').length")) === 0);
    await a.shot('quickplay-dealing.png');
  }
  await a.until("document.querySelectorAll('.category-header').length === 6", { timeout: 40000 });
  check('the board is dealt without anybody starting it', true);
  check('all three players are on the scoreboard',
    (await a.evaluate("document.querySelectorAll('.player-chip').length")) === 3);
  await a.shot('quickplay-board.png');

  // --- a clue is played ------------------------------------------------------
  /* Whoever holds the pick opens a clue: a bot in a few seconds, or us. */
  const myTurn = (await text(a, '.turn-indicator-subtle')).includes('Your turn');
  if (myTurn) await a.click('.question-cell');
  await a.until("!!document.querySelector('.mp-question-overlay')", { timeout: 30000 });
  check(`a clue was opened${myTurn ? ' by us' : ' by the house'}`, true);
  await a.shot('quickplay-clue.png');

  /* We do not ring in. Somebody else does, or the clock runs out; either way
     the clue closes and the game moves on. */
  const t0 = Date.now();
  await a.until("!document.querySelector('.mp-question-overlay') || !!document.querySelector('.correct-answer-reveal') || document.body.textContent.includes('buzzed first')", { timeout: 40000 });
  const rangIn = await a.evaluate("document.body.textContent.includes('buzzed first')");
  check('a house player rang in on it', rangIn, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await a.shot('quickplay-buzz.png');

  /* The clue ends one of two ways, and which one is down to whether anybody
     knew it. Either the house player was right and the board comes back, or
     everybody misses and the clue waits on the one person who has not acted,
     which is us. A real player presses Continue there, so this does too. */
  await a.until(`!document.querySelector('.mp-question-overlay')
    || [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Continue')`, { timeout: 45000 });
  const needsMe = await a.evaluate("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Continue')");
  if (needsMe) {
    await a.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Continue').click()");
    check('nobody knew it, so the clue waits for everyone to move on', true);
  }
  await a.until("!document.querySelector('.mp-question-overlay')", { timeout: 20000 });
  check('and the clue closed', true);
  const scored = await a.evaluate("[...document.querySelectorAll('.player-chip .chip-score')].some(e => e.textContent.trim() !== '$0')");
  check('somebody scored, or lost money, on it', scored || needsMe, needsMe ? 'nobody knew it' : '');
  const revealed = await a.evaluate("document.querySelectorAll('.question-cell.revealed').length");
  check('the board remembers the clue', revealed >= 1, `${revealed} revealed`);

  // --- the words --------------------------------------------------------------
  const copy = await a.evaluate("document.body.innerText");
  check('no em dashes anywhere on the game page', !copy.includes('—'));
  check('and no tables or seats in a quiz show', !/\b(table|seat|seated)\b/i.test(copy),
    (copy.match(/\b(table|seat|seated)\b/i) || [])[0]);
} catch (err) {
  bad++;
  console.log(' THREW', err.message);
  try { await a.shot('quickplay-threw.png'); } catch { /* the browser is gone */ }
} finally {
  a.kill();
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
