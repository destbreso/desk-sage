// The whole chain without hardware: the real bridge in emulator mode, the page in headless Chromium.
// A hook posted as Claude Code posts it must change the page's mood; a click on the prism must reach
// the bridge as a tap (and the bridge's answer come back); a double click must be one tap; a clip the
// bridge sends must play. Prints what it measured; with --sheet, also saves a small contact sheet.
//
//   node emulator/checks/e2e.mjs [--sheet out.png]
// Chromium: $CHROME, else Playwright's cached headless shell (~/Library/Caches/ms-playwright). No dependencies.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sheetAt = process.argv.indexOf('--sheet');
const SHEET = sheetAt > 0 ? process.argv[sheetAt + 1] : null;

async function waitFor(what, fn, ms = 10000, every = 15) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  throw new Error('timed out waiting for ' + what);
}
function freePort() {
  return new Promise(res => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
function chromium() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  for (const d of (existsSync(cache) ? readdirSync(cache) : []).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    for (const sub of readdirSync(join(cache, d))) {
      const exe = join(cache, d, sub, 'chrome-headless-shell');
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error('no Chromium: set CHROME, or install Playwright\'s headless shell');
}

class CDP {                                       // just enough of the DevTools protocol
  constructor(url) {
    this.ws = new WebSocket(url); this.n = 0; this.pending = new Map();
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data), p = m.id && this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    };
  }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; }); }
  send(method, params = {}, sessionId) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const home = mkdtempSync(join(tmpdir(), 'desk-emulator-e2e-')), profile = mkdtempSync(join(tmpdir(), 'desk-emulator-chrome-'));
mkdirSync(join(home, 'clips'));
copyFileSync(join(ROOT, 'emulator', 'testcard', 'ping.clip'), join(home, 'clips', 'ping.clip'));
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const bridge = spawn('python3', [join(ROOT, 'tools', 'buddy_bridge.py'), '--emulator', '--port', String(port), '--art', join(ROOT, 'emulator', 'testcard', 'testcard.bin')],
                     { env: { ...process.env, DESKBUDDY_HOME: home }, stdio: 'ignore' });
let chrome, results = {}, failed = [];
const bridgeLog = () => { try { return readFileSync(join(home, 'bridge.log'), 'utf8'); } catch { return ''; } };
const check = (name, ok, detail) => { results[name] = { ok, ...detail }; if (!ok) failed.push(name); };

// a hook, posted the way tools/install_hooks.py has Claude Code post it
function hook(event, extra = {}) {
  const payload = JSON.stringify({ session_id: 'e2e-session', transcript_path: join(home, 'transcript.jsonl'), cwd: ROOT, permission_mode: 'default', hook_event_name: event, ...extra });
  execFileSync('curl', ['-s', '-m', '1', '-o', '/dev/null', '-H', 'Content-Type: application/json', '--data-binary', '@-', `${base}/hook`], { input: payload });
}

try {
  await waitFor('the bridge', () => fetch(`${base}/status`).then(r => r.ok, () => false));
  chrome = spawn(chromium(), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errText = '';
  chrome.stderr.on('data', d => { errText += d; });
  const wsUrl = await waitFor('DevTools', () => (errText.match(/DevTools listening on (ws:\S+)/) || [])[1]);
  const cdp = new CDP(wsUrl); await cdp.open();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 860, deviceScaleFactor: 1, mobile: false }, sid);
  await cdp.send('Page.navigate', { url: `${base}/emulator/` }, sid);
  const ev = async expr => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;
  const state = () => ev('window.__emu ? window.__emu.state() : null');
  const prism = await waitFor('the page', () => ev(`(() => { const r = document.getElementById('prism')?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; })()`));
  const shots = [];
  const shoot = async (label, clip = { x: prism.x, y: prism.y, width: prism.w, height: prism.h }) => {
    if (SHEET) shots.push({ label, png: (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } }, sid)).data });
  };
  const click = async (x = prism.x + prism.w / 2, y = prism.y + prism.h / 2) => {
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sid);
  };

  // linked, and the bridge has spoken (the board left its offline state)
  await waitFor('the link', async () => { const s = await state(); return s && s.linked && s.mode === 'direct'; }, 15000);
  await sleep(1500);
  await shoot('idle, linked');

  // 1. a hook changes the page's mood
  let t0 = Date.now();
  hook('UserPromptSubmit', { prompt: 'continue' });
  await waitFor('target working', async () => (await state()).target === 'working');
  const hookToTarget = Date.now() - t0;
  await waitFor('the working loop', async () => (await state()).playing === 'working');
  check('hook changes the mood', true, { hook_to_target_ms: hookToTarget, hook_to_loop_ms: Date.now() - t0 });
  await sleep(2500);
  results['fps on the page'] = { fps: (await state()).fps };
  await shoot('working (hook)');

  // 2. a click is a tap, and the bridge's answer to it comes back: needs-you snoozed, so the mood moves on
  hook('PermissionRequest', { tool_name: 'Bash' });
  await waitFor('alert', async () => (await state()).playing === 'alert');
  const tapsBefore = (bridgeLog().match(/board: tap$/gm) || []).length;
  t0 = Date.now();
  await click();
  await waitFor('the tap in the bridge', () => /tap: needs-you snoozed/.test(bridgeLog()));
  const tapToBridge = Date.now() - t0;
  await waitFor('the snooze back on the page', async () => (await state()).target === 'awake');
  check('a click reaches the bridge as a tap', true, { click_to_bridge_ms: tapToBridge, click_to_new_mood_ms: Date.now() - t0, gag: (bridgeLog().match(/board: (gag \S+)/) || [])[1] || null });
  await sleep(250);
  await shoot('tap: a gag playing');

  // 3. a double click is one tap (the board ignores a second knock within 600 ms)
  await sleep(1500);
  const before = (bridgeLog().match(/board: tap$/gm) || []).length;
  await click(); await sleep(180); await click();
  await sleep(1200);
  const doubleTaps = (bridgeLog().match(/board: tap$/gm) || []).length - before;
  check('a double click is one tap', doubleTaps === 1, { taps_seen: doubleTaps, taps_before: tapsBefore });

  // 4. more sessions waiting: the amber dots
  hook('PermissionRequest', { session_id: 'e2e-two', tool_name: 'Edit' });
  hook('PermissionRequest', { session_id: 'e2e-three', tool_name: 'Edit' });
  await waitFor('two or more waiting', async () => (await state()).overlay[1] >= 2);
  await sleep(1500);
  await shoot('alert, 3 sessions waiting');

  // 5. a clip goes over as POST /clip would, and plays
  for (const s of ['e2e-session', 'e2e-two', 'e2e-three']) hook('Stop', { session_id: s });
  await waitFor('done', async () => (await state()).target === 'done');
  await sleep(1200);
  await shoot('done (Stop hooks)');
  await sleep(9000);
  t0 = Date.now();
  const played = await fetch(`${base}/play`, { method: 'POST', body: 'ping' }).then(r => r.status);
  await waitFor('the clip', async () => (await state()).playing === 'ping');
  check('a clip reaches the page and plays', played === 200 && /clip ping sent/.test(bridgeLog()), { http: played, play_to_playing_ms: Date.now() - t0, clips_on_page: (await state()).clips.map(c => c.name) });
  await sleep(700);
  await shoot('clip "ping" playing');

  // 6. night, dimmed by the backlight
  await fetch(`${base}/cmd`, { method: 'POST', body: 's night' });
  await waitFor('night', async () => (await state()).playing === 'night');
  await sleep(4000);
  results['night'] = { backlight: (await state()).backlight };
  await shoot('night, backlight dimmed');
  await shoot('the page', { x: 0, y: 0, width: 1180, height: 860 });

  if (SHEET) {                                     // one small PNG: 4 by 2 tiles of 240 px, drawn by the page itself
    const url = await ev(`(async shots => {
      const T = 240, cv = Object.assign(document.createElement('canvas'), { width: 4 * T, height: 2 * (T + 22) }), c = cv.getContext('2d');
      c.fillStyle = '#0d0f12'; c.fillRect(0, 0, cv.width, cv.height); c.font = '12px monospace'; c.fillStyle = '#c9d1db'; c.textAlign = 'center';
      for (const [i, s] of shots.entries()) {
        const img = new Image(); img.src = 'data:image/png;base64,' + s.png; await img.decode();
        const x = (i % 4) * T, y = Math.floor(i / 4) * (T + 22), k = Math.min(T / img.width, T / img.height);
        c.drawImage(img, x + (T - img.width * k) / 2, y + (T - img.height * k) / 2, img.width * k, img.height * k);
        c.fillText(s.label, x + T / 2, y + T + 15);
      }
      return cv.toDataURL('image/png');
    })(${JSON.stringify(shots)})`);
    mkdirSync(dirname(SHEET), { recursive: true });
    writeFileSync(SHEET, Buffer.from(url.split(',')[1], 'base64'));
    results.sheet = SHEET;
  }
  results.problems = (await state()).problems;
} catch (e) {
  failed.push(String(e.message || e));
} finally {
  if (chrome) chrome.kill();
  bridge.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
console.log(JSON.stringify({ results, failed }, null, 1));
process.exit(failed.length ? 1 : 0);
