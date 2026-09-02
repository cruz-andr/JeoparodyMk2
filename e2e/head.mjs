/**
 * The head of the document: tab titles, the manifest and the share image.
 *
 * Every page used to share one title from index.html, so three open tabs all
 * read "Jeoparody!" and a shared link had no picture. This opens three
 * screens in a real Chrome and checks that each names itself, that the title
 * from one screen does not leak into the next, and that the head carries the
 * manifest and the og:image a scraper looks for.
 */
import { launch } from './driver.mjs';
const STAMP = String(Date.now()).slice(-7);
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';

/* Its own account, like every suite, so a signed-in host screen is the one
   under test and not whatever the previous suite left behind. */
const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `head-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'H', username: `head${STAMP}` }),
})).json();

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

const b = await launch({ width: 1280, height: 800, dpr: 1 });
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);

  const titles = {};
  /* Readiness is a DOM selector, never the title itself: a page that renders
     but forgets its title should fail the title check at once, not sit in a
     15s wait and then report that it never came up. */
  for (const [path, ready, expect] of [
    ['/menu', '!!document.querySelector(".menu-wordmark")', 'Jeoparody'],
    ['/daily', '!!document.querySelector(".daily-page")', 'The Sixer · Jeoparody'],
    ['/host', '!!document.querySelector(".host-page")', 'Host a game · Jeoparody'],
  ]) {
    await b.goto(`${APP}${path}`);
    try {
      await b.until(ready, { timeout: 15000 });
    } catch (err) {
      check(`${path} came up`, false, err.message);
    }
    titles[path] = await b.evaluate('document.title');
    check(`${path} is titled "${expect}"`, titles[path] === expect, `got "${titles[path]}"`);
  }

  const distinct = new Set(Object.values(titles));
  check('the three pages have three different titles', distinct.size === 3, [...distinct].join(' | '));

  const head = await b.evaluate(`(() => ({
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null,
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null,
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    card: document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? null,
    icon: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null,
  }))()`);
  check('the manifest is linked', head.manifest === '/manifest.json', String(head.manifest));
  check('og:image points at og.png', /\/og\.png$/.test(head.ogImage ?? ''), String(head.ogImage));
  check('og:title is set', !!head.ogTitle, String(head.ogTitle));
  check('a real description', (head.description ?? '').length > 40, String(head.description));
  check('theme-color is the navy ground', head.themeColor === '#0B0D1F', String(head.themeColor));
  check('twitter card is the large one', head.card === 'summary_large_image', String(head.card));
  check('the icon is no longer the Vite logo', head.icon === '/favicon.svg', String(head.icon));

  /* The files the head names must actually be served, or the tab shows a
     broken icon and the share card is blank. A missing file does not 404
     here: the SPA rewrite answers with index.html and a 200, which is how
     the automatic /favicon.ico probe used to get a page instead of an icon.
     So the content type is checked, not just the status. */
  for (const path of ['/manifest.json', '/og.png', '/favicon.svg', '/favicon.ico', '/apple-touch-icon.png']) {
    const got = await b.evaluate(`fetch(${JSON.stringify(path)})
      .then((r) => ({ status: r.status, type: r.headers.get('content-type') || '' }))
      .catch(() => ({ status: 0, type: '' }))`);
    check(`${path} is served`, got.status === 200 && !got.type.startsWith('text/html'),
      `status ${got.status}, ${got.type || 'no content type'}`);
  }
  const manifest = await b.evaluate(`fetch('/manifest.json').then((r) => r.json()).catch(() => null)`);
  check('the manifest starts at the menu', manifest?.start_url === '/menu', String(manifest?.start_url));
  check('the manifest opens standalone', manifest?.display === 'standalone', String(manifest?.display));
  check('the manifest has icons', Array.isArray(manifest?.icons) && manifest.icons.length > 0);
} catch (err) {
  bad++;
  console.log(' THREW ', err.message);
} finally {
  b.kill();
}

console.log(bad ? `\n${bad} failed\n` : '\nall passed\n');
process.exit(bad ? 1 : 0);
