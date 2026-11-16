// Glyph frames (version 6): the atlas and the frames parsed, every damage refused cleanly, known pixels drawn,
// a clip carrying its own atlas, and the emulator's drawing against the firmware's own glyphs.h
// (tools/glyph_check.cpp, built with clang++; skipped without it).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Board, EVENT } from '../board.mjs';
import { encode, solid, solidOps } from './fixture.mjs';
import { compare } from '../checks/glyph_fidelity.mjs';
import { frameTable } from '../checks/vec_fidelity.mjs';

const TESTCARD = new Uint8Array(readFileSync(new URL('../testcard/testcard.bin', import.meta.url)));
const RED = 0xF800, BLUE = 0x001F;
// a 3 by 2 bitmap whose corner is 1 left and 2 up from where it is drawn
const GLYPH = { left: -1, top: -2, w: 3, h: 2, cov: [15, 8, 0, 1, 15, 7] };
const at = (b, x, y) => b.fb[y * 240 + x];

function v6(frames, atlas = [GLYPH], moods = [['idle', 0]]) {
  return encode({ version: 6, moods, seqs: [[0, 0, 0, 'idle', frames.map((_, i) => i)]], frames, atlas });
}
function drawn(file, frame = 0) {
  const b = new Board();
  assert.equal(b.setup(file), true);
  b.drawFrame(0, frame);
  return b;
}

describe('version 6', () => {
  const mixed = () => v6([solid(BLUE), solidOps(255, 0, 0), { glyphs: [BLUE, [[10, 20, 0, RED]]] }]);

  test('the atlas and every kind of frame parse', () => {
    const b = new Board(), f = mixed();
    assert.equal(b.parseArt(f, f.length, 0), true);
    assert.equal(b.A.nFrames, 3);
    assert.equal(b.A.srcs[0].atlas.n, 1);
  });

  test('every truncation fails cleanly, never throws', () => {
    const full = mixed();
    for (let n = 0; n < full.length; n++) assert.equal(new Board().parseArt(full.subarray(0, n), n, 0), false, `cut at ${n}`);
  });

  test('a damaged atlas, an unknown kind, a glyph frame in an older version or too short for its background is refused', () => {
    const bad = (f, why) => assert.equal(new Board().parseArt(f, f.length, 0), false, why);
    const damaged = (f, change) => { const c = f.slice(); change(c, frameTable(c)); return c; };
    // the atlas: u16 count, u32 size, u32 where each record starts, then the records (left, top, width, height, bits)
    bad(damaged(mixed(), (f, T) => { f[T.atlas + 10 + 2] = 9; }), 'a record wider than its bits');
    bad(damaged(mixed(), (f, T) => { f[T.atlas + 6] = 200; }), 'a record starting past the atlas');
    bad(damaged(mixed(), (f, T) => { f[T.atlas] = 1; f[T.atlas + 1] = 1; }), 'more than 256 glyphs');
    bad(damaged(mixed(), (f, T) => { f[T.offsets + 4 * 2 + 3] = (f[T.offsets + 4 * 2 + 3] & 0x3F) | 0x40; }), 'a frame of kind 01');
    const old = encode({ version: 5, moods: [['idle', 0]], seqs: [[0, 0, 0, 'idle', [0]]], frames: [{ ops: [1, 1] }] });
    assert.equal(new Board().parseArt(old, old.length, 0), true);
    bad(damaged(old, (f, T) => { f[T.offsets + 3] |= 0xC0; }), 'a glyph frame in version 5');
    bad(damaged(v6([{ ops: [1] }]), (f, T) => { f[T.offsets + 3] |= 0xC0; }), 'a glyph frame of one byte');
  });
});

describe('a glyph frame', () => {
  test('draws its background, then each glyph by its coverage', () => {
    const b = drawn(v6([{ glyphs: [BLUE, [[10, 20, 0, RED]]] }]));
    assert.equal(at(b, 0, 0), BLUE);
    assert.equal(at(b, 9, 18), RED);            // coverage 15: the colour itself
    assert.equal(at(b, 10, 18), 0x880E);        // 8: red 255*137/256 = 136, blue 255 - 137 = 118
    assert.equal(at(b, 11, 18), BLUE);          // 0: untouched
    assert.equal(at(b, 9, 19), 0x101D);         // 1: red 16, blue 238
    assert.equal(at(b, 11, 19), 0x7011);        // 7: red 118, blue 136
    assert.equal(at(b, 12, 18), BLUE);
  });

  test('is clipped to the screen at every edge', () => {
    const b = drawn(v6([{ glyphs: [BLUE, [[0, 1, 0, RED], [240, 241, 0, RED], [-5, 100, 0, RED], [100, 500, 0, RED]]] }]));
    assert.equal(at(b, 0, 0), RED);             // the bitmap's second row, second column
    assert.equal(at(b, 1, 0), 0x7011);
    assert.equal(at(b, 239, 239), RED);         // its first row, first column
    assert.equal(at(b, 238, 239), BLUE);
    assert.equal(b.fb.filter(v => v !== BLUE).length, 3);
  });

  test('draws in order, skips a glyph the atlas does not have, and uses no colour but its own', () => {
    const b = drawn(v6([{ glyphs: [0, [[10, 20, 0, RED], [10, 20, 5, BLUE], [11, 20, 0, BLUE]]] }]));
    assert.equal(at(b, 9, 18), RED);
    assert.equal(at(b, 10, 18), BLUE);          // the third glyph over the first
    b.goalR = b.tintR = 0; b.drawFrame(0, 0);   // a body colour changes nothing here
    assert.equal(at(b, 9, 18), RED);
  });

  test('a clip brings its own atlas', () => {
    const b = new Board({ millis: () => 0 });
    assert.equal(b.setup(TESTCARD), true);
    const wide = { left: 0, top: 0, w: 2, h: 1, cov: [15, 15] };
    const clip = encode({ version: 6, moods: [['idle', 0]], seqs: [[EVENT, 0, 0, 'rain', [0]]], frames: [{ glyphs: [0, [[50, 60, 0, RED]]] }], atlas: [wide] });
    assert.deepEqual(b.postClip(clip, 'rain'), { status: 200, body: 'ok' });
    const si = b.clips()[0].slot;
    assert.equal(b.A.srcs[0].atlas.n, 0);
    b.drawFrame(si, 0);
    assert.equal(at(b, 50, 60), RED);
    assert.equal(at(b, 51, 60), RED);
    assert.equal(at(b, 52, 60), 0);
  });
});

const clang = spawnSync('clang++', ['--version']).status === 0;
test('drawn as glyphs.h draws it', { skip: !clang && 'clang++ is not installed' }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'desk-glyphs-')), file = join(dir, 'g.bin');
  try {
    const atlas = [GLYPH, { left: -3, top: -4, w: 7, h: 9, cov: Array.from({ length: 63 }, (_, i) => (i * 7) % 16) }];
    const list = [];
    for (let i = 0; i < 300; i++) list.push([(i * 37) % 250 - 5, (i * 53) % 250 - 5, i % 2, (i * 2654435761) & 0xFFFF]);
    writeFileSync(file, v6([{ glyphs: [0x2104, list] }, { glyphs: [0, list.slice(0, 40)] }], atlas));
    const r = compare(file);
    t.diagnostic(JSON.stringify(r));
    assert.equal(r.frames, 2);
    assert.equal(r.firmware.identical, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
