import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeSeo } from './seo/build.js'

/* ads.txt, which AdSense checks at the root of the site before it pays out,
   written from the same publisher id the ads use (src/config/ads.js). No id,
   no file. */
function adsTxt() {
  return {
    name: 'ads-txt',
    /* AdSense's own way of confirming the site is yours, without running ads:
       a meta tag in the head. */
    transformIndexHtml() {
      const client = String(process.env.VITE_ADSENSE_CLIENT ?? '').trim();
      if (!/^ca-pub-\d{10,20}$/.test(client)) return [];
      return [{ tag: 'meta', attrs: { name: 'google-adsense-account', content: client }, injectTo: 'head' }];
    },
    generateBundle() {
      const client = String(process.env.VITE_ADSENSE_CLIENT ?? '').trim();
      const match = /^ca-(pub-\d{10,20})$/.exec(client);
      if (!match) return;
      this.emitFile({
        type: 'asset',
        fileName: 'ads.txt',
        source: `google.com, ${match[1]}, DIRECT, f08c47fec0942fa0\n`,
      });
    },
  };
}

/* A real page per public address, robots.txt, sitemap.xml and llms.txt, for
   search engines and AI assistants (seo/). Production builds only. */
function seo() {
  let outDir = 'dist';
  let isBuild = false;
  return {
    name: 'seo',
    configResolved(config) { outDir = config.build.outDir; isBuild = config.command === 'build'; },
    async closeBundle() {
      if (!isBuild) return;
      const api = String(process.env.VITE_SOCKET_URL ?? '').trim().replace(/\/$/, '');
      const done = await writeSeo(outDir, { api: /^https:/.test(api) ? api : null });
      console.log(`seo: ${done.pages} pages (${done.boards} community boards), sitemap.xml, robots.txt, llms.txt`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), adsTxt(), seo()],
  resolve: {
    alias: {
      /* The board format is shared with the API and has to live under server/,
         because the server image is built from that directory alone: a module
         the API imports cannot sit in src/ or it is simply not there in
         production. The alias is so client code does not have to say
         ../../server/shared/ to reach it. */
      '@shared': fileURLToPath(new URL('./server/shared', import.meta.url)),
    },
  },
  build: {
    minify: 'terser',
  },
  server: {
    port: 5000,
  },
})
