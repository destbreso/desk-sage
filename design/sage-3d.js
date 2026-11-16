// A small world of flat shapes for Sage and the things that appear around it: rounded boxes, balls, rods and discs in
// millimetres (x across, y up, z toward the camera when nothing is turned), seen by a camera that orbits, tilts (from
// above or from below) and zooms, each shape projected, its faces shaded in flat steps (the top lit, the side away
// from the light darker, the bottom in shadow) and the shapes drawn far to near. Only flat fills and strokes, so the
// board draws every frame as instructions. Part of Sage's art: see LICENSE-ART.md.
(function () {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixc = (a, b, u) => { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * u).toString(16).padStart(2, "0")).join(""); };
  const ramp = (dark, lit, n) => Array.from({ length: n }, (_, i) => mixc(dark, lit, i / (n - 1)));
  const RIM = "#cfe8d6";

  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
  /** A rounded rectangle shaded in steps toward the light (the upper left), a specular spot, a rim of the prism's light. */
  function shaded(g, x, y, w, h, r, tones, { spec = 0.5, rimA = 0.35 } = {}) {
    rr(g, x, y, w, h, r); g.fillStyle = tones[0]; g.fill();
    g.save(); rr(g, x, y, w, h, r); g.clip();
    const n = tones.length;
    for (let i = 1; i < n; i++) {
      const u = i / n, s = 1 - u * 0.62, iw = w * s, ih = h * s;
      rr(g, x - w * 0.05 + (w - iw) * 0.18, y - h * 0.05 + (h - ih) * 0.14, iw * 1.06, ih * 1.06, r * s); g.fillStyle = tones[i]; g.fill();
    }
    if (spec) { g.globalAlpha = spec; g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(x + w * 0.3, y + h * 0.17, w * 0.17, h * 0.055, -0.25, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    if (rimA) { g.globalAlpha = rimA; g.strokeStyle = RIM; g.lineWidth = Math.max(1, w * 0.025); rr(g, x + w * 0.03, y + h * 0.03, w, h, r); g.stroke(); g.globalAlpha = 1; }
    g.restore();
  }
  function ball(g, cx, cy, r, tones, spec = 0.5) {
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = tones[0]; g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    tones.forEach((t, i) => { if (!i) return; const u = i / tones.length; g.beginPath(); g.arc(cx - r * 0.25 * u, cy - r * 0.25 * u, r * (1 - u * 0.55), 0, Math.PI * 2); g.fillStyle = t; g.fill(); });
    if (spec) { g.globalAlpha = spec; g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(cx - r * 0.35, cy - r * 0.42, r * 0.28, r * 0.14, -0.5, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    g.restore();
  }

  /**
   * A camera: `k` pixels a millimetre, the world's origin at screen (`ox`, `oy`), `orbit` turning the world about its
   * vertical axis, `tilt` looking down on it (positive) or up at it (negative), in radians.
   */
  function camera({ k = 1.42, ox = 120, oy = 228, orbit = 0, tilt = 0 } = {}) {
    const co = Math.cos(orbit), so = Math.sin(orbit), cp = Math.cos(tilt), sp = Math.sin(tilt);
    return {
      k, orbit, tilt, cp, sp,
      /** a world point on the screen, with its depth toward the camera */
      at(x, y, z) { const x1 = x * co + z * so, z1 = -x * so + z * co; return [ox + x1 * k, oy - (y * cp - z1 * sp) * k, y * sp + z1 * cp]; },
    };
  }

  /**
   * A scene: shapes added in any order, drawn far to near. Every shape has a world centre, a yaw of its own (added to
   * the camera's orbit), and screen turns about points (a lean, a head's roll) applied as it is drawn.
   */
  function scene(cam) {
    const shapes = [];
    const add = (shape) => (shapes.push(shape), shape);
    return {
      cam, add,
      /** A rounded box W across, H high, D deep; `front`, `top`, `bottom` draw on those faces. */
      box(o) { return add({ kind: "box", ...o }); },
      ball(o) { return add({ kind: "ball", ...o }); },
      /** a rod standing up (a leg, a neck), r round, H high */
      rod(o) { return add({ kind: "box", W: o.r * 2, D: o.r * 2, r: o.r * 0.95, rimA: 0.25, ...o }); },
      /** a disc facing along its local x (a wheel), r round */
      disc(o) { return add({ kind: "disc", ...o }); },
      /** anything else, drawn at its centre's depth by `draw(g, cam)` */
      custom(o) { return add({ kind: "custom", ...o }); },
      draw(g) {
        for (const sh of shapes) sh.depth = cam.at(sh.c[0], sh.c[1], sh.c[2])[2] + (sh.bias || 0);
        const order = shapes.map((s, i) => [s, i]).sort((a, b) => a[0].depth - b[0].depth || a[1] - b[1]);
        for (const [sh] of order) {
          g.save();
          for (const t of sh.turns || []) { g.translate(t[0], t[1]); g.rotate(t[2]); g.translate(-t[0], -t[1]); }
          if (sh.alpha !== undefined) g.globalAlpha = sh.alpha;
          DRAW[sh.kind](g, cam, sh);
          g.restore();
        }
      },
    };
  }

  const DRAW = {
    box(g, cam, b) {
      const yaw = (b.yaw || 0) + cam.orbit, c = Math.cos(yaw), s = Math.sin(yaw), k = cam.k, sc = b.scale ?? 1;
      const W = b.W * sc, H = b.H * sc, D = b.D * sc, r = (b.r ?? 4) * sc;
      const deep = W * Math.abs(s) + D * Math.abs(c);
      const w = W * Math.abs(c) + D * Math.abs(s), h = H * cam.cp + deep * Math.abs(cam.sp);
      const [sx, sy] = cam.at(...b.c);
      const x0 = sx - (w * k) / 2, y0 = sy - (h * k) / 2;
      shaded(g, x0, y0, w * k, h * k, r * k, b.tones, { spec: b.spec ?? 0.5, rimA: b.rimA ?? 0.35 });
      // where its upright faces are on the screen, and its top or bottom
      const vh = H * cam.cp, capH = deep * Math.abs(cam.sp), capOnTop = cam.sp > 0;
      const vy0 = capOnTop ? y0 + capH * k : y0;
      const fdir = Math.sign(c || 1), fcx = sx + ((D / 2) * fdir * s) * k * 1, fw = W * Math.abs(c), sw = D * Math.abs(s);
      g.save(); rr(g, x0, y0, w * k, h * k, r * k); g.clip();
      if (sw > 0.5) {
        const onRight = fcx < sx, xs = onRight ? x0 + (w - sw) * k : x0;
        g.globalAlpha = onRight ? 0.06 + 0.2 * Math.min(1, fw / 20) : 0.07; g.fillStyle = onRight ? "#000000" : "#ffffff"; g.fillRect(xs, vy0, sw * k, vh * k);
        g.globalAlpha = 0.35; g.strokeStyle = RIM; g.lineWidth = Math.max(1, 0.5 * k);
        const edge = onRight ? xs : xs + sw * k; g.beginPath(); g.moveTo(edge, vy0 + r * 0.6 * k); g.lineTo(edge, vy0 + (vh - r * 0.6) * k); g.stroke();
      }
      if (capH > 0.5) {
        // the top in the light from above, the bottom in shadow from below
        g.globalAlpha = capOnTop ? 0.12 : 0.3; g.fillStyle = capOnTop ? "#ffffff" : "#000000";
        rr(g, x0, capOnTop ? y0 : y0 + vh * k, w * k, capH * k, r * k); g.fill();
      }
      g.restore();
      const face = { x: fcx - (fw * k) / 2, y: vy0, w: fw * k, h: vh * k, facing: c, side: s, k };
      if (b.front && c > 0.12) b.front(g, face);
      if (b.back && c < -0.12) b.back(g, { ...face, w: fw * k });
      if (b.edge && Math.abs(c) <= 0.12) b.edge(g, { x: sx + (D / 2) * Math.sign(s || 1) * k, y: vy0, h: vh * k, dir: Math.sign(s || 1), k });
      if (b.top && capOnTop && capH > 0.5) b.top(g, { x: x0, y: y0, w: w * k, h: capH * k, k, yaw });
      if (b.bottom && !capOnTop && capH > 0.5) b.bottom(g, { x: x0, y: y0 + vh * k, w: w * k, h: capH * k, k, yaw });
    },
    ball(g, cam, b) { const [sx, sy] = cam.at(...b.c); ball(g, sx, sy, b.R * cam.k * (b.scale ?? 1), b.tones, b.spec ?? 0.5); },
    disc(g, cam, d) {
      const yaw = (d.yaw || 0) + cam.orbit, c = Math.cos(yaw), s = Math.sin(yaw), k = cam.k, [sx, sy] = cam.at(...d.c);
      const rx = (d.R * Math.abs(s) + (d.T || 1) * Math.abs(c)) * k, ry = d.R * Math.max(cam.cp, Math.abs(c * cam.sp)) * k;
      g.fillStyle = d.tones[1]; g.beginPath(); g.ellipse(sx, sy, Math.max(1, rx), ry, 0, 0, Math.PI * 2); g.fill();
      if (Math.abs(s) > 0.3) {
        g.fillStyle = d.tones[3]; g.beginPath(); g.ellipse(sx, sy, rx * 0.8, ry * 0.8, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = d.tones[5] || d.tones[d.tones.length - 1]; g.lineWidth = Math.max(1, 0.7 * k); g.lineCap = "round";
        for (let i = 0; i < 4; i++) { const a = (d.spin || 0) + (i * Math.PI) / 2; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + rx * 0.72 * Math.cos(a) * Math.sign(s), sy - ry * 0.72 * Math.sin(a)); g.stroke(); }
      }
      if (d.hub) { g.fillStyle = d.hub; g.beginPath(); g.arc(sx, sy, 1.1 * k, 0, Math.PI * 2); g.fill(); }
    },
    custom(g, cam, o) { o.draw(g, cam); },
  };

  window.Sage3D = { camera, scene, shaded, ball, rr, ramp, mixc };
})();
