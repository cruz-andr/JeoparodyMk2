/**
 * The archive, as a person sees it.
 *
 * Registers an account, files two games through the API, then opens the
 * profile and the highscores page in a real browser signed in as that account
 * and checks the numbers on screen are the archive's, not this device's. Then
 * the same pages signed out, which must show the local record and say so.
 */
import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5000';
const API = 'http://127.0.0.1:3995';

const reg = async (email, username) => (await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'hunter2hunter2', displayName: username, username }),
})).json()).token;

const ada = await reg(`hist-${STAMP}@x.com`, `hist${STAMP}`);
const A = (p, o = {}) => fetch(`${API}/api${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ada}`, ...o.headers },
}).then(r => r.json());

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

const first = await A('/games/finish', { method: 'POST', body: JSON.stringify({
  mode: 'single', score: 4200, correct: 7, total: 9, genre: 'Volcanoes',
  categories: ['Lava', 'Ash', 'Craters', 'Islands', 'Eruptions', 'Rock'],
}) });
check('the first game is filed', first.game?.score === 4200, JSON.stringify(first).slice(0, 120));
const second = await A('/games/finish', { method: 'POST', body: JSON.stringify({
  mode: 'single', score: -600, correct: 1, total: 4, genre: 'Opera',
}) });
check('a losing game is filed too', second.game?.score === -600);

const stats = await A('/users/me/stats');
check('the stats say two games and the best is the first', stats.stats?.gamesPlayed === 2 && stats.stats?.bestScore === 4200, JSON.stringify(stats.stats));

const text = (b) => b.evaluate('document.body.innerText');

// Signed in: the profile and the highscores read from the archive.
const me = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  await me.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token: ada, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);

  await me.goto(`${APP}/profile`);
  await me.until("document.querySelectorAll('.profile-game').length === 2");
  const profile = await text(me);
  check('the profile shows games played from the archive', /2\s*Games played/i.test(profile));
  check('the profile shows the best score', /\$4,200\s*Best score/i.test(profile));
  check('recent games list the genre', profile.includes('Volcanoes') && profile.includes('Opera'));
  check('a losing score is shown as a loss', profile.includes('-$600'));
  check('the profile does not say it is showing this device', !profile.includes('could not be reached'));
  /* Case-insensitive: the labels are text-transform: uppercase, and innerText
   reflects that. */
  check('the daily record is still there', /Board streak/i.test(profile) && /Boards played/i.test(profile));

  await me.goto(`${APP}/highscores`);
  await me.until("document.querySelectorAll('.scores-table tbody tr').length === 2");
  const scores = await text(me);
  check('highscores read the same record', /\$4,200/.test(scores) && scores.includes('Volcanoes'));
  check('highscores do not say the record is local', !scores.includes('Kept on this device'));
} finally { me.kill(); }

// Signed out: the local record, and it says so.
const guest = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  await guest.goto(`${APP}/highscores`);
  await guest.until("/Games Played/i.test(document.body.innerText)");
  const scores = await text(guest);
  check('a visitor sees an empty record', /No games yet/.test(scores));
  check('and is told it lives on this device', scores.includes('Kept on this device'));
  check("a visitor never sees another account's games", !scores.includes('Volcanoes'));
} finally { guest.kill(); }

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
