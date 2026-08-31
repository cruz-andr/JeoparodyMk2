import { launch } from './driver.mjs';
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';
const { token } = await (await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'fix@x.com', password: 'hunter2hunter2' }),
})).json();
const mk = async (title) => (await (await fetch(`${API}/api/boards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title }),
})).json()).slug;

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

const b = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);

  // ---------- 5. undo ----------
  console.log('\n-- undo --');
  const undoSlug = await mk('Undo');
  await b.goto(`${APP}/boards/${undoSlug}/edit`);
  await new Promise(r => setTimeout(r, 700));

  check('undo starts disabled', await b.evaluate("document.querySelector('.board-edit-undo').disabled") === true);

  await b.click('.ge-grid .ge-cell');
  await b.type('#ge-clue', 'A clue worth keeping');
  await b.type('#ge-response', 'What is it?');
  await new Promise(r => setTimeout(r, 500));
  check('undo becomes available once something changed',
    await b.evaluate("document.querySelector('.board-edit-undo').disabled") === false);
  check('the cell is written', await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 1);

  // Clear it, which must be recoverable.
  await b.evaluate(`[...document.querySelectorAll('.ge-action')].find(e=>e.textContent.includes('Clear this clue')).click()`);
  await new Promise(r => setTimeout(r, 400));
  check('clearing empties the cell', await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 0);
  check('and offers an undo in place', await b.evaluate("!!document.querySelector('.board-cleared-undo')"));

  await b.click('.board-cleared-undo');
  await new Promise(r => setTimeout(r, 400));
  check('undo brings the clue back', await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 1);
  await b.click('.ge-grid .ge-cell');
  check('with its text intact',
    (await b.evaluate("document.querySelector('#ge-clue').value")) === 'A clue worth keeping',
    await b.evaluate("document.querySelector('#ge-clue').value"));

  // Cmd+Z from the board, not from inside a field.
  await b.evaluate(`[...document.querySelectorAll('.ge-action')].find(e=>e.textContent.includes('Clear this clue')).click()`);
  await new Promise(r => setTimeout(r, 300));
  await b.evaluate("document.querySelector('.ge-cell.is-on').focus()");
  await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  await new Promise(r => setTimeout(r, 400));
  check('Cmd+Z from the board undoes too',
    await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 1);

  // And must NOT be stolen from a text field.
  await b.click('.ge-grid .ge-cell.is-on');
  await b.type('#ge-clue', ' plus more');
  const before = await b.evaluate("document.querySelector('#ge-clue').value");
  await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
  await new Promise(r => setTimeout(r, 400));
  check('Cmd+Z inside a field is left to the browser',
    await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 1,
    `board undo did not fire; field was "${before}"`);

  // ---------- 8. multiple choice ----------
  console.log('\n-- multiple choice --');
  check('the section is collapsed by default',
    await b.evaluate("!document.querySelector('.ge-choices-body')"));
  await b.click('.ge-choices-toggle');
  await new Promise(r => setTimeout(r, 250));
  check('it opens to three wrong answers',
    await b.evaluate("document.querySelectorAll('.ge-choices-body input').length") === 3);

  await b.evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const fields = document.querySelectorAll('.ge-choices-body input');
    ['What is the Amazon?','What is the Congo?','What is the Volga?'].forEach((v, i) => {
      set.call(fields[i], v);
      fields[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
  })()`);
  await new Promise(r => setTimeout(r, 2200));

  let stored = await (await fetch(`${API}/api/boards/${undoSlug}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  let opts = stored.board.categories[0].questions[0].options;
  check('the correct answer is stored at index zero', opts?.[0] === stored.board.categories[0].questions[0].question,
    JSON.stringify(opts));
  check('with the three wrong ones after it', opts?.length === 4, JSON.stringify(opts?.slice(1)));

  // The hazard: change the response afterwards.
  await b.click('.ge-grid .ge-cell.is-on');
  await b.evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const f = document.querySelector('#ge-response');
    set.call(f, 'What is the Blue Nile?');
    f.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 2200));
  stored = await (await fetch(`${API}/api/boards/${undoSlug}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  opts = stored.board.categories[0].questions[0].options;
  check('changing the response cannot leave a stale right answer',
    opts?.[0] === 'What is the Blue Nile?' && !opts.slice(1).includes('What is the Blue Nile?'),
    JSON.stringify(opts));

  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) {
  console.error('THREW:', err.message);
  await b.shot('fixes2-fail.png'); b.kill(); process.exit(1);
}
