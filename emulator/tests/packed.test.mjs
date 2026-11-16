// Compressed frames (version 7): parsed, every truncation and damaged head refused when the file is read, damaged
// deflate refused when the frame is drawn (never a throw, never a wrong picture), the window's reuse of a base, a clip
// with its own bases, and the emulator's inflating against the firmware's own packed.h with the ROM's tinfl
// (tools/pack_check.cpp, built with clang++; skipped without it).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Board, EVENT } from '../board.mjs';
import { HEAD, WINDOW, frameTable, unpack, prepare, prepared } from '../packed.mjs';
import { inflate } from '../inflate-node.mjs';
import { encode, solid, solidOps } from './fixture.mjs';
import { compare, native } from '../checks/pack_fidelity.mjs';

const TESTCARD = new Uint8Array(readFileSync(new URL('../testcard/testcard.bin', import.meta.url)));
const RED = 0xF800, BLUE = 0x001F;
const GLYPH = { left: -1, top: -2, w: 3, h: 2, cov: [15, 8, 0, 1, 15, 7] };
const glyphs = n => ({ glyphs: [BLUE, Array.from({ length: n }, (_, i) => [(i * 37) % 240, (i * 53) % 240, 0, RED])] });
const ops = k => ({ ops: [20, 200, 100 + k, 50, 255, 10, 0, 0, 0, 0, 0, 15, 0, 15, 1, 3, 16, 1, 32, 1, 4, 64, 2, 16, 3, 11] });

// the same frames: pixels, instructions and glyphs, then two after an instruction frame as their base
const FRAMES = [solid(RED), ops(0), glyphs(40), ops(1), ops(2)];
const PACKED = [{ ...FRAMES[0], pack: true }, { ...FRAMES[1], pack: true }, { ...FRAMES[2], pack: true },
                { ...FRAMES[3], pack: true, base: 1 }, { ...FRAMES[4], pack: true, base: 1 }];
const file = (version, frames) => encode({ version, moods: [['idle', 0]], seqs: [[0, 0, 0, 'idle', frames.map((_, i) => i)]], frames, atlas: [GLYPH] });
const v7 = () => file(7, PACKED);

function board(art, said = []) {
  const b = new Board({ millis: () => 0, say: l => said.push(l), inflate });
  assert.equal(b.setup(art), true);
  return b;
}
const pictures = b => Array.from({ length: b.A.nFrames }, (_, f) => { b.drawFrame(0, f); return b.fb.slice(); });

describe('version 7', () => {
  test('every kind of frame, compressed on its own or after a base, draws as its uncompressed twin', () => {
    const plain = pictures(board(file(6, FRAMES))), packed = pictures(board(v7()));
    for (let f = 0; f < FRAMES.length; f++) assert.deepEqual(packed[f], plain[f], `frame ${f}`);
    const T = frameTable(v7());
    assert.deepEqual([...Array(5).keys()].map(T.kind), [1, 1, 1, 1, 1]);
  });

  test('every truncation is refused cleanly, never throws', () => {
    const full = v7();
    for (let n = 0; n < full.length; n++) assert.equal(new Board().parseArt(full.subarray(0, n), n, 0), false, `cut at ${n}`);
  });

  test('a damaged head is refused when the file is read', () => {
    const damaged = (change, why) => {
      const x = v7(), T = frameTable(x), dv = new DataView(x.buffer);
      change(x, dv, T);
      assert.equal(new Board().parseArt(x, x.length, 0), false, why);
    };
    const head = (x, T, f) => T.at(f);
    damaged((x, dv, T) => { x[head(x, T, 1)] = 1; }, 'a frame inflating to kind 1');
    damaged((x, dv, T) => { x[head(x, T, 1)] = 4; }, 'a frame inflating to kind 4');
    damaged((x, dv, T) => { dv.setUint32(head(x, T, 1) + 3, 1, true); }, 'an instruction frame of one byte');
    damaged((x, dv, T) => { dv.setUint32(head(x, T, 0) + 3, 2, true); }, 'a pixel frame of two bytes');
    damaged((x, dv, T) => { dv.setUint32(head(x, T, 2) + 3, 3, true); }, 'a glyph frame too short for its background');
    damaged((x, dv, T) => { dv.setUint32(head(x, T, 1) + 3, WINDOW + 1, true); }, 'a frame larger than the window');
    damaged((x, dv, T) => { dv.setUint32(head(x, T, 4) + 7, x.length, true); }, 'its deflate past the end');
    damaged((x, dv, T) => { dv.setUint16(head(x, T, 3) + 1, 9, true); }, 'a base past the last frame');
    damaged((x, dv, T) => { dv.setUint16(head(x, T, 3) + 1, 3, true); }, 'a frame as its own base');
    damaged((x, dv, T) => { dv.setUint16(head(x, T, 3) + 1, 4, true); }, 'a base with a base of its own');
    damaged((x, dv, T) => { dv.setUint32(head(x, T, 1) + 3, WINDOW - 10, true); }, 'a frame and its base past the window');
    const mixed = file(7, [FRAMES[1], { ...FRAMES[3], pack: true, base: 0 }]);
    assert.equal(new Board().parseArt(mixed, mixed.length, 0), false, 'a base stored as it is');
    const old = file(6, PACKED);
    assert.equal(new Board().parseArt(old, old.length, 0), false, 'a compressed frame in version 6');
  });

  test('damaged deflate or checksum: refused when drawn, said once, the picture left as it was; or drawn exactly', t => {
    const good = pictures(board(v7()));
    let refused = 0, drawn = 0;
    for (const f of [0, 1, 2, 3]) {
      const T = frameTable(v7()), h = T.at(f), len = new DataView(v7().buffer).getUint32(h + 7, true);
      for (let i = h + 11; i < h + HEAD + len; i++) {
        for (const flip of [0x01, 0x80, 0xFF]) {
          const x = v7(); x[i] ^= flip;
          const said = [], b = board(x, said);
          b.fb.fill(0x1234);
          assert.doesNotThrow(() => { b.drawFrame(0, f); b.drawFrame(0, f); });
          const lines = said.filter(l => l.startsWith('frame'));
          if (lines.length) {
            assert.deepEqual(lines, [`frame ${f} does not inflate`]);
            assert.ok(b.fb.every(v => v === 0x1234), 'nothing drawn');
            refused++;
          } else { assert.deepEqual(b.fb, good[f], `byte ${i - h} ^ ${flip} of frame ${f}`); drawn++; }
        }
      }
    }
    assert.ok(refused > 0);
    t.diagnostic(`damaged: ${refused} refused, ${drawn} drawn exactly as the frame`);
  });

  test('frames after a base: the base inflated once while they share it, a frame not inflated twice in a row', () => {
    const b = board(v7()), w = b.win;
    const count = f => { const n = w.inflates; b.drawFrame(0, f); return w.inflates - n; };
    assert.equal(count(3), 2);        // its base, then itself
    assert.equal(count(4), 1);        // the base is still at the window's start
    assert.equal(count(4), 0);        // the corner marks redraw it: nothing inflated
    assert.equal(count(1), 0);        // the base itself, already there
    assert.equal(count(3), 1);
    assert.equal(count(0), 1);        // another frame without a base takes the window's start
    assert.equal(count(4), 2);
  });

  test('a clip of compressed frames brings its own bases, and dropping a clip forgets the window', () => {
    const b = board(v7());
    const clipFile = encode({ version: 7, moods: [['idle', 0]], seqs: [[EVENT, 0, 0, 'rain', [0, 1]]], frames: [{ ...FRAMES[1], pack: true }, { ...FRAMES[4], pack: true, base: 0 }], atlas: [GLYPH] });
    assert.deepEqual(b.postClip(clipFile, 'rain'), { status: 200, body: 'ok' });
    const si = b.clips()[0].slot, alone = board(file(6, FRAMES));
    b.drawFrame(si, 1); alone.drawFrame(0, 4);
    assert.deepEqual(b.fb, alone.fb);
    assert.notEqual(b.win.first, null);
    b.dropClip(si);
    assert.equal(b.win.first, null);
  });

  test('the page inflates as the tests do (prepare(), DecompressionStream) on the test card', async () => {
    await prepare(TESTCARD);
    const a = unpack(TESTCARD, inflate), p = unpack(TESTCARD, prepared);
    assert.ok(a.filter(Boolean).length === a.length);
    for (let f = 0; f < a.length; f++) assert.deepEqual(p[f] && p[f].buf.subarray(p[f].p, p[f].end), a[f].buf.subarray(a[f].p, a[f].end), `frame ${f}`);
  });
});

const clang = spawnSync('clang++', ['--version']).status === 0;
describe('against the board', { skip: !clang && 'clang++ is not installed' }, () => {
  test('the test card and the fixture: the emulator and the page inflate every frame as packed.h with tinfl does', async t => {
    for (const buf of [TESTCARD, v7()]) {
      const r = await compare(buf);
      t.diagnostic(JSON.stringify(r));
      assert.ok(r.compressed > 0);
      assert.equal(r.refused, 0);
      assert.deepEqual(r.emulator.disagree, []);
      assert.deepEqual(r.page.disagree, []);
    }
  });

  test('every damaged byte of a deflate: the board and the emulator refuse the same frames, and what they keep is the frame', () => {
    const good = unpack(v7(), inflate);
    let agree = 0;
    for (const f of [0, 1, 2, 3]) {
      const T = frameTable(v7()), h = T.at(f), len = new DataView(v7().buffer).getUint32(h + 7, true);
      for (let i = h + 1; i < h + HEAD + len; i++) {
        const x = v7(); x[i] ^= 0x5A;
        const board = native(x), emu = unpack(x, inflate);
        for (const [g, bytes] of board) {
          const e = emu[g] && emu[g].buf.subarray(emu[g].p, emu[g].end);
          assert.equal(bytes === null, e === null, `frame ${g}, byte ${i - h} of frame ${f}: one refuses, the other does not`);
          if (bytes) assert.deepEqual(Buffer.from(bytes), Buffer.from(good[g].buf.subarray(good[g].p, good[g].end)));
          agree++;
        }
      }
    }
    assert.ok(agree > 0);
  });
});
