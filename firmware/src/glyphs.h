// Glyph frames: a background colour and a list of glyphs, each a small coverage bitmap from the file's atlas
// blended in its own colour into a 240x240 RGB565 picture. tools/export_frames.py writes them (the layout is in
// its docstring) and keeps one only if tools/glyph_check.cpp, which builds this same file, reproduces the
// browser's picture. Plain C++ with no Arduino dependencies; define VEC_SWAPPED first to store pixels
// byte-swapped, as the display wants them.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace glyphs {

constexpr int W = 240, H = 240, MAX_GLYPHS = 256;      // a glyph names its bitmap in one byte

struct Atlas {
  const uint8_t* at = nullptr;     // u32 per glyph: where its record starts in rec
  const uint8_t* rec = nullptr;    // records: s8 left, s8 top, u8 width, u8 height, then rows of 4-bit coverage
  uint32_t size = 0;               // bytes of rec
  uint16_t n = 0;
};

inline uint16_t rd16(const uint8_t* p) { return uint16_t(p[0] | (p[1] << 8)); }
inline uint32_t rd32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (uint32_t(p[3]) << 24); }

// Reads the atlas at p and moves p past it. Every record must lie inside the atlas, so drawing never reads
// outside it; false if it does not fit before end.
inline bool parseAtlas(const uint8_t*& p, const uint8_t* end, Atlas& a) {
  if (end - p < 6) return false;
  uint16_t n = rd16(p); uint32_t size = rd32(p + 2);
  size_t room = size_t(end - p) - 6;
  if (n > MAX_GLYPHS || room < size_t(n) * 4 || room - size_t(n) * 4 < size) return false;
  const uint8_t* at = p + 6; const uint8_t* rec = at + n * 4;
  for (int i = 0; i < n; i++) {
    uint32_t o = rd32(at + 4 * i);
    if (o > size || size - o < 4) return false;
    const uint8_t* g = rec + o;
    if (size - o - 4 < uint32_t(g[3]) * ((g[2] + 1) / 2)) return false;
  }
  a.n = n; a.at = at; a.rec = rec; a.size = size;
  p = rec + size;
  return true;
}

#ifdef VEC_SWAPPED
inline uint16_t sw(uint16_t v) { return uint16_t((v >> 8) | (v << 8)); }
#else
inline uint16_t sw(uint16_t v) { return v; }
#endif

// A coverage of 0..15 as a weight out of 256 (round(c * 256 / 15)), so 15 is the glyph's colour exactly.
constexpr uint16_t K[16] = {0, 17, 34, 51, 68, 85, 102, 119, 137, 154, 171, 188, 205, 222, 239, 256};

// Draws one glyph frame (the bytes after its u16 length) into fb: the background, then each glyph in order,
// clipped to the screen. A glyph naming a bitmap the atlas does not have is skipped. Its colour already
// carries its alpha against black, so it is blended by coverage alone.
inline void draw(uint16_t* fb, const Atlas& a, const uint8_t* p, uint32_t len) {
  if (len < 2) return;
  const uint8_t* end = p + len;
  uint16_t bg = sw(rd16(p)); p += 2;
  for (int i = 0; i < W * H; i++) fb[i] = bg;
  for (; end - p >= 7; p += 7) {
    int x = int16_t(rd16(p)), y = int16_t(rd16(p + 2)), gi = p[4];
    uint16_t col = rd16(p + 5);
    if (gi >= a.n) continue;
    const uint8_t* g = a.rec + rd32(a.at + 4 * gi);
    int left = x + int8_t(g[0]), top = y + int8_t(g[1]), w = g[2], h = g[3], row = (w + 1) / 2;
    int x0 = left < 0 ? -left : 0, x1 = left + w > W ? W - left : w;
    int y0 = top < 0 ? -top : 0, y1 = top + h > H ? H - top : h;
    if (x0 >= x1 || y0 >= y1) continue;
    int cr = (col >> 11) << 3 | (col >> 13), cg = ((col >> 5) & 63) << 2 | ((col >> 9) & 3), cb = (col & 31) << 3 | ((col >> 2) & 7);
    uint16_t full = sw(col);
    for (int yy = y0; yy < y1; yy++) {
      const uint8_t* bits = g + 4 + yy * row;
      uint16_t* out = fb + (top + yy) * W + left;
      for (int xx = x0; xx < x1; xx++) {
        int c = (bits[xx >> 1] >> (xx & 1 ? 0 : 4)) & 15;      // the left pixel of a byte is its high nibble
        if (!c) continue;
        if (c == 15) { out[xx] = full; continue; }
        uint16_t v = sw(out[xx]);
        int r = (v >> 11) << 3 | (v >> 13), gr = ((v >> 5) & 63) << 2 | ((v >> 9) & 3), b = (v & 31) << 3 | ((v >> 2) & 7), k = K[c];
        r += ((cr - r) * k) >> 8; gr += ((cg - gr) * k) >> 8; b += ((cb - b) * k) >> 8;
        out[xx] = sw(uint16_t(((r & 0xF8) << 8) | ((gr & 0xFC) << 3) | (b >> 3)));
      }
    }
  }
}

}  // namespace glyphs
