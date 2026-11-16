// The few LovyanGFX sprite calls the firmware draws its corner marks with (fillRect, fillRoundRect,
// fillCircle, fillTriangle), as plain integer fills on an RGB565 buffer clipped to the sprite.
// Coordinates are int32 in LovyanGFX, so the firmware's float arguments are truncated, as here.
// These are the classic midpoint and scanline fills; LovyanGFX's own may differ by a pixel at an edge.

const W = 240, H = 240;

export const color565 = (r, g, b) => (((r & 0xFF) & 0xF8) << 8) | (((g & 0xFF) & 0xFC) << 3) | ((b & 0xFF) >> 3);

export class Sprite {
  constructor(fb) { this.fb = fb; }

  hline(x, y, w, c) {
    if (y < 0 || y >= H || w <= 0) return;
    let x1 = x + w;
    if (x < 0) x = 0;
    if (x1 > W) x1 = W;
    for (let i = x; i < x1; i++) this.fb[y * W + i] = c;
  }
  vline(x, y, h, c) {
    if (x < 0 || x >= W || h <= 0) return;
    let y1 = y + h;
    if (y < 0) y = 0;
    if (y1 > H) y1 = H;
    for (let j = y; j < y1; j++) this.fb[j * W + x] = c;
  }
  fillRect(x, y, w, h, c) {
    x = Math.trunc(x); y = Math.trunc(y); w = Math.trunc(w); h = Math.trunc(h);
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    for (let j = y; j < y + h; j++) this.hline(x, j, w, c);
  }
  // quarter-circle spans: corners 1 = right half, 2 = left half; delta stretches them vertically
  circleHelper(x0, y0, r, corners, delta, c) {
    let f = 1 - r, ddx = 1, ddy = -2 * r, x = 0, y = r, px = x, py = y;
    delta++;
    while (x < y) {
      if (f >= 0) { y--; ddy += 2; f += ddy; }
      x++; ddx += 2; f += ddx;
      if (x < y + 1) {
        if (corners & 1) this.vline(x0 + x, y0 - y, 2 * y + delta, c);
        if (corners & 2) this.vline(x0 - x, y0 - y, 2 * y + delta, c);
      }
      if (y !== py) {
        if (corners & 1) this.vline(x0 + py, y0 - px, 2 * px + delta, c);
        if (corners & 2) this.vline(x0 - py, y0 - px, 2 * px + delta, c);
        py = y;
      }
      px = x;
    }
  }
  fillCircle(x, y, r, c) {
    x = Math.trunc(x); y = Math.trunc(y); r = Math.trunc(r);
    this.vline(x, y - r, 2 * r + 1, c);
    this.circleHelper(x, y, r, 3, 0, c);
  }
  fillRoundRect(x, y, w, h, r, c) {
    x = Math.trunc(x); y = Math.trunc(y); w = Math.trunc(w); h = Math.trunc(h); r = Math.trunc(r);
    r = Math.min(r, Math.trunc(Math.min(w, h) / 2));
    this.fillRect(x + r, y, w - 2 * r, h, c);
    this.circleHelper(x + w - r - 1, y + r, r, 1, h - 2 * r - 1, c);
    this.circleHelper(x + r, y + r, r, 2, h - 2 * r - 1, c);
  }
  fillTriangle(x0, y0, x1, y1, x2, y2, c) {
    [x0, y0, x1, y1, x2, y2] = [x0, y0, x1, y1, x2, y2].map(Math.trunc);
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }
    if (y1 > y2) { [y2, y1] = [y1, y2]; [x2, x1] = [x1, x2]; }
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }
    if (y0 === y2) {                                           // all on one row
      const a = Math.min(x0, x1, x2), b = Math.max(x0, x1, x2);
      this.hline(a, y0, b - a + 1, c);
      return;
    }
    const dx01 = x1 - x0, dy01 = y1 - y0, dx02 = x2 - x0, dy02 = y2 - y0, dx12 = x2 - x1, dy12 = y2 - y1;
    let sa = 0, sb = 0, y;
    const last = y1 === y2 ? y1 : y1 - 1;                      // include y1's row here only if the lower part is flat
    for (y = y0; y <= last; y++) {
      let a = x0 + Math.trunc(sa / dy01), b = x0 + Math.trunc(sb / dy02);
      sa += dx01; sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.hline(a, y, b - a + 1, c);
    }
    sa = dx12 * (y - y1); sb = dx02 * (y - y0);
    for (; y <= y2; y++) {
      let a = x1 + Math.trunc(sa / dy12), b = x0 + Math.trunc(sb / dy02);
      sa += dx12; sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.hline(a, y, b - a + 1, c);
    }
  }
}
