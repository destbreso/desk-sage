// Does the emulator draw what the board draws? Every instruction frame of a .bin is drawn by the
// emulator's renderer (vec.mjs) and handed, as the reference picture, to tools/vec_check.cpp, which
// draws the same instructions with the firmware's own vec.h (built with clang++ as the bake builds it)
// and says how far apart the two are. The tolerance is the bake's: tools/export_frames.py MAX_MEAN, MAX_FAR.
// A compressed frame is inflated first as the emulator inflates it (packed.mjs, with Node's zlib).
//
//   node emulator/checks/vec_fidelity.mjs [file.bin]        (default: emulator/testcard/testcard.bin)

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, W, H } from '../vec.mjs';
import { frameTable, unpack } from '../packed.mjs';
import { inflate } from '../inflate-node.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MAX_MEAN = 2.0, MAX_FAR = 300;

export function buildVecCheck() {
  const src = join(ROOT, 'tools', 'vec_check.cpp'), hdr = join(ROOT, 'firmware', 'src', 'vec.h');
  const exe = join(tmpdir(), 'desk_sage_vec_check');
  if (!existsSync(exe) || statSync(exe).mtimeMs < Math.max(statSync(src).mtimeMs, statSync(hdr).mtimeMs))
    execFileSync('clang++', ['-O2', '-std=c++17', '-I', dirname(hdr), src, '-o', exe]);
  return exe;
}

export { frameTable };

export function compare(file, exe = buildVecCheck()) {
  const buf = new Uint8Array(readFileSync(file));
  if (String.fromCharCode(...buf.subarray(0, 4)) !== 'LUMP') throw new Error(`${file} is not a .bin or a clip`);
  const T = frameTable(buf), frames = unpack(buf, inflate), cv = new Canvas(), rgba = new Uint8Array(W * H * 4), feed = [], js = [];
  const refused = frames.flatMap((fr, f) => fr ? [] : [f]);
  for (let f = 0; f < frames.length; f++) {
    if (!frames[f] || frames[f].kind !== 2) continue;          // pixels or glyphs: not vec's (glyph_fidelity.mjs)
    const { buf: b, p: at } = frames[f], len = b[at] | (b[at + 1] << 8), ops = b.subarray(at + 2, at + 2 + len);
    cv.play(b, at + 2, len);                                   // the frame buffer carries over, as on the board and in vec_check
    for (let i = 0; i < W * H; i++) {                          // RGB565 widened the way vec_check widens its own
      const v = cv.fb[i];
      rgba[i * 4] = ((v >> 11) << 3) | (v >> 13); rgba[i * 4 + 1] = (((v >> 5) & 63) << 2) | ((v >> 9) & 3); rgba[i * 4 + 2] = ((v & 31) << 3) | ((v >> 2) & 7); rgba[i * 4 + 3] = 255;
    }
    const head = Buffer.alloc(4); head.writeUInt32LE(len);
    feed.push(head, Buffer.from(ops), Buffer.from(rgba));
    js.push({ frame: f, overflow: cv.overflow });
  }
  const out = feed.length ? execFileSync(exe, { input: Buffer.concat(feed), maxBuffer: 1 << 26 }).toString().trim().split('\n') : [];
  const rows = out.map((line, i) => { const [mean, far, ov] = line.split(' '); return { ...js[i], mean: +mean, far: +far, cOverflow: ov === '1' }; });
  return {
    frames: rows.length,
    identical: rows.filter(r => r.mean === 0 && r.far === 0).length,
    worstMean: Math.max(0, ...rows.map(r => r.mean)), worstFar: Math.max(0, ...rows.map(r => r.far)),
    overflowDisagrees: rows.filter(r => r.overflow !== r.cOverflow).length,
    outside: rows.filter(r => r.mean > MAX_MEAN || r.far > MAX_FAR).map(r => r.frame),
    compressed: frames.filter((_, f) => T.kind(f) === 1).length, refused,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || join(ROOT, 'emulator', 'testcard', 'testcard.bin');
  const r = compare(file);
  console.log(JSON.stringify({ file, ...r, tolerance: { mean_pct: MAX_MEAN, far_pixels: MAX_FAR } }, null, 1));
  process.exit(r.outside.length || r.overflowDisagrees || r.refused.length ? 1 : 0);
}
