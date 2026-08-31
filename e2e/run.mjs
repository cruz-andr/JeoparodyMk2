/**
 * The browser suite.
 * Run with: npm run e2e
 *
 * Starts a server on a spare port with a throwaway database and a Vite dev
 * server pointed at it, runs every flow in a real Chrome, and tears both down.
 * Nothing here touches the developer's own database or a deployed anything.
 *
 * These exist because the things they check cannot be checked anywhere else: a
 * save surviving a reload, a header surviving CORS, a key press reaching a
 * handler, two tabs racing each other. Everything provable without a browser
 * belongs in the plain node suites instead, which run with no install at all.
 */
import { spawn } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const API_PORT = 3995;
const APP_PORT = 5000;
const DB = join(here, 'tmp-e2e.sqlite');

/* Alphabetical, and each file creates its own account and its own board. A
   suite that reads "whatever board is first" passes or fails on whatever ran
   before it, which cost three debugging rounds before this rule existed. */
const suites = readdirSync(here)
  .filter((f) => f.endsWith('.mjs') && !['run.mjs', 'driver.mjs', 'ws.mjs'].includes(f))
  .sort();

const wipe = () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${DB}${suffix}`); } catch { /* not there */ }
  }
};

const started = [];
function start(name, command, args, env, cwd) {
  const child = spawn(command, args, {
    cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  /* Kept rather than discarded: when one of these fails to start, the reason
     is in here, and a runner that hides it just says "never started". */
  child.log = '';
  child.stdout.on('data', (d) => { child.log += d; });
  child.stderr.on('data', (d) => { child.log += d; });
  child.name = name;
  started.push(child);
  return child;
}

async function waitFor(url, child) {
  for (let i = 0; i < 160; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok || res.status === 404) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${child.name} never came up at ${url}\n${child.log || '(it said nothing)'}`);
}

const stop = () => { for (const child of started) { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(1); });

wipe();
const api = start('api', 'node', [join(root, 'server', 'index.js')], {
  SERVER_PORT: String(API_PORT),
  DATABASE_PATH: DB,
  JWT_SECRET: 'e2e-secret-not-a-real-one',
  NODE_ENV: 'test',
}, root);

const app = start('app', process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(APP_PORT), '--strictPort'], {
  VITE_SOCKET_URL: `http://localhost:${API_PORT}`,
}, root);

await waitFor(`http://127.0.0.1:${API_PORT}/health`, api);
await waitFor(`http://localhost:${APP_PORT}/`, app);

let failed = 0;
for (const suite of suites) {
  process.stdout.write(`${suite.replace('.mjs', '').padEnd(30)}`);
  const code = await new Promise((resolve) => {
    const child = spawn('node', [join(here, suite)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (c) => {
      console.log(c === 0 ? 'passed' : 'FAILED');
      if (c !== 0) console.log(out.split('\n').filter((l) => /FAIL|THREW|Error/.test(l)).slice(0, 6).join('\n'));
      resolve(c);
    });
  });
  if (code !== 0) failed += 1;
}

stop();
wipe();
console.log(`\n${suites.length - failed} of ${suites.length} suites passed\n`);
process.exit(failed ? 1 : 0);
