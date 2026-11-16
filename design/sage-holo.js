// What Sage projects: a hologram thrown from its visor into the air beside it, as its mind shows on the website (green
// and see-through, scan lines and a band of light running down it), switched on and off as the room's screens are (a
// point, a line, then the picture; and back). On the prism the black around it is glass, so it hangs in the air. It is
// a plane in Sage's small 3D world, so it turns with the camera. What it shows is drawn with strokes and fills (digits
// of seven segments, rings, cells, a wireframe), so the board draws it as instructions. Part of Sage's art: see
// LICENSE-ART.md.
(function () {
  const G = "#a0e299", HI = "#d8f7d2", AMBER = "#ffb347";
  const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (u) => u * u * (3 - 2 * u);
  let GLIDE = null;

  // ── digits of seven segments, `h` millimetres tall, from their top left ──
  const SEG = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g" };
  function digits(g, x, y, h, text, color, a = 1) {
    const w = h * 0.5, gap = h * 0.22;
    g.strokeStyle = color; g.globalAlpha = a; g.lineWidth = h * 0.13; g.lineCap = "round"; g.beginPath();
    let cx = x;
    for (const ch of String(text)) {
      if (ch === ":") { g.moveTo(cx + h * 0.1, y + h * 0.3); g.lineTo(cx + h * 0.1, y + h * 0.32); g.moveTo(cx + h * 0.1, y + h * 0.68); g.lineTo(cx + h * 0.1, y + h * 0.7); cx += h * 0.2 + gap; continue; }
      if (ch === "%") { g.moveTo(cx + w, y); g.lineTo(cx, y + h); g.moveTo(cx + w * 0.15, y + h * 0.12); g.lineTo(cx + w * 0.17, y + h * 0.14); g.moveTo(cx + w * 0.85, y + h * 0.86); g.lineTo(cx + w * 0.87, y + h * 0.88); cx += w + gap; continue; }
      const on = SEG[ch] || "", m = h / 2;
      const L = { a: [0, 0, w, 0], b: [w, 0, w, m], c: [w, m, w, h], d: [0, h, w, h], e: [0, m, 0, h], f: [0, 0, 0, m], g: [0, m, w, m] };
      for (const s of on) { const [x0, y0, x1, y1] = L[s]; g.moveTo(cx + x0, y + y0); g.lineTo(cx + x1, y + y1); }
      cx += w + gap;
    }
    g.stroke(); g.globalAlpha = 1;
    return cx - gap - x;
  }
  /** how wide digits() draws a text */
  const width = (h, text) => [...String(text)].reduce((w, ch) => w + (ch === ":" ? h * 0.2 : h * 0.5) + h * 0.22, 0) - h * 0.22;
  const cellAt = (g, x, y, s) => { g.beginPath(); g.roundRect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8, s * 0.2); g.fill(); };

  // ── what a hologram shows, in its own millimetres (0, 0) at its top left, W by H ──
  const SHOW = {
    /** a test run: a cell a test, lit as each finishes (`done` of them), the failures amber, and the counts */
    tests(g, W, H, o, t) {
      const n = o.count || 12, cols = 6, s = 7, x0 = (W - cols * s) / 2, done = Math.floor(o.done ?? n), fails = new Set(o.fails || []);
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols), bad = fails.has(i);
        g.fillStyle = i < done ? (bad ? AMBER : G) : G; g.globalAlpha = i < done ? (bad && Math.floor(t / 4) % 2 ? 0.55 : 0.95) : 0.15; cellAt(g, x0 + c * s, 5 + r * s, s);
      }
      g.globalAlpha = 1;
      const passed = [...Array(Math.min(done, n)).keys()].filter((i) => !fails.has(i)).length, failed = [...fails].filter((i) => i < done).length;
      const wd = digits(g, x0, H - 15, 10, passed, G);
      if (failed) digits(g, x0 + wd + 7, H - 15, 10, failed, AMBER);
    },
    /** progress round a ring, the percentage in its middle */
    ring(g, W, H, o) {
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.36, p = clamp01(o.progress || 0);
      g.lineCap = "round"; g.strokeStyle = G; g.globalAlpha = 0.18; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 0.95; g.strokeStyle = p >= 1 ? HI : G; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, p)); g.stroke(); g.globalAlpha = 1;
      const txt = String(Math.round(p * 100)), h = r * 0.62;
      digits(g, cx - width(h, txt) / 2, cy - h / 2, h, txt, p >= 1 ? HI : G);
    },
    /** the time, its colon blinking, a crescent of moon above it */
    clock(g, W, H, o, t) {
      const h = H * 0.42, time = o.time || "02:14", [hh, mm] = time.split(":"), x0 = (W - width(h, time)) / 2, y0 = H * 0.36;
      const wh = digits(g, x0, y0, h, hh, G), gap = h * 0.22;
      if (Math.floor(t / 12) % 2) digits(g, x0 + wh + gap, y0, h, ":", G);
      digits(g, x0 + wh + gap + width(h, ":") + gap, y0, h, mm, G);
      g.fillStyle = G; g.globalAlpha = 0.85; g.beginPath(); g.arc(W * 0.16, H * 0.2, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#000000"; g.globalAlpha = 1; g.beginPath(); g.arc(W * 0.16 + 1.8, H * 0.2 - 1.2, 3.6, 0, Math.PI * 2); g.fill();
    },
    /** its battery (the author's Claude usage): four bars, the level, amber below a quarter */
    battery(g, W, H, o, t) {
      const lv = clamp01(o.level ?? 0.23), low = lv < 0.25, col = low ? AMBER : G, bw = W * 0.56, bh = H * 0.34, x0 = (W - bw) / 2, y0 = H * 0.14;
      g.strokeStyle = col; g.lineWidth = 1.2; g.globalAlpha = 0.9; g.beginPath(); g.roundRect(x0, y0, bw, bh, 2.5); g.stroke();
      g.fillStyle = col; g.fillRect(x0 + bw, y0 + bh * 0.3, 2.2, bh * 0.4);
      const bars = Math.ceil(lv * 4), blink = low && Math.floor(t / 8) % 2;
      for (let i = 0; i < bars; i++) { g.globalAlpha = i === bars - 1 && blink ? 0.3 : 0.9; g.fillRect(x0 + 2 + i * ((bw - 4) / 4), y0 + 2, (bw - 4) / 4 - 1.6, bh - 4); }
      g.globalAlpha = 1;
      const txt = String(Math.round(lv * 100)) + "%", h = H * 0.3;
      digits(g, (W - width(h, txt)) / 2, H * 0.58, h, txt, col);
    },
    /** a board of the Game of Life with a glider on it, wrapping round its edges */
    life(g, W, H, o, t) {
      const n = 8, s = Math.min(W, H - 4) / n, x0 = (W - n * s) / 2, y0 = (H - n * s) / 2;
      g.strokeStyle = G; g.globalAlpha = 0.16; g.lineWidth = 0.4; g.beginPath();
      for (let i = 0; i <= n; i++) { g.moveTo(x0 + i * s, y0); g.lineTo(x0 + i * s, y0 + n * s); g.moveTo(x0, y0 + i * s); g.lineTo(x0 + n * s, y0 + i * s); }
      g.stroke(); g.globalAlpha = 0.95; g.fillStyle = G;
      const gens = (GLIDE = GLIDE || SageThings.life.run([[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]], 32)), gi = Math.floor(o.gen || 0) % 32;
      for (const k of gens[gi]) { const [c, r] = k.split(",").map(Number); cellAt(g, x0 + (((c % n) + n) % n) * s, y0 + (((r % n) + n) % n) * s, s); }
      g.globalAlpha = 1;
    },
    /** itself, as a wireframe turning: its head with its visor and eyes, its body, its feet */
    self(g, W, H, o) {
      const a = o.turn || 0, ca = Math.cos(a), sa = Math.sin(a), k = Math.min(W, H) / 150, cx = W / 2, base = H * 0.92;
      const P = (x, y, z) => [cx + (x * ca + z * sa) * k, base - y * k - (z * ca - x * sa) * k * 0.18];
      const box = (x, y, z, w, h, d) => {
        const v = [];
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) v.push(P(x + sx * w / 2, y + sy * h / 2, z + sz * d / 2));
        for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) { g.moveTo(v[i][0], v[i][1]); g.lineTo(v[j][0], v[j][1]); }
      };
      g.strokeStyle = G; g.lineWidth = 0.7; g.globalAlpha = 0.9; g.beginPath();
      box(-17, 6.5, 3, 26, 13, 38); box(17, 6.5, 3, 26, 13, 38); box(0, 46, 0, 46, 32, 34); box(0, 101, 0, 76, 62, 58);
      g.stroke();
      if (ca > 0.15) {
        // its visor and eyes, on the front of the head, while the front faces us
        g.globalAlpha = 0.9 * Math.min(1, ca * 2); g.beginPath();
        const q = [P(-32, 128, 29), P(32, 128, 29), P(32, 74, 29), P(-32, 74, 29)]; q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
        g.fillStyle = HI; for (const ex of [-12, 12]) { const e = [P(ex - 4, 110, 29), P(ex + 4, 110, 29), P(ex + 4, 92, 29), P(ex - 4, 92, 29)]; g.beginPath(); e.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); }
      }
      g.globalAlpha = 1;
    },
  };

  /**
   * A hologram into the scene: `h` is { kind, open (0 to 1: a point, a line, then the picture), at [x, y, z] its middle
   * in the world, w and h in millimetres, yaw (turned about the vertical), glitch (0 to 1), and what its kind shows };
   * `from` is two points on the visor its beam leaves from.
   */
  function add(S, cam, h, from, t) {
    const open = clamp01(h.open ?? 1); if (open <= 0) return;
    const W = h.w || 60, Hh = h.h || 44, [cx, cy, cz] = h.at || [62, 96, 18], c = Math.cos(h.yaw || 0), s = Math.sin(h.yaw || 0);
    const at = (u, v) => cam.at([cx + c * (u - W / 2), cy - (v - Hh / 2), cz - s * (u - W / 2)]);
    S.custom({ w: [cx, cy, cz], bias: 120, draw(g) {
      // flicker: now and then dimmer, now and then a jump sideways
      const f = Math.floor(t / 2), dim = hash(f, 3) < 0.07 ? 0.55 : 0.85 + 0.15 * hash(f, 4), jump = (hash(f, 5) < 0.06 + 0.3 * (h.glitch || 0) ? (hash(f, 6) - 0.5) * 6 : 0);
      const line = clamp01(open / 0.35), grow = ease(clamp01((open - 0.35) / 0.65)), hv = Math.max(0.6, Hh * grow);
      // the beam from its visor to the near edge of the picture
      const a = cam.at(from[0]), b = cam.at(from[1]), p0 = at(0, Hh / 2 - hv / 2), p1 = at(0, Hh / 2 + hv / 2);
      g.globalAlpha = 0.11 * dim * line; g.fillStyle = G; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(p1[0], p1[1]); g.lineTo(p0[0], p0[1]); g.closePath(); g.fill();
      g.globalAlpha = 0.45 * dim * line; g.strokeStyle = G; g.lineWidth = 0.7; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(p0[0], p0[1]); g.moveTo(b[0], b[1]); g.lineTo(p1[0], p1[1]); g.stroke();
      // the picture's plane, in its millimetres
      const o = at(0, 0), x = at(1, 0), y = at(0, 1);
      g.save(); g.transform(x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], o[0] + jump, o[1]);
      if (grow <= 0) {
        // switching on or off: a bright line, from a point
        const lw = W * line; g.globalAlpha = 0.9 * dim; g.fillStyle = HI; g.fillRect(W / 2 - lw / 2, Hh / 2 - 0.4, lw, 0.8);
      } else {
        g.beginPath(); g.rect(0, Hh / 2 - hv / 2, W, hv); g.clip();
        // its glow round it, then the picture
        g.globalAlpha = 0.05 * dim; g.fillStyle = G; g.beginPath(); g.roundRect(-2.5, -2.5, W + 5, Hh + 5, 5); g.fill();
        g.globalAlpha = 0.07 * dim; g.beginPath(); g.roundRect(0, 0, W, Hh, 3); g.fill();
        g.globalAlpha = 0.6 * dim; g.strokeStyle = G; g.lineWidth = 0.6; g.beginPath(); g.roundRect(0, 0, W, Hh, 3); g.stroke();
        g.globalAlpha = dim; SHOW[h.kind](g, W, Hh, h, t); g.globalAlpha = 1;
        // its scan lines, and a band of light running down it
        g.globalAlpha = 0.08 * dim; g.strokeStyle = HI; g.lineWidth = 0.35; g.beginPath(); for (let v = 1.5; v < Hh; v += 2.2) { g.moveTo(0, v); g.lineTo(W, v); } g.stroke();
        const band = ((t % 108) / 108) * (Hh * 1.3) - Hh * 0.15; g.globalAlpha = 0.1 * dim; g.fillStyle = G; g.fillRect(0, band, W, Hh * 0.18);
        if (grow < 1) { g.globalAlpha = 0.8; g.fillStyle = HI; g.fillRect(0, Hh / 2 - hv / 2, W, 0.7); g.fillRect(0, Hh / 2 + hv / 2 - 0.7, W, 0.7); }
      }
      g.restore();
    } });
  }

  window.SageHolo = { add, digits };
})();
