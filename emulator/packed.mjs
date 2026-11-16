// A port of firmware/src/packed.h, the board's compressed frames (version 7): the same checks of a record, the same
// window and the same choice of when to inflate, so the emulator inflates exactly what the board inflates, when it
// does. Each function mirrors the one of the same name there: change one, change both. The inflating itself is the
// caller's (the Board's `inflate` hook): Node's zlib in the tests and checks (inflate-node.mjs), and in the page the
// browser's DecompressionStream, ahead of time (prepare(), below).

export const HEAD = 15, NONE = 0xFFFF, WINDOW = 3 * 240 * 240, SLACK = 64;

const rd16 = (b, p) => b[p] | (b[p + 1] << 8);
const rd32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

export function head(b, p) { return { kind: b[p], base: rd16(b, p + 1), size: rd32(b, p + 3), len: rd32(b, p + 7), adler: rd32(b, p + 11) }; }

export function sane(h) {
  return ((h.kind === 0 && h.size >= 3) || (h.kind === 2 && h.size >= 2) || (h.kind === 3 && h.size >= 4)) && h.size <= WINDOW;
}

// check(): the compressed frame at `at` in a table's frame data (buf[data .. data + have)): its head sane, its deflate
// inside the data, its base (if any) a compressed frame of the same table with no base, the two within the window.
export function check(buf, offsets, data, have, nFrames, at) {
  if (at > have || have - at < HEAD) return false;
  const h = head(buf, data + at);
  if (!sane(h) || have - at - HEAD < h.len) return false;
  if (h.base === NONE) return true;
  if (h.base >= nFrames) return false;
  const o = rd32(buf, offsets + 4 * h.base), b = o & 0x3FFFFFFF;
  if (o >>> 30 !== 1 || b > have || have - b < HEAD) return false;
  const bh = head(buf, data + b);
  return bh.base === NONE && sane(bh) && bh.size <= WINDOW - h.size;
}

// What TINFL_FLAG_COMPUTE_ADLER32 gives tinfl_get_adler32() for the bytes a call wrote.
export function adler32(b) {
  let s1 = 1, s2 = 0;
  for (let i = 0; i < b.length;) {
    const end = Math.min(b.length, i + 5552);
    for (; i < end; i++) { s1 += b[i]; s2 += s1; }
    s1 %= 65521; s2 %= 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

// The window. Records are known by [file, offset], as the board knows them by address; forget() when a file goes.
export class Window {
  constructor(inflate) { this.buf = new Uint8Array(WINDOW + SLACK); this.inflate = inflate; this.inflates = 0; this.forget(); }
  forget() { this.first = this.last = this.bad = null; this.firstSize = this.lastAt = 0; }

  // open(): where in this.buf the frame whose record is at rec in file (its base's at base, or -1) starts once
  // inflated, or -1 if it does not inflate to exactly what its head says. Both records are check()ed.
  open(file, rec, base) {
    const is = (k, o) => k !== null && k[0] === file && k[1] === o;
    if (is(this.last, rec)) return this.lastAt;
    if (is(this.bad, rec)) return -1;
    if (base < 0 && is(this.first, rec)) { this.last = [file, rec]; this.lastAt = 0; return 0; }
    this.last = null;
    let at = 0;
    if (base >= 0) {
      if (!is(this.first, base)) {
        this.first = null;
        if (!this.#inflate(file, base, 0)) { this.bad = [file, rec]; return -1; }
        this.first = [file, base]; this.firstSize = head(file, base).size;
      }
      at = this.firstSize;
    }
    if (!this.#inflate(file, rec, at)) {
      if (base < 0) this.first = null;
      this.bad = [file, rec]; return -1;
    }
    if (base < 0) { this.first = [file, rec]; this.firstSize = head(file, rec).size; }
    this.last = [file, rec]; this.lastAt = at;
    return at;
  }

  #inflate(file, rec, at) {
    const h = head(file, rec);
    if (h.size > WINDOW - at) return false;
    this.inflates++;
    const out = this.inflate(file.subarray(rec + HEAD, rec + HEAD + h.len), this.buf.subarray(0, at), h.size);
    if (!out || out.length !== h.size || adler32(out) !== h.adler) return false;
    this.buf.set(out, at);
    const n = rd16(out, 0);
    return h.kind === 0 || (n + 2 === h.size && (h.kind === 2 || n >= 2));
  }
}

// Where the frames are, in a .bin or a clip (the layout in tools/export_frames.py): only the frame table and the glyph
// atlas matter here. kind(f) is the top two bits of a frame's offset (0 pixels, 1 compressed, 2 instructions, 3 glyphs),
// at(f) where its bytes start. Nothing is checked: that is the parser's.
export function frameTable(buf) {
  const version = rd16(buf, 4), nFrames = rd16(buf, 6), wide = version >= 5 ? 2 : 1;
  let p = 10;
  for (let m = buf[8]; m > 0; m--) p += 2 + buf[p + 1];
  let n = wide === 2 ? rd16(buf, p) : buf[p];
  for (p += wide; n > 0; n--) { p += 4 + buf[p + 3]; p += 2 + 2 * rd16(buf, p); }
  const atlas = p;
  if (version >= 6) p += 6 + 4 * rd16(buf, p) + rd32(buf, p + 2);
  const offsets = p, data = p + 4 * nFrames;
  return { version, nFrames, atlas, offsets, data, kind: f => rd32(buf, offsets + 4 * f) >>> 30, at: f => data + (rd32(buf, offsets + 4 * f) & 0x3FFFFFFF) };
}

// Every frame of a file as the board draws it, each compressed one inflated cold (the window forgotten first): per
// frame { kind, buf, p, end } with p at its bytes, or null for a compressed frame the board refuses.
export function unpack(file, inflate) {
  const T = frameTable(file), w = new Window(inflate), have = file.length - T.data, out = [];
  if (have < 0) throw new Error('the frame table runs past the end of the file');
  for (let f = 0; f < T.nFrames; f++) {
    const k = T.kind(f), at = T.at(f);
    if (k !== 1) { out.push({ kind: k, buf: file, p: at, end: file.length }); continue; }
    if (!check(file, T.offsets, T.data, have, T.nFrames, at - T.data)) { out.push(null); continue; }
    const h = head(file, at);
    w.forget();
    const q = w.open(file, at, h.base === NONE ? -1 : T.at(h.base));
    out.push(q < 0 ? null : { kind: h.kind, buf: w.buf.slice(q, q + h.size), p: 0, end: h.size });
  }
  return out;
}

// ---- the page: the browser inflates only asynchronously, so a file's compressed frames are inflated when it arrives ----

// A base's bytes as stored deflate blocks, none of them final: a stream after them reaches back into them, the same
// history a preset dictionary gives.
function stored(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 65535) {
    const n = Math.min(65535, bytes.length - i);
    out.push(Uint8Array.of(0, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255), bytes.subarray(i, i + n));
  }
  return out;
}
async function inflateAsync(stream, dictionary, size) {
  const skip = dictionary ? dictionary.length : 0, chunks = [];
  let n = 0;
  try {
    const r = new Blob(dictionary ? [...stored(dictionary), stream] : [stream]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      n += value.length;
      if (n > skip + size + 1) { r.cancel(); return null; }
      chunks.push(value);
    }
  } catch { return null; }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return all.subarray(skip);
}

const ready = new WeakMap();                    // a file's ArrayBuffer -> Map(where a deflate stream starts -> its bytes)

// prepare(file): inflate every compressed frame of a file, bases first, so prepared() can answer for it.
export async function prepare(file) {
  const map = new Map();
  ready.set(file.buffer, map);
  let T;
  try { T = frameTable(file); } catch { return; }
  if (T.data > file.length) return;
  const have = file.length - T.data, list = [];
  for (let f = 0; f < T.nFrames; f++) {
    if (T.kind(f) !== 1) continue;
    const at = T.at(f);
    if (check(file, T.offsets, T.data, have, T.nFrames, at - T.data)) list.push([at, head(file, at)]);
  }
  for (const pass of [false, true]) {
    for (const [at, h] of list) {
      if ((h.base !== NONE) !== pass) continue;
      const base = pass ? map.get(file.byteOffset + T.at(h.base) + HEAD) : null;
      if (pass && !base) continue;
      map.set(file.byteOffset + at + HEAD, await inflateAsync(file.subarray(at + HEAD, at + HEAD + h.len), base, h.size));
    }
  }
}

// The Board's inflate hook in the page: what prepare() found for this stream (the dictionary is the base it used).
export function prepared(stream) {
  const map = ready.get(stream.buffer);
  return (map && map.get(stream.byteOffset)) || null;
}
