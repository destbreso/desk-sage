// The real firmware in Espressif's QEMU, driven over UART0 as the bridge drives the board: it boots, reads the art
// partition, forms out of the rain, shows its antenna dark with no bridge, answers every command of the protocol,
// plays every mood and some of each kind of act, chooses its own taps, goes offline after a minute of silence and
// says hello when the bridge is back. At each moment QEMU's virtual panel is set against the emulator's board drawing
// the same art (the frame of that sequence, and antenna step, closest to it), within the bake's tolerance.
//
//   node tools/qemu/check.mjs [--no-build] [--sheet out.png]
// It builds and writes the image first (tools/qemu/run.sh image) unless --no-build. About three minutes, one of them
// the silence the board waits out before it goes its own way. Times are QEMU's, not the board's.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Qemu, Reference, RUN, sleep, waitFor, diff, within, sheet, OFFLINE_STEPS, RELINK_STEPS, MAX_MEAN, MAX_FAR } from './qemu.mjs';

const argv = process.argv.slice(2);
const sheetAt = argv.indexOf('--sheet'), SHEET = sheetAt >= 0 ? argv[sheetAt + 1] : null;
if (!argv.includes('--no-build')) execFileSync(RUN, ['image'], { stdio: ['ignore', 'ignore', 'inherit'] });

const ref = new Reference(), A = ref.A;
const tmp = mkdtempSync(join(tmpdir(), 'sage-qemu-'));
const steps = [], failed = [], rows = [];
let q, dumps = 0, t0;
const secs = () => +((performance.now() - t0) / 1000).toFixed(1);

function record(name, ok, detail = {}) {
  steps.push({ step: name, ok, ...detail });
  if (!ok) failed.push(name);
}
const field = (reply, key) => (reply.match(new RegExp(`\\b${key}=(\\S+)`)) || [])[1];
const playing = (reply) => field(reply, 'playing');

// the panel, with the chip stopped so the frame is whole, and what the board said it was playing just before
async function capture() {
  const reply = await q.ask('?');
  await q.qmp('stop');
  const pic = await q.screendump(join(tmp, `${dumps++}.ppm`));
  await q.qmp('cont');
  return { reply, pic };
}
async function panel() {
  await q.qmp('stop');
  const pic = await q.screendump(join(tmp, `${dumps++}.ppm`));
  await q.qmp('cont');
  return pic;
}
// the panel against the emulator's frames of these sequences (and antenna steps)
function compare(name, pic, seqs, stepsAllowed = [-1], expect = () => true) {
  const m = ref.match(pic, seqs, stepsAllowed), b = m.best;
  const ok = within(b) && expect(b);
  rows.push({ qemu: pic, ref: m.ref });
  record(name, ok, { matched: `${b.name}[${b.k}]`, antenna: b.step, mean: b.mean, far: b.far, pixels_differing: b.differ, most_levels: b.most,
    closest_different: m.other ? { matched: `${m.other.name}[${m.other.k}]`, mean: m.other.mean, far: m.other.far } : null,
    ...(stepsAllowed.some((s) => s !== -1) ? { without_antenna: { matched: `${m.plain.name}[${m.plain.k}]`, mean: m.plain.mean, far: m.plain.far } } : {}) });
  return b;
}
async function untilPlaying(re, ms = 15000) {
  return waitFor(String(re), async () => { const r = await q.ask('?'); return re.test(playing(r) || '') && r; }, ms, 300);
}
async function expectReply(name, cmd, re) {
  const reply = await q.ask(cmd).catch((e) => String(e.message));
  record(name, re.test(reply), { sent: cmd, reply });
  return reply;
}

try {
  q = await Qemu.start();
  t0 = performance.now();

  // boot: the art partition read as the emulator reads the file
  const ready = (await q.waitLine(/sage ready|err art/, { ms: 30000 })).line;
  record('boot reads the art partition', ready === `sage ready: ${A.nMoods} moods, ${A.nSeqs} sequences, ${A.nFrames} frames`, { line: ready });
  const imu = (await q.waitLine(/^imu /)).line, wifi = (await q.waitLine(/^wifi /)).line;
  record('no motion sensor, and it carries on', imu === 'imu not found', { line: imu });
  record('no Wi-Fi set up, and it carries on', wifi === 'wifi not set up', { line: wifi });
  const bootAt = q.lines.find((l) => l.line.startsWith('sage ready')).t;

  // out of the rain after a boot (nothing sent yet: no bridge)
  await sleep(1500);
  compare('forms out of the rain after a boot (glyph frames)', await panel(), 'glyph_form');

  // no bridge since boot: after 8 s its antenna's ball dark, now and then a ring
  await waitFor('8 s after boot', () => performance.now() - bootAt > 10000, 20000, 100);
  compare('no bridge: its antenna dark', await panel(), 'idle', [-1, ...OFFLINE_STEPS], (b) => b.step >= 0);

  // the bridge speaks: resync, and the ball lights again with a ring (0.58 s, caught at once)
  {
    const from = q.lines.length;
    q.send('h 43200');
    await q.waitLine(/^resync$/, { from });
    await sleep(200);                                     // the line is said before the frame with the ring is drawn
    const pic = await panel();
    record('the bridge speaks: resync', true);
    compare('the bridge back: the relink ring', pic, 'idle', [-1, ...RELINK_STEPS], (b) => b.step <= -2);
  }
  await expectReply('state report', '?', /^ok mode=direct target=idle playing=idle\(loop\) fps=[\d.]+ frames=\d+ seqs=\d+ draw_ms=\d+$/);
  await expectReply('colour, as the bridge sends it', 'c FF7A45', /^ok colour FF7A45$/);
  await expectReply('corner extras off', 'o 0 0 0', /^ok overlay working=0 waiting=0 unseen=0$/);

  // every mood: its transition, then its loop on the panel
  for (const mood of ref.moods.filter((m) => m !== 'idle').concat('idle')) {
    const reply = await q.ask(`s ${mood}`);
    if (!new RegExp(`^ok mode=direct target=${mood} `).test(reply)) { record(`mood ${mood}`, false, { reply }); continue; }
    try {
      await untilPlaying(new RegExp(`^${mood}\\(loop\\)$`));
      const c = await capture();
      if (playing(c.reply) !== `${mood}(loop)`) { record(`mood ${mood}`, false, { reply: c.reply }); continue; }
      compare(`mood ${mood}`, c.pic, mood);
    } catch (e) { record(`mood ${mood}`, false, { error: e.message }); }
  }

  // acts of each kind: instructions, a hologram, glyphs, the Game of Life, a camera move
  for (const act of ['tap_knock', 'holo_tests', 'glyph_rain', 'life_deploy', 'cam_orbit', 'work_tests_fail']) {
    if (!(act in ref.seqOf)) continue;
    try {
      const reply = await q.ask(`e ${act}`);
      if (playing(reply) !== `${act}(event)`) { record(`act ${act}`, false, { reply }); continue; }
      await sleep(900);
      const c = await capture();
      if (playing(c.reply) !== `${act}(event)`) { record(`act ${act}`, false, { reply: c.reply }); continue; }
      compare(`act ${act}`, c.pic, act);
      await untilPlaying(/^idle\(loop\)$/, 15000);
    } catch (e) { record(`act ${act}`, false, { error: e.message }); }
  }

  // its own choice of a tap: any tap_* but tap_dizzy, never the same twice running while there is another
  {
    const taps = Object.keys(ref.seqOf).filter((n) => n.startsWith('tap_') && n !== 'tap_dizzy');
    const chosen = [];
    for (let k = 0; k < 4; k++) {
      const p = playing(await q.ask('e tap')) || '';
      chosen.push(p.replace(/\(event\)$/, ''));
      await untilPlaying(/^idle\(loop\)$/, 15000);
    }
    const ok = chosen.every((c) => taps.includes(c)) && (taps.length < 2 || chosen.every((c, i) => !i || c !== chosen[i - 1]));
    record('e tap: the board chooses, never tap_dizzy, never twice running', ok, { chosen, from: taps });
    const f = playing(await q.ask('e fidget')) || '';
    record('e fidget: the board chooses a fidget', /^fidget_\w+\(event\)$/.test(f), { playing: f });
    await untilPlaying(/^idle\(loop\)$/, 15000);
  }

  // the rest of the protocol
  {
    const from = q.lines.length;
    q.send('X');
    await q.waitLine(/^tap$/, { from });
    await sleep(300);
    const r = await q.ask('?');
    record('a tap with the bridge there: only reported', playing(r) === 'idle(loop)', { reply: r });
  }
  await expectReply('unknown act', 'e nope', /^err unknown event$/);
  await expectReply('unknown mood', 's nope', /^err unknown mood$/);
  await expectReply('unknown command', 'Z', /^err unknown command$/);
  await expectReply('motion sensor report', 'i', /^ok imu=missing peak=0\.00g taps=0 threshold=0\.35g$/);
  await expectReply('tap sensitivity', 'T 0.5', /^ok threshold=0\.50g$/);
  await expectReply('tap sensitivity back', 'T 0.35', /^ok threshold=0\.35g$/);
  await expectReply('Wi-Fi report', 'W', /^ok wifi=off$/);
  await expectReply('bad colour', 'c 12', /^err bad colour$/);
  {
    await expectReply('corner extras', 'o 1 2 1', /^ok overlay working=1 waiting=2 unseen=1$/);
    await sleep(300);
    const c = await capture(), m = ref.match(c.pic, 'idle');
    // the corners differ from the frame (the dots pulse, dim at times, and a sparkle) while the rest is the frame
    const corners = [[0, 0, 70, 28], [196, 0, 240, 32], [0, 210, 50, 240]].map((r) => diff(c.pic, m.ref, r).differ);
    const middle = diff(c.pic, m.ref, [40, 40, 200, 200]);
    rows.push({ qemu: c.pic, ref: m.ref });
    record('corner extras drawn over the frame', corners.every((n) => n >= 10) && within(middle), { corners_pixels_differing: corners, middle });
    await expectReply('corner extras off again', 'o 0 0 0', /^ok overlay working=0 waiting=0 unseen=0$/);
  }

  // silence: the board goes its own way after a minute, into the rain and out of it, its antenna dark
  {
    await untilPlaying(/^idle\(loop\)$/);
    const quiet = performance.now(), seen = [];
    let dissolveAt = null, formAt = null, darkAt = null, dark = null;
    while (performance.now() - quiet < 95000 && darkAt === null) {
      await sleep(1500);
      const pic = await panel(), s = +((performance.now() - quiet) / 1000).toFixed(1);
      const m = ref.match(pic, ['idle', 'glyph_dissolve', 'glyph_form']), b = m.best;
      const what = b.name === 'idle' ? (within(b) ? 'idle' : 'idle?') : b.name;
      if (!seen.length || seen[seen.length - 1].what !== what) seen.push({ what, s, mean: b.mean, far: b.far });
      if (b.name === 'glyph_dissolve' && dissolveAt === null && within(b)) { dissolveAt = s; rows.push({ qemu: pic, ref: m.ref }); }
      if (b.name === 'glyph_form' && formAt === null && within(b)) formAt = s;
      if (formAt !== null && b.name === 'idle') {
        const d = ref.match(pic, 'idle', [-1, ...OFFLINE_STEPS]);
        if (d.best.step >= 0 && within(d.best)) { darkAt = s; dark = { matched: `idle[${d.best.k}]`, antenna: d.best.step, mean: d.best.mean, far: d.best.far, pixels_differing: d.best.differ, most_levels: d.best.most }; rows.push({ qemu: pic, ref: d.ref }); }
      }
    }
    record('silence: offline after about a minute, through the rain, its antenna dark',
      dissolveAt !== null && formAt !== null && darkAt !== null && dissolveAt >= 55 && dissolveAt <= 66, { seen, dissolve_s: dissolveAt, form_s: formAt, antenna_dark_s: darkAt, antenna_dark: dark });
  }

  // the bridge back: resync, the relink ring and a hello
  {
    const from = q.lines.length;
    q.send('h 43200');
    await q.waitLine(/^resync$/, { from });
    await sleep(200);
    const pic = await panel(), r = await q.ask('?');
    record('back: hello', playing(r) === 'hello(event)', { reply: r });
    compare('back: the relink ring', pic, ['idle', 'hello'], [-1, ...RELINK_STEPS], (b) => b.step <= -2);
  }
  record('no restart while it ran', q.lines.filter((l) => /^rst:/.test(l.line)).length === 1 && !q.lines.some((l) => /Guru Meditation|abort\(\)|panic/i.test(l.line)),
    { boots: q.lines.filter((l) => /^rst:/.test(l.line)).map((l) => l.line) });
} catch (e) {
  failed.push(String(e.stack || e));
} finally {
  if (q) await q.kill();
  if (SHEET && rows.length) sheet(SHEET, rows);
  rmSync(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify({ steps, failed, tolerance: { mean_pct: MAX_MEAN, far_pixels: MAX_FAR }, seconds: t0 ? secs() : 0, sheet: SHEET }, null, 1));
process.exit(failed.length ? 1 : 0);
