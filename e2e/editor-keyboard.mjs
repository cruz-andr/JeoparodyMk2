import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `keys-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'Keys', username: `keys${STAMP}` }),
})).json();

/* Its own board, in a state it controls. Reading whatever board happened to be
   first meant this script passed or failed on what had run before it. */
const POINTS = [200, 400, 600, 800, 1000];
const board = {
  version: 1,
  categories: ['RIVERS', 'MOUNTAINS', 'DESERTS', 'ISLANDS', 'CAPITALS', 'FLAGS'].map((name) => ({
    name,
    questions: POINTS.map((points) => ({
      points, answer: '', question: '',
      options: null, mediaType: null, mediaData: null,
      youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
    })),
  })),
  finalJeopardy: null,
};
// Exactly one written clue, at RIVERS $200, so Next empty has a known answer.
board.categories[0].questions[0].answer = 'The longest river in Africa';
board.categories[0].questions[0].question = 'What is the Nile?';

const slug = (await (await fetch(`${API}/api/boards`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title: 'Keys' }),
})).json()).slug;
await fetch(`${API}/api/boards/${slug}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ board }),
});

const b = await launch({ width: 1440, height: 900, dpr: 2 });
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };
const where = () => b.evaluate("document.querySelector('.ge-where').textContent");
const focused = () => b.evaluate("document.activeElement.id || document.activeElement.className");

try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);
  await b.goto(`${APP}/boards/${slug}/edit`);

  // Focus goes on the selected CELL now, not on the grid container: that is
  // the roving tabindex, and it is why Tab leaves the grid in one press
  // instead of walking thirty-six buttons.
  await b.evaluate("document.querySelector('.ge-cell.is-on').focus()");
  check('the selected cell takes focus', (await focused()).includes('ge-cell'), await focused());

  await b.key('ArrowRight');
  check('right moves a category', /\$200/.test(await where()) && !/Rivers/.test(await where()), await where());

  await b.key('ArrowDown'); await b.key('ArrowDown');
  check('down moves to $600', /\$600/.test(await where()), await where());

  await b.key('ArrowUp'); await b.key('ArrowUp'); await b.key('ArrowUp');
  check('up past the top row selects the category header', /Category 2/.test(await where()), await where());

  await b.key('Enter');
  check('Enter on a header goes to the name field', (await focused()) === 'ge-name', await focused());

  await b.key('Escape');
  // Whatever is selected, not specifically a clue: at this point in the walk
  // the selection is a category header, and Escape should return to that.
  check('Escape hands focus back to whatever is selected', (await focused()).includes('is-on'), await focused());

  await b.key('ArrowDown');
  await b.key('Enter');
  check('Enter on a cell goes to the clue', (await focused()) === 'ge-clue', await focused());

  // Next empty walks the board rather than jumping about.
  await b.key('Escape');
  await b.click('.ge-grid .ge-cell');  // back to the first cell, which is written
  await b.evaluate(`[...document.querySelectorAll('.ge-action')].find(e=>e.textContent.includes('Next empty')).click()`);
  await new Promise(r => setTimeout(r, 250));
  // Down the category rather than across the board: the $400 of whichever
  // category the written $200 was in.
  check('Next empty goes to the next one down the category',
    (await where()) === 'RIVERS · $400', await where());
  check('and puts the cursor in the clue', (await focused()) === 'ge-clue', await focused());

  // Clear.
  await b.click('.ge-grid .ge-cell');
  await b.evaluate(`[...document.querySelectorAll('.ge-action')].find(e=>e.textContent.includes('Clear this clue')).click()`);
  await new Promise(r => setTimeout(r, 250));
  check('clearing empties the one written cell',
    await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length") === 0,
    `${await b.evaluate("document.querySelectorAll('.ge-cell.is-written').length")} still written`);

  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) {
  console.error('THREW:', err.message);
  b.kill(); process.exit(1);
}
