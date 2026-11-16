// A port of firmware/src/glyphs.h, the board's glyph frames: the same atlas checks and the same RGB565 blend,
// so the emulator shows the board's pixels. Each function mirrors the one of the same name there: change one,
// change both. Pixels are RGB565 in native order (glyphs.h without VEC_SWAPPED, as tools/glyph_check.cpp builds it).

export const W = 240, H = 240, MAX_GLYPHS = 256;

const rd16 = (b, p) => b[p] | (b[p + 1] << 8);
const rd32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

export function emptyAtlas() { return { buf: null, at: 0, rec: 0, size: 0, n: 0 }; }

// parseAtlas(): reads the atlas at p into a; every record must lie inside it. The position past it, or -1 if
// it does not fit before end.
export function parseAtlas(buf, p, end, a) {
  if (end - p < 6) return -1;
  const n = rd16(buf, p), size = rd32(buf, p + 2), room = end - p - 6;
  if (n > MAX_GLYPHS || room < n * 4 || room - n * 4 < size) return -1;
  const at = p + 6, rec = at + n * 4;
  for (let i = 0; i < n; i++) {
    const o = rd32(buf, at + 4 * i);
    if (o > size || size - o < 4) return -1;
    const g = rec + o;
    if (size - o - 4 < buf[g + 3] * ((buf[g + 2] + 1) >> 1)) return -1;
  }
  Object.assign(a, { buf, at, rec, size, n });
  return rec + size;
}

// A coverage of 0..15 as a weight out of 256 (round(c * 256 / 15)), so 15 is the glyph's colour exactly.
export const K = [0, 17, 34, 51, 68, 85, 102, 119, 137, 154, 171, 188, 205, 222, 239, 256];

// draw(): one glyph frame, buf[p .. p+len) (the bytes after its u16 length), into fb: the background, then each
// glyph in order, clipped to the screen; a glyph naming a bitmap the atlas does not have is skipped.
export function draw(fb, a, buf, p, len) {
  if (len < 2) return;
  const end = p + len, bg = rd16(buf, p), ab = a.buf;
  p += 2;
  fb.fill(bg);
  for (; end - p >= 7; p += 7) {
    const x = (rd16(buf, p) << 16) >> 16, y = (rd16(buf, p + 2) << 16) >> 16, gi = buf[p + 4], col = rd16(buf, p + 5);
    if (gi >= a.n) continue;
    const g = a.rec + rd32(ab, a.at + 4 * gi);
    const left = x + ((ab[g] << 24) >> 24), top = y + ((ab[g + 1] << 24) >> 24), w = ab[g + 2], h = ab[g + 3], row = (w + 1) >> 1;
    const x0 = left < 0 ? -left : 0, x1 = left + w > W ? W - left : w;
    const y0 = top < 0 ? -top : 0, y1 = top + h > H ? H - top : h;
    if (x0 >= x1 || y0 >= y1) continue;
    const cr = ((col >> 11) << 3) | (col >> 13), cg = (((col >> 5) & 63) << 2) | ((col >> 9) & 3), cb = ((col & 31) << 3) | ((col >> 2) & 7);
    for (let yy = y0; yy < y1; yy++) {
      const bits = g + 4 + yy * row, out = (top + yy) * W + left;
      for (let xx = x0; xx < x1; xx++) {
        const c = (ab[bits + (xx >> 1)] >> (xx & 1 ? 0 : 4)) & 15;        // the left pixel of a byte is its high nibble
        if (!c) continue;
        if (c === 15) { fb[out + xx] = col; continue; }
        const v = fb[out + xx], k = K[c];
        let r = ((v >> 11) << 3) | (v >> 13), gr = (((v >> 5) & 63) << 2) | ((v >> 9) & 3), b = ((v & 31) << 3) | ((v >> 2) & 7);
        r += ((cr - r) * k) >> 8; gr += ((cg - gr) * k) >> 8; b += ((cb - b) * k) >> 8;
        fb[out + xx] = ((r & 0xF8) << 8) | ((gr & 0xFC) << 3) | (b >> 3);
      }
    }
  }
}
