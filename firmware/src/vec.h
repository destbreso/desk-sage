// A small canvas-style renderer: paths, fills, round strokes, dashes, clipping and alpha, drawn
// with smooth edges into a 240x240 RGB565 picture. It plays the instruction lists that
// tools/export_frames.py records from design/sage.html (the format is in that file's encode()).
// Plain C++ with no Arduino dependencies, so the same file builds for the board and for the Mac
// (tools/vec_check.cpp, which the exporter uses to check every frame against the browser's picture).
// Define VEC_SWAPPED before including it to store pixels byte-swapped, as the display wants them.
#pragma once
#include <math.h>
#include <stdint.h>
#include <string.h>

namespace vec {

constexpr int W = 240, H = 240, STRIDE = W + 2;
constexpr int MAX_PTS = 1024, MAX_SUBS = 256, MAX_STATES = 12, MAX_CLIPS = 3, MAX_DASH = 8;
constexpr float TOL = 0.15f, PI_F = 3.14159265f;     // TOL: how far a flattened curve may stray, in pixels

struct Pt { float x, y; };
struct Sub { uint16_t start, n; bool closed; };
struct State {
  float a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;     // x' = a*x + c*y + e,  y' = b*x + d*y + f
  uint8_t fill[4] = {0, 0, 0, 255}, stroke[4] = {0, 0, 0, 255};
  float lineWidth = 1, dash[MAX_DASH], dashOff = 0;
  uint8_t alpha = 255, nDash = 0;
  int8_t clip = -1;
  bool ownClip = false;                // the clip mask was made since the last save, so it can be cut into in place
};

struct Canvas {
  uint16_t* fb = nullptr;              // W*H pixels, RGB565 in native byte order
  float* acc = nullptr;                // STRIDE*(H+1) cells of signed coverage, kept zeroed between shapes
  uint8_t* clips[MAX_CLIPS] = {};      // W*H each
  void (*recolour)(uint8_t* rgba) = nullptr;   // called on every colour as it is set (the board swaps in his body colour)
  bool overflow = false;               // the last frame needed more points, saves or clips than there is room for
  bool anchored = false;               // the last frame marked where the antenna's ball is (instruction 28), at
  int16_t anchorX = 0, anchorY = 0, anchorR = 0;   // these, in 1/16 px of the screen (not through the transform)

  // ---- one frame ----
  void play(const uint8_t* p, uint32_t len) {
    st = State(); sp = 0; clipTop = 0; overflow = false; anchored = false; beginPath();
    const uint8_t* end = p + len;
    auto s16 = [&]() { int16_t v = int16_t(p[0] | (p[1] << 8)); p += 2; return v; };
    auto u16 = [&]() { uint16_t v = uint16_t(p[0] | (p[1] << 8)); p += 2; return v; };
    auto px = [&]() { return s16() / 16.f; };
    auto ang = [&]() { return s16() / 4096.f; };
    while (p < end) {
      switch (*p++) {
        case 1: beginPath(); break;
        case 2: closePath(); break;
        case 3: { float x = px(), y = px(); moveTo(tx(x, y)); break; }
        case 4: { float x = px(), y = px(); lineTo(tx(x, y)); break; }
        case 5: { float x1 = px(), y1 = px(), x = px(), y = px(); quadTo(tx(x1, y1), tx(x, y)); break; }
        case 6: { float x1 = px(), y1 = px(), x2 = px(), y2 = px(), x = px(), y = px(); cubicTo(tx(x1, y1), tx(x2, y2), tx(x, y)); break; }
        case 7: { float x = px(), y = px(), r = px(), a0 = ang(), a1 = ang(); bool ccw = *p++; arc(x, y, r, r, 0, a0, a1, ccw); break; }
        case 8: { float x = px(), y = px(), rx = px(), ry = px(), rot = ang(), a0 = ang(), a1 = ang(); bool ccw = *p++; arc(x, y, rx, ry, rot, a0, a1, ccw); break; }
        case 9: { float x = px(), y = px(), w = px(), h = px(); rect(x, y, w, h); break; }
        case 10: { float x = px(), y = px(), w = px(), h = px(); fillRect(x, y, w, h); break; }
        case 11: fill(); break;
        case 12: stroke(); break;
        case 13: clip(); break;
        case 14: if (sp < MAX_STATES) { stack[sp++] = st; st.ownClip = false; } else overflow = true; break;
        case 15: if (sp > 0) { st = stack[--sp]; clipTop = st.clip + 1; } break;
        case 16: { float x = px(), y = px(); st.e += st.a * x + st.c * y; st.f += st.b * x + st.d * y; break; }
        case 17: { float t = ang(), cs = cosf(t), sn = sinf(t), a = st.a, b = st.b;
                   st.a = a * cs + st.c * sn; st.b = b * cs + st.d * sn; st.c = st.c * cs - a * sn; st.d = st.d * cs - b * sn; break; }
        case 18: { float sx = s16() / 256.f, sy = s16() / 256.f; st.a *= sx; st.b *= sx; st.c *= sy; st.d *= sy; break; }
        case 19: { st.a = s16() / 256.f; st.b = s16() / 256.f; st.c = s16() / 256.f; st.d = s16() / 256.f; st.e = px(); st.f = px(); break; }
        case 20: memcpy(st.fill, p, 4); p += 4; if (recolour) recolour(st.fill); break;
        case 21: memcpy(st.stroke, p, 4); p += 4; if (recolour) recolour(st.stroke); break;
        case 22: st.lineWidth = u16() / 16.f; break;
        case 23: st.alpha = *p++; break;
        case 24: { int n = *p++; st.nDash = 0; for (int i = 0; i < n; i++) { float v = u16() / 16.f; if (i < MAX_DASH) st.dash[st.nDash++] = v; } break; }
        case 25: { float x = px(), y = px(), w = px(), h = px(), r = px(); roundRect(x, y, w, h, r); break; }
        case 26: st.dashOff = px(); break;
        case 27: clip(true); break;
        case 28: if (end - p < 6) { overflow = true; return; }      // a mark, not a drawing: the board draws over it (antenna.h)
                 anchorX = s16(); anchorY = s16(); anchorR = s16(); anchored = true; break;
        default: overflow = true; return;                 // unknown instruction: stop rather than misread the rest
      }
    }
  }

 private:
  State st, stack[MAX_STATES];
  int sp = 0, clipTop = 0;
  Pt pts[MAX_PTS]; Sub subs[MAX_SUBS];
  int nPts = 0, nSubs = 0;
  bool open = false, pending = false; Pt pendingAt{0, 0};
  int minX, maxX, minY, maxY;

  Pt tx(float x, float y) const { return {st.a * x + st.c * y + st.e, st.b * x + st.d * y + st.f}; }
  float scale() const { return sqrtf(fabsf(st.a * st.d - st.b * st.c)); }

  // ---- building the path (points are stored in screen space) ----
  void beginPath() { nPts = nSubs = 0; open = pending = false; }
  void newSub(Pt p) { if (nSubs >= MAX_SUBS || nPts >= MAX_PTS) { open = false; overflow = true; return; } subs[nSubs++] = {uint16_t(nPts), 1, false}; pts[nPts++] = p; open = true; pending = false; }
  void push(Pt p) { if (nPts < MAX_PTS) { pts[nPts++] = p; subs[nSubs - 1].n++; } else overflow = true; }
  void moveTo(Pt p) { newSub(p); }
  void lineTo(Pt p) {
    if (!open) { if (pending) newSub(pendingAt); else { newSub(p); return; } if (!open) return; }
    push(p);
  }
  Pt cur() const { return pts[nPts - 1]; }
  void closePath() { if (!open || !nSubs) return; Sub& s = subs[nSubs - 1]; s.closed = true; pendingAt = pts[s.start]; pending = true; open = false; }
  void quadTo(Pt c, Pt p) {
    if (!open) lineTo(c); if (!open) return;
    Pt p0 = cur(); float dx = p0.x - 2 * c.x + p.x, dy = p0.y - 2 * c.y + p.y;
    int n = steps(sqrtf(sqrtf(dx * dx + dy * dy) / (4 * TOL)));
    for (int i = 1; i <= n; i++) { float t = float(i) / n, u = 1 - t; push({u * u * p0.x + 2 * u * t * c.x + t * t * p.x, u * u * p0.y + 2 * u * t * c.y + t * t * p.y}); }
  }
  void cubicTo(Pt c1, Pt c2, Pt p) {
    if (!open) lineTo(c1); if (!open) return;
    Pt p0 = cur();
    float ax = p0.x - 2 * c1.x + c2.x, ay = p0.y - 2 * c1.y + c2.y, bx = c1.x - 2 * c2.x + p.x, by = c1.y - 2 * c2.y + p.y;
    int n = steps(sqrtf(0.75f * sqrtf(fmaxf(ax * ax + ay * ay, bx * bx + by * by)) / TOL));
    for (int i = 1; i <= n; i++) {
      float t = float(i) / n, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      push({w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p.x, w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p.y});
    }
  }
  static int steps(float n) { return n < 1 ? 1 : n > 40 ? 40 : int(ceilf(n)); }
  void arc(float cx, float cy, float rx, float ry, float rot, float a0, float a1, bool ccw) {
    float sweep = a1 - a0, two = 2 * PI_F;
    if (!ccw) { if (sweep >= two) sweep = two; else if (sweep < 0) sweep = fmodf(sweep, two) + two; }       // as the canvas has it
    else { if (sweep <= -two) sweep = -two; else if (sweep > 0) sweep = fmodf(sweep, two) - two; }
    float r = fmaxf(rx, ry) * scale();
    int n = r <= TOL * 1.5f ? 3 : int(ceilf(fabsf(sweep) / (2 * acosf(1 - TOL / r))));
    n = n < 2 ? 2 : n > 96 ? 96 : n;
    float cr = cosf(rot), sr = sinf(rot);
    for (int i = 0; i <= n; i++) {
      float t = a0 + sweep * i / n, ux = rx * cosf(t), uy = ry * sinf(t);
      lineTo(tx(cx + ux * cr - uy * sr, cy + ux * sr + uy * cr));       // the first point joins on from wherever the path was
    }
  }
  void rect(float x, float y, float w, float h) { moveTo(tx(x, y)); lineTo(tx(x + w, y)); lineTo(tx(x + w, y + h)); lineTo(tx(x, y + h)); closePath(); }
  void roundRect(float x, float y, float w, float h, float r) {
    r = fminf(r, fminf(fabsf(w), fabsf(h)) / 2);
    moveTo(tx(x + r, y)); arc(x + w - r, y + r, r, r, 0, -PI_F / 2, 0, false); arc(x + w - r, y + h - r, r, r, 0, 0, PI_F / 2, false);
    arc(x + r, y + h - r, r, r, 0, PI_F / 2, PI_F, false); arc(x + r, y + r, r, r, 0, PI_F, 1.5f * PI_F, false); closePath();
  }

  // ---- coverage: every edge adds its signed area into acc; a running sum along each row then gives
  // how much of each pixel is inside (the method fonts are commonly drawn with) ----
  void resetBounds() { minX = STRIDE; maxX = -1; minY = H; maxY = -1; }
  void edge(Pt p0, Pt p1) {
    if (!(p0.y == p0.y && p1.y == p1.y && p0.x == p0.x && p1.x == p1.x) || p0.y == p1.y) return;
    float dir = 1; if (p0.y > p1.y) { Pt t = p0; p0 = p1; p1 = t; dir = -1; }
    if (p1.y <= 0 || p0.y >= H) return;
    float dxdy = (p1.x - p0.x) / (p1.y - p0.y), x = p0.x;
    int y0 = 0; if (p0.y < 0) x -= p0.y * dxdy; else y0 = int(p0.y);
    int y1 = p1.y >= H ? H : int(ceilf(p1.y));
    if (y0 < minY) minY = y0; if (y1 - 1 > maxY) maxY = y1 - 1;
    for (int y = y0; y < y1; y++) {
      float* row = acc + y * STRIDE;
      float dy = fminf(y + 1, p1.y) - fmaxf(y, p0.y), xn = x + dxdy * dy, d = dy * dir;
      float xa = x < xn ? x : xn, xb = x < xn ? xn : x;
      xa = xa < 0 ? 0 : xa > W ? W : xa; xb = xb < 0 ? 0 : xb > W ? W : xb;
      float xaf = floorf(xa); int ia = int(xaf), ib = int(ceilf(xb));
      if (ia < minX) minX = ia;
      if (ib <= ia + 1) {
        float m = 0.5f * (xa + xb) - xaf;
        row[ia] += d - d * m; row[ia + 1] += d * m;
        if (ia + 1 > maxX) maxX = ia + 1;
      } else {
        float s = 1 / (xb - xa), fa = xa - xaf, a0 = 0.5f * s * (1 - fa) * (1 - fa), fb1 = xb - ib + 1, am = 0.5f * s * fb1 * fb1;
        row[ia] += d * a0;
        if (ib == ia + 2) row[ia + 1] += d * (1 - a0 - am);
        else {
          float a1 = s * (1.5f - fa);
          row[ia + 1] += d * (a1 - a0);
          for (int xi = ia + 2; xi < ib - 1; xi++) row[xi] += d * s;
          row[ib - 1] += d * (1 - (a1 + (ib - ia - 3) * s) - am);
        }
        row[ib] += d * am;
        if (ib > maxX) maxX = ib;
      }
      x = xn;
    }
  }
#ifdef VEC_SWAPPED
  static inline uint16_t sw(uint16_t v) { return uint16_t((v >> 8) | (v << 8)); }
#else
  static inline uint16_t sw(uint16_t v) { return v; }
#endif
  static inline void blend(uint16_t* dst, const uint8_t* c, uint32_t a) {      // a: 0..255
    if (a >= 255) { *dst = sw(uint16_t(((c[0] & 0xF8) << 8) | ((c[1] & 0xFC) << 3) | (c[2] >> 3))); return; }
    uint16_t v = sw(*dst); int r = (v >> 11) << 3 | (v >> 13), g = ((v >> 5) & 63) << 2 | ((v >> 9) & 3), b = (v & 31) << 3 | ((v >> 2) & 7);
    int k = int(a + (a >> 7));
    r += ((c[0] - r) * k) >> 8; g += ((c[1] - g) * k) >> 8; b += ((c[2] - b) * k) >> 8;
    *dst = sw(uint16_t(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)));
  }
  // Turn the accumulated edges into pixels of one colour (or into a clip mask, or with cut, out of
  // one), and leave acc zeroed.
  void paint(const uint8_t* col, uint8_t* mask = nullptr, const uint8_t* maskIn = nullptr, bool cut = false) {
    if (maxY < minY || maxX < 0) return;
    float op = col ? col[3] * st.alpha / 255.f : 255.f;
    const uint8_t* cm = (col && st.clip >= 0) ? clips[st.clip] : maskIn;
    for (int y = minY; y <= maxY; y++) {
      float* row = acc + y * STRIDE; float s = 0;
      for (int x = minX; x <= maxX; x++) {
        s += row[x]; row[x] = 0;
        if (x >= W) continue;
        float cov = fabsf(s); if (cov < 0.004f) continue;
        uint32_t a = uint32_t((cov > 1 ? 1 : cov) * op + 0.5f);
        if (!col && !mask) continue;
        if (cut) { uint8_t& m = mask[y * W + x]; m = uint8_t(m * (255 - a) / 255); continue; }
        if (cm) a = a * cm[y * W + x] / 255;
        if (!a) continue;
        if (mask) mask[y * W + x] = uint8_t(a); else blend(fb + y * W + x, col, a);
      }
    }
  }
  void outline() {                                   // the path's own edges, each subpath closed
    for (int i = 0; i < nSubs; i++) {
      const Sub& s = subs[i]; if (s.n < 2) continue;
      const Pt* P = pts + s.start;
      for (int k = 0; k + 1 < s.n; k++) edge(P[k], P[k + 1]);
      edge(P[s.n - 1], P[0]);
    }
  }
  void fill() { resetBounds(); outline(); paint(st.fill); }
  void fillRect(float x, float y, float w, float h) {
    Pt a = tx(x, y), b = tx(x + w, y), c = tx(x + w, y + h), d = tx(x, y + h);
    if (st.clip < 0 && st.alpha == 255 && st.fill[3] == 255 && st.b == 0 && st.c == 0 && a.x <= 0 && a.y <= 0 && c.x >= W && c.y >= H) {
      uint16_t v = 0; blend(&v, st.fill, 255); for (int i = 0; i < W * H; i++) fb[i] = v;      // the background wipe
      return;
    }
    resetBounds(); edge(a, b); edge(b, c); edge(c, d); edge(d, a); paint(st.fill);
  }
  void clip(bool outside = false) {                  // outside: keep what is not in the path
    resetBounds(); outline();
    if (outside && st.ownClip) { paint(nullptr, clips[st.clip], nullptr, true); return; }
    if (clipTop >= MAX_CLIPS || !clips[clipTop]) { overflow = true; paint(nullptr, nullptr); return; }
    uint8_t* m = clips[clipTop]; const uint8_t* was = st.clip >= 0 ? clips[st.clip] : nullptr;
    if (!outside) { memset(m, 0, W * H); paint(nullptr, m, was); }
    else { if (was) memcpy(m, was, W * H); else memset(m, 255, W * H); paint(nullptr, m, nullptr, true); }
    st.clip = int8_t(clipTop++); st.ownClip = true;
  }

  // ---- strokes: every segment becomes a rectangle and every end or corner a disc, all wound the
  // same way so that where they overlap the coverage just saturates ----
  void disc(Pt c, float hw) {
    int n = hw < 0.8f ? 6 : hw < 2.5f ? 10 : hw < 6 ? 16 : 24;
    Pt prev{c.x + hw, c.y};
    for (int i = 1; i <= n; i++) { float t = -2 * PI_F * i / n; Pt q{c.x + hw * cosf(t), c.y + hw * sinf(t)}; edge(prev, q); prev = q; }
  }
  void strokeLine(const Pt* P, int n, bool closed, float hw) {
    if (n == 1) { disc(P[0], hw); return; }
    int segs = closed ? n : n - 1;
    for (int i = 0; i < segs; i++) {
      Pt p0 = P[i], p1 = P[(i + 1) % n]; float dx = p1.x - p0.x, dy = p1.y - p0.y, len = sqrtf(dx * dx + dy * dy);
      if (len < 1e-4f) continue;
      float nx = -dy / len * hw, ny = dx / len * hw;
      Pt A{p0.x + nx, p0.y + ny}, B{p1.x + nx, p1.y + ny}, C{p1.x - nx, p1.y - ny}, D{p0.x - nx, p0.y - ny};
      edge(A, B); edge(B, C); edge(C, D); edge(D, A);
    }
    for (int i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {       // corners that turn enough to leave a notch
      Pt a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
      float ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y, lu = sqrtf(ux * ux + uy * uy), lv = sqrtf(vx * vx + vy * vy);
      if (lu < 1e-4f || lv < 1e-4f || (ux * vx + uy * vy) < 0.97f * lu * lv) disc(b, hw);
    }
    if (!closed) { disc(P[0], hw); disc(P[n - 1], hw); }
  }
  void stroke() {
    float sc = scale(), hw = fmaxf(0.5f * st.lineWidth * sc, 0.05f);
    static Pt tmp[MAX_PTS], piece[MAX_PTS + 4];
    resetBounds();
    for (int i = 0; i < nSubs; i++) {
      const Sub& s = subs[i]; int n = 0;
      for (int k = 0; k < s.n; k++) { Pt p = pts[s.start + k]; if (!n || fabsf(p.x - tmp[n - 1].x) + fabsf(p.y - tmp[n - 1].y) > 1e-3f) tmp[n++] = p; }
      bool closed = s.closed;
      if (closed && n > 1 && fabsf(tmp[0].x - tmp[n - 1].x) + fabsf(tmp[0].y - tmp[n - 1].y) <= 1e-3f) n--;
      if (!st.nDash) { strokeLine(tmp, n, closed && n > 2, hw); continue; }
      // dashes: walk the line, switching on and off by the pattern
      int total = closed ? n : n - 1, di = 0, m = 0; bool on = true;
      float left = st.dash[0] * sc, skip = st.dashOff * sc;
      auto next = [&]() { di++; on = !on; left = st.dash[di % st.nDash] * sc; if (left <= 0) left = 1e-3f; };
      while (skip > 0) { if (skip >= left) { skip -= left; next(); } else { left -= skip; skip = 0; } }
      if (on) piece[m++] = tmp[0];
      for (int k = 0; k < total; k++) {
        Pt p0 = tmp[k], p1 = tmp[(k + 1) % n]; float dx = p1.x - p0.x, dy = p1.y - p0.y, len = sqrtf(dx * dx + dy * dy), at = 0;
        while (len - at > left) {
          at += left; Pt q{p0.x + dx * at / len, p0.y + dy * at / len};
          if (on) { piece[m++] = q; strokeLine(piece, m, false, hw); m = 0; } else piece[m++] = q;
          next(); if (!on) m = 0;
        }
        left -= len - at;
        if (on) piece[m++] = p1;
      }
      if (on && m > 0) strokeLine(piece, m, false, hw);
    }
    paint(st.stroke);
  }
};

}  // namespace vec
