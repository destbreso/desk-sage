// A port of firmware/src/antenna.h, line for line: what the board shows on Sage's antenna about the bridge, as
// instructions for vec at the ball a frame marks. Integer arithmetic only, so it builds the board's bytes exactly
// (emulator/checks/antenna_fidelity.mjs compares them with antenna.h's). Change one, change both.

export const FPS = 24;                               // its steps, as the art's ticks
export const RING = 24, EVERY = 96, RELINK = 14;     // offline, a ring over a second every four; back, one over 0.58 s
export const MAX = 160;                              // bytes an overlay takes, at most

class Out {
  constructor(b) { this.b = b; this.n = 0; }
  u8(v) { this.b[this.n++] = v & 255; }
  s16(v) { v = v < -32768 ? -32768 : v > 32767 ? 32767 : v; this.b[this.n++] = v & 255; this.b[this.n++] = (v >> 8) & 255; }
  rgba(r, g, bl, a) { this.u8(r); this.u8(g); this.u8(bl); this.u8(a); }
  arc(x, y, r, a0, a1) { this.u8(7); this.s16(x); this.s16(y); this.s16(r); this.s16(a0); this.s16(a1); this.u8(0); }
}
const FULL0 = -25736, FULL1 = 0;                     // a whole turn, as the bake stores arc(.., 0, 2 pi)
const UP0 = -10938, UP1 = -1930;                     // the offline ring, from -0.85 pi to -0.15 pi (over the top)

// v * num / den, rounded, for v >= 0 (lengths in 1/16 px), as C++'s integer division
export const part = (v, num, den) => Math.trunc((v * num + Math.trunc(den / 2)) / den);

function deadBall(o, x, y, r) {
  const TONE = [[42, 45, 49], [64, 67, 73], [85, 90, 96], [107, 112, 120]];
  const STEP = [[99, 121, 1380], [198, 242, 1160], [297, 363, 940]];   // up-left, up and radius, of r / 1600
  o.u8(1); o.arc(x, y, r, FULL0, FULL1); o.u8(20); o.rgba(TONE[0][0], TONE[0][1], TONE[0][2], 255); o.u8(11);
  o.u8(14); o.u8(1); o.arc(x, y, r, FULL0, FULL1); o.u8(13);
  for (let i = 0; i < 3; i++) {
    o.u8(1); o.arc(x - part(r, STEP[i][0], 1600), y - part(r, STEP[i][1], 1600), part(r, STEP[i][2], 1600), FULL0, FULL1);
    o.u8(20); o.rgba(TONE[i + 1][0], TONE[i + 1][1], TONE[i + 1][2], 255); o.u8(11);
  }
  o.u8(23); o.u8(89); o.u8(20); o.rgba(255, 255, 255, 255); o.u8(1);
  o.u8(8); o.s16(x - part(r, 279, 1000)); o.s16(y - part(r, 385, 1000)); o.s16(part(r, 260, 1000)); o.s16(part(r, 130, 1000));
  o.s16(-2809); o.s16(FULL0); o.s16(FULL1); o.u8(0);
  o.u8(11); o.u8(23); o.u8(255); o.u8(15);
}

/** offline(): the ball dark at (x, y), radius r (1/16 px), and the faint ring at step k (none if k < 0). The bytes written. */
export function offline(buf, x, y, r, k) {
  const o = new Out(buf);
  if (r <= 0) return 0;
  deadBall(o, x, y, r);
  if (k >= 0 && k < RING) {
    const lw = part(r, 3, 14);                       // 0.6 mm (r is 2.8 mm), at least a pixel
    o.u8(21); o.rgba(160, 226, 153, 255); o.u8(22); o.s16(lw < 16 ? 16 : lw); o.u8(23); o.u8(part(RING - k, 357, 96));
    o.u8(1); o.arc(x, y, part(r, 960 + 140 * k, 672), UP0, UP1); o.u8(12); o.u8(23); o.u8(255);   // 4 to 18 mm out
  }
  return o.n;
}

/** relink(): the bright ring at step k round the ball at (x, y), radius r (1/16 px). The bytes written. */
export function relink(buf, x, y, r, k) {
  const o = new Out(buf);
  if (r <= 0 || k < 0 || k >= RELINK) return 0;
  const lw = [part(r, 15, 14), part(r, 3, 7)], a = [part(RELINK - k, 255, 56), part(RELINK - k, 459, 28)];   // 3 and 1.2 mm; 0.25 and 0.9
  for (let i = 0; i < 2; i++) {
    o.u8(21); o.rgba(232, 255, 228, 255); o.u8(22); o.s16(lw[i]); o.u8(23); o.u8(a[i]);
    o.u8(1); o.arc(x, y, part(r, 420 + 220 * k, 392), FULL0, FULL1); o.u8(12); o.u8(23); o.u8(255);   // 3 to 25 mm out
  }
  return o.n;
}
