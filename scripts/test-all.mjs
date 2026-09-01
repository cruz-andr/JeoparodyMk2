/**
 * Run every plain node test file and fail if any of them fails.
 * Run with: npm test
 *
 * The suites are zero dependency node scripts that print "N passed, M failed"
 * and exit non zero on a failure. Before this, package.json listed four of
 * them by hand and the other nine only ran when somebody remembered, so a
 * suite could be red for weeks with "npm test" green. This finds them all:
 * src/**\/*.test.js, server/test/*.test.js, scripts/*.test.js and e2e/*.test.js.
 *
 * Each file runs in its own process, one after another. The socket suites
 * bind real ports, and two of them at once would fight over them.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The directories searched, relative to the repo root, and how deep. */
export const ROOTS = [
  { dir: 'src', recursive: true },
  { dir: 'server/test', recursive: false },
  { dir: 'scripts', recursive: false },
  /* The browser driver's own unit test, not the browser suites: those are
     .mjs and run by e2e/run.mjs with a real Chrome. */
  { dir: 'e2e', recursive: false },
];

/** Every test file under the roots, sorted, as paths relative to `base`. */
export function discover(base = root, roots = ROOTS) {
  const found = [];
  for (const { dir, recursive } of roots) {
    const full = join(base, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full, { recursive, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.test.js')) continue;
      /* parentPath arrived in Node 20.12; path is the older name for the same
         thing. node_modules is skipped in case a symlinked one sits inside. */
      const parent = entry.parentPath ?? entry.path;
      const rel = relative(base, join(parent, entry.name)).split(sep).join('/');
      if (rel.split('/').includes('node_modules')) continue;
      found.push(rel);
    }
  }
  return [...new Set(found)].sort();
}

/**
 * The "N passed, M failed" line a suite prints on the way out.
 * Null when there is no such line, which is itself a failure: a suite that
 * crashed before its summary must not count as green.
 */
export function parseSummary(output) {
  const m = /(\d+) passed, (\d+) failed/.exec(output);
  return m ? { passed: Number(m[1]), failed: Number(m[2]) } : null;
}

/**
 * Run one suite. Server suites run from server/, as "npm test" there does,
 * so a relative path inside one resolves the same way in both places.
 */
export function runOne(file, base = root) {
  const cwd = file.startsWith('server/') ? join(base, 'server') : base;
  const r = spawnSync(process.execPath, [join(base, file)], { cwd, encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const summary = parseSummary(output);
  const ok = r.status === 0 && summary !== null && summary.failed === 0;
  return { file, ok, status: r.status, summary, output };
}

export function main() {
  const files = discover();
  if (files.length === 0) {
    console.error('no test files found');
    return 1;
  }
  let passed = 0;
  let failed = 0;
  let broken = 0;
  for (const file of files) {
    process.stdout.write(file.padEnd(48));
    const r = runOne(file);
    if (r.summary) {
      passed += r.summary.passed;
      failed += r.summary.failed;
      console.log(`${r.ok ? 'ok     ' : 'FAILED '} ${r.summary.passed} passed, ${r.summary.failed} failed`);
    } else {
      console.log(`BROKEN  exit ${r.status}, no summary line`);
    }
    /* A suite can exit non zero with a clean summary line (a crash in
       teardown, say). That is still red. */
    if (!r.ok) broken += 1;
    /* A green suite's own output is noise; a red one's is the diagnosis. */
    if (!r.ok) console.log(r.output.trimEnd().split('\n').map((l) => `    ${l}`).join('\n'));
  }
  console.log(`\n${files.length} suites, ${files.length - broken} green: ${passed} passed, ${failed} failed\n`);
  return broken ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
