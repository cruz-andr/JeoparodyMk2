/**
 * Hovering a button must not restyle its text.
 *
 * The reset for link-like buttons stated background, border, colour and
 * text-transform on one rule shared with :hover, which made every declaration
 * in it 0,3,1 under the pointer. text-transform: none then outweighed the
 * 0,1,1 uppercase every button class sets, so a label written "Game Settings"
 * and shown as GAME SETTINGS dropped back to Game Settings on hover. With a
 * display face that reads as the font changing.
 *
 * This walks the buttons on several screens and holds their type still, while
 * checking the thing that rule was there for in the first place: a plain button
 * must not flare gold when the pointer reaches it.
 */
import { launch } from './driver.mjs';
const APP = 'http://localhost:5100';
const API = 'http://127.0.0.1:3995';
const STAMP = String(Date.now()).slice(-7);

const { token } = await (await fetch(`${API}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `hs-${STAMP}@x.com`, password: 'hunter2hunter2',
                         displayName: 'H', username: `hs${STAMP}` }),
})).json();

let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '  ' + d : ''}`); };

/* Everything about a button's text. If any of it moves under the pointer, the
   label changes shape, which is the bug. */
const typeOf = (b, sel) => b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});
  if(!e) return null; const s=getComputedStyle(e);
  return { transform: s.textTransform, family: s.fontFamily, weight: s.fontWeight,
           size: s.fontSize, spacing: s.letterSpacing, shown: e.innerText };})()`);

/* Opacity of the button's own ground. A quiet hover wash is a low alpha tint;
   the gold slab the reset exists to prevent is opaque. Comparing before with
   after is what separates a flare from a cell that is meant to be gold because
   it is selected. */
const groundOf = (b, sel) => b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});
  if(!e) return null; const m = getComputedStyle(e).backgroundColor.match(/[\\d.]+/g) || [];
  return m.length > 3 ? Number(m[3]) : 1;})()`);

const b = await launch({ width: 1440, height: 900, dpr: 2 });
try {
  await b.onNewDocument(`localStorage.setItem('jeopardy-user-storage', ${JSON.stringify(
    JSON.stringify({ state: { token, isAuthenticated: true, isGuest: false }, version: 0 })
  )});`);

  const screens = [
    ['the menu', '/menu', '.plain-btn'],
    ['host setup', '/host', '.host-settings'],
    ['my boards', '/boards/mine', '.plain-btn'],
    ['community boards', '/boards', '.plain-btn'],
  ];

  for (const [name, path, ready] of screens) {
    console.log(`\n-- ${name} --`);
    await b.goto(`${APP}${path}`);
    await b.until(`!!document.querySelector(${JSON.stringify(ready)})`, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 600));

    /* Every plain button on screen, addressed by index so the check does not
       depend on any one class existing. */
    const count = await b.evaluate(`(()=>{
      const all = [...document.querySelectorAll('button.plain-btn')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      window.__btns = all;
      all.forEach((e, i) => e.setAttribute('data-hoverprobe', String(i)));
      return all.length;})()`);
    check(`${name} has plain buttons to check`, count > 0, `${count} of them`);

    let moved = [];
    let flared = [];
    for (let i = 0; i < count; i += 1) {
      const sel = `[data-hoverprobe="${i}"]`;
      const before = await typeOf(b, sel);
      const groundBefore = await groundOf(b, sel);
      await b.hover(sel);
      const after = await typeOf(b, sel);
      const groundAfter = await groundOf(b, sel);
      if (!before || !after) continue;
      for (const key of ['transform', 'family', 'weight', 'size', 'spacing', 'shown']) {
        if (before[key] !== after[key]) {
          moved.push(`${before.shown?.slice(0, 20)} ${key}: ${before[key]} -> ${after[key]}`);
          break;
        }
      }
      /* A wash appearing is the point of a quiet button. A ground going fully
         opaque is the gold slab this reset exists to prevent. */
      if (groundAfter > 0.5 && groundBefore <= 0.5) {
        flared.push(`${before.shown?.slice(0, 24)} ${groundBefore} -> ${groundAfter}`);
      }
    }

    check(`nothing on ${name} changes shape under the pointer`, moved.length === 0,
      moved.slice(0, 3).join(' / '));
    check(`and no plain button flares gold`, flared.length === 0, flared.slice(0, 3).join(' / '));
  }
} finally {
  b.kill();
}
process.exit(bad ? 1 : 0);
