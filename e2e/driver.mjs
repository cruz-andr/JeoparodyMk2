// Minimal CDP driver: real Chrome, real viewport, real clicks.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from './ws.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* Every browser gets its own port, and the port is checked free first.
   Sharing one meant a second launch() bound nothing and /json/list handed back
   the FIRST browser's page, so a probe that thought it was a signed-out
   visitor was quietly driving the signed-in tab. Worse, a run killed by a
   timeout leaves its Chrome behind holding the port, and the next run then
   attaches to a dead page and hangs. */
async function freePort(from = 9400) {
  for (let port = from + Math.floor(Math.random() * 200); port < from + 400; port += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) });
    } catch {
      return port; // nothing answered, so nothing is there
    }
  }
  throw new Error('no free debugging port');
}

const strays = new Set();
const reap = () => { for (const p of strays) { try { p.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', reap);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { reap(); process.exit(1); });

export async function launch({ width = 393, height = 852, dpr = 3 } = {}) {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run',
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });
  strays.add(proc);

  let target;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('chrome never came up');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await ws.ready;
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile: dpr > 1,
  });

  const api = {
    send,
    onNewDocument: (source) => send('Page.addScriptToEvaluateOnNewDocument', { source }),
    async goto(url) {
      await send('Page.navigate', { url });
      await new Promise((r) => setTimeout(r, 1800));
    },
    async evaluate(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
      return r.result.value;
    },
    async click(sel) {
      const box = await api.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
        if (!e) return null; const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error('no element for ' + sel);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, 500));
    },
    /* Real text entry: focus the field, then Input.insertText, which fires the
       same input events a keyboard does. Assigning .value skips React's
       synthetic onChange and the store never hears about it, so a probe that
       does that will report a passing editor that does not work. */
    async type(sel, text) {
      await api.click(sel);
      await send('Input.insertText', { text });
      await new Promise((r) => setTimeout(r, 120));
    },
    /* A real key press, not a synthetic event: rawKeyDown then keyUp is what
       Chrome sends, and it is what a keydown handler with preventDefault
       actually sees. */
    async key(name, code) {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, key: name, code: code ?? name, windowsVirtualKeyCode: {
          ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27, Tab: 9,
        }[name] ?? 0 });
      }
      await new Promise((r) => setTimeout(r, 90));
    },
    async shot(path) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(data, 'base64'));
    },
    kill() {
      try { ws.close(); } catch { /* already gone */ }
      /* SIGKILL, not SIGTERM: a script that calls kill() then process.exit()
         never gives a polite signal time to be delivered, and the leftover
         browser is what breaks the next run. */
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      strays.delete(proc);
    },
  };
  return api;
}
