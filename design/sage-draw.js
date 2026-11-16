// Sage drawn for the prism, illustrated: each part shaded in steps toward the light (the upper left), a specular spot,
// the prism's light on its edges, contact shadows, the visor's bezel and glass, seams, screws, treads and hubs, from the
// 3D model's own measurements in millimetres (the floor at 0, y up), its face the website's own
// (design/site/sage-site.js). Only flat fills and strokes, through flat(), so the board draws every frame as
// instructions. Part of Sage's art: see LICENSE-ART.md.
(function () {
  const { drawSageFace, SAGE_GREEN } = SageSite;

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixc = (a, b, u) => { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * u).toString(16).padStart(2, "0")).join(""); };
  const ramp = (dark, lit, n) => Array.from({ length: n }, (_, i) => mixc(dark, lit, i / (n - 1)));
  // Tones for the prism: black turns to glass, so the graphite and rubber are lifted from the room's or they vanish.
  const SHELL = ramp("#a99f8d", "#fbf8f1", 8), GRAPH = ramp("#33363c", "#8a8f98", 6), RUBBER = ramp("#1f2124", "#55585e", 5);
  const AMBER = ramp("#8a5a1a", "#ffe1a8", 4), ANT = ramp("#4f8a4b", "#d8f7d2", 4), PAPER = ramp("#bdb3a0", "#f6f1e6", 4), PAD = ramp("#24312a", "#4a6656", 4);
  const T = { green: SAGE_GREEN, amber: "#ffb347", ink: "#8f8676", seam: "#8f8676", hole: "#16181b", holeLit: "#7d828b", screw: "#9aa0a8", hub: "#b9bdc4", tread: "#17181a", rim: "#cfe8d6" };

  // The camera: `z` 0 shows the whole of it, 1 its head close.
  const CAM = { body: { k: 1.42, x: 120, y: 228 }, close: { k: 2.3, x: 120, y: 368 } };
  const mix = (a, b, u) => a + (b - a) * u;

  /** A pose: everything a drawing of Sage can set, in millimetres and radians. */
  const POSE = {
    z: 0, x: 0, depth: 0, lift: 0, crouch: 0, lean: 0, roll: 0, nod: 0, foot: 0, yaw: 0, headYaw: 0, wheel: 0,
    // (a camera a little above it by default, so the desk and what lies on it read)
    tilt: 0.12, orbit: 0, zoom: 1, camX: 0, camY: 0, things: null, bar: 0, footSide: 1, squash: 0, antennaBend: 0, bow: 0,
    mood: "calm", look: [0, 0], shut: 0, squeezed: false, eyes: null, antenna: 0.7,
    book: 0, page: 0, light: 0, charger: 0, signal: 0, rise: 0, burst: 0, amber: false,
  };

  /**
   * The canvas the board can draw: arcTo (which the website's face uses) becomes the line and arc it traces, and
   * shadows (its glow) are dropped, as glow() draws them in flat layers instead. Nothing else is changed.
   */
  function flat(ctx) {
    let cur = null, start = null;
    const at = (x, y) => (cur = [x, y]);
    // (the transform kept here too, so transform() can become the setTransform the board has, never read off the canvas)
    let m = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const mult = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
    const api = {
      save() { stack.push(m); ctx.save(); },
      restore() { if (stack.length) m = stack.pop(); ctx.restore(); },
      translate(x, y) { m = mult(m, [1, 0, 0, 1, x, y]); ctx.translate(x, y); },
      rotate(a) { const c = Math.cos(a), s = Math.sin(a); m = mult(m, [c, s, -s, c, 0, 0]); ctx.rotate(a); },
      scale(x, y) { m = mult(m, [x, 0, 0, y, 0, 0]); ctx.scale(x, y); },
      setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; ctx.setTransform(a, b, c, d, e, f); },
      transform(a, b, c, d, e, f) { m = mult(m, [a, b, c, d, e, f]); ctx.setTransform(...m); },
      beginPath() { cur = start = null; ctx.beginPath(); },
      moveTo(x, y) { start = [x, y]; at(x, y); ctx.moveTo(x, y); },
      lineTo(x, y) { if (!cur) start = [x, y]; at(x, y); ctx.lineTo(x, y); },
      closePath() { if (start) at(...start); ctx.closePath(); },
      arc(x, y, r, a0, a1, ccw) { ctx.arc(x, y, r, a0, a1, ccw); at(x + r * Math.cos(a1), y + r * Math.sin(a1)); },
      roundRect(x, y, w, h, r) { ctx.roundRect(x, y, w, h, r); start = [x, y]; at(x, y); },
      rect(x, y, w, h) { ctx.rect(x, y, w, h); start = [x, y]; at(x, y); },
      arcTo(x1, y1, x2, y2, r) {
        if (!cur) { api.moveTo(x1, y1); return; }
        const [x0, y0] = cur;
        const ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        const turn = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1);
        if (r <= 0 || la < 1e-9 || lb < 1e-9 || Math.abs(turn) < 1e-9) return api.lineTo(x1, y1);
        const ux = ax / la, uy = ay / la, vx = bx / lb, vy = by / lb;
        const half = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy))) / 2;
        const d = r / Math.tan(half), m = r / Math.sin(half);
        const bxn = ux + vx, byn = uy + vy, bl = Math.hypot(bxn, byn);
        const cx = x1 + (bxn / bl) * m, cy = y1 + (byn / bl) * m;
        const t1x = x1 + ux * d, t1y = y1 + uy * d, t2x = x1 + vx * d, t2y = y1 + vy * d;
        api.lineTo(t1x, t1y);
        api.arc(cx, cy, r, Math.atan2(t1y - cy, t1x - cx), Math.atan2(t2y - cy, t2x - cx), turn < 0);
      },
    };
    return new Proxy(ctx, {
      get(t, k) { if (k in api) return api[k]; const v = t[k]; return typeof v === "function" ? v.bind(t) : v; },
      set(t, k, v) { if (k !== "shadowBlur" && k !== "shadowColor" && k !== "shadowOffsetX" && k !== "shadowOffsetY") t[k] = v; return true; },
    });
  }

  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
  /** A rounded part shaded in steps toward the light, with a specular spot and the prism's light on its far edge. */
  function shaded(g, x, y, w, h, r, tones, { spec = 0.5, rimA = 0.35 } = {}) {
    rr(g, x, y, w, h, r); g.fillStyle = tones[0]; g.fill();
    g.save(); rr(g, x, y, w, h, r); g.clip();
    const n = tones.length;
    for (let i = 1; i < n; i++) {
      const u = i / n, s = 1 - u * 0.62, iw = w * s, ih = h * s;
      rr(g, x - w * 0.05 + (w - iw) * 0.18, y - h * 0.05 + (h - ih) * 0.14, iw * 1.06, ih * 1.06, r * s); g.fillStyle = tones[i]; g.fill();
    }
    if (spec) { g.globalAlpha = spec; g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(x + w * 0.3, y + h * 0.17, w * 0.17, h * 0.055, -0.25, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    if (rimA) { g.globalAlpha = rimA; g.strokeStyle = T.rim; g.lineWidth = Math.max(1, w * 0.025); rr(g, x + w * 0.03, y + h * 0.03, w, h, r); g.stroke(); g.globalAlpha = 1; }
    g.restore();
  }
  function ball(g, cx, cy, r, tones, spec = 0.5) {
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = tones[0]; g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    tones.forEach((t, i) => { if (!i) return; const u = i / tones.length; g.beginPath(); g.arc(cx - r * 0.25 * u, cy - r * 0.25 * u, r * (1 - u * 0.55), 0, Math.PI * 2); g.fillStyle = t; g.fill(); });
    if (spec) { g.globalAlpha = spec; g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(cx - r * 0.35, cy - r * 0.42, r * 0.28, r * 0.14, -0.5, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    g.restore();
  }
  /** A soft shadow where one part meets another, as three flat ellipses. */
  function shadowUnder(g, cx, cy, w, h, a = 0.45) {
    for (let i = 0; i < 3; i++) { g.globalAlpha = a / (i + 1.6); g.fillStyle = "#000000"; g.beginPath(); g.ellipse(cx, cy, w * (1 - i * 0.18), h * (1 - i * 0.18), 0, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  }
  /** The glow the room gets from a blur, as three larger, fainter copies behind the thing itself. */
  function glow(g, cx, cy, draw) {
    for (const [grow, a] of [[0.16, 0.09], [0.07, 0.18]]) { g.save(); g.globalAlpha = a; g.translate(cx, cy); g.scale(1 + grow, 1 + grow); g.translate(-cx, -cy); draw(); g.restore(); }
    draw();
  }

  // What its visor shows besides its eyes, all its own: a glider of the Game of Life crossing it (all is well), a
  // block of cells breaking into amber (something failed), cells lighting one by one (progress), a slow wave (asleep),
  // a shutter down (do not disturb), dizzy spirals, the website's prompt.
  const GLIDER = [[[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]], [[0, 1], [2, 1], [1, 2], [2, 2], [1, 3]], [[2, 1], [0, 2], [2, 2], [1, 3], [2, 3]], [[1, 1], [2, 2], [3, 2], [1, 3], [2, 3]]];
  function cell(g, x, y, s) { rr(g, x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.22); g.fill(); }
  function special(g, x, y, w, h, eyes, t, bar = 0) {
    g.fillStyle = "#000000"; rr(g, x, y, w, h, h * 0.24); g.fill();
    const cy = y + h / 2, s = h * 0.13;
    g.fillStyle = g.strokeStyle = T.green; g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = Math.max(0.8, h * 0.06);
    if (eyes === "glider") {
      // its four phases, one cell further down and across every four
      const ph = Math.floor(t / 4) % 4, step = Math.floor(t / 16) % 6, ox = x + w * 0.2 + step * s, oy = y + h * 0.08 + step * s * 0.5;
      g.save(); rr(g, x, y, w, h, h * 0.24); g.clip(); for (const [cx, cyy] of GLIDER[ph]) cell(g, ox + cx * s, oy + cyy * s, s); g.restore();
    } else if (eyes === "ash") {
      // a block that comes apart: its cells drifting out, one going amber
      const u = (t % 48) / 48;
      [[-1, -1], [0, -1], [-1, 0], [0, 0]].forEach(([dx, dy], i) => { g.globalAlpha = 1 - u * 0.7; g.fillStyle = i === 3 ? T.amber : T.green; cell(g, x + w / 2 + (dx + 0.5 * (dx + 0.5) * u * 4) * s - s / 2, cy + (dy + 0.5 * (dy + 0.5) * u * 4) * s - s / 2, s); });
      g.globalAlpha = 1;
    } else if (eyes === "cells") {
      // a row of ten cells lit one by one as it goes
      for (let i = 0; i < 10; i++) { g.globalAlpha = i < Math.round(bar * 10) ? 1 : 0.18; cell(g, x + w * 0.1 + i * (w * 0.8 / 10), cy - (w * 0.8 / 10) / 2, w * 0.8 / 10); }
      g.globalAlpha = 1;
    } else if (eyes === "sleep") {
      // asleep: its eyes a slow wave, rising and falling as it breathes
      g.globalAlpha = 0.85; g.beginPath();
      for (let i = 0; i <= 24; i++) { const px = x + w * (0.18 + 0.64 * i / 24), py = cy + Math.sin(i / 24 * Math.PI * 2 + Math.floor(t / 4) / 3) * h * 0.06; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke(); g.globalAlpha = 1;
    } else if (eyes === "shutter") {
      // do not disturb: closed eyes, and a graphite shutter lowered over the top of its visor
      for (const cx of [x + w * 0.3, x + w * 0.7]) { g.beginPath(); g.moveTo(cx - w * 0.08, cy + h * 0.08); g.lineTo(cx + w * 0.08, cy + h * 0.08); g.stroke(); }
      g.save(); rr(g, x, y, w, h, h * 0.24); g.clip(); g.fillStyle = GRAPH[1]; g.fillRect(x, y, w, h * 0.46);
      g.strokeStyle = GRAPH[3]; g.lineWidth = Math.max(0.6, h * 0.02); for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x, y + h * 0.115 * i); g.lineTo(x + w, y + h * 0.115 * i); g.stroke(); } g.restore();
    } else if (eyes === "dizzy") for (const cx of [x + w * 0.3, x + w * 0.7]) { g.beginPath(); for (let a = 0; a < Math.PI * 4; a += 0.35) { const r = h * 0.17 * (0.15 + a / (Math.PI * 4)), aa = a + t * 0.6; a === 0 ? g.moveTo(cx + r * Math.cos(aa), cy + r * Math.sin(aa)) : g.lineTo(cx + r * Math.cos(aa), cy + r * Math.sin(aa)); } g.stroke(); }
    else if (eyes === "mark") {
      // the website's prompt, >_, its cursor blinking
      g.beginPath(); g.moveTo(x + w * 0.27, cy - h * 0.2); g.lineTo(x + w * 0.45, cy); g.lineTo(x + w * 0.27, cy + h * 0.2); g.stroke();
      if (Math.floor(t / 12) % 2 === 0) { g.beginPath(); g.moveTo(x + w * 0.52, cy + h * 0.2); g.lineTo(x + w * 0.74, cy + h * 0.2); g.stroke(); }
    }
  }
  // Marks in the air, all its own, in screen pixels at a point of the world (k pixels a millimetre there).
  /** rings of signal leaving its antenna, for when it is needed */
  function signal(g, x, y, k, u, tone) {
    g.lineCap = "round"; g.strokeStyle = tone;
    for (let i = 0; i < 3; i++) { const v = (u + i / 3) % 1; g.globalAlpha = (1 - v) * 0.8; g.lineWidth = Math.max(1, 0.8 * k); g.beginPath(); g.arc(x, y, (3 + 10 * v) * k, -Math.PI * 0.85, -Math.PI * 0.15); g.stroke(); }
    g.globalAlpha = 1;
  }
  /** cells of its green rising from its antenna, for joy */
  function rise(g, x, y, k, u) {
    g.fillStyle = T.green;
    for (let i = 0; i < 5; i++) { const v = (u + i / 5) % 1, cx = x + Math.sin(i * 2.4 + v * 5) * 7 * k, cyy = y - 26 * v * k, s = (2.2 - v) * k; g.globalAlpha = Math.sin(Math.PI * v); cell(g, cx - s / 2, cyy - s / 2, s); }
    g.globalAlpha = 1;
  }
  /** a burst of cells, flying out and fading */
  function burst(g, x, y, k, u) {
    g.fillStyle = T.green;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3, r = (3 + 9 * u) * k, s = 2 * (1 - u) * k + 0.5; g.globalAlpha = 1 - u; cell(g, x + Math.cos(a) * r - s / 2, y + Math.sin(a) * r - s / 2, s); }
    g.globalAlpha = 1;
  }

  // Props, in millimetres from the floor.
  function book(g, p) {
    // an open book lying on the desk in front of it, in the floor's millimetres (x across, y toward you)
    const w = 36, d = 24;
    g.fillStyle = PAPER[0]; rr(g, -w / 2 - 1, -d / 2 - 1, w + 2, d + 2, 2); g.fill();
    g.fillStyle = PAPER[3]; rr(g, -w / 2, -d / 2, w / 2 - 0.6, d, 1.5); g.fill(); rr(g, 0.6, -d / 2, w / 2 - 0.6, d, 1.5); g.fill();
    g.strokeStyle = T.ink; g.lineWidth = 0.5;
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) { const y = -d / 2 + 4 + i * 3.4; g.beginPath(); g.moveTo(side * 3, y); g.lineTo(side * 15, y); g.stroke(); }
    if (p.page > 0 && p.page < 1) { const x = Math.cos(Math.PI * p.page) * (w / 2 - 1); g.fillStyle = PAPER[2]; g.beginPath(); g.moveTo(0, -d / 2); g.lineTo(x, -d / 2 + 1); g.lineTo(x, d / 2 - 1); g.lineTo(0, d / 2); g.closePath(); g.fill(); }
  }
  function lightCone(g, X, Y, k, p, faceX, faceY) {
    // its own light, from its face down onto the book
    g.save(); g.globalAlpha = 0.17 * p.light; g.fillStyle = T.green;
    g.beginPath(); g.moveTo(faceX - 14 * k, faceY); g.lineTo(faceX + 14 * k, faceY); g.lineTo(X(19), Y(5)); g.lineTo(X(-19), Y(5)); g.closePath(); g.fill(); g.restore();
  }
  /** The camera a pose asks for: `z` from the whole of it (0) to its head close (1), `tilt` from above or below,
   *  `orbit` round it, `zoom` past either, aimed at the part of it that matters at that distance (`camX`, `camY` move
   *  the aim, in millimetres). */
  function cameraFor(p) {
    const k = mix(1.42, 2.3, p.z) * p.zoom, ty = mix(76, 108, p.z) + p.lift;
    return Sage3D.camera({ k, target: [p.x + p.camX, ty + p.camY, p.depth], orbit: p.orbit, tilt: p.tilt });
  }
  /** the floor's plane through a point, as the screen sees it: draw in its millimetres (x across, y toward you) */
  function onFloor(g, cam, at, draw) {
    const o = cam.at(at), x = cam.at([at[0] + 1, at[1], at[2]]), y = cam.at([at[0], at[1], at[2] + 1]);
    g.save(); g.transform(x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], o[0], o[1]); draw(); g.restore();
  }

  /**
   * Sage in a pose, on a 240 by 240 canvas already black, at tick `t` (24 a second): its parts as shapes of a small
   * 3D world (design/sage-3d.js) from the model's own measurements, hung on one another (feet and legs on the floor,
   * the body leaning about its hips, the head turning, rolling and bowing on its neck), seen through cameraFor(p).
   * `extra(scene, sage)` adds things in the same world.
   */
  function drawSage(ctx, pose, t = 0, extra) {
    const g = flat(ctx);
    const p = { ...POSE, ...pose };
    const cam = cameraFor(p), S = Sage3D.scene(cam), { frame, rotX, rotY, rotZ, mul } = Sage3D;
    const root = frame([p.x, p.lift, p.depth], rotY(p.yaw));
    g.lineCap = "round"; g.lineJoin = "round"; g.globalAlpha = 1;

    // the prism's glow on the floor under it, so a view from above has ground
    S.custom({ w: root.at([0, 0, 0]), bias: -1e6, draw(gg) { onFloor(gg, cam, root.at([0, 0, 0]), () => { gg.globalAlpha = 0.08; gg.fillStyle = T.green; gg.beginPath(); gg.ellipse(0, 0, 46, 40, 0, 0, Math.PI * 2); gg.fill(); }); } });
    if (p.charger) S.box({ f: root, c: [0, 1.25, 3], W: 68, H: 2.5, D: 52, r: 1.2, tones: PAD, bias: -1e5,
      faces: { top(gg, w, h) { gg.globalAlpha = 0.35 + 0.35 * p.charger; gg.fillStyle = T.green; gg.beginPath(); gg.ellipse(w / 2, h / 2, w * 0.3, h * 0.3, 0, 0, Math.PI * 2); gg.fill(); } } });

    // feet, wheels, legs and hips
    const legTop = 26 - p.crouch;
    for (const sd of [-1, 1]) {
      const up = sd === p.footSide ? p.foot : 0;
      S.box({ f: root, c: [sd * 17, 6.5 + up, 3], W: 26, H: 13, D: 38, r: 6.2, tones: RUBBER, spec: 0.2, rimA: 0.2,
        faces: {
          bottom(gg, w, h) { gg.strokeStyle = T.tread; gg.lineWidth = 0.9; for (let i = 0; i < 6; i++) { gg.beginPath(); gg.moveTo(w * 0.18, (i + 0.5) * (h / 6)); gg.lineTo(w * 0.82, (i + 0.5) * (h / 6)); gg.stroke(); } },
          front(gg, w, h) { gg.strokeStyle = T.tread; gg.lineWidth = 0.8; for (let i = 0; i < 5; i++) { const x = (i + 0.6) * (w / 5.2); gg.beginPath(); gg.moveTo(x, h * 0.88); gg.lineTo(x + 1.5, h * 0.7); gg.stroke(); } },
        } });
      S.disc({ f: root, c: [sd * 30.5, 6.5 + up, 3], R: 5.5, tones: GRAPH, spin: p.wheel, hub: T.hub });
      const legH = Math.max(2, legTop - 12 - up);
      S.box({ f: root, c: [sd * 17, 12 + up + legH / 2, 0], W: 12.5, H: legH, D: 12.5, r: 6, tones: GRAPH, spec: 0.25 });
      S.ball({ f: root, c: [sd * 17, legTop + 1, 0], R: 7.2, tones: SHELL, spec: 0.45 });
    }
    if (p.book) S.custom({ w: root.at([0, 0.5, 26]), bias: -1e4, draw(gg) { onFloor(gg, cam, root.at([0, 0.5, 26]), () => book(gg, p)); } });

    // the body, leaning about its hips: its belly plate and its LED on the front, then the neck
    const sv = 1 + 0.16 * p.squash, sh = 1 - 0.09 * p.squash, hv = 1 + 0.1 * p.squash, hz = 1 - 0.06 * p.squash;
    const hip = root.then([0, legTop, 0], rotZ(-p.lean));
    S.box({ f: hip, c: [0, 2 + 16 * sv, 0], W: 46 * sh, H: 32 * sv, D: 34 * sh, r: 13.5, tones: SHELL, spec: 0.55,
      faces: { front(gg, w, h) {
        const x0 = w / 2 - 14, y0 = h / 2 - 9.5 - 1;
        Sage3D.shaded(gg, x0, y0, 28, 19, 4, GRAPH, { spec: 0.15 });
        gg.globalAlpha = 0.5; gg.strokeStyle = "#1c1e21"; gg.lineWidth = 0.7; rr(gg, x0, y0, 28, 19, 4); gg.stroke(); gg.globalAlpha = 1;
        for (let i = 0; i < 12; i++) { const hx = x0 + 6.5 + (i % 4) * 5, hy = y0 + 5 + Math.floor(i / 4) * 4.5; gg.fillStyle = T.hole; gg.beginPath(); gg.arc(hx, hy, 1.05, 0, Math.PI * 2); gg.fill(); gg.fillStyle = T.holeLit; gg.beginPath(); gg.arc(hx + 0.35, hy + 0.35, 0.55, 0, Math.PI * 2); gg.fill(); }
        for (const [sx, sy] of [[2.5, 3], [25.5, 3], [2.5, 16], [25.5, 16]]) { gg.fillStyle = T.screw; gg.beginPath(); gg.arc(x0 + sx, y0 + sy, 0.7, 0, Math.PI * 2); gg.fill(); }
        glow(gg, x0 + 23.5, y0 + 15, () => { gg.fillStyle = T.green; gg.beginPath(); gg.arc(x0 + 23.5, y0 + 15, 1.3, 0, Math.PI * 2); gg.fill(); });
      } } });
    S.box({ f: hip, c: [0, 2 + 32 * sv + 4, 0], W: 15.2, H: 10, D: 15.2, r: 7, tones: GRAPH, spec: 0.2 });

    // the head, on the top of its neck: turned, rolled and bowed there, nodding down by `nod`
    const head = hip.then([0, 2 + 32 * sv + 8 - p.nod, 0], mul(rotY(p.headYaw), mul(rotZ(-p.roll), rotX(p.bow))));
    const hpt = (x, y, z) => head.at([x, y, z]);
    S.box({ f: head, c: [0, 31 * hv, 0], W: 76 * hz, H: 62 * hv, D: 58 * hz, r: 19, tones: SHELL, spec: 0.6,
      faces: {
        front(gg, w, h) {
          // the seam round its front, the visor's bezel, the face, the glass's reflection
          const cx = w / 2, cy = h / 2 - 1;
          gg.globalAlpha = 0.35; gg.strokeStyle = T.seam; gg.lineWidth = 0.6; rr(gg, cx - 35.5, cy - 28.5, 71, 57, 16.5); gg.stroke(); gg.globalAlpha = 1;
          Sage3D.shaded(gg, cx - 33.6, cy - 28.6, 67.2, 57.2, 14.5, GRAPH, { spec: 0 });
          const fx0 = cx - 32.25, fy0 = cy - 27.25, fw = 64.5, fh = 54.5;
          if (p.eyes) glow(gg, cx, cy, () => special(gg, fx0, fy0, fw, fh, p.eyes, t, p.bar));
          else glow(gg, cx, cy, () => drawSageFace(gg, fx0, fy0, fw, fh, p.mood, { radius: fh * 0.24, scale: fw / 170, look: p.look, shut: p.shut, squeezed: p.squeezed }));
          gg.save(); rr(gg, fx0, fy0, fw, fh, fh * 0.24); gg.clip();
          gg.globalAlpha = 0.13; gg.fillStyle = "#ffffff"; gg.beginPath(); gg.moveTo(fx0, fy0 + fh * 0.32); gg.quadraticCurveTo(fx0 + fw * 0.35, fy0 + fh * 0.05, fx0 + fw * 0.62, fy0); gg.lineTo(fx0, fy0); gg.closePath(); gg.fill();
          gg.restore();
        },
        back(gg, w, h) {
          gg.globalAlpha = 0.3; gg.strokeStyle = T.seam; gg.lineWidth = 0.6; rr(gg, w / 2 - 30, h / 2 - 20, 60, 40, 10); gg.stroke();
          for (let i = 0; i < 4; i++) { gg.beginPath(); gg.moveTo(w / 2 - 14, h / 2 + 4 + i * 4); gg.lineTo(w / 2 + 14, h / 2 + 4 + i * 4); gg.stroke(); }
        },
        top(gg, w, h) { gg.globalAlpha = 0.25; gg.strokeStyle = T.seam; gg.lineWidth = 0.6; rr(gg, w * 0.12, h * 0.15, w * 0.76, h * 0.7, 10); gg.stroke(); },
      } });
    // its own light, from the visor down onto the book
    // (seen only from the front: from behind, its body hides where it falls)
    const facing = cam.dir(Sage3D.apply(head.rot, [0, 0, 1]))[2];
    // (and left out once it is too faint to see)
    if (p.light >= 0.3 && p.book && facing > 0.2) S.custom({ w: hpt(0, 0, 30), bias: 50, draw(gg) {
      const a = cam.at(hpt(-26, 4, 30)), b = cam.at(hpt(26, 4, 30)), c = cam.at(root.at([19, 0.5, 34])), d = cam.at(root.at([-19, 0.5, 34]));
      gg.globalAlpha = 0.16 * p.light; gg.fillStyle = T.green; gg.beginPath(); gg.moveTo(a[0], a[1]); gg.lineTo(b[0], b[1]); gg.lineTo(c[0], c[1]); gg.lineTo(d[0], d[1]); gg.closePath(); gg.fill(); } });

    // the antenna: a rod that bends with `antennaBend`, its ball glowing at the tip
    S.custom({ w: hpt(22, 70 * hv, -10), draw(gg) {
      const base = cam.at(hpt(22, 62 * hv, -10)), top = cam.at(hpt(22, 62 * hv + 16, -10)), L = Math.hypot(top[0] - base[0], top[1] - base[1]), up = Math.atan2(top[0] - base[0], -(top[1] - base[1]));
      const b = up + p.antennaBend, tx = base[0] + Math.sin(b) * L, ty = base[1] - Math.cos(b) * L, mx = base[0] + Math.sin(up + p.antennaBend * 0.35) * L * 0.55, my = base[1] - Math.cos(up + p.antennaBend * 0.35) * L * 0.55, kk = base[3];
      gg.lineCap = "round"; gg.strokeStyle = GRAPH[2]; gg.lineWidth = Math.max(1.5, 2.4 * kk); gg.beginPath(); gg.moveTo(base[0], base[1]); gg.quadraticCurveTo(mx, my, tx, ty); gg.stroke();
      gg.strokeStyle = GRAPH[5]; gg.lineWidth = Math.max(1, 0.7 * kk); gg.beginPath(); gg.moveTo(base[0] - 0.6 * kk, base[1]); gg.quadraticCurveTo(mx - 0.6 * kk, my, tx - 0.6 * kk, ty); gg.stroke();
      gg.save(); gg.globalAlpha = 0.35 + 0.65 * p.antenna; glow(gg, tx, ty, () => Sage3D.ball(gg, tx, ty, 2.8 * kk, p.amber ? AMBER : ANT, 0.6)); gg.restore();
    } });

    // marks in the air near its head, and things floating round it (drawn facing the camera)
    const mark = (pt, fn) => S.custom({ w: pt, bias: 200, draw(gg) { const [mx, my, , kk] = cam.at(pt); fn(gg, mx, my, kk); } });
    if (p.signal) mark(hpt(22, 62 * hv + 18, -10), (gg, x, y, kk) => signal(gg, x, y, kk, p.signal, p.amber ? T.amber : T.green));
    if (p.rise) mark(hpt(22, 62 * hv + 18, -10), (gg, x, y, kk) => rise(gg, x, y, kk, p.rise));
    if (p.burst) mark(hpt(0, 70, 20), (gg, x, y, kk) => burst(gg, x, y, kk, p.burst));

    if (p.things && window.SageThings) SageThings.add(S, p.things, cam, t);
    if (extra) extra(S, { root, head, cam, p, t });
    S.draw(g);
  }

  /** A pose between two, for transitions: numbers eased, the rest from whichever is nearer. */
  function between(a, b, u) {
    const out = {};
    for (const key of new Set([...Object.keys(POSE), ...Object.keys(a), ...Object.keys(b)])) {
      const va = key in a ? a[key] : POSE[key], vb = key in b ? b[key] : POSE[key];
      if (typeof va === "number" && typeof vb === "number") out[key] = mix(va, vb, u);
      else if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length && va.every((v) => typeof v === "number")) out[key] = va.map((v, i) => mix(v, vb[i], u));
      else out[key] = u < 0.5 ? va : vb;
    }
    return out;
  }

  window.SageDraw = { drawSage, between, POSE, flat, cameraFor };
})();
