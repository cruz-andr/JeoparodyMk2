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
const APP_PORT = 5100;
const DB = join(here, 'tmp-e2e.sqlite');

/* Alphabetical, and each file creates its own account and its own board. A
   suite that reads "whatever board is first" passes or fails on whatever ran
   before it, which cost three debugging rounds before this rule existed. */
/* ONLY=<substring> runs one suite and prints everything it said, which is how
   you debug one without waiting for the other sixteen. */
const only = process.env.ONLY ?? '';

const suites = readdirSync(here)
  .filter((f) => f.endsWith('.mjs') && !['run.mjs', 'driver.mjs', 'ws.mjs'].includes(f))
  .filter((f) => !only || f.includes(only))
  .sort();

/* The shots are the only way to look at what a suite saw, and wiping them on
   the way out means you have to re-run to see anything. KEEP_SHOTS=1 leaves
   them behind. */
const keepShots = process.env.KEEP_SHOTS === '1';

const wipe = ({ shots = true } = {}) => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${DB}${suffix}`); } catch { /* not there */ }
  }
  if (shots) try { rmSync(join(here, 'shots'), { recursive: true }); } catch { /* not there */ }
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
      /* Any answer means something is listening, which is the only thing this
         is asking. Vite replies 403 to 127.0.0.1 because of its host check and
         200 to localhost, and a probe that insisted on 2xx spent thirty
         seconds timing out against a server printing its own URL. */
      await fetch(url, { signal: AbortSignal.timeout(500) });
      return;
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
  /* The API's CORS allowlist names localhost:5000 and whatever CLIENT_URL is.
     The page lives on APP_PORT now, so it has to be told, or every fetch the
     browser makes to the API is refused and twenty two suites time out on a
     board that never loads. */
  CLIENT_URL: `http://localhost:${APP_PORT}`,
  /* A key that is present but worthless. The model is behind the server now,
     so the server has to believe it is set up for a request to get as far as
     the route, where a suite answers it from fakeModel.mjs before it leaves
     the browser. Nothing here ever reaches Google. E2E_REAL_AI=1 hands the
     real key over for the rare check that has to watch a live generation. */
  GEMINI_API_KEY: process.env.E2E_REAL_AI === '1'
    ? (process.env.GEMINI_API_KEY ?? '')
    : 'e2e-offline-not-a-real-key',
}, root);

/* Port 5100, not 5000, and --host so Vite listens on both address families.

   On macOS, ControlCenter (AirPlay Receiver) holds 127.0.0.1:5000. Left to
   itself Vite bound "localhost" as IPv6 only, the probe below hit
   ControlCenter's 403 on IPv4 and called that "up", and Chrome reached Vite
   through ::1. It worked by accident. On the Ubuntu runner there is no
   squatter, Vite bound IPv6 only, and the IPv4 probe was refused: "app never
   came up" with Vite reporting ready. Any IPv4 bind on 5000 here collides
   with ControlCenter under --strictPort and Vite does not start at all.
   A port nobody squats on, bound on both families, behaves the same on both. */
const app = start('app', process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(APP_PORT), '--strictPort', '--host'], {
  VITE_SOCKET_URL: `http://localhost:${API_PORT}`,
}, root);

await waitFor(`http://127.0.0.1:${API_PORT}/health`, api);
/* 127.0.0.1, not localhost: Node's fetch tries ::1 first and Vite binds to
   IPv4, so the probe failed against a server that was plainly running and
   printing its own URL. The browser is fine with localhost. */
await waitFor(`http://127.0.0.1:${APP_PORT}/`, app);

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
      /* A suite that prints its own diagnosis on the way down is worth more
         than six greppable lines, so ONLY=<suite> shows everything it said. */
      /* With ONLY set you are looking at one suite on purpose, so its own
         output is worth seeing whether or not it passed. */
      if (only && c === 0) console.log(out);
      /* In CI the six greppable lines are all anyone gets, and a width or a
         count that differs from a laptop's is invisible in them. A failed
         suite prints everything it said there, the way ONLY does here. */
      const verbose = only || process.env.CI;
      if (c !== 0) {
        console.log(verbose
          ? out
          : out.split('\n').filter((l) => /FAIL|THREW|Error/.test(l)).slice(0, 6).join('\n'));
        /* The server's own account of what it did. Half of a failing suite's
           causes are on this side, and guessing from the browser is slow. */
        if (verbose) console.log(`\n--- api log ---\n${api.log.split('\n').slice(-40).join('\n')}`);
      }
      resolve(c);
    });
  });
  if (code !== 0) failed += 1;
}

stop();
wipe({ shots: !keepShots });
console.log(`\n${suites.length - failed} of ${suites.length} suites passed\n`);
process.exit(failed ? 1 : 0);
