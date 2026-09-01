/**
 * How the browser driver finds Chrome. Run with: node e2e/driver.test.js
 *
 * No browser is started. This checks the rule only: CHROME wins, then the
 * platform's usual places, and on Linux a name that is actually on PATH.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { findChrome } from './driver.mjs';

const failures = [];
let passed = 0;
const eq = (name, got, want) => {
  if (got === want) { passed += 1; return; }
  failures.push(name);
  console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

eq('CHROME wins on a Mac', findChrome({ CHROME: '/opt/chrome' }, 'darwin'), '/opt/chrome');
eq('CHROME wins on Linux', findChrome({ CHROME: '/opt/chrome', PATH: '/usr/bin' }, 'linux'), '/opt/chrome');
eq('CHROME can be a bare command', findChrome({ CHROME: 'chromium' }, 'linux'), 'chromium');
eq('an empty CHROME is no CHROME', findChrome({ CHROME: '', PATH: '' }, 'darwin'), MAC);
eq('a Mac defaults to the app bundle', findChrome({}, 'darwin'), MAC);
eq('an unknown platform gets the Linux names', findChrome({ PATH: '' }, 'freebsd'), 'google-chrome-stable');

/* A fake PATH with one of the Linux names in it. */
const bin = mkdtempSync(join(tmpdir(), 'chrome-bin-'));
writeFileSync(join(bin, 'chromium'), '#!/bin/sh\n');
const path = ['/nowhere/at/all', bin].join(delimiter);
eq('Linux picks the first name that is on PATH', findChrome({ PATH: path }, 'linux'), 'chromium');
eq('Linux with nothing on PATH still names the usual binary', findChrome({ PATH: '/nowhere' }, 'linux'), 'google-chrome-stable');
eq('Linux with no PATH at all does not throw', findChrome({}, 'linux'), 'google-chrome-stable');
writeFileSync(join(bin, 'google-chrome'), '#!/bin/sh\n');
eq('and the earlier name wins when both are there', findChrome({ PATH: path }, 'linux'), 'google-chrome');
rmSync(bin, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
