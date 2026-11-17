// No bridge, on its antenna: the mark a frame carries (instruction 28), version 8's flags, the board's overlay over
// time (the ball dark and a ring every four seconds; back, the relink ring and then the hello), the corner mark kept
// for art that marks no antenna, and the emulator's overlay against firmware/src/antenna.h (skipped without clang++).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Board, HOST_TIMEOUT_MS } from '../board.mjs';
import { Canvas } from '../vec.mjs';
import { encode, solidOps } from './fixture.mjs';
import { inflate } from '../inflate-node.mjs';

const TESTCARD = new Uint8Array(readFileSync(new URL('../testcard/testcard.bin', import.meta.url)));
const q = v => { const n = Math.round(v * 16); return [n & 255, (n >> 8) & 255]; };
const WIPE = [20, 0, 0, 0, 255, 10, ...q(0), ...q(0), ...q(240), ...q(240)];
// a frame with a lit green ball at (x, y) and the mark the bake puts there
const marked = (x, y, r) => ({ ops: [...WIPE, 20, 160, 226, 153, 255, 1, 7, ...q(x), ...q(y), ...q(r), ...q(-2 * Math.PI * 4096 / 16), 0, 0, 0, 11, 28, ...q(x), ...q(y), ...q(r)] });
const BALL = [120, 60, 4];
function art({ version = 8, flags = 1, pack = false } = {}) {
  const moods = [['idle', 0], ['night', 1]], acts = ['glyph_form', 'glyph_dissolve', 'hello'];
  return encode({ version, flags, moods, frames: [{ ...marked(...BALL), pack }, solidOps(20, 20, 20)],
    seqs: [[0, 0, 0, 'idle', [0, 0]], [0, 1, 1, 'night', [0, 0]], [1, 0, 1, 'idle_to_night', [0]], [1, 1, 0, 'night_to_idle', [0]],
           ...acts.map(a => [2, 0, 0, a, Array(24).fill(0)]), [2, 0, 0, 'plain', Array(48).fill(1)]] });
}
function make(file = art()) {
  const clock = { t: 0 }, said = [];
  const b = new Board({ millis: () => clock.t, micros: () => clock.t * 1000, random: () => 0, say: l => said.push(l), inflate });
  b.setup(file);
  const run = (ms, step = 4) => { for (let i = 0; i < ms; i += step) { clock.t += step; b.loop(); } };
  const cmd = line => { b.receive(line + '\n'); run(4); };
  return { b, clock, said, run, cmd };
}
const rgb = v => [(v >> 11) << 3, ((v >> 5) & 63) << 2, (v & 31) << 3];
const at = (b, x, y) => rgb(b.fb[y * 240 + x]);
const until = (m, ok, ms = 70000) => { for (let t = 0; t < ms && !ok(m.b.state()); t += 4) m.run(4); assert.ok(ok(m.b.state()), 'timed out'); };

describe('the mark', () => {
  test('instruction 28 marks the ball in screen pixels and draws nothing; without it, or cut short, there is none', () => {
    const cv = new Canvas(), ops = Uint8Array.from([...WIPE, 28, ...q(120.5), ...q(-3), ...q(4.25)]);
    cv.play(ops, 0, ops.length);
    assert.deepEqual([cv.anchored, cv.anchorX, cv.anchorY, cv.anchorR], [true, 1928, -48, 68]);
    assert.ok(cv.fb.every(v => v === 0), 'it draws nothing');
    const plain = Uint8Array.from(WIPE);
    cv.play(plain, 0, plain.length);
    assert.equal(cv.anchored, false);
    for (let cut = 1; cut < 7; cut++) {
      cv.play(ops, 0, WIPE.length + cut);
      assert.equal(cv.anchored, false, `cut ${cut} bytes into it`); assert.equal(cv.overflow, true);
    }
  });

  test('version 8: its flags are read (older versions mark nothing), every truncation refused, a compressed frame marks its ball', () => {
    assert.equal(make(art()).b.A.anchors, true);
    assert.equal(make(art({ flags: 0 })).b.A.anchors, false);
    assert.equal(make(art({ version: 7 })).b.A.anchors, false);
    const full = art();
    for (let n = 0; n < full.length; n++) assert.equal(new Board().parseArt(full.subarray(0, n), n, 0), false, `cut at ${n}`);
    const m = make(art({ pack: true }));
    m.b.drawFrame(0, 0);
    assert.deepEqual([m.b.cv.anchored, m.b.cv.anchorX / 16, m.b.cv.anchorY / 16, m.b.cv.anchorR / 16], [true, ...BALL]);
    m.b.drawFrame(0, 1);
    assert.equal(m.b.cv.anchored, false);
  });
});

describe('the overlay', () => {
  test('no bridge: after 8 s its ball dark, and a faint ring going out for a second every four', () => {
    const m = make();
    m.run(7900); assert.equal(m.b.state().antenna, null);
    m.run(200);
    const seen = { dark: 0, ring: 0 };
    for (let i = 0; i < 8000; i += 20) { m.run(20); seen[m.b.state().antenna]++; }
    assert.ok(Math.abs(seen.ring / (seen.ring + seen.dark) - 0.25) < 0.02, JSON.stringify(seen));
    const c = at(m.b, 120, 60);                                // the lit green ball is grey now
    assert.ok(c[1] < 140 && Math.abs(c[0] - c[1]) < 24, String(c));
    until(m, s => s.antenna === 'ring' && m.b.lastAntenna === 13);   // step 12: the ring 15.7 px out, over the top
    const ring = at(m.b, 120, 44);
    assert.ok(ring[1] > 20 && ring[1] > ring[0], String(ring));
    assert.equal(m.b.overlayVisible(), false);
    assert.deepEqual(at(m.b, 205, 227), [0, 0, 0], 'no corner mark');
  });

  test('the bridge back: its ball lit with the relink ring at once, then the hello', () => {
    const m = make(); m.cmd('h 43200'); m.run(HOST_TIMEOUT_MS + 2000);
    until(m, s => s.playing === 'idle' && s.antenna === 'dark');
    m.cmd('h 43200');
    assert.equal(m.b.state().antenna, 'relink');
    assert.ok(at(m.b, 120, 56)[1] > 200, String(at(m.b, 120, 56)));   // the bright ring, 4.3 px out
    assert.equal(m.b.state().playing, 'hello');
    m.run(600);
    assert.equal(m.b.state().antenna, null);
    assert.ok(at(m.b, 120, 60)[1] > 200, 'the art\'s own lit ball');
  });

  test('art that marks no antenna keeps the corner mark; art that does never shows it, not even on a frame without a mark', () => {
    const card = make(TESTCARD); card.run(8200);
    assert.equal(card.b.overlayVisible(), true);
    assert.ok([...Array(40).keys()].some(i => at(card.b, 186 + i, 227).some(v => v > 0)), 'the unplugged cable');
    const m = make(); m.run(9000);
    until(m, s => s.playing === 'idle');
    m.b.playEvent('plain'); m.run(500);
    assert.equal(m.b.state().playing, 'plain');
    assert.equal(m.b.state().antenna, null);
    assert.equal(m.b.overlayVisible(), false);
    assert.deepEqual(at(m.b, 205, 227), [16, 20, 16]);           // the frame's grey (20, 20, 20) in RGB565
  });
});

const clang = spawnSync('clang++', ['--version']).status === 0;
test('the emulator\'s overlay is antenna.h\'s: the same bytes, the same pixels within the bake\'s tolerance', { skip: !clang && 'clang++ is not installed' }, async t => {
  const { compare, STEPS } = await import('../checks/antenna_fidelity.mjs');
  // a marked frame for every step the check takes, the ball anywhere (half off the screen too) and at any size
  const balls = [[120, 60, 4], [10, 200, 3.2], [236, 4, 6.6], [60, 120, 12], [120.4, 33.7, 3.9], [-2, 100, 4], [200, 238, 5], [0, 0, 2], [180, 90, 30]];
  const frames = [...balls, ...balls].map((b, i) => ({ ...marked(...b), pack: i % 2 === 0 }));
  const dir = mkdtempSync(join(tmpdir(), 'antenna-test-')), file = join(dir, 'marked.bin');
  writeFileSync(file, encode({ version: 8, flags: 1, moods: [['idle', 0]], seqs: [[0, 0, 0, 'idle', frames.map((_, i) => i)]], frames }));
  try {
    const r = compare(file);
    t.diagnostic(JSON.stringify(r));
    assert.equal(r.anchored, frames.length); assert.ok(frames.length >= STEPS.length);
    assert.deepEqual([r.anchoredDisagrees, r.bytesDisagree, r.outside], [[], [], []]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
