// The real bridge and Sage's mind driving the real firmware in Espressif's QEMU, over UART0 on a pty as over the
// board's USB serial: hooks posted as Claude Code posts them, the act the mind chooses sent by the bridge, and that
// act seen on QEMU's virtual panel (the emulator's frames of it, within the bake's tolerance). A tap goes the other
// way: the firmware says "tap" (pretended with X, as QEMU has no motion sensor) and the mind answers it.
//
//   node tools/qemu/bridge.mjs [--no-build] [--sheet out.png]
// The bridge runs from tools/.venv (it needs pyserial) with a temporary home, on a free port, never the hooks' 47823.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Qemu, Reference, ROOT, RUN, sleep, waitFor, freePort, within, sheet, MAX_MEAN, MAX_FAR } from './qemu.mjs';

const argv = process.argv.slice(2);
const sheetAt = argv.indexOf('--sheet'), SHEET = sheetAt >= 0 ? argv[sheetAt + 1] : null;
if (!argv.includes('--no-build')) execFileSync(RUN, ['image'], { stdio: ['ignore', 'ignore', 'inherit'] });
const PY = join(ROOT, 'tools', '.venv', 'bin', 'python');
if (!existsSync(PY)) throw new Error('tools/.venv is missing: tools/qemu/run.sh image creates it');

const ref = new Reference();
const home = mkdtempSync(join(tmpdir(), 'sage-qemu-bridge-')), tmp = mkdtempSync(join(tmpdir(), 'sage-qemu-dumps-'));
const steps = [], failed = [], rows = [];
let q, bridge, dumps = 0;
const log = () => { try { return readFileSync(join(home, 'bridge.log'), 'utf8'); } catch { return ''; } };
const port = await freePort(), base = `http://127.0.0.1:${port}`;

function hook(event, extra = {}) {            // posted the way tools/install_hooks.py has Claude Code post it
  const payload = JSON.stringify({ session_id: 'qemu-session', transcript_path: join(home, 'transcript.jsonl'), cwd: ROOT, permission_mode: 'default', hook_event_name: event, ...extra });
  execFileSync('curl', ['-s', '-m', '1', '-o', '/dev/null', '-H', 'Content-Type: application/json', '--data-binary', '@-', `${base}/hook`], { input: payload });
}
const cmd = (line) => fetch(`${base}/cmd`, { method: 'POST', body: line });
// what the board last said it was playing, asked through the bridge (its reply lands in the bridge's log)
async function boardPlaying() {
  const from = log().length;
  await cmd('?');
  const line = await waitFor('the board\'s reply', () => (log().slice(from).match(/board: ok mode=\S+ target=\S+ playing=(\S+)/) || [])[1], 5000, 50);
  return line;
}
async function panel() {
  await q.qmp('stop');
  const pic = await q.screendump(join(tmp, `${dumps++}.ppm`));
  await q.qmp('cont');
  return pic;
}

// one step: do something, read the act the bridge sends ("-> e <act>"), wait for the firmware to play it, and set the
// panel against the emulator's frames of it
async function step(name, act, choices, { ms = 20000 } = {}) {
  const from = log().length;
  try {
    await act();
    const sent = await waitFor(`${name}: an act sent`, () => {
      const m = log().slice(from).match(/-> e (\S+)/);
      return m && m[1];
    }, ms, 50);
    const lines = () => log().slice(from).split('\n').filter((l) => /mind: |-> e |board: tap|hook /.test(l)).map((l) => l.replace(/^\S+ \S+ /, ''));
    if (choices && !choices.includes(sent)) { steps.push({ step: name, ok: false, sent, expected_one_of: choices, lines: lines() }); failed.push(name); return; }
    await waitFor(`${name}: the firmware playing ${sent}`, async () => (await boardPlaying()) === `${sent}(event)`, 15000, 300);
    await sleep(400);
    const pic = await panel(), m = ref.match(pic, sent), b = m.best, ok = within(b);
    rows.push({ qemu: pic, ref: m.ref });
    steps.push({ step: name, ok, sent, panel: { matched: `${b.name}[${b.k}]`, mean: b.mean, far: b.far, pixels_differing: b.differ, most_levels: b.most }, lines: lines() });
    if (!ok) failed.push(name);
    await waitFor(`${name}: back to its loop`, async () => /\(loop\)$/.test(await boardPlaying()), 15000, 500);
  } catch (e) {
    steps.push({ step: name, ok: false, error: e.message, lines: log().slice(from).split('\n').slice(-12) });
    failed.push(name);
  }
}

try {
  q = await Qemu.start({ pty: true });
  bridge = spawn(PY, [join(ROOT, 'tools', 'buddy_bridge.py'), '--port', String(port), '--art', join(ROOT, 'firmware', 'data', 'sage.bin')],
    { env: { ...process.env, DESKBUDDY_HOME: home, DESKBUDDY_PORT: q.pty }, stdio: 'ignore' });
  await waitFor('the bridge', () => fetch(`${base}/status`).then((r) => r.ok, () => false), 20000);
  await waitFor('the bridge on the pty', () => log().includes(`connected to ${q.pty}`), 20000);
  await waitFor('the mind', () => /mind: ready/.test(log()), 20000);
  await waitFor('the board answering the bridge', () => /board: ok /.test(log()), 20000);
  await waitFor('its loop', async () => /\(loop\)$/.test(await boardPlaying()), 20000, 500);
  steps.push({ step: 'the bridge on the firmware\'s UART', ok: true, pty: q.pty, lines: log().split('\n').filter((l) => /connected to|mind: ready|board: /.test(l)).slice(0, 6).map((l) => l.replace(/^\S+ \S+ /, '')) });

  await step('a session starts', () => hook('SessionStart', { source: 'startup' }), ['hello', 'glyph_form']);
  await step('a test command fails', async () => {
    hook('UserPromptSubmit', { prompt: 'run the tests' });
    await sleep(600);
    hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1' });
  }, ['work_tests_fail', 'life_tests_fail', 'holo_tests', 'holo_screen_tests', 'glyph_glitch']);
  await step('the context is compacted', () => hook('PreCompact', { trigger: 'auto' }), ['glyph_rain', 'glyph_decode']);
  await step('a push', () => hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git push' }, tool_response: { stdout: '' } }), ['life_deploy', 'done_glider']);
  await step('a tap on the glass (X: QEMU has no motion sensor)', () => cmd('X'), null);
} catch (e) {
  failed.push(String(e.stack || e));
} finally {
  if (bridge) bridge.kill();
  if (q) await q.kill();
  await sleep(300);
  if (SHEET && rows.length) sheet(SHEET, rows);
  rmSync(home, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify({ steps, failed, tolerance: { mean_pct: MAX_MEAN, far_pixels: MAX_FAR }, sheet: SHEET }, null, 1));
process.exit(failed.length ? 1 : 0);
