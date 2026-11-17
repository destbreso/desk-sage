// Small .bin files written by hand for the tests, in the layout tools/export_frames.py documents
// (version 5 and the magic SAGE unless asked; the board also reads LUMP, what the bake wrote before): moods [[name, base]], sequences [[kind, from, to, name, [frame per tick]]],
// frames as {rle: [[count, rgb565], ...]}, {ops: [byte, ...]} or, from version 6, {glyphs: [bg, [[x, y, atlas index, rgb565], ...]]};
// a version 6 file carries its atlas as [{left, top, w, h, cov: [0..15 a pixel, row by row]}]. From version 7 a frame
// with pack: true is stored compressed, and with base: i (another packed frame's index) after that frame's bytes.
// From version 8 the header carries `flags` (bit 0: its instruction frames mark the antenna's ball, instruction 28).

import { deflateRawSync } from 'node:zlib';
import { adler32 } from '../packed.mjs';

export function encode({ version = 5, fps = 24, moods, seqs, frames, atlas = [], magic = 'SAGE', flags = 0 }) {
  const out = [];
  const u8 = v => out.push(v & 255), u16 = v => out.push(v & 255, (v >> 8) & 255);
  const u32 = v => out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const str = s => { u8(s.length); for (const c of s) u8(c.charCodeAt(0)); };
  for (const c of magic) u8(c.charCodeAt(0));
  u16(version); u16(frames.length); u8(moods.length); u8(fps);
  if (version >= 8) u8(flags);
  for (const [name, base] of moods) { u8(base); str(name); }
  if (version >= 5) u16(seqs.length); else u8(seqs.length);
  for (const [kind, from, to, name, ticks] of seqs) { u8(kind); u8(from); u8(to); str(name); u16(ticks.length); ticks.forEach(u16); }
  if (version >= 6) {
    const rec = [], at = [];
    for (const g of atlas) {
      at.push(rec.length); rec.push(g.left & 255, g.top & 255, g.w, g.h);
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x += 2) rec.push((g.cov[y * g.w + x] << 4) | (x + 1 < g.w ? g.cov[y * g.w + x + 1] : 0));
    }
    u16(atlas.length); u32(rec.length); at.forEach(u32); out.push(...rec);
  }
  const blobs = frames.map(f => {
    const sized = body => ({ body: [body.length & 255, body.length >> 8, ...body] });
    if (f.ops) return { kind: 2, ...sized(f.ops) };
    if (f.glyphs) {
      const [bg, list] = f.glyphs, body = [bg & 255, bg >> 8];
      for (const [x, y, i, c] of list) body.push(x & 255, (x >> 8) & 255, y & 255, (y >> 8) & 255, i, c & 255, c >> 8);
      return { kind: 3, ...sized(body) };
    }
    return { kind: 0, body: f.rle.flatMap(([n, v]) => [n, v >> 8, v & 255]) };
  });
  frames.forEach((f, i) => {
    if (!f.pack) return;
    const b = blobs[i], raw = Uint8Array.from(b.body), base = f.base ?? 0xFFFF;
    const z = deflateRawSync(raw, { level: 9, ...(f.base !== undefined ? { dictionary: Uint8Array.from(blobs[f.base].raw || blobs[f.base].body) } : {}) });
    const n = raw.length, a = adler32(raw), m = z.length;
    b.raw = b.body;
    b.body = [b.kind, base & 255, base >> 8, n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24, m & 255, (m >>> 8) & 255, (m >>> 16) & 255, m >>> 24,
              a & 255, (a >>> 8) & 255, (a >>> 16) & 255, a >>> 24, ...z];
    b.kind = 1;
  });
  let off = 0;
  for (const b of blobs) { u32((off | (b.kind << 30)) >>> 0); off += b.body.length; }
  for (const b of blobs) out.push(...b.body);
  return new Uint8Array(out);
}

// A whole-screen frame of one colour, as pixels: 57600 px in runs of 255 (and the rest).
export function solid(rgb565) {
  const runs = [];
  for (let left = 240 * 240; left > 0; left -= 255) runs.push([Math.min(255, left), rgb565]);
  return { rle: runs };
}

// The same as instructions: fillStyle, then a fillRect over the whole screen (the background wipe).
export function solidOps(r, g, b) {
  const q = v => [(v * 16) & 255, ((v * 16) >> 8) & 255];
  return { ops: [20, r, g, b, 255, 10, ...q(0), ...q(0), ...q(240), ...q(240)] };
}

// A clip: only events, its moods named as the board's (the board matches them by name).
export function clip(name, home = 'idle', ticks = 4, moods = [['idle', 0]]) {
  const m = moods.findIndex(([n]) => n === home);
  return encode({ moods, seqs: [[2, m, m, name, Array(ticks).fill(0)]], frames: [solidOps(40, 40, 40)] });
}

// An art shaped as Sage's: every act starts from idle, among them the rain's hand-over (glyph_form, glyph_dissolve),
// a hello, taps (tap_dizzy among them, which the board never picks for a tap) and fidgets; each act a second long.
export function sageLike({ acts = ['glyph_form', 'glyph_dissolve', 'hello', 'tap_hello', 'tap_knock', 'tap_dizzy', 'fidget_look', 'fidget_turn', 'fidget_mark'], magic } = {}) {
  const moods = [['idle', 0], ['working', 1], ['alert', 2], ['night', 3]];
  const loops = moods.map(([n], i) => [0, i, i, n, [0, 0]]);
  const trans = [1, 2, 3].flatMap(i => [[1, 0, i, `idle_to_${moods[i][0]}`, Array(12).fill(0)], [1, i, 0, `${moods[i][0]}_to_idle`, Array(12).fill(0)]]);
  return encode({ moods, seqs: [...loops, ...trans, ...acts.map(a => [2, 0, 0, a, Array(24).fill(0)])], frames: [solidOps(30, 30, 30)], ...(magic ? { magic } : {}) });
}
