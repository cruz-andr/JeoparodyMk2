/**
 * The site as a search engine or an AI assistant reads it: a page per public
 * address, robots.txt, sitemap.xml and llms.txt, written into dist/ after the
 * app is built. See seo/pages.js for what each page says.
 *
 * dist/index.html becomes the home page. The plain app shell, for every other
 * address, is kept as dist/app.html, which vercel.json falls back to.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NAV, PAGES, PRIVATE_PATHS, SITE_NAME, SITE_URL } from './pages.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlOf = (path) => `${SITE_URL}${path === '/' ? '/' : path}`;

/* The community boards worth a page of their own: the site's own, and ones
   people have actually played, finished. A board made to test something is
   neither. */
async function fetchBoards(api) {
  if (!api) return [];
  const found = new Map();
  for (const row of ['house', 'popular', 'new']) {
    try {
      const res = await fetch(`${api}/api/boards?row=${row}&limit=48`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      for (const b of (await res.json()).boards ?? []) {
        const complete = b.clueCount >= b.clueTotal;
        /* The browser tests publish boards named like "Phone Play 7093893";
           a name ending in a long number is one of theirs, not a real board. */
        const real = row === 'house' || (b.plays > 0 && !/\s\d{5,}$/.test(b.title ?? ''));
        if (b.visibility === 'public' && complete && real && !found.has(b.slug)) found.set(b.slug, b);
      }
    } catch { /* no boards this build; the rest of the site is still written */ }
  }
  return [...found.values()];
}

function boardPage(b) {
  const cats = (b.categories ?? []).slice(0, 6);
  return {
    path: `/boards/${b.slug}`,
    title: `${b.title}: a trivia board to play free · ${SITE_NAME}`,
    description: (b.description || `A ${b.clueTotal}-clue trivia board`) + (cats.length ? ` Categories: ${cats.join(', ')}.` : ''),
    heading: b.title,
    body: [
      b.description || 'A community trivia board, free to play alone or with friends.',
      cats.length ? `Categories: ${cats.join(', ')}.` : '',
    ].filter(Boolean),
    updated: (b.updatedAt || b.publishedAt || '').slice(0, 10),
  };
}

function structuredData(page) {
  if (page.home) {
    return [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/`, description: page.description },
      {
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: page.description,
        genre: ['Trivia', 'Quiz', 'Game show'],
        gamePlatform: 'Web browser',
        applicationCategory: 'Game',
        playMode: ['SinglePlayer', 'MultiPlayer'],
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
    ];
  }
  return [{
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: page.heading, item: urlOf(page.path) },
    ],
  }];
}

function render(shell, page) {
  const url = urlOf(page.path);
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    ...structuredData(page).map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`),
  ].join('\n    ');
  const nav = NAV.map(([p, label]) => `<a href="${p}">${esc(label)}</a>`).join(' · ');
  const body = `<main class="seo-shell"><h1>${esc(page.heading)}</h1>${page.body.map((t) => `<p>${esc(t)}</p>`).join('')}<nav>${nav}</nav></main>`;
  return shell
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace(/<meta property="og:(title|description|url)"[^>]*>\s*/g, '')
    .replace(/<meta name="twitter:(title|description)"[^>]*>\s*/g, '')
    .replace('</head>', `    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

export async function writeSeo(outDir, { api } = {}) {
  const shell = readFileSync(join(outDir, 'index.html'), 'utf8');
  writeFileSync(join(outDir, 'app.html'), shell);

  const boards = (await fetchBoards(api)).map(boardPage);
  const pages = [...PAGES, ...boards];
  for (const page of pages) {
    const file = page.path === '/' ? join(outDir, 'index.html') : join(outDir, page.path, 'index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, render(shell, page));
  }

  const today = new Date().toISOString().slice(0, 10);
  const daily = new Set(['/', '/daily', '/daily/board', '/archive']);
  writeFileSync(join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${urlOf(p.path)}</loc><lastmod>${daily.has(p.path) ? today : (p.updated || today)}</lastmod><changefreq>${daily.has(p.path) ? 'daily' : 'weekly'}</changefreq><priority>${p.home ? '1.0' : p.path.startsWith('/boards/') ? '0.6' : '0.8'}</priority></url>`).join('\n')}
</urlset>
`);

  writeFileSync(join(outDir, 'robots.txt'), `# Everyone is welcome, search engines and AI assistants alike.
User-agent: *
Allow: /
${PRIVATE_PATHS.map((p) => `Disallow: ${p}`).join('\n')}
Disallow: /boards/*/edit

Sitemap: ${SITE_URL}/sitemap.xml
`);

  writeFileSync(join(outDir, 'llms.txt'), `# ${SITE_NAME}

> Free Jeopardy-style trivia in the browser: a new daily board and six daily clues from real episodes, quickplay against other players, private rooms to play with friends on their own phones, and community-made boards. No download, no account needed to play. A fan-made game, not affiliated with Jeopardy Productions, Sony Pictures Television or Disney.

## Play
${PAGES.filter((p) => !['/guidelines', '/privacy'].includes(p.path)).map((p) => `- [${p.heading}](${urlOf(p.path)}): ${p.description}`).join('\n')}

## Community boards
${boards.slice(0, 40).map((b) => `- [${b.heading}](${urlOf(b.path)})`).join('\n') || '- See the boards page.'}

## About
- [Board guidelines](${SITE_URL}/guidelines)
- [Privacy](${SITE_URL}/privacy)
`);

  return { pages: pages.length, boards: boards.length };
}
