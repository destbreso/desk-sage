// Small .bin files written by hand for the tests, in the layout tools/export_frames.py documents
// (version 5 unless asked): moods [[name, base]], sequences [[kind, from, to, name, [frame per tick]]],
// frames as {rle: [[count, rgb565], ...]} or {ops: [byte, ...]}.

export function encode({ version = 5, fps = 24, moods, seqs, frames }) {
  const out = [];
  const u8 = v => out.push(v & 255), u16 = v => out.push(v & 255, (v >> 8) & 255);
  const u32 = v => out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const str = s => { u8(s.length); for (const c of s) u8(c.charCodeAt(0)); };
  for (const c of 'LUMP') u8(c.charCodeAt(0));
  u16(version); u16(frames.length); u8(moods.length); u8(fps);
  for (const [name, base] of moods) { u8(base); str(name); }
  if (version >= 5) u16(seqs.length); else u8(seqs.length);
  for (const [kind, from, to, name, ticks] of seqs) { u8(kind); u8(from); u8(to); str(name); u16(ticks.length); ticks.forEach(u16); }
  const blobs = frames.map(f => {
    if (f.ops) return { vec: true, bytes: [f.ops.length & 255, f.ops.length >> 8, ...f.ops] };
    return { vec: false, bytes: f.rle.flatMap(([n, v]) => [n, v >> 8, v & 255]) };
  });
  let off = 0;
  for (const b of blobs) { u32((off | (b.vec ? 0x80000000 : 0)) >>> 0); off += b.bytes.length; }
  for (const b of blobs) out.push(...b.bytes);
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
