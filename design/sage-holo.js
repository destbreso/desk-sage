// What Sage projects, from the lens on the top edge of its head: a hologram made only of light, as its mind shows on
// the website (green, see-through, a band of light running down it), switched on and off as the website's screens are (a
// point, a line, then the picture). It has no panel behind it: its strokes glow in layers, it is cut into scan lines,
// it flickers and now and then a slice of it jumps, and on the prism the black round it is glass, so it hangs in the
// air. It stands on a ring of light on the desk, floats beside Sage, takes the whole screen, or lies on the desk as a
// board of the Game of Life. What it shows is strokes and fills, so the board draws it as instructions. Part of Sage's
// art: see LICENSE-ART.md.
(function () {
  const G = "#a0e299", HI = "#e8ffe4", AMBER = "#ffb347";
  const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (u) => u * u * (3 - 2 * u);
  let GLIDE = null;
  // the shape of light a hologram stands on, by what it shows: none is a rule, each is what suits it
  const BASE = { tests: "rect", battery: "rect", life: "square", ring: "ring", self: "ring", clock: "line" };

  // ── digits of seven segments, `h` tall, from their top left ──
  const SEG = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g" };
  const width = (h, text) => [...String(text)].reduce((w, ch) => w + (ch === ":" ? h * 0.2 : h * 0.5) + h * 0.22, 0) - h * 0.22;
  function digits(g, x, y, h, text, color) {
    const w = h * 0.5, gap = h * 0.22, m = h / 2;
    g.strokeStyle = color; g.lineWidth = h * 0.12; g.lineCap = "round"; g.beginPath();
    let cx = x;
    for (const ch of String(text)) {
      if (ch === ":") { for (const yy of [0.3, 0.7]) { g.moveTo(cx + h * 0.1, y + h * yy); g.lineTo(cx + h * 0.1, y + h * yy + 0.01); } cx += h * 0.2 + gap; continue; }
      if (ch === "%") { g.moveTo(cx + w, y); g.lineTo(cx, y + h); for (const [px, py] of [[0.15, 0.12], [0.85, 0.88]]) { g.moveTo(cx + w * px, y + h * py); g.lineTo(cx + w * px + 0.01, y + h * py); } cx += w + gap; continue; }
      const L = { a: [0, 0, w, 0], b: [w, 0, w, m], c: [w, m, w, h], d: [0, h, w, h], e: [0, m, 0, h], f: [0, 0, 0, m], g: [0, m, w, m] };
      for (const s of SEG[ch] || "") { const [x0, y0, x1, y1] = L[s]; g.moveTo(cx + x0, y + y0); g.lineTo(cx + x1, y + y1); }
      cx += w + gap;
    }
    g.stroke();
  }
  const cellAt = (g, x, y, s) => { g.beginPath(); g.rect(x + s * 0.14, y + s * 0.14, s * 0.72, s * 0.72); g.fill(); };

  // ── what a hologram shows, in its own units, (0, 0) its top left, W by H ──
  const SHOW = {
    /** a test run: a cell a test, lit as each finishes (`done` of them), the failures amber, and the counts */
    tests(g, W, H, o, t) {
      const n = o.count || 12, cols = 6, s = W / 7.5, x0 = (W - cols * s) / 2, done = Math.floor(o.done ?? n), fails = new Set(o.fails || []);
      for (let i = 0; i < Math.min(done, n); i++) {
        const bad = fails.has(i); if (bad && Math.floor(t / 4) % 2) continue;
        g.fillStyle = bad ? AMBER : G; cellAt(g, x0 + (i % cols) * s, H * 0.06 + Math.floor(i / cols) * s, s);
      }
      const passed = [...Array(Math.min(done, n)).keys()].filter((i) => !fails.has(i)).length, failed = [...fails].filter((i) => i < done).length, h = H * 0.32;
      digits(g, x0, H - h - H * 0.04, h, passed, G);
      if (failed) digits(g, x0 + width(h, passed) + h * 0.8, H - h - H * 0.04, h, failed, AMBER);
    },
    /** progress round a ring, the percentage in its middle */
    ring(g, W, H, o) {
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.42, p = clamp01(o.progress || 0), col = p >= 1 ? HI : G;
      g.lineCap = "round"; g.strokeStyle = col; g.lineWidth = r * 0.13; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, p)); g.stroke();
      g.lineWidth = r * 0.03; g.beginPath(); g.arc(cx, cy, r * 0.8, 0, Math.PI * 2); g.stroke();
      const txt = String(Math.round(p * 100)), h = r * 0.62; digits(g, cx - width(h, txt) / 2, cy - h / 2, h, txt, col);
    },
    /** the time, its colon blinking, a crescent of moon above it */
    clock(g, W, H, o, t) {
      const h = H * 0.44, time = o.time || "02:14", [hh, mm] = time.split(":"), x0 = (W - width(h, time)) / 2, y0 = H * 0.46, gap = h * 0.22;
      digits(g, x0, y0, h, hh, G); if (Math.floor(t / 12) % 2) digits(g, x0 + width(h, hh) + gap, y0, h, ":", G); digits(g, x0 + width(h, hh) + gap + width(h, ":") + gap, y0, h, mm, G);
      g.strokeStyle = G; g.lineWidth = H * 0.04; g.beginPath(); g.arc(W * 0.5, H * 0.2, H * 0.12, Math.PI * 0.55, Math.PI * 1.75); g.stroke();
    },
    /** its battery (the author's Claude usage): four bars, the level, amber below a quarter */
    battery(g, W, H, o, t) {
      const lv = clamp01(o.level ?? 0.23), col = lv < 0.25 ? AMBER : G, bw = W * 0.62, bh = H * 0.36, x0 = (W - bw) / 2 - W * 0.02, y0 = H * 0.06;
      g.strokeStyle = col; g.lineWidth = H * 0.035; g.beginPath(); g.rect(x0, y0, bw, bh); g.moveTo(x0 + bw + H * 0.05, y0 + bh * 0.3); g.lineTo(x0 + bw + H * 0.05, y0 + bh * 0.7); g.stroke();
      g.fillStyle = col; const bars = Math.ceil(lv * 4), blink = lv < 0.25 && Math.floor(t / 8) % 2;
      for (let i = 0; i < bars - (blink ? 1 : 0); i++) g.fillRect(x0 + bw * 0.07 + i * (bw * 0.88 / 4), y0 + bh * 0.22, bw * 0.88 / 4 - bw * 0.05, bh * 0.56);
      const txt = String(Math.round(lv * 100)) + "%", h = H * 0.34; digits(g, (W - width(h, txt)) / 2, H * 0.56, h, txt, col);
    },
    /** a board of the Game of Life with a glider on it, wrapping round its edges */
    life(g, W, H, o) {
      const n = 8, s = Math.min(W, H) / n, x0 = (W - n * s) / 2, y0 = (H - n * s) / 2;
      g.strokeStyle = G; g.lineWidth = s * 0.04; g.beginPath(); g.rect(x0, y0, n * s, n * s); g.stroke();
      GLIDE = GLIDE || SageThings.life.run([[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]], 32);
      g.fillStyle = G; for (const k of GLIDE[Math.floor(o.gen || 0) % 32]) { const [c, r] = k.split(",").map(Number); cellAt(g, x0 + (((c % n) + n) % n) * s, y0 + (((r % n) + n) % n) * s, s); }
    },
    /** itself, as a wireframe turning: its feet, its body, its head with its eyes */
    self(g, W, H, o) {
      const a = o.turn || 0, ca = Math.cos(a), sa = Math.sin(a), k = H / 140, cx = W / 2, base = H * 0.96;
      const P = (x, y, z) => [cx + (x * ca + z * sa) * k, base - y * k - (z * ca - x * sa) * k * 0.2];
      const box = (x, y, z, w, h, d) => {
        const v = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) v.push(P(x + sx * w / 2, y + sy * h / 2, z + sz * d / 2));
        for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) { g.moveTo(v[i][0], v[i][1]); g.lineTo(v[j][0], v[j][1]); }
      };
      g.strokeStyle = G; g.lineWidth = H * 0.01; g.beginPath(); box(-17, 6.5, 3, 26, 13, 38); box(17, 6.5, 3, 26, 13, 38); box(0, 46, 0, 46, 32, 34); box(0, 101, 0, 76, 62, 58); g.stroke();
      if (ca > 0.15) { g.fillStyle = G; for (const ex of [-12, 12]) { const e = [P(ex - 4, 110, 29), P(ex + 4, 110, 29), P(ex + 4, 92, 29), P(ex - 4, 92, 29)]; g.beginPath(); e.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); } }
    },
  };

  /**
   * One layer of light: what is drawn through it is widened by `add` (in the units drawn in) and dimmed by `dim`, and
   * a fill also glows round its edge. Three layers (wide and faint, narrower, the bright core) make a stroke glow.
   */
  function layer(g, add, dim) {
    g.globalAlpha = dim;
    const halo = (o) => { if (add > 0) { const s = o.strokeStyle, w = o.lineWidth; o.strokeStyle = o.fillStyle; o.lineWidth = add * 1.4; o.stroke(); o.strokeStyle = s; o.lineWidth = w; } };
    return new Proxy(g, {
      get(o, k) {
        if (k === "fill") return () => { halo(o); o.fill(); };
        if (k === "fillRect") return (x, y, w, h) => { o.beginPath(); o.rect(x, y, w, h); halo(o); o.fill(); };
        const v = o[k]; return typeof v === "function" ? v.bind(o) : v;
      },
      set(o, k, v) { if (k === "lineWidth") o.lineWidth = v + add; else if (k === "globalAlpha") o.globalAlpha = v * dim; else o[k] = v; return true; },
    });
  }
  /** its flicker at a tick: now and then dimmer, and now and then (more when `glitch`) a slice jumping sideways */
  const flicker = (t, glitch = 0) => { const f = Math.floor(t / 2); return { dim: hash(f, 3) < 0.06 ? 0.6 : 0.88 + 0.12 * hash(f, 4), jumpAt: hash(f, 5) < 0.12 + 0.4 * glitch ? hash(f, 6) : -1, jump: hash(f, 7) - 0.5 }; };
  /**
   * The picture made of light, W by H in its own units at the current transform: cut into scan lines `pitch` apart,
   * its strokes glowing, a band of light running down it, and on a flicker a slice jumping. `open` 0 to 1 is a point,
   * a line, then the picture opening from its middle.
   */
  function picture(g, W, H, h, t, pitch, unit) {
    const { dim, jumpAt, jump } = flicker(t, h.glitch), open = clamp01(h.open ?? 1), line = clamp01(open / 0.3), hv = H * ease(clamp01((open - 0.3) / 0.7));
    if (hv <= 0) {
      g.globalAlpha = 0.22 * dim; g.fillStyle = G; g.fillRect(W / 2 - (W * line) / 2, H / 2 - unit * 1.8, W * line, unit * 3.6);
      g.globalAlpha = dim; g.fillStyle = HI; g.fillRect(W / 2 - (W * line) / 2, H / 2 - unit * 0.5, W * line, unit);
      g.globalAlpha = 1; return;
    }
    g.save();
    // only where its scan lines are, and only as far as it has opened
    g.beginPath(); for (let y = H / 2 - hv / 2; y < H / 2 + hv / 2; y += pitch) g.rect(-W * 0.15, y, W * 1.3, pitch * 0.6); g.clip();
    const draw = (dx) => { for (const [add, a] of [[unit * 2.8, 0.13], [unit * 1.2, 0.32], [0, 1]]) { g.save(); g.translate(dx, 0); SHOW[h.kind](layer(g, add, a * dim), W, H, h, t); g.restore(); } };
    if (jumpAt < 0) draw(0);
    else {
      const y0 = jumpAt * H, y1 = y0 + H * 0.12;
      g.save(); g.beginPath(); g.rect(-W, -H, W * 3, y0 + H); g.rect(-W, y1, W * 3, H * 2); g.clip(); draw(0); g.restore();
      g.save(); g.beginPath(); g.rect(-W, y0, W * 3, y1 - y0); g.clip(); draw(jump * W * 0.1); g.restore();
    }
    // a band of light running down it, brightening what it passes over
    const band = ((t % 96) / 96) * H * 1.4 - H * 0.2;
    if (band > -H * 0.1 && band < H) { g.save(); g.beginPath(); g.rect(-W, band, W * 3, H * 0.12); g.clip(); SHOW[h.kind](layer(g, unit * 0.6, 0.55 * dim), W, H, h, t); g.restore(); }
    g.restore();
    if (open < 1) { g.globalAlpha = 0.9 * dim; g.fillStyle = HI; g.fillRect(0, H / 2 - hv / 2, W, unit * 0.8); g.fillRect(0, H / 2 + hv / 2 - unit * 0.8, W, unit * 0.8); }
    g.globalAlpha = 1;
  }

  /** a soft cone of light from the lens to the far edge (a, b) of what it lights, in faint layers and a few rays */
  function cone(g, e, a, b, k, strength = 1) {
    if (strength <= 0) return;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    g.fillStyle = G;
    for (const [w, al] of [[1, 0.03], [0.66, 0.04], [0.33, 0.05]]) {
      g.globalAlpha = al * strength; g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(m[0] + (a[0] - m[0]) * w, m[1] + (a[1] - m[1]) * w); g.lineTo(m[0] + (b[0] - m[0]) * w, m[1] + (b[1] - m[1]) * w); g.closePath(); g.fill();
    }
    g.strokeStyle = G; g.lineWidth = Math.max(0.5, 0.3 * k); g.globalAlpha = 0.14 * strength; g.beginPath();
    for (const u of [0, 0.35, 0.65, 1]) { g.moveTo(e[0], e[1]); g.lineTo(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u); }
    g.stroke(); g.globalAlpha = 1;
  }

  /** the lens: a graphite ring, dark glass, a glint, and when it projects (`on` 0 to 1) a glow */
  function lens(g, p, on) {
    const [x, y, , k] = p, r = 2.6 * k;
    if (on > 0) for (const [s, a] of [[3.2, 0.12], [2, 0.25]]) { g.globalAlpha = a * on; g.fillStyle = G; g.beginPath(); g.arc(x, y, r * s, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1; g.fillStyle = "#5d626b"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = on > 0 ? HI : "#101418"; g.beginPath(); g.arc(x, y, r * 0.62, 0, Math.PI * 2); g.fill();
    if (!on) { g.fillStyle = G; g.globalAlpha = 0.7; g.beginPath(); g.arc(x - r * 0.22, y - r * 0.22, r * 0.18, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
  }

  /**
   * A hologram into Sage's world, from its lens at `eye`. `h` is { kind, open (0 to 1), place "desk" (standing on a
   * shape of light on the desk, `base` or the one that suits its kind) or "air" (floating), at [x, y, z] (the ring's middle, or the picture's), w and h in
   * millimetres, glitch, and what its kind shows }. It always faces the camera.
   */
  function add(S, cam, h, eye, t) {
    const open = clamp01(h.open ?? 1); if (open <= 0) return;
    const W = h.w || 50, Hh = h.h || 44, [cx, cy, cz] = h.at || [70, 0, 30], desk = h.place !== "air", R = [cam.view[0], cam.view[1], cam.view[2]];
    const base = desk ? [cx, 5, cz] : [cx, cy - Hh / 2, cz];
    const at = (u, v) => cam.at([base[0] + R[0] * (u - W / 2), base[1] + (Hh - v), base[2] + R[2] * (u - W / 2)]);
    S.custom({ w: [cx, desk ? 20 : cy, cz], bias: 150, draw(g) {
      const e = cam.at(eye), k = e[3], strength = clamp01(open / 0.3);
      if (desk) {
        // where the beam lands on the desk, in the shape that suits what it shows, the cone onto it, and a faint
        // column of light rising from it to the picture
        const shape = h.base || BASE[h.kind] || "ring", F = [cam.view[6], 0, cam.view[8]], fm = Math.hypot(F[0], F[2]) || 1;
        const on = (u, v) => cam.at([cx + R[0] * u + (F[0] / fm) * v, 0.5, cz + R[2] * u + (F[2] / fm) * v]);
        const glow = (path) => { for (const [lw, a] of [[5 * k, 0.1], [2 * k, 0.28], [0.6 * k, 0.9]]) { g.globalAlpha = a * strength; g.strokeStyle = G; g.lineWidth = lw; g.beginPath(); path(); g.stroke(); } };
        const hw = W * 0.42, hd = W * (shape === "line" ? 0 : shape === "rect" ? 0.2 : 0.42);  // (a square and a ring as deep as they are wide)
        if (shape === "ring") { const p0 = cam.at([cx, 0.5, cz]), px = cam.at([cx + hw, 0.5, cz]), pz = cam.at([cx, 0.5, cz + hw]); glow(() => g.ellipse(p0[0], p0[1], Math.hypot(px[0] - p0[0], px[1] - p0[1]), Math.max(0.6, Math.abs(pz[1] - p0[1])), 0, 0, Math.PI * 2)); }
        else if (shape === "line") { const a = on(-hw, 0), b = on(hw, 0); glow(() => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }); }
        else { const q = [on(-hw, -hd), on(hw, -hd), on(hw, hd), on(-hw, hd)]; glow(() => { q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }); }
        const c0 = on(-hw, 0), c1 = on(hw, 0), t0 = at(0, Hh), t1 = at(W, Hh);
        for (const [sh, al] of [[0, 0.035], [0.18, 0.04]]) { const m = (a, b) => [a[0] + (b[0] - a[0]) * sh, a[1] + (b[1] - a[1]) * sh]; g.globalAlpha = al * strength; g.fillStyle = G; g.beginPath(); const p1 = m(c0, c1), p2 = m(c1, c0), p3 = m(t1, t0), p4 = m(t0, t1); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]); g.closePath(); g.fill(); }
        cone(g, e, on(-hw, -hd), on(hw, -hd), k, strength);
      } else cone(g, e, at(0, Hh), at(0, 0), k, strength * 0.9);
      const o = at(0, 0), x = at(1, 0), y = at(0, 1);
      g.save(); g.transform(x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], o[0], o[1]); picture(g, W, Hh, h, t, 2.4, 0.5); g.restore();
    } });
  }

  /**
   * A board of the Game of Life projected onto the desk from its lens: its grid of light glowing, a scan band sweeping
   * across it, a flicker, and the cone of light from the lens to its far edge. Cells are drawn by design/sage-things.js.
   */
  function board(g, cam, b, eye, t) {
    const { size = 7, c0, r0, c1, r1 } = b, X = (c) => b.x + (c - 0.5) * size, Z = (r) => (b.z ?? 0) - (r - 0.5) * size;
    const { dim } = flicker(t), a = (b.alpha ?? 0.16) * dim, k = cam.at([b.x, 0, b.z ?? 0])[3];
    const lines = () => { g.beginPath(); for (let c = c0; c <= c1 + 1; c++) { const p = cam.at([X(c), 0, Z(r0)]), q = cam.at([X(c), 0, Z(r1 + 1)]); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); } for (let r = r0; r <= r1 + 1; r++) { const p = cam.at([X(c0), 0, Z(r)]), q = cam.at([X(c1 + 1), 0, Z(r)]); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); } };
    if (eye) {
      // the cone from the lens to the board's far edge, faint, so the board reads as thrown there
      const far = [cam.at([X(c0), 0, Z(r1 + 1)]), cam.at([X(c1 + 1), 0, Z(r1 + 1)]), cam.at([X(c1 + 1), 0, Z(r0)]), cam.at([X(c0), 0, Z(r0)])];
      const e = cam.at(eye); far.sort((p, q) => Math.hypot(q[0] - e[0], q[1] - e[1]) - Math.hypot(p[0] - e[0], p[1] - e[1]));
      cone(g, e, far[0], far[1], k, (b.alpha ?? 0.16) / 0.16);
    }
    // (round caps: the only kind the board draws)
    g.strokeStyle = G; g.lineCap = "round";
    lines(); g.globalAlpha = a * 0.5; g.lineWidth = 2.6 * k; g.stroke(); g.globalAlpha = a * 1.6; g.lineWidth = Math.max(0.6, 0.35 * k); g.stroke();
    // a band of brighter light sweeping across it, row by row
    const span = r1 + 1 - r0, rb = r0 + ((t % 72) / 72) * (span + 2) - 1;
    if (rb >= r0 && rb <= r1) { const q = [cam.at([X(c0), 0.3, Z(rb)]), cam.at([X(c1 + 1), 0.3, Z(rb)]), cam.at([X(c1 + 1), 0.3, Z(rb + 1)]), cam.at([X(c0), 0.3, Z(rb + 1)])]; g.globalAlpha = a * 0.6; g.fillStyle = G; g.beginPath(); q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); }
    g.globalAlpha = 1;
  }

  /** the hologram taking the whole screen (240 by 240), Sage out of sight while it lasts */
  function screen(ctx, h, t) {
    ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 240, 240);
    const g = SageDraw.flat(ctx);
    g.save(); g.translate(24, 34); picture(g, 192, 172, h, t, 3, 1); g.restore();
  }

  window.SageHolo = { add, board, screen, lens, digits };
})();
