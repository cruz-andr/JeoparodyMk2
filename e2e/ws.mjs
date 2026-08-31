// Node 22 has a global WebSocket; this just adds a `ready` promise and
// a string-only onmessage so the driver reads plainly.
export default class Shim {
  constructor(url) {
    this.raw = new globalThis.WebSocket(url);
    this.ready = new Promise((res, rej) => { this.raw.onopen = res; this.raw.onerror = rej; });
    this.raw.onmessage = (e) => this._h && this._h(e.data);
  }
  set onmessage(h) { this._h = h; }
  send(s) { this.raw.send(s); }
  close() { this.raw.close(); }
}
