// Do the emulator's glyph frames draw what the board draws, and what the browser drew? Every glyph frame of a .bin
// is drawn by the emulator's glyphs.mjs; that picture is handed, as the reference, to tools/glyph_check.cpp, which
// draws the same frame with the firmware's own glyphs.h (built with clang++ as the bake builds it); and, given the
// bake's references (tools/export_frames.py --refs), it is compared with the browser's own picture of that frame.
// The tolerance is the bake's: tools/export_frames.py MAX_MEAN, MAX_FAR.
//
//   node emulator/checks/glyph_fidelity.mjs file.bin [refs.bin]

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { W, H, emptyAtlas, parseAtlas, draw } from '../glyphs.mjs';
import { frameTable, MAX_MEAN, MAX_FAR } from './vec_fidelity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function buildGlyphCheck() {
  const src = join(ROOT, 'tools', 'glyph_check.cpp'), hdr = join(ROOT, 'firmware', 'src', 'glyphs.h');
  const exe = join(tmpdir(), 'desk_sage_glyph_check');
  if (!existsSync(exe) || statSync(exe).mtimeMs < Math.max(statSync(src).mtimeMs, statSync(hdr).mtimeMs))
    execFileSync('clang++', ['-O2', '-std=c++17', '-I', dirname(hdr), src, '-o', exe]);
  return exe;
}

// The references: [u32 frame index][u32 length][zlib of its RGBA], per glyph frame.
function readRefs(file) {
  const b = readFileSync(file), out = new Map();
  for (let p = 0; p < b.length;) { const i = b.readUInt32LE(p), n = b.readUInt32LE(p + 4); out.set(i, inflateSync(b.subarray(p + 8, p + 8 + n))); p += 8 + n; }
  return out;
}

// The same measure as glyph_check and vec_check: per pixel the largest channel difference after both are taken to
// RGB565 and widened back, as a mean in % of full scale, and the pixels more than a quarter of full scale apart.
export function difference(fb, rgba) {
  let sum = 0, far = 0;
  for (let i = 0; i < W * H; i++) {
    const v = fb[i], got = [((v >> 11) << 3) | (v >> 13), (((v >> 5) & 63) << 2) | ((v >> 9) & 3), ((v & 31) << 3) | ((v >> 2) & 7)];
    const want = [(rgba[i * 4] & 0xF8) | (rgba[i * 4] >> 5), (rgba[i * 4 + 1] & 0xFC) | (rgba[i * 4 + 1] >> 6), (rgba[i * 4 + 2] & 0xF8) | (rgba[i * 4 + 2] >> 5)];
    const d = Math.max(Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]), Math.abs(got[2] - want[2]));
    sum += d; far += d > 64;
  }
  return { mean: Math.round(sum / (W * H) / 2.55 * 1000) / 1000, far };
}

function widen(fb, rgba) {
  for (let i = 0; i < W * H; i++) {
    const v = fb[i];
    rgba[i * 4] = ((v >> 11) << 3) | (v >> 13); rgba[i * 4 + 1] = (((v >> 5) & 63) << 2) | ((v >> 9) & 3); rgba[i * 4 + 2] = ((v & 31) << 3) | ((v >> 2) & 7); rgba[i * 4 + 3] = 255;
  }
}

const summary = rows => ({
  frames: rows.length, identical: rows.filter(r => r.mean === 0 && r.far === 0).length,
  worstMean: Math.max(0, ...rows.map(r => r.mean)), worstFar: Math.max(0, ...rows.map(r => r.far)),
  outside: rows.filter(r => r.mean > MAX_MEAN || r.far > MAX_FAR).map(r => r.frame),
});

export function compare(file, refsFile = null, exe = buildGlyphCheck()) {
  const buf = new Uint8Array(readFileSync(file));
  if (String.fromCharCode(...buf.subarray(0, 4)) !== 'LUMP') throw new Error(`${file} is not a .bin or a clip`);
  const S = frameTable(buf), atlas = emptyAtlas();
  if (S.version < 6) return { frames: 0 };
  const atlasEnd = parseAtlas(buf, S.atlas, S.offsets, atlas);
  if (atlasEnd !== S.offsets) throw new Error('the atlas does not parse');
  const refs = refsFile ? readRefs(refsFile) : null, fb = new Uint16Array(W * H), rgba = new Uint8Array(W * H * 4);
  const head = Buffer.alloc(4); head.writeUInt32LE(S.offsets - S.atlas);
  const feed = [head, Buffer.from(buf.subarray(S.atlas, S.offsets))], order = [], browser = [];
  for (let f = 0; f < S.nFrames; f++) {
    if (S.kind(f) !== 3) continue;
    const at = S.at(f), len = buf[at] | (buf[at + 1] << 8);
    draw(fb, atlas, buf, at + 2, len);
    if (refs && refs.has(f)) browser.push({ frame: f, ...difference(fb, refs.get(f)) });
    widen(fb, rgba);
    const n = Buffer.alloc(4); n.writeUInt32LE(len);
    feed.push(n, Buffer.from(buf.subarray(at + 2, at + 2 + len)), Buffer.from(rgba));
    order.push(f);
  }
  const out = order.length ? execFileSync(exe, { input: Buffer.concat(feed), maxBuffer: 1 << 26 }).toString().trim().split('\n') : [];
  const firmware = out.map((line, i) => { const [mean, far] = line.split(' '); return { frame: order[i], mean: +mean, far: +far }; });
  const means = browser.map(r => r.mean).sort((a, b) => a - b);
  return {
    frames: order.length, atlasGlyphs: atlas.n,
    firmware: summary(firmware),
    browser: refs ? { ...summary(browser), medianMean: means.length ? means[means.length >> 1] : 0, missing: order.filter(f => !refs.has(f)).length } : null,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, refs] = process.argv.slice(2);
  if (!file) { console.error('usage: node emulator/checks/glyph_fidelity.mjs file.bin [refs.bin]'); process.exit(2); }
  const r = compare(file, refs);
  console.log(JSON.stringify({ file, ...r, tolerance: { mean_pct: MAX_MEAN, far_pixels: MAX_FAR } }, null, 1));
  const bad = r.frames && (r.firmware.identical !== r.frames || (r.browser && (r.browser.outside.length || r.browser.missing)));
  process.exit(bad ? 1 : 0);
}
