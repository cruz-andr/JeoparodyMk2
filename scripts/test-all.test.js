/**
 * The test runner's own tests. Run with: node scripts/test-all.test.js
 *
 * Fixtures are written to a throwaway directory and run through the same
 * discover/runOne the real run uses, so a green here means the runner would
 * have caught a red suite, a crashed suite and a suite hiding in a subfolder.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover, parseSummary, runOne, ROOTS } from './test-all.mjs';

const failures = [];
let passed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed += 1; return; }
  failures.push(name);
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* parseSummary */
eq('parses the summary line', parseSummary('x\n12 passed, 3 failed\n'), { passed: 12, failed: 3 });
eq('parses a zero failure line', parseSummary('9 passed, 0 failed'), { passed: 9, failed: 0 });
eq('no summary is null', parseSummary('TypeError: boom\n'), null);
eq('empty output is null', parseSummary(''), null);

/* discover against a fixture tree */
const base = mkdtempSync(join(tmpdir(), 'test-all-'));
const write = (rel, body) => {
  mkdirSync(join(base, rel, '..'), { recursive: true });
  writeFileSync(join(base, rel), body);
};
const green = "console.log('2 passed, 0 failed'); process.exit(0);\n";
const red = "console.log('FAIL thing\\n1 passed, 1 failed'); process.exit(1);\n";
const crash = "throw new Error('boom before any summary');\n";
const liar = "console.log('3 passed, 0 failed'); process.exit(1);\n";

write('src/a.test.js', green);
write('src/deep/er/b.test.js', red);
write('src/notatest.js', green);
write('src/helper.test.js.bak', green);
write('server/test/c.test.js', crash);
write('server/test/nested/d.test.js', green); // server/test is not recursive
write('scripts/e.test.js', liar);
write('other/f.test.js', green); // not a root at all

const found = discover(base);
eq('finds every test file under the roots, sorted', found, [
  'scripts/e.test.js',
  'server/test/c.test.js',
  'src/a.test.js',
  'src/deep/er/b.test.js',
]);
eq('a base with none of the roots finds nothing', discover(join(base, 'nowhere')), []);
eq('roots cover src, the server and the tooling', ROOTS.map((r) => r.dir), ['src', 'server/test', 'scripts', 'e2e']);
check('only src is walked recursively', ROOTS.every((r) => r.recursive === (r.dir === 'src')));

/* runOne on each fixture */
const a = runOne('src/a.test.js', base);
check('a green suite is ok', a.ok, JSON.stringify(a));
eq('a green suite reports its counts', a.summary, { passed: 2, failed: 0 });

const b = runOne('src/deep/er/b.test.js', base);
check('a red suite is not ok', !b.ok);
eq('a red suite reports its counts', b.summary, { passed: 1, failed: 1 });
check('a red suite keeps its output for the diagnosis', b.output.includes('FAIL thing'));

const c = runOne('server/test/c.test.js', base);
check('a suite that crashes before its summary is not ok', !c.ok);
eq('a crashed suite has no summary', c.summary, null);
check('a crashed suite exits non zero', c.status !== 0);

const e = runOne('scripts/e.test.js', base);
check('a clean summary with a non zero exit is still not ok', !e.ok);

/* The real tree: the runner must see the suites this repo actually has. */
const real = discover();
check('the real tree has server suites', real.some((f) => f.startsWith('server/test/')), real.join(','));
check('the real tree has src suites', real.some((f) => f.startsWith('src/')), real.join(','));
check('the real tree includes this file', real.includes('scripts/test-all.test.js'), real.join(','));
check('nothing from node_modules', !real.some((f) => f.includes('node_modules')));

rmSync(base, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
