// What the board shows on Sage's antenna about the bridge (design/sage-draw.js, the pose's `offline` and `relink`):
// with no bridge its ball dark and a faint ring going out now and then, unanswered; with the bridge back a bright ring
// as the art's lit ball shows again. Drawn over a baked frame, at the ball the frame marks (vec.h's instruction 28), as
// instructions for vec.h: the same calls the reference makes, so its edges and its alpha are the art's own. Integer
// arithmetic only, so the emulator (emulator/antenna.mjs) builds the same bytes. Plain C++, built for the board and
// for the Mac (tools/antenna_check.cpp).
#pragma once
#include <stdint.h>

namespace antenna {

constexpr int FPS = 24;                              // its steps, as the art's ticks
constexpr int RING = 24, EVERY = 96, RELINK = 14;    // offline, a ring over a second every four; back, one over 0.58 s
constexpr int MAX = 160;                             // bytes an overlay takes, at most

struct Out {
  uint8_t* b; int n;
  void u8(int v) { b[n++] = uint8_t(v); }
  void s16(int32_t v) { v = v < -32768 ? -32768 : v > 32767 ? 32767 : v; b[n++] = uint8_t(v & 255); b[n++] = uint8_t((v >> 8) & 255); }
  void rgba(int r, int g, int bl, int a) { u8(r); u8(g); u8(bl); u8(a); }
  // arc(x, y, r) clockwise from a0 to a1, in 1/16 px and 1/4096 rad, as the bake encodes it
  void arc(int32_t x, int32_t y, int32_t r, int a0, int a1) { u8(7); s16(x); s16(y); s16(r); s16(a0); s16(a1); u8(0); }
};
constexpr int FULL0 = -25736, FULL1 = 0;             // a whole turn, as the bake stores arc(.., 0, 2 pi)
constexpr int UP0 = -10938, UP1 = -1930;             // the offline ring, from -0.85 pi to -0.15 pi (over the top)

// v * num / den, rounded, for v >= 0 (lengths in 1/16 px)
inline int32_t part(int32_t v, int32_t num, int32_t den) { return (v * num + den / 2) / den; }

// Sage3D.ball() (design/sage-3d.js) with the DEAD tones and its spot at 0.35: the ball at (x, y), radius r (1/16 px)
inline void deadBall(Out& o, int32_t x, int32_t y, int32_t r) {
  static const uint8_t TONE[4][3] = {{42, 45, 49}, {64, 67, 73}, {85, 90, 96}, {107, 112, 120}};
  static const int16_t STEP[3][3] = {{99, 121, 1380}, {198, 242, 1160}, {297, 363, 940}};   // up-left, up and radius, of r / 1600
  o.u8(1); o.arc(x, y, r, FULL0, FULL1); o.u8(20); o.rgba(TONE[0][0], TONE[0][1], TONE[0][2], 255); o.u8(11);
  o.u8(14); o.u8(1); o.arc(x, y, r, FULL0, FULL1); o.u8(13);
  for (int i = 0; i < 3; i++) {
    o.u8(1); o.arc(x - part(r, STEP[i][0], 1600), y - part(r, STEP[i][1], 1600), part(r, STEP[i][2], 1600), FULL0, FULL1);
    o.u8(20); o.rgba(TONE[i + 1][0], TONE[i + 1][1], TONE[i + 1][2], 255); o.u8(11);
  }
  o.u8(23); o.u8(89); o.u8(20); o.rgba(255, 255, 255, 255); o.u8(1);
  o.u8(8); o.s16(x - part(r, 279, 1000)); o.s16(y - part(r, 385, 1000)); o.s16(part(r, 260, 1000)); o.s16(part(r, 130, 1000));
  o.s16(-2809); o.s16(FULL0); o.s16(FULL1); o.u8(0);
  o.u8(11); o.u8(23); o.u8(255); o.u8(15);
}

// No bridge: the ball dark at (x, y), radius r (1/16 px), and the faint ring at its step k (0 .. RING-1; none if k < 0).
// The bytes written to buf (MAX at most).
inline int offline(uint8_t* buf, int32_t x, int32_t y, int32_t r, int k) {
  Out o{buf, 0};
  if (r <= 0) return 0;
  deadBall(o, x, y, r);
  if (k >= 0 && k < RING) {
    int lw = part(r, 3, 14);                         // 0.6 mm (r is 2.8 mm), at least a pixel
    o.u8(21); o.rgba(160, 226, 153, 255); o.u8(22); o.s16(lw < 16 ? 16 : lw); o.u8(23); o.u8(part(RING - k, 357, 96));
    o.u8(1); o.arc(x, y, part(r, 960 + 140 * k, 672), UP0, UP1); o.u8(12); o.u8(23); o.u8(255);   // 4 to 18 mm out
  }
  return o.n;
}

// The bridge back: the bright ring at its step k (0 .. RELINK-1) round the ball at (x, y), radius r (1/16 px), a wide
// faint stroke and a fine bright one. The bytes written to buf (MAX at most).
inline int relink(uint8_t* buf, int32_t x, int32_t y, int32_t r, int k) {
  Out o{buf, 0};
  if (r <= 0 || k < 0 || k >= RELINK) return 0;
  const int32_t lw[2] = {part(r, 15, 14), part(r, 3, 7)}, a[2] = {part(RELINK - k, 255, 56), part(RELINK - k, 459, 28)};   // 3 and 1.2 mm; 0.25 and 0.9
  for (int i = 0; i < 2; i++) {
    o.u8(21); o.rgba(232, 255, 228, 255); o.u8(22); o.s16(lw[i]); o.u8(23); o.u8(a[i]);
    o.u8(1); o.arc(x, y, part(r, 420 + 220 * k, 392), FULL0, FULL1); o.u8(12); o.u8(23); o.u8(255);   // 3 to 25 mm out
  }
  return o.n;
}

}  // namespace antenna
