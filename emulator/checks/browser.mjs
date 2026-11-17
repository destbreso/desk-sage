// Headless Chromium over the DevTools protocol, a static server, and the waits the Realistic check and the live GIF
// share. No dependencies. Chromium: $CHROME, else Playwright's cached headless shell (~/Library/Caches/ms-playwright).

import { spawn } from 'node:child_process';
import { createServer as tcp } from 'node:net';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, normalize, extname } from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function waitFor(what, fn, ms = 15000, every = 20) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  throw new Error('timed out waiting for ' + what);
}
export const freePort = () => new Promise(res => { const s = tcp().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function chromium() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  for (const d of (existsSync(cache) ? readdirSync(cache) : []).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse())
    for (const sub of readdirSync(join(cache, d))) { const exe = join(cache, d, sub, 'chrome-headless-shell'); if (existsSync(exe)) return exe; }
  throw new Error('no Chromium: set CHROME, or install Playwright\'s headless shell');
}

class CDP {                                       // just enough of the DevTools protocol, with its events
  constructor(url) {
    this.ws = new WebSocket(url); this.n = 0; this.pending = new Map(); this.handlers = [];
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data), p = m.id && this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      else if (m.method) this.handlers.forEach(h => h(m));
    };
  }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; }); }
  send(method, params = {}, sessionId) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

// a browser with one page; the GPU on a Mac (Metal), else Chromium's software WebGL
export async function browser({ width, height }) {
  const profile = await mkdtemp(join(tmpdir(), 'desk-chrome-'));
  const gl = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : ['--enable-unsafe-swiftshader'];
  const proc = spawn(chromium(), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, ...gl, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', d => { err += d; });
  const cdp = new CDP(await waitFor('DevTools', () => (err.match(/DevTools listening on (ws:\S+)/) || [])[1]));
  await cdp.open();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid);
  // what the page logs as an error, and what it throws
  const errors = [];
  cdp.handlers.push(m => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.source}: ${m.params.entry.text}${m.params.entry.url ? ' ' + m.params.entry.url : ''}`);
  });
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Log.enable', {}, sid);
  const ev = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const mouse = async (type, x, y) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, sid);
  return {
    errors, ev,
    go: url => cdp.send('Page.navigate', { url }, sid),
    shot: async (clip, format = 'png') => (await cdp.send('Page.captureScreenshot', { format, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, sid)).data,
    click: async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); },
    drag: async (x, y, dx, dy) => { await mouse('mousePressed', x, y); for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', x + dx * k / 8, y + dy * k / 8); await sleep(16); } await mouse('mouseReleased', x + dx, y + dy); },
    key: async (key, code = key, text) => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38 }[key] || 0, ...(text && type === 'keyDown' ? { text } : {}) }, sid); },
    type: async text => { for (const ch of text) await cdp.send('Input.insertText', { text: ch }, sid); },
    send: (method, params) => cdp.send(method, params, sid),
    async close() { proc.kill(); await sleep(300); await rm(profile, { recursive: true, force: true }); },
  };
}

// the repository served as files, as python3 -m http.server would (the page's modules need http)
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.bin': 'application/octet-stream', '.json': 'application/json' };
export async function serveStatic(root) {
  const srv = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(root, path));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(r => srv.close(r)) };
}

// shots side by side in one PNG, drawn by the page itself
export async function sheet(ev, shots, { tile = 300, cols = 4 } = {}) {
  const url = await ev(`(async (shots, T, C) => {
    const rows = Math.ceil(shots.length / C), cv = Object.assign(document.createElement('canvas'), { width: C * T, height: rows * (T + 24) }), c = cv.getContext('2d');
    c.fillStyle = '#0d0f12'; c.fillRect(0, 0, cv.width, cv.height); c.font = '12px monospace'; c.fillStyle = '#c9d1db'; c.textAlign = 'center';
    for (const [i, s] of shots.entries()) {
      const img = new Image(); img.src = 'data:image/png;base64,' + s.png; await img.decode();
      const x = (i % C) * T, y = Math.floor(i / C) * (T + 24), k = Math.min(T / img.width, T / img.height);
      c.drawImage(img, x + (T - img.width * k) / 2, y + (T - img.height * k) / 2, img.width * k, img.height * k);
      c.fillText(s.label, x + T / 2, y + T + 16, T - 8);
    }
    return cv.toDataURL('image/png');
  })(${JSON.stringify(shots)}, ${tile}, ${cols})`);
  return Buffer.from(url.split(',')[1], 'base64');
}
