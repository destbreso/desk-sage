// Does the emulator show on Sage's antenna what the board shows? Every instruction frame of a .bin is drawn by the
// emulator's board (Board.drawFrame, then Board.drawAntenna at one of the antenna's steps, taken in turn: the ball
// dark, the faint ring at five of its steps, the relink at three) and handed, as the reference picture, to
// tools/antenna_check.cpp, which draws the same frame and builds and draws the overlay with the firmware's own vec.h
// and antenna.h. The overlay's bytes must be the same, whether a frame marks its ball must agree, and the pictures
// must be within the bake's tolerance (MAX_MEAN, MAX_FAR), as vec_fidelity.mjs has it for frames.
//
//   node emulator/checks/antenna_fidelity.mjs [file.bin]        (default: firmware/data/sage.bin)

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Board } from '../board.mjs';
import { W, H } from '../vec.mjs';
import { frameTable, unpack } from '../packed.mjs';
import { inflate } from '../inflate-node.mjs';
import * as antenna from '../antenna.mjs';
import { MAX_MEAN, MAX_FAR } from './vec_fidelity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STEPS = [0, 1, 6, 12, 18, 24, -2, -7, -15];     // antennaStep(): dark; ring steps 0, 5, 11, 17, 23; relink 0, 5, 13

export function buildAntennaCheck() {
  const src = join(ROOT, 'tools', 'antenna_check.cpp'), dir = join(ROOT, 'firmware', 'src');
  const exe = join(tmpdir(), 'desk_sage_antenna_check');
  const deps = [src, join(dir, 'vec.h'), join(dir, 'antenna.h')];
  if (!existsSync(exe) || statSync(exe).mtimeMs < Math.max(...deps.map(f => statSync(f).mtimeMs)))
    execFileSync('clang++', ['-O2', '-std=c++17', '-I', dir, src, '-o', exe]);
  return exe;
}

const hex = (b, n) => n ? Buffer.from(b.subarray(0, n)).toString('hex') : '-';

export function compare(file, exe = buildAntennaCheck()) {
  const buf = new Uint8Array(readFileSync(file));
  const board = new Board({ inflate });
  if (!board.parseArt(buf, buf.length, 0)) throw new Error(`${file}: the emulator's parser refused it`);
  const T = frameTable(buf), frames = unpack(buf, inflate), rgba = new Uint8Array(W * H * 4), feed = [], js = [];
  const mine = new Uint8Array(antenna.MAX);
  let n = 0;
  for (let f = 0; f < frames.length; f++) {
    if (!frames[f] || frames[f].kind !== 2) continue;          // the antenna is only ever marked in instruction frames
    const { buf: b, p: at } = frames[f], len = b[at] | (b[at + 1] << 8), ops = b.subarray(at + 2, at + 2 + len);
    const step = STEPS[n++ % STEPS.length];
    board.drawFrame(0, f);
    const anchored = board.cv.anchored, cv = board.cv;
    const bytes = !anchored ? 0 : step >= 0 ? antenna.offline(mine, cv.anchorX, cv.anchorY, cv.anchorR, step - 1) : antenna.relink(mine, cv.anchorX, cv.anchorY, cv.anchorR, -2 - step);
    board.drawAntenna(step);
    for (let i = 0; i < W * H; i++) {                          // RGB565 widened the way antenna_check widens its own
      const v = board.fb[i];
      rgba[i * 4] = ((v >> 11) << 3) | (v >> 13); rgba[i * 4 + 1] = (((v >> 5) & 63) << 2) | ((v >> 9) & 3); rgba[i * 4 + 2] = ((v & 31) << 3) | ((v >> 2) & 7); rgba[i * 4 + 3] = 255;
    }
    const head = Buffer.alloc(8); head.writeUInt32LE(len); head.writeInt32LE(step, 4);
    feed.push(Buffer.from(head.subarray(0, 4)), Buffer.from(ops), Buffer.from(head.subarray(4)), Buffer.from(rgba));
    js.push({ frame: f, step, anchored, bytes: hex(mine, bytes), at: anchored ? [cv.anchorX / 16, cv.anchorY / 16, cv.anchorR / 16] : null });
  }
  const out = feed.length ? execFileSync(exe, { input: Buffer.concat(feed), maxBuffer: 1 << 28 }).toString().trim().split('\n') : [];
  const rows = out.map((line, i) => { const [mean, far, a, bytes] = line.split(' '); return { ...js[i], mean: +mean, far: +far, cAnchored: a === '1', cBytes: bytes }; });
  const marked = rows.filter(r => r.anchored);
  return {
    frames: rows.length, anchored: marked.length,
    anchoredDisagrees: rows.filter(r => r.anchored !== r.cAnchored).map(r => r.frame),
    bytesDisagree: rows.filter(r => r.bytes !== r.cBytes).map(r => r.frame),
    identical: marked.filter(r => r.mean === 0 && r.far === 0).length,
    worstMean: Math.max(0, ...marked.map(r => r.mean)), worstFar: Math.max(0, ...marked.map(r => r.far)),
    outside: rows.filter(r => r.mean > MAX_MEAN || r.far > MAX_FAR).map(r => r.frame),
    radius: marked.length ? [Math.min(...marked.map(r => r.at[2])), Math.max(...marked.map(r => r.at[2]))] : null,
    compressed: frames.filter((_, f) => T.kind(f) === 1).length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || join(ROOT, 'firmware', 'data', 'sage.bin');
  const r = compare(file);
  console.log(JSON.stringify({ file, ...r, tolerance: { mean_pct: MAX_MEAN, far_pixels: MAX_FAR } }, null, 1));
  process.exit(r.outside.length || r.anchoredDisagrees.length || r.bytesDisagree.length ? 1 : 0);
}
