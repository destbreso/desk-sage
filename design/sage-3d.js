// A small 3D world of flat shapes for Sage and the things around it, drawn as the board's instructions (flat fills and
// strokes): rounded boxes, balls and discs in millimetres, placed by real rotations, seen by a camera with a little
// perspective that can orbit, tilt, travel and zoom. Each shape's outline is its true projection (the convex hull of its
// core, rounded by its radius), each face that shows is its projected quadrilateral, lit by a light fixed in the world,
// and what is drawn on a face (a visor, a plate, treads) is drawn in that face's own millimetres through the exact map
// of its plane onto the screen. Shapes are drawn far to near. Part of Sage's art: see LICENSE-ART.md.
(function () {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixc = (a, b, u) => { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * u).toString(16).padStart(2, "0")).join(""); };
  const ramp = (dark, lit, n) => Array.from({ length: n }, (_, i) => mixc(dark, lit, i / (n - 1)));

  // ── 3 by 3 rotations, row-major; a point is turned by m · p ──
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => scl(a, 1 / Math.hypot(...a));

  /** A frame: where a part sits and how it is turned; `then` places another inside it. */
  const frame = (pos = [0, 0, 0], rot = I) => ({ pos, rot, at: (p) => add(pos, apply(rot, p)), then: (p, r = I) => frame(add(pos, apply(rot, p)), mul(rot, r)) });

  // the light, fixed in the world: from the upper left, a little in front
  const LIGHT = norm([-0.5, 0.75, 0.55]);

  /**
   * The camera: it looks at `target` from `orbit` round it and `tilt` above it (below when negative), `k` pixels a
   * millimetre at the target, `persp` how strongly what is near grows (0 none), the target at screen (ox, oy).
   */
  function camera({ k = 1.42, ox = 120, oy = 120, target = [0, 76, 0], orbit = 0, tilt = 0, persp = 0.0012 } = {}) {
    const view = mul(rotX(tilt), rotY(-orbit)); // world to camera: x right, y up, z toward the eye
    const cp = Math.cos(tilt), sp = Math.sin(tilt);
    const cam = {
      k, orbit, tilt, cp, sp, view,
      /** a world point on the screen: [x, y, depth toward the eye, pixels a millimetre there] */
      at(p) { const c = apply(view, [p[0] - target[0], p[1] - target[1], p[2] - target[2]]), s = k / Math.max(0.2, 1 - c[2] * persp); return [ox + c[0] * s, oy - c[1] * s, c[2], s]; },
      /** a direction in the world, in camera space */
      dir(v) { return apply(view, v); },
    };
    return cam;
  }

  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2))); }
  function ball(g, cx, cy, r, tones, spec = 0.5, lx = -0.45, ly = -0.55) {
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = tones[0]; g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    tones.forEach((t, i) => { if (!i) return; const u = i / tones.length; g.beginPath(); g.arc(cx + lx * r * 0.55 * u, cy + ly * r * 0.55 * u, r * (1 - u * 0.55), 0, Math.PI * 2); g.fillStyle = t; g.fill(); });
    if (spec) { g.globalAlpha = spec; g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(cx + lx * r * 0.62, cy + ly * r * 0.7, r * 0.26, r * 0.13, Math.atan2(ly, lx) + Math.PI / 2, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    g.restore();
  }
  /** A rounded rectangle shaded in steps toward the upper left (for flat things drawn on a face). */
  function shaded(g, x, y, w, h, r, tones, { spec = 0.4 } = {}) {
    rr(g, x, y, w, h, r); g.fillStyle = tones[0]; g.fill();
    g.save(); rr(g, x, y, w, h, r); g.clip();
    for (let i = 1; i < tones.length; i++) { const u = i / tones.length, s = 1 - u * 0.62; rr(g, x - w * 0.05 + w * (1 - s) * 0.18, y - h * 0.05 + h * (1 - s) * 0.14, w * s * 1.06, h * s * 1.06, r * s); g.fillStyle = tones[i]; g.fill(); }
    if (spec) { g.globalAlpha = spec; g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(x + w * 0.3, y + h * 0.17, Math.abs(w) * 0.17, Math.abs(h) * 0.055, -0.25, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }

  /** the convex hull of 2D points (monotone chain), counter-clockwise on the screen */
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  /** a convex polygon grown by `r` all round: its edges pushed out, its corners round */
  function roundedHull(g, pts, r) {
    const h = hull(pts), n = h.length;
    g.beginPath();
    if (n < 3) { const [x, y] = h[0] || [0, 0]; g.arc(x, y, r, 0, Math.PI * 2); return; }
    for (let i = 0; i < n; i++) {
      const a = h[(i + n - 1) % n], b = h[i], c = h[(i + 1) % n];
      const n1 = Math.atan2(-(b[0] - a[0]), b[1] - a[1]), n2 = Math.atan2(-(c[0] - b[0]), c[1] - b[1]);
      // (outward normals of the edges in and out of this corner: the arc between them, round the corner)
      let a1 = n1, a2 = n2;
      if (a2 < a1) a2 += Math.PI * 2;
      g.arc(b[0], b[1], r, a1, a2);
    }
    g.closePath();
  }

  // The six faces of a box: [normal, along-the-face x, along-the-face y as drawn (screen-down when seen from outside)].
  const FACES = {
    front: [[0, 0, 1], [1, 0, 0], [0, -1, 0]], back: [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],
    right: [[1, 0, 0], [0, 0, -1], [0, -1, 0]], left: [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
    top: [[0, 1, 0], [1, 0, 0], [0, 0, 1]], bottom: [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
  };

  /** a scene: shapes added in any order, drawn far to near */
  function scene(cam) {
    const shapes = [];
    const put = (s) => (shapes.push(s), s);
    return {
      cam,
      /** A rounded box W by H by D in a frame `f`, its centre at `c` in the frame. `faces.front(g, w, h)` and the
       *  others draw on that face in its own millimetres, (0, 0) its top left as seen from outside. */
      box(o) { return put({ kind: "box", ...o }); },
      ball(o) { return put({ kind: "ball", ...o }); },
      /** a disc of radius R in a frame, facing along the frame's x (a wheel), its spokes turned by `spin` */
      disc(o) { return put({ kind: "disc", ...o }); },
      /** anything else, drawn at its world point `w` by `draw(g, cam)` */
      custom(o) { return put({ kind: "custom", ...o }); },
      draw(g) {
        for (const s of shapes) s.depth = cam.at(s.kind === "custom" ? s.w : s.f.at(s.c || [0, 0, 0]))[2] + (s.bias || 0);
        shapes.map((s, i) => [s, i]).sort((a, b) => a[0].depth - b[0].depth || a[1] - b[1]).forEach(([s]) => { g.save(); if (s.alpha !== undefined) g.globalAlpha = s.alpha; DRAW[s.kind](g, cam, s); g.restore(); });
      },
    };
  }

  const DRAW = {
    box(g, cam, b) {
      const sc = b.scale ?? 1, W = b.W * sc, H = b.H * sc, D = b.D * sc, r = Math.min((b.r ?? 4) * sc, W / 2, H / 2, D / 2) * 0.999;
      const fr = b.f.then(b.c || [0, 0, 0]), core = [W / 2 - r, H / 2 - r, D / 2 - r];
      const pts = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(cam.at(fr.at([sx * core[0], sy * core[1], sz * core[2]])));
      const kMid = cam.at(fr.at([0, 0, 0]))[3];
      // its outline, then the same outline in steps, smaller and lighter, drawn toward the light as the camera sees it
      const outline = pts.map((p) => [p[0], p[1]]), hl = hull(outline), lc = cam.dir(LIGHT), lm = Math.hypot(lc[0], lc[1]) || 1;
      let cx = 0, cy = 0; for (const [x, y] of hl) { cx += x / hl.length; cy += y / hl.length; }
      let ext = 0; for (const [x, y] of hl) ext = Math.max(ext, Math.hypot(x - cx, y - cy));
      const ax = cx + (lc[0] / lm) * (ext + r * kMid) * 0.42, ay = cy - (lc[1] / lm) * (ext + r * kMid) * 0.42;
      roundedHull(g, outline, r * kMid); g.fillStyle = b.tones[0]; g.fill();
      // (the steps shrink toward a point inside it, so they never leave the outline: no clip needed)
      g.save();
      // (four steps on a large part, two on a small one: each step is the whole outline again, and bytes on the board)
      const n = b.tones.length, steps = b.steps ?? (Math.max(W, H, D) >= 30 ? 4 : 2);
      for (let i = 1; i <= steps; i++) { const ti = Math.round((i * (n - 1)) / steps), sF = 1 - (i / (steps + 1)) * 0.62; roundedHull(g, outline.map(([x, y]) => [ax + (x - ax) * sF, ay + (y - ay) * sF]), r * kMid * sF); g.fillStyle = b.tones[ti]; g.fill(); }
      if ((b.spec ?? 0.5) > 0) { g.globalAlpha = (b.spec ?? 0.5) * 0.8; g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(ax + (cx - ax) * 0.25, ay + (cy - ay) * 0.25, Math.max(1, ext * 0.22), Math.max(1, ext * 0.07), Math.atan2(cy - ay, cx - ax) + Math.PI / 2, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
      g.restore();
      // each face that shows: its plane marked only by a little shade when it turns from the light, then what is on it
      const half = { front: [W, H, D], back: [W, H, D], right: [D, H, W], left: [D, H, W], top: [W, D, H], bottom: [W, D, H] };
      for (const [name, [n0, u, v]] of Object.entries(FACES)) {
        const nw = apply(fr.rot, n0), nc = cam.dir(nw);
        if (nc[2] <= 0.02) continue;
        const [fw, fh, depth] = half[name], c0 = fr.at(scl(n0, depth / 2)), uw = apply(fr.rot, u), vw = apply(fr.rot, v);
        const iw = Math.max(0.01, fw / 2 - r), ih = Math.max(0.01, fh / 2 - r);
        const lit = Math.max(0, dot(nw, LIGHT));
        if (lit < 0.6) {
          const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, bb]) => cam.at(add(c0, add(scl(uw, a * iw), scl(vw, bb * ih)))));
          g.beginPath(); q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.globalAlpha = (0.6 - lit) * 0.38; g.fillStyle = "#000000"; g.fill(); g.globalAlpha = 1;
        }
        const paint = b.faces && b.faces[name];
        if (paint) {
          // the face's own millimetres onto the screen: x along u, y along v, (0, 0) at its top left
          const o = cam.at(add(c0, add(scl(uw, -fw / 2), scl(vw, -fh / 2)))), px = cam.at(add(c0, add(scl(uw, 1 - fw / 2), scl(vw, -fh / 2)))), py = cam.at(add(c0, add(scl(uw, -fw / 2), scl(vw, 1 - fh / 2))));
          g.save(); g.transform(px[0] - o[0], px[1] - o[1], py[0] - o[0], py[1] - o[1], o[0], o[1]);
          paint(g, fw, fh, { lit, facing: nc[2] });
          g.restore();
        }
      }
      // the prism's own light on the far rim
      if ((b.rimA ?? (Math.max(W, H, D) >= 30 ? 0.3 : 0)) > 0) { g.save(); roundedHull(g, pts.map((p) => [p[0], p[1]]), r * kMid); g.clip(); g.globalAlpha = b.rimA ?? 0.3; g.strokeStyle = "#cfe8d6"; g.lineWidth = Math.max(1, 1.2 * kMid); roundedHull(g, pts.map((p) => [p[0] + 1.2 * kMid, p[1] + 1.2 * kMid]), r * kMid); g.stroke(); g.restore(); }
    },
    ball(g, cam, b) {
      const p = cam.at(b.f.at(b.c || [0, 0, 0])), l = cam.dir(LIGHT), m = Math.hypot(l[0], l[1]) || 1;
      const tn = b.tones, few = [tn[0], tn[Math.floor((tn.length - 1) / 2)], tn[tn.length - 1]];
      ball(g, p[0], p[1], b.R * p[3] * (b.scale ?? 1), few, b.spec ?? 0.5, (l[0] / m) * 0.8, (-l[1] / m) * 0.8);
    },
    disc(g, cam, d) {
      // a circle in the frame's y-z plane is an ellipse on the screen: drawn as the unit circle through its exact map
      const fr = d.f.then(d.c || [0, 0, 0]), o = cam.at(fr.at([0, 0, 0])), u = cam.at(fr.at([0, 0, d.R])), v = cam.at(fr.at([0, -d.R, 0]));
      const side = cam.dir(apply(fr.rot, [1, 0, 0]))[2];
      g.save(); g.transform(u[0] - o[0], u[1] - o[1], v[0] - o[0], v[1] - o[1], o[0], o[1]);
      g.fillStyle = d.tones[1]; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
      if (Math.abs(side) > 0.25) {
        g.fillStyle = d.tones[3]; g.beginPath(); g.arc(0, 0, 0.8, 0, Math.PI * 2); g.fill();
        g.strokeStyle = d.tones[d.tones.length - 1]; g.lineWidth = 0.12; g.lineCap = "round";
        for (let i = 0; i < 4; i++) { const a = (d.spin || 0) + (i * Math.PI) / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(0.72 * Math.cos(a), 0.72 * Math.sin(a)); g.stroke(); }
      }
      if (d.hub) { g.fillStyle = d.hub; g.beginPath(); g.arc(0, 0, 0.2, 0, Math.PI * 2); g.fill(); }
      g.restore();
    },
    custom(g, cam, o) { o.draw(g, cam); },
  };

  window.Sage3D = { camera, scene, frame, rotX, rotY, rotZ, mul, apply, I, ball, shaded, rr, ramp, mixc, LIGHT };
})();
