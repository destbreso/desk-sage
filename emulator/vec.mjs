// A port of firmware/src/vec.h, the board's own renderer: the same coverage method, the same
// limits and the same RGB565 blending, so the emulator shows the board's pixels rather than the
// browser's. Every method mirrors the one of the same name in vec.h: change one, change both.
// Pixels are RGB565 in native order (vec.h without VEC_SWAPPED, as tools/vec_check.cpp builds it).

export const W = 240, H = 240, STRIDE = W + 2;
export const MAX_PTS = 1024, MAX_SUBS = 256, MAX_STATES = 12, MAX_CLIPS = 3, MAX_DASH = 8;
const TOL = Math.fround(0.15), PI_F = Math.fround(3.14159265), COV_MIN = Math.fround(0.004);   // vec.h's float constants

class State {
  constructor(o) {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;   // x' = a*x + c*y + e,  y' = b*x + d*y + f
    this.fill = [0, 0, 0, 255]; this.stroke = [0, 0, 0, 255];
    this.lineWidth = 1; this.dash = new Array(MAX_DASH).fill(0); this.dashOff = 0;
    this.alpha = 255; this.nDash = 0; this.clip = -1; this.ownClip = false;
    if (o) {                                                    // a copy, as C++ copies the struct on save
      Object.assign(this, o);
      this.fill = o.fill.slice(); this.stroke = o.stroke.slice(); this.dash = o.dash.slice();
    }
  }
}

export class Canvas {
  constructor() {
    this.fb = new Uint16Array(W * H);
    this.acc = new Float32Array(STRIDE * (H + 1));            // float in vec.h, kept zeroed between shapes
    this.clips = Array.from({ length: MAX_CLIPS }, () => new Uint8Array(W * H));
    this.recolour = null;                                      // called on every colour as it is set
    this.overflow = false;
    this.st = new State(); this.stack = []; this.sp = 0; this.clipTop = 0;
    this.pts = []; this.subs = []; this.nPts = 0; this.nSubs = 0;
    this.open = false; this.pending = false; this.pendingAt = { x: 0, y: 0 };
    this.minX = 0; this.maxX = 0; this.minY = 0; this.maxY = 0;
  }

  // ---- one frame: buf[start .. start+len) ----
  play(buf, start, len) {
    this.st = new State(); this.sp = 0; this.clipTop = 0; this.overflow = false; this.beginPath();
    let p = start;
    const end = start + len, st = () => this.st;
    const s16 = () => { const v = ((buf[p] | (buf[p + 1] << 8)) << 16) >> 16; p += 2; return v; };
    const u16 = () => { const v = buf[p] | (buf[p + 1] << 8); p += 2; return v; };
    const px = () => s16() / 16;
    const ang = () => s16() / 4096;
    const col = (into) => { for (let i = 0; i < 4; i++) into[i] = buf[p + i]; p += 4; if (this.recolour) this.recolour(into); };
    while (p < end) {
      switch (buf[p++]) {
        case 1: this.beginPath(); break;
        case 2: this.closePath(); break;
        case 3: { const x = px(), y = px(); this.moveTo(this.tx(x, y)); break; }
        case 4: { const x = px(), y = px(); this.lineTo(this.tx(x, y)); break; }
        case 5: { const x1 = px(), y1 = px(), x = px(), y = px(); this.quadTo(this.tx(x1, y1), this.tx(x, y)); break; }
        case 6: { const x1 = px(), y1 = px(), x2 = px(), y2 = px(), x = px(), y = px(); this.cubicTo(this.tx(x1, y1), this.tx(x2, y2), this.tx(x, y)); break; }
        case 7: { const x = px(), y = px(), r = px(), a0 = ang(), a1 = ang(); const ccw = !!buf[p++]; this.arc(x, y, r, r, 0, a0, a1, ccw); break; }
        case 8: { const x = px(), y = px(), rx = px(), ry = px(), rot = ang(), a0 = ang(), a1 = ang(); const ccw = !!buf[p++]; this.arc(x, y, rx, ry, rot, a0, a1, ccw); break; }
        case 9: { const x = px(), y = px(), w = px(), h = px(); this.rect(x, y, w, h); break; }
        case 10: { const x = px(), y = px(), w = px(), h = px(); this.fillRect(x, y, w, h); break; }
        case 11: this.fill(); break;
        case 12: this.stroke(); break;
        case 13: this.clip(); break;
        case 14: if (this.sp < MAX_STATES) { this.stack[this.sp++] = new State(this.st); this.st.ownClip = false; } else this.overflow = true; break;
        case 15: if (this.sp > 0) { this.st = this.stack[--this.sp]; this.clipTop = this.st.clip + 1; } break;
        case 16: { const s = st(), x = px(), y = px(); s.e += s.a * x + s.c * y; s.f += s.b * x + s.d * y; break; }
        case 17: { const s = st(), t = ang(), cs = Math.cos(t), sn = Math.sin(t), a = s.a, b = s.b;
                   s.a = a * cs + s.c * sn; s.b = b * cs + s.d * sn; s.c = s.c * cs - a * sn; s.d = s.d * cs - b * sn; break; }
        case 18: { const s = st(), sx = s16() / 256, sy = s16() / 256; s.a *= sx; s.b *= sx; s.c *= sy; s.d *= sy; break; }
        case 19: { const s = st(); s.a = s16() / 256; s.b = s16() / 256; s.c = s16() / 256; s.d = s16() / 256; s.e = px(); s.f = px(); break; }
        case 20: col(this.st.fill); break;
        case 21: col(this.st.stroke); break;
        case 22: this.st.lineWidth = u16() / 16; break;
        case 23: this.st.alpha = buf[p++]; break;
        case 24: { const s = st(), n = buf[p++]; s.nDash = 0; for (let i = 0; i < n; i++) { const v = u16() / 16; if (i < MAX_DASH) s.dash[s.nDash++] = v; } break; }
        case 25: { const x = px(), y = px(), w = px(), h = px(), r = px(); this.roundRect(x, y, w, h, r); break; }
        case 26: this.st.dashOff = px(); break;
        case 27: this.clip(true); break;
        default: this.overflow = true; return;                // unknown instruction: stop rather than misread the rest
      }
    }
  }

  tx(x, y) { const s = this.st; return { x: s.a * x + s.c * y + s.e, y: s.b * x + s.d * y + s.f }; }
  scale() { const s = this.st; return Math.sqrt(Math.abs(s.a * s.d - s.b * s.c)); }

  // ---- building the path (points are stored in screen space) ----
  beginPath() { this.nPts = this.nSubs = 0; this.open = this.pending = false; }
  newSub(p) {
    if (this.nSubs >= MAX_SUBS || this.nPts >= MAX_PTS) { this.open = false; this.overflow = true; return; }
    this.subs[this.nSubs++] = { start: this.nPts, n: 1, closed: false }; this.pts[this.nPts++] = p; this.open = true; this.pending = false;
  }
  push(p) { if (this.nPts < MAX_PTS) { this.pts[this.nPts++] = p; this.subs[this.nSubs - 1].n++; } else this.overflow = true; }
  moveTo(p) { this.newSub(p); }
  lineTo(p) {
    if (!this.open) { if (this.pending) this.newSub(this.pendingAt); else { this.newSub(p); return; } if (!this.open) return; }
    this.push(p);
  }
  cur() { return this.pts[this.nPts - 1]; }
  closePath() {
    if (!this.open || !this.nSubs) return;
    const s = this.subs[this.nSubs - 1]; s.closed = true; this.pendingAt = this.pts[s.start]; this.pending = true; this.open = false;
  }
  quadTo(c, p) {
    if (!this.open) this.lineTo(c);
    if (!this.open) return;
    const p0 = this.cur(), dx = p0.x - 2 * c.x + p.x, dy = p0.y - 2 * c.y + p.y;
    const n = Canvas.steps(Math.sqrt(Math.sqrt(dx * dx + dy * dy) / (4 * TOL)));
    for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; this.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p.y }); }
  }
  cubicTo(c1, c2, p) {
    if (!this.open) this.lineTo(c1);
    if (!this.open) return;
    const p0 = this.cur();
    const ax = p0.x - 2 * c1.x + c2.x, ay = p0.y - 2 * c1.y + c2.y, bx = c1.x - 2 * c2.x + p.x, by = c1.y - 2 * c2.y + p.y;
    const n = Canvas.steps(Math.sqrt(0.75 * Math.sqrt(Math.max(ax * ax + ay * ay, bx * bx + by * by)) / TOL));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      this.push({ x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p.x, y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p.y });
    }
  }
  static steps(n) { return n < 1 ? 1 : n > 40 ? 40 : Math.ceil(n); }
  arc(cx, cy, rx, ry, rot, a0, a1, ccw) {
    let sweep = a1 - a0;
    const two = 2 * PI_F;
    if (!ccw) { if (sweep >= two) sweep = two; else if (sweep < 0) sweep = (sweep % two) + two; }      // as the canvas has it
    else { if (sweep <= -two) sweep = -two; else if (sweep > 0) sweep = (sweep % two) - two; }
    const r = Math.max(rx, ry) * this.scale();
    let n = r <= TOL * 1.5 ? 3 : Math.ceil(Math.abs(sweep) / (2 * Math.acos(1 - TOL / r)));
    n = n < 2 ? 2 : n > 96 ? 96 : n;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const t = a0 + sweep * i / n, ux = rx * Math.cos(t), uy = ry * Math.sin(t);
      this.lineTo(this.tx(cx + ux * cr - uy * sr, cy + ux * sr + uy * cr));     // the first point joins on from wherever the path was
    }
  }
  rect(x, y, w, h) { this.moveTo(this.tx(x, y)); this.lineTo(this.tx(x + w, y)); this.lineTo(this.tx(x + w, y + h)); this.lineTo(this.tx(x, y + h)); this.closePath(); }
  roundRect(x, y, w, h, r) {
    r = Math.min(r, Math.min(Math.abs(w), Math.abs(h)) / 2);
    this.moveTo(this.tx(x + r, y)); this.arc(x + w - r, y + r, r, r, 0, -PI_F / 2, 0, false); this.arc(x + w - r, y + h - r, r, r, 0, 0, PI_F / 2, false);
    this.arc(x + r, y + h - r, r, r, 0, PI_F / 2, PI_F, false); this.arc(x + r, y + r, r, r, 0, PI_F, 1.5 * PI_F, false); this.closePath();
  }

  // ---- coverage: every edge adds its signed area into acc; a running sum along each row then gives
  // how much of each pixel is inside ----
  resetBounds() { this.minX = STRIDE; this.maxX = -1; this.minY = H; this.maxY = -1; }
  edge(p0, p1) {
    if (!(p0.y === p0.y && p1.y === p1.y && p0.x === p0.x && p1.x === p1.x) || p0.y === p1.y) return;
    let dir = 1;
    if (p0.y > p1.y) { const t = p0; p0 = p1; p1 = t; dir = -1; }
    if (p1.y <= 0 || p0.y >= H) return;
    const acc = this.acc, dxdy = (p1.x - p0.x) / (p1.y - p0.y);
    let x = p0.x, y0 = 0;
    if (p0.y < 0) x -= p0.y * dxdy; else y0 = Math.trunc(p0.y);
    const y1 = p1.y >= H ? H : Math.trunc(Math.ceil(p1.y));
    if (y0 < this.minY) this.minY = y0;
    if (y1 - 1 > this.maxY) this.maxY = y1 - 1;
    for (let y = y0; y < y1; y++) {
      const row = y * STRIDE;
      const dy = Math.min(y + 1, p1.y) - Math.max(y, p0.y), xn = x + dxdy * dy, d = dy * dir;
      let xa = x < xn ? x : xn, xb = x < xn ? xn : x;
      xa = xa < 0 ? 0 : xa > W ? W : xa; xb = xb < 0 ? 0 : xb > W ? W : xb;
      const xaf = Math.floor(xa), ia = xaf, ib = Math.ceil(xb);
      if (ia < this.minX) this.minX = ia;
      if (ib <= ia + 1) {
        const m = 0.5 * (xa + xb) - xaf;
        acc[row + ia] += d - d * m; acc[row + ia + 1] += d * m;
        if (ia + 1 > this.maxX) this.maxX = ia + 1;
      } else {
        const s = 1 / (xb - xa), fa = xa - xaf, a0 = 0.5 * s * (1 - fa) * (1 - fa), fb1 = xb - ib + 1, am = 0.5 * s * fb1 * fb1;
        acc[row + ia] += d * a0;
        if (ib === ia + 2) acc[row + ia + 1] += d * (1 - a0 - am);
        else {
          const a1 = s * (1.5 - fa);
          acc[row + ia + 1] += d * (a1 - a0);
          for (let xi = ia + 2; xi < ib - 1; xi++) acc[row + xi] += d * s;
          acc[row + ib - 1] += d * (1 - (a1 + (ib - ia - 3) * s) - am);
        }
        acc[row + ib] += d * am;
        if (ib > this.maxX) this.maxX = ib;
      }
      x = xn;
    }
  }
  blend(i, c, a) {                                             // a: 0..255
    const fb = this.fb;
    if (a >= 255) { fb[i] = ((c[0] & 0xF8) << 8) | ((c[1] & 0xFC) << 3) | (c[2] >> 3); return; }
    const v = fb[i];
    let r = ((v >> 11) << 3) | (v >> 13), g = (((v >> 5) & 63) << 2) | ((v >> 9) & 3), b = ((v & 31) << 3) | ((v >> 2) & 7);
    const k = a + (a >> 7);
    r += ((c[0] - r) * k) >> 8; g += ((c[1] - g) * k) >> 8; b += ((c[2] - b) * k) >> 8;
    fb[i] = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
  }
  // Turn the accumulated edges into pixels of one colour (or into a clip mask, or with cut, out of one), and leave acc zeroed.
  paint(col, mask = null, maskIn = null, cut = false) {
    if (this.maxY < this.minY || this.maxX < 0) return;
    const acc = this.acc, st = this.st;
    const op = col ? Math.fround(col[3] * st.alpha / 255) : 255;
    const cm = (col && st.clip >= 0) ? this.clips[st.clip] : maskIn;
    for (let y = this.minY; y <= this.maxY; y++) {
      const row = y * STRIDE;
      let s = 0;
      for (let x = this.minX; x <= this.maxX; x++) {
        s = Math.fround(s + acc[row + x]); acc[row + x] = 0;
        if (x >= W) continue;
        const cov = Math.abs(s);
        if (cov < COV_MIN) continue;
        let a = Math.trunc(Math.fround(Math.fround((cov > 1 ? 1 : cov) * op) + 0.5));
        if (!col && !mask) continue;
        if (cut) { const at = y * W + x; mask[at] = Math.trunc(mask[at] * (255 - a) / 255); continue; }
        if (cm) a = Math.trunc(a * cm[y * W + x] / 255);
        if (!a) continue;
        if (mask) mask[y * W + x] = a; else this.blend(y * W + x, col, a);
      }
    }
  }
  outline() {                                                  // the path's own edges, each subpath closed
    for (let i = 0; i < this.nSubs; i++) {
      const s = this.subs[i];
      if (s.n < 2) continue;
      const P = this.pts, o = s.start;
      for (let k = 0; k + 1 < s.n; k++) this.edge(P[o + k], P[o + k + 1]);
      this.edge(P[o + s.n - 1], P[o]);
    }
  }
  fill() { this.resetBounds(); this.outline(); this.paint(this.st.fill); }
  fillRect(x, y, w, h) {
    const st = this.st, a = this.tx(x, y), b = this.tx(x + w, y), c = this.tx(x + w, y + h), d = this.tx(x, y + h);
    if (st.clip < 0 && st.alpha === 255 && st.fill[3] === 255 && st.b === 0 && st.c === 0 && a.x <= 0 && a.y <= 0 && c.x >= W && c.y >= H) {
      this.fb.fill(((st.fill[0] & 0xF8) << 8) | ((st.fill[1] & 0xFC) << 3) | (st.fill[2] >> 3));    // the background wipe
      return;
    }
    this.resetBounds(); this.edge(a, b); this.edge(b, c); this.edge(c, d); this.edge(d, a); this.paint(st.fill);
  }
  clip(outside = false) {                                      // outside: keep what is not in the path
    const st = this.st;
    this.resetBounds(); this.outline();
    if (outside && st.ownClip) { this.paint(null, this.clips[st.clip], null, true); return; }
    if (this.clipTop >= MAX_CLIPS || !this.clips[this.clipTop]) { this.overflow = true; this.paint(null, null); return; }
    const m = this.clips[this.clipTop], was = st.clip >= 0 ? this.clips[st.clip] : null;
    if (!outside) { m.fill(0); this.paint(null, m, was); }
    else { if (was) m.set(was); else m.fill(255); this.paint(null, m, null, true); }
    st.clip = this.clipTop++; st.ownClip = true;
  }

  // ---- strokes: every segment becomes a rectangle and every end or corner a disc, all wound the
  // same way so that where they overlap the coverage just saturates ----
  disc(c, hw) {
    const n = hw < 0.8 ? 6 : hw < 2.5 ? 10 : hw < 6 ? 16 : 24;
    let prev = { x: c.x + hw, y: c.y };
    for (let i = 1; i <= n; i++) { const t = -2 * PI_F * i / n, q = { x: c.x + hw * Math.cos(t), y: c.y + hw * Math.sin(t) }; this.edge(prev, q); prev = q; }
  }
  strokeLine(P, n, closed, hw) {
    if (n === 1) { this.disc(P[0], hw); return; }
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = P[i], p1 = P[(i + 1) % n], dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-4) continue;
      const nx = -dy / len * hw, ny = dx / len * hw;
      const A = { x: p0.x + nx, y: p0.y + ny }, B = { x: p1.x + nx, y: p1.y + ny }, C = { x: p1.x - nx, y: p1.y - ny }, D = { x: p0.x - nx, y: p0.y - ny };
      this.edge(A, B); this.edge(B, C); this.edge(C, D); this.edge(D, A);
    }
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {        // corners that turn enough to leave a notch
      const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y, lu = Math.sqrt(ux * ux + uy * uy), lv = Math.sqrt(vx * vx + vy * vy);
      if (lu < 1e-4 || lv < 1e-4 || (ux * vx + uy * vy) < 0.97 * lu * lv) this.disc(b, hw);
    }
    if (!closed) { this.disc(P[0], hw); this.disc(P[n - 1], hw); }
  }
  stroke() {
    const st = this.st, sc = this.scale(), hw = Math.max(0.5 * st.lineWidth * sc, 0.05);
    const tmp = [], piece = [];
    this.resetBounds();
    for (let i = 0; i < this.nSubs; i++) {
      const s = this.subs[i];
      let n = 0;
      for (let k = 0; k < s.n; k++) { const p = this.pts[s.start + k]; if (!n || Math.abs(p.x - tmp[n - 1].x) + Math.abs(p.y - tmp[n - 1].y) > 1e-3) tmp[n++] = p; }
      const closed = s.closed;
      if (closed && n > 1 && Math.abs(tmp[0].x - tmp[n - 1].x) + Math.abs(tmp[0].y - tmp[n - 1].y) <= 1e-3) n--;
      if (!st.nDash) { this.strokeLine(tmp, n, closed && n > 2, hw); continue; }
      // dashes: walk the line, switching on and off by the pattern
      const total = closed ? n : n - 1;
      let di = 0, m = 0, on = true, left = st.dash[0] * sc, skip = st.dashOff * sc;
      const next = () => { di++; on = !on; left = st.dash[di % st.nDash] * sc; if (left <= 0) left = 1e-3; };
      while (skip > 0) { if (skip >= left) { skip -= left; next(); } else { left -= skip; skip = 0; } }
      if (on) piece[m++] = tmp[0];
      for (let k = 0; k < total; k++) {
        const p0 = tmp[k], p1 = tmp[(k + 1) % n], dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.sqrt(dx * dx + dy * dy);
        let at = 0;
        while (len - at > left) {
          at += left;
          const q = { x: p0.x + dx * at / len, y: p0.y + dy * at / len };
          if (on) { piece[m++] = q; this.strokeLine(piece, m, false, hw); m = 0; } else piece[m++] = q;
          next(); if (!on) m = 0;
        }
        left -= len - at;
        if (on) piece[m++] = p1;
      }
      if (on && m > 0) this.strokeLine(piece, m, false, hw);
    }
    this.paint(st.stroke);
  }
}
