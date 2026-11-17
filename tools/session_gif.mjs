// A day with Sage as one GIF, drawn as the board draws it: every frame of gallery/session.json's chain taken from the
// baked art (firmware/data/sage.bin) and drawn by the emulator's board, which is the firmware's code line for line,
// with the antenna the board draws over the frames once the bridge is gone and when it comes back. The bake's own
// GIFs are drawn by the browser and cannot show that, since only the board draws it.
//
//   node tools/session_gif.mjs [session.json] [sage.bin] [out.gif]
//   (defaults: gallery/session.json, firmware/data/sage.bin, gallery/session.gif; needs ffmpeg)

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Board } from '../emulator/board.mjs';
import { W, H } from '../emulator/vec.mjs';
import { inflate } from '../emulator/inflate-node.mjs';
import * as antenna from '../emulator/antenna.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [sessionFile = join(ROOT, 'gallery', 'session.json'), artFile = join(ROOT, 'firmware', 'data', 'sage.bin'), out = join(ROOT, 'gallery', 'session.gif')] = process.argv.slice(2);

const chain = JSON.parse(readFileSync(sessionFile, 'utf8')).session.chain;
const art = new Uint8Array(readFileSync(artFile));
const board = new Board({ inflate });
if (!board.parseArt(art, art.length, 0)) throw new Error(`${artFile}: the emulator's parser refused it`);
const A = board.A, seqOf = {};
for (let i = 0; i < A.nSeqs; i++) seqOf[A.name[i]] = i;
const frameAt = (i, k) => A.seqBuf[i][A.seq[i] + 2 * k] | (A.seqBuf[i][A.seq[i] + 2 * k + 1] << 8);

// the frames in order, each with the antenna's step the board would draw over it (antennaStep in board.mjs)
const ticks = [];
let gone = null, back = null;
for (const [key, most, , bridge] of chain) {
  const i = seqOf[key];
  if (i === undefined) throw new Error(`the art has no sequence ${key}`);
  if (bridge === 'gone') { gone = ticks.length; back = null; }
  if (bridge === 'back') { back = ticks.length; gone = null; }
  for (let k = 0; k < Math.min(A.len[i], most ?? Infinity); k++) {
    const t = ticks.length;
    let step = -1;
    if (gone !== null) { const k2 = (t - gone) % antenna.EVERY; step = k2 < antenna.RING ? 1 + k2 : 0; }
    else if (back !== null && t - back < antenna.RELINK) step = -2 - (t - back);
    ticks.push([frameAt(i, k), step]);
  }
}

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(A.fps), '-i', '-',
  '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=none', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const rgba = new Uint8Array(W * H * 4);
for (const [idx, step] of ticks) {
  board.drawFrame(0, idx);
  board.drawAntenna(step);
  for (let i = 0; i < W * H; i++) {                            // RGB565 widened as the fidelity checks widen it
    const v = board.fb[i];
    rgba[i * 4] = ((v >> 11) << 3) | (v >> 13); rgba[i * 4 + 1] = (((v >> 5) & 63) << 2) | ((v >> 9) & 3); rgba[i * 4 + 2] = ((v & 31) << 3) | ((v >> 2) & 7); rgba[i * 4 + 3] = 255;
  }
  if (!ff.stdin.write(Buffer.from(rgba))) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end();
const code = await new Promise((r) => ff.on('close', r));
console.log(JSON.stringify({ ticks: ticks.length, seconds: +(ticks.length / A.fps).toFixed(1), antenna: ticks.filter(([, s]) => s !== -1).length, out, ffmpeg: code }));
process.exit(code);
