// Sage's mind end to end, without hardware: the real bridge in emulator mode starting the real mind, the page in
// headless Chromium playing the committed art (which predates some of the table's acts, so the mind must skip those).
// Hooks are posted as the installed ones post them. A failing test command, a Stop, a compaction, a push, idle time,
// the battery and taps that run its patience out: what the page played, and the bridge's lines for each.
//
//   node mind/checks/e2e.mjs [--art firmware/data/sage.bin]
// Chromium: $CHROME, else Playwright's cached headless shell (~/Library/Caches/ms-playwright). No dependencies.
// It waits for one idle minute of the bridge's rhythm, so it takes about two minutes.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const artAt = process.argv.indexOf('--art');
const ART = artAt > 0 ? resolve(process.argv[artAt + 1]) : join(ROOT, 'firmware', 'data', 'sage.bin');
const HOLDS = await (await import('../art.mjs')).readArt(ART);             // the acts this art holds, read as the mind reads them
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, ms = 15000, every = 25) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  throw new Error('timed out waiting for ' + what);
}
const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
function chromium() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  for (const d of (existsSync(cache) ? readdirSync(cache) : []).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse())
    for (const sub of readdirSync(join(cache, d))) { const exe = join(cache, d, sub, 'chrome-headless-shell'); if (existsSync(exe)) return exe; }
  throw new Error('no Chromium: set CHROME, or install Playwright\'s headless shell');
}
class CDP {                                       // just enough of the DevTools protocol
  constructor(url) {
    this.ws = new WebSocket(url); this.n = 0; this.pending = new Map();
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data), p = m.id && this.pending.get(m.id); if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; }); }
  send(method, params = {}, sessionId) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const home = mkdtempSync(join(tmpdir(), 'desk-mind-e2e-')), profile = mkdtempSync(join(tmpdir(), 'desk-mind-chrome-'));
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const bridge = spawn('python3', [join(ROOT, 'tools', 'buddy_bridge.py'), '--emulator', '--port', String(port), '--art', ART],
  { env: { ...process.env, DESKBUDDY_HOME: home }, stdio: 'ignore' });
const log = () => { try { return readFileSync(join(home, 'bridge.log'), 'utf8'); } catch { return ''; } };
const steps = [], failed = [];
let chrome, t0 = Date.now();

function hook(event, extra = {}) {            // posted the way tools/install_hooks.py has Claude Code post it
  const payload = JSON.stringify({ session_id: 'e2e-session', transcript_path: join(home, 'transcript.jsonl'), cwd: ROOT, permission_mode: 'default', hook_event_name: event, ...extra });
  execFileSync('curl', ['-s', '-m', '1', '-o', '/dev/null', '-H', 'Content-Type: application/json', '--data-binary', '@-', `${base}/hook`], { input: payload });
}
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

try {
  await waitFor('the bridge', () => fetch(`${base}/status`).then((r) => r.ok, () => false));
  chrome = spawn(chromium(), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errText = '';
  chrome.stderr.on('data', (d) => { errText += d; });
  const cdp = new CDP(await waitFor('DevTools', () => (errText.match(/DevTools listening on (ws:\S+)/) || [])[1]));
  await cdp.open();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 860, deviceScaleFactor: 1, mobile: false }, sid);
  await cdp.send('Page.navigate', { url: `${base}/emulator/` }, sid);
  const ev = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;
  const state = () => ev('window.__emu ? window.__emu.state() : null');
  const prism = await waitFor('the page', () => ev(`(() => { const r = document.getElementById('prism')?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`));
  const click = async () => { for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: prism.x, y: prism.y, button: 'left', clickCount: 1 }, sid); };
  await waitFor('the link', async () => { const s = await state(); return s && s.linked && s.mode === 'direct'; });
  await waitFor('the mind', () => /mind: ready/.test(log()));

  // every act the page plays, as it starts
  const played = [];
  let last = null, watching = true;
  (async () => {
    while (watching) {
      const s = await state().catch(() => null);
      const now = s && s.kind === 'event' ? s.playing : null;
      if (now && now !== last) played.push({ act: now, s: (Date.now() - t0) / 1000 });
      last = now;
      await sleep(30);
    }
  })();

  // one step: do something, then wait for the page to play one of these acts (or, with none, for the bridge's line)
  async function step(name, act, expect, opts = {}) {
    const from = log().length, n = played.length;
    await act();
    let got = null, error = null;
    try {
      if (expect) got = (await waitFor(name, () => played.slice(n).find((p) => expect.includes(p.act)), opts.ms || 15000)).act;
      else await waitFor(name, () => opts.until.test(log().slice(from)), opts.ms || 15000);
    } catch (e) { error = e.message; failed.push(name); }
    await sleep(opts.after ?? 400);
    const lines = log().slice(from).split('\n').filter((l) => /mind:|-> e |tap:|board: (tap|gag)|hook /.test(l)).map((l) => l.replace(/^\S+ \S+ /, ''));
    steps.push({ step: name, played: got, page: played.slice(n).map((p) => p.act), lines, ...(error ? { error } : {}) });
  }

  await step('a session starts after a long quiet', () => hook('SessionStart', { source: 'startup' }), ['hello', 'glyph_form']);
  await step('a test command fails', async () => {
    hook('UserPromptSubmit', { prompt: 'run the tests' });
    await sleep(600);
    hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1' });
  }, ['work_tests_fail', 'life_tests_fail', 'holo_tests', 'holo_screen_tests', 'glyph_glitch'], { after: 7000 });
  await step('the context is compacted', () => hook('PreCompact', { trigger: 'auto' }), ['glyph_rain', 'glyph_decode'], { after: 8000 });
  // (and the next step waits for whichever it played to end: the board never cuts an act short)
  await step('a push', () => hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git push' }, tool_response: { stdout: '' } }), ['life_deploy', 'done_glider'], { after: 1000 * Math.max(...['life_deploy', 'done_glider'].map((a) => HOLDS[a] || 0)) + 1500 });
  await step('Claude stops, nothing else going on', () => hook('Stop'), ['done_glider', 'done_hearts', 'glyph_joy', 'holo_screen_self'], { after: 6000 });
  await step('the battery falls below a quarter', async () => {
    await post('/usage', { rate_limits: { five_hour: { used_percentage: 50, resets_at: Math.floor(Date.now() / 1000) + 3600 } } });
    await sleep(300);
    await post('/usage', { rate_limits: { five_hour: { used_percentage: 80, resets_at: Math.floor(Date.now() / 1000) + 3600 } } });
  }, ...('holo_battery' in HOLDS ? [['holo_battery'], { after: 1000 * HOLDS.holo_battery + 1000 }] : [null, { until: /mind: usage -> nothing \(its battery fell below a quarter/ }]));
  // the session ends (it was done but unseen, so awake): idle, and its next idle minute
  await step('idle time', () => hook('SessionEnd'), Object.keys((await import('../table.mjs')).REACTIONS.idle_late.acts), { ms: 95000, after: 9000 });
  // taps about a second apart, in the middle of its hellos: its patience runs out
  await step('taps on and on', async () => {
    for (let k = 0; k < 14 && !/out of patience|mind: tap -> glyph_glitch|mind: glitch/.test(log()); k++) { await click(); await sleep(1000); }
  }, ['glyph_glitch', 'tap_dizzy'], { ms: 20000, after: 1500 });
  await step('one more tap, while it is cross', () => click(), null, { until: /mind: tap -> nothing \(It is still cross/ });
  watching = false;
  steps.push({ problems: (await state()).problems, fps: (await state()).fps });
} catch (e) {
  failed.push(String(e.message || e));
} finally {
  if (chrome) chrome.kill();
  bridge.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
console.log(JSON.stringify({ art: ART, steps, failed }, null, 1));
process.exit(failed.length ? 1 : 0);
