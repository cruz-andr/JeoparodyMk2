import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `quiet-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'Q', username: `quiet${STAMP}` }),
})).json();
const A = (p, o = {}) => fetch(`${API}/api/boards${p}`, { ...o,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...o.headers } }).then((r) => r.json());

const POINTS = [200, 400, 600, 800, 1000];
const board = {
  version: 1,
  categories: ['RIVERS', 'PEAKS', 'DESERTS', 'ISLES', 'CAPITALS', 'FLAGS'].map((name) => ({
    name,
    questions: POINTS.map((points) => ({
      points, answer: `${name} $${points}`, question: `What is ${name}?`,
      options: null, mediaType: null, mediaData: null,
      youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
    })),
  })),
  finalJeopardy: null,
};
const { slug } = await A('/', { method: 'POST', body: JSON.stringify({ title: 'Quiet' }) });
await A(`/${slug}`, { method: 'PUT', body: JSON.stringify({ board, topic: 'geography' }) });
await A(`/${slug}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) });

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

const b = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);

  const noOutlines = () => b.evaluate(`(() => {
    const bad = [...document.querySelectorAll('button.quiet-action, .board-cover-pick')]
      .filter(el => {
        const s = getComputedStyle(el);
        return s.borderTopWidth !== '0px' || s.borderTopStyle !== 'none';
      })
      .map(el => el.textContent.trim().slice(0, 24));
    return bad;
  })()`);

  /* Waits for each screen to be there rather than guessing how long it takes.
     A fixed pause passed alone and failed in the full run, where the server is
     answering twenty other suites and a page takes longer than the guess. */
  for (const [path, name, ready] of [
    [`/boards`, 'Community Boards', '.boards-body'],
    [`/boards/${slug}`, 'a board page', 'button.quiet-action'],
    [`/boards/${slug}/edit`, 'the editor', '.ge-board'],
    ['/boards/mine', 'my shelf', '.boards-body'],
  ]) {
    await b.goto(`${APP}${path}`);
    await b.until(`!!document.querySelector(${JSON.stringify(ready)})`, { timeout: 15000 });
    const outlined = await noOutlines();
    const count = await b.evaluate("document.querySelectorAll('button.quiet-action, .board-cover-pick').length");
    check(`${name}: no outlined secondary buttons`, outlined.length === 0,
      outlined.length ? JSON.stringify(outlined) : `${count} quiet controls`);
  }

  // One filled button per screen, and it is the one that matters.
  await b.goto(`${APP}/boards/${slug}`);
  await b.until("!!document.querySelector('button.quiet-action')", { timeout: 15000 });
  const filled = await b.evaluate(`[...document.querySelectorAll('button')]
    .filter(el => {
      const bg = getComputedStyle(el).backgroundColor;
      return bg === 'rgb(214, 159, 76)' || bg === 'rgb(232, 179, 90)';
    }).map(el => el.textContent.trim().slice(0, 24))`);
  check('exactly one filled button on the board page', filled.length === 1, JSON.stringify(filled));

  // And the ground still arrives on hover.
  const hoverBg = await b.evaluate(`(() => {
    const el = document.querySelector('button.quiet-action');
    if (!el) return 'no quiet button';
    const rule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
      .flatMap(r => r.cssRules ? [...r.cssRules] : [r])
      .find(r => r.selectorText && r.selectorText.includes('button.quiet-action:hover'));
    return rule ? rule.style.background || rule.style.backgroundColor : 'no hover rule';
  })()`);
  check('a ground appears on hover', /214/.test(hoverBg), hoverBg);

  b.kill();
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
} catch (err) {
  console.error('THREW:', err.message); b.kill(); process.exit(1);
}
