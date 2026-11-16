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
  const ANT = ramp("#4f8a4b", "#d8f7d2", 4), PAPER = ramp("#bdb3a0", "#f6f1e6", 4), PAD = ramp("#24312a", "#4a6656", 4);
  const T = { green: SAGE_GREEN, heart: "#ff6f8e", ink: "#8f8676", seam: "#8f8676", hole: "#16181b", holeLit: "#7d828b", screw: "#9aa0a8", hub: "#b9bdc4", tread: "#17181a", rim: "#cfe8d6" };

  // The camera: `z` 0 shows the whole of it, 1 its head close.
  const CAM = { body: { k: 1.42, x: 120, y: 228 }, close: { k: 2.3, x: 120, y: 368 } };
  const mix = (a, b, u) => a + (b - a) * u;

  /** A pose: everything a drawing of Sage can set, in millimetres and radians. */
  const POSE = {
    z: 0, x: 0, depth: 0, lift: 0, crouch: 0, lean: 0, roll: 0, nod: 0, foot: 0, yaw: 0, headYaw: 0, wheel: 0,
    tilt: 0, orbit: 0, zoom: 1, camX: 0, camY: 0, things: null, bar: 0, footSide: 1,
    mood: "calm", look: [0, 0], shut: 0, squeezed: false, eyes: null, antenna: 0.7,
    book: 0, page: 0, light: 0, letter: null, zz: 0, sweat: 0, alert: 0, dnd: 0, hearts: 0, charger: 0, spark: 0,
  };

  /**
   * The canvas the board can draw: arcTo (which the website's face uses) becomes the line and arc it traces, and
   * shadows (its glow) are dropped, as glow() draws them in flat layers instead. Nothing else is changed.
   */
  function flat(ctx) {
    let cur = null, start = null;
    const at = (x, y) => (cur = [x, y]);
    const api = {
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
    for (const [grow, a] of [[0.2, 0.07], [0.12, 0.12], [0.05, 0.2]]) { g.save(); g.globalAlpha = a; g.translate(cx, cy); g.scale(1 + grow, 1 + grow); g.translate(-cx, -cy); draw(); g.restore(); }
    draw();
  }

  // Eyes the website's face does not draw: hearts, dizzy spirals, the website's mark.
  function heart(g, cx, cy, s) {
    g.beginPath(); g.moveTo(cx, cy + s * 0.9);
    g.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.7, cy - s * 1.25, cx, cy - s * 0.45);
    g.bezierCurveTo(cx + s * 0.7, cy - s * 1.25, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
    g.closePath(); g.fill();
  }
  function special(g, x, y, w, h, eyes, t, bar = 0) {
    g.fillStyle = "#000000"; rr(g, x, y, w, h, h * 0.24); g.fill();
    const cy = y + h / 2, ex = [x + w * 0.3, x + w * 0.7], s = h * 0.17;
    g.fillStyle = g.strokeStyle = eyes === "hearts" ? T.heart : T.green;
    g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = Math.max(2, h * 0.07);
    if (eyes === "hearts") for (const cx of ex) heart(g, cx, cy + s * 0.1, s * (1 + 0.08 * Math.sin(t * 0.9)));
    else if (eyes === "dizzy") for (const cx of ex) { g.beginPath(); for (let a = 0; a < Math.PI * 4; a += 0.35) { const r = s * (0.15 + a / (Math.PI * 4)), aa = a + t * 0.6; a === 0 ? g.moveTo(cx + r * Math.cos(aa), cy + r * Math.sin(aa)) : g.lineTo(cx + r * Math.cos(aa), cy + r * Math.sin(aa)); } g.stroke(); }
    else if (eyes === "mark") {
      // the website's prompt, >_, its cursor blinking
      g.beginPath(); g.moveTo(x + w * 0.27, cy - h * 0.2); g.lineTo(x + w * 0.45, cy); g.lineTo(x + w * 0.27, cy + h * 0.2); g.stroke();
      if (Math.floor(t / 12) % 2 === 0) { g.beginPath(); g.moveTo(x + w * 0.52, cy + h * 0.2); g.lineTo(x + w * 0.74, cy + h * 0.2); g.stroke(); }
    } else if (eyes === "bar") {
      // a progress bar across its visor, filling to `bar`
      g.globalAlpha = 0.35; rr(g, x + w * 0.16, cy - h * 0.09, w * 0.68, h * 0.18, h * 0.09); g.fill(); g.globalAlpha = 1;
      if (bar > 0) { rr(g, x + w * 0.16, cy - h * 0.09, Math.max(h * 0.18, w * 0.68 * Math.min(1, bar)), h * 0.18, h * 0.09); g.fill(); }
    } else if (eyes === "check") { g.lineWidth = Math.max(2, h * 0.1); g.beginPath(); g.moveTo(x + w * 0.32, cy); g.lineTo(x + w * 0.45, cy + h * 0.16); g.lineTo(x + w * 0.7, cy - h * 0.2); g.stroke(); }
    else if (eyes === "cross") { g.strokeStyle = "#ff6b6b"; g.lineWidth = Math.max(2, h * 0.1); g.beginPath(); g.moveTo(x + w * 0.38, cy - h * 0.18); g.lineTo(x + w * 0.62, cy + h * 0.18); g.moveTo(x + w * 0.62, cy - h * 0.18); g.lineTo(x + w * 0.38, cy + h * 0.18); g.stroke(); }
    else if (eyes === "x") for (const cx of ex) { g.beginPath(); g.moveTo(cx - s * 0.7, cy - s * 0.7); g.lineTo(cx + s * 0.7, cy + s * 0.7); g.moveTo(cx + s * 0.7, cy - s * 0.7); g.lineTo(cx - s * 0.7, cy + s * 0.7); g.stroke(); }
  }

  // Props, in millimetres from the floor.
  function book(g, X, Y, k, p) {
    // an open book on the floor in front of it, a page turning with `page` (0 to 1)
    const w = 36, h = 5, y = -1;
    shaded(g, X(-w / 2), Y(y + h), w * k, h * k, 1.5 * k, PAPER, { spec: 0, rimA: 0.15 });
    g.strokeStyle = "#a69c88"; g.lineWidth = Math.max(1, 0.5 * k); g.beginPath(); g.moveTo(X(0), Y(y + h + 0.6)); g.lineTo(X(0), Y(y + 0.4)); g.stroke();
    if (p.page > 0 && p.page < 1) {
      const a = Math.PI * p.page, len = (w / 2 - 2) * k;
      g.strokeStyle = PAPER[3]; g.lineWidth = 1.6 * k; g.lineCap = "round";
      g.beginPath(); g.moveTo(X(0), Y(y + h + 1)); g.lineTo(X(0) + Math.cos(a) * len, Y(y + h + 1) - Math.sin(a) * len * 0.55); g.stroke();
    }
    g.strokeStyle = T.ink; g.lineWidth = Math.max(1, 0.5 * k);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(X(side * 3.5), Y(y + h - 1 - i * 1.1)); g.lineTo(X(side * 14), Y(y + h - 1 - i * 1.1)); g.stroke(); }
  }
  function lightCone(g, X, Y, k, p, faceX, faceY) {
    // its own light, from its face down onto the book
    g.save(); g.globalAlpha = 0.17 * p.light; g.fillStyle = T.green;
    g.beginPath(); g.moveTo(faceX - 14 * k, faceY); g.lineTo(faceX + 14 * k, faceY); g.lineTo(X(19), Y(5)); g.lineTo(X(-19), Y(5)); g.closePath(); g.fill(); g.restore();
  }
  function letter(g, cx, cy, k, rot) {
    g.save(); g.translate(cx, cy); g.rotate(rot);
    shaded(g, -11 * k, -7.5 * k, 22 * k, 15 * k, 1.6 * k, PAPER, { spec: 0.2, rimA: 0.2 });
    g.strokeStyle = "#b3a993"; g.lineWidth = Math.max(1, 1.1 * k); g.lineJoin = "round";
    g.beginPath(); g.moveTo(-10 * k, -6.5 * k); g.lineTo(0, 1.5 * k); g.lineTo(10 * k, -6.5 * k); g.stroke();
    glow(g, 0, 1.5 * k, () => { g.fillStyle = T.green; g.beginPath(); g.arc(0, 1.5 * k, 2 * k, 0, Math.PI * 2); g.fill(); });
    g.restore();
  }
  function zz(g, x, y, k, u) {
    // three z's rising and fading, drawn as strokes
    g.strokeStyle = T.green; g.lineCap = "round"; g.lineJoin = "round";
    for (let i = 0; i < 3; i++) {
      const v = (u + i / 3) % 1, s = (3 + 3 * v) * k, zx = x + 10 * v * k, zy = y - 26 * v * k;
      g.save(); g.globalAlpha = Math.sin(Math.PI * v) * 0.9; g.lineWidth = Math.max(1, 0.9 * k);
      g.beginPath(); g.moveTo(zx, zy); g.lineTo(zx + s, zy); g.lineTo(zx, zy + s); g.lineTo(zx + s, zy + s); g.stroke(); g.restore();
    }
  }
  function sweat(g, x, y, k, u) {
    g.save(); g.globalAlpha = 0.85; g.fillStyle = "#9fd6ff";
    const yy = y + 6 * u * k;
    g.beginPath(); g.moveTo(x, yy - 3.2 * k); g.quadraticCurveTo(x + 2.4 * k, yy, x, yy + 1.8 * k); g.quadraticCurveTo(x - 2.4 * k, yy, x, yy - 3.2 * k); g.fill();
    g.globalAlpha = 0.7; g.fillStyle = "#ffffff"; g.beginPath(); g.arc(x - 0.7 * k, yy - 0.6 * k, 0.6 * k, 0, Math.PI * 2); g.fill(); g.restore();
  }
  function alertMark(g, x, y, k, u) {
    g.save(); g.globalAlpha = u;
    glow(g, x, y - 4 * k, () => { g.fillStyle = T.green; rr(g, x - 1.6 * k, y - 11 * k, 3.2 * k, 8 * k, 1.6 * k); g.fill(); g.beginPath(); g.arc(x, y + 0.5 * k, 1.8 * k, 0, Math.PI * 2); g.fill(); });
    g.restore();
  }
  function dndSign(g, x, y, k, u) {
    g.save(); g.globalAlpha = u;
    ball(g, x, y, 6.5 * k, ramp("#a8283a", "#ff6b6b", 4), 0.35);
    g.fillStyle = "#fff4f0"; rr(g, x - 4.2 * k, y - 1.2 * k, 8.4 * k, 2.4 * k, 1.2 * k); g.fill(); g.restore();
  }
  function floatingHearts(g, x, y, k, u) {
    g.fillStyle = T.heart;
    for (let i = 0; i < 3; i++) { const v = (u + i / 3) % 1; g.save(); g.globalAlpha = Math.sin(Math.PI * v); heart(g, x + (i - 1) * 9 * k + Math.sin(v * 6 + i) * 2 * k, y - 22 * v * k, (1.6 + v) * k); g.restore(); }
  }
  function spark(g, x, y, k, u) {
    g.save(); g.globalAlpha = Math.sin(Math.PI * u); g.strokeStyle = T.green; g.lineCap = "round"; g.lineWidth = Math.max(1, 1 * k);
    const r = (2 + 4 * u) * k;
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke(); }
    g.restore();
  }

  /** The camera a pose asks for: `z` from the whole of it (0) to its head close (1), `tilt` from above or below,
   *  `orbit` round it, `zoom` past either, framed on the part of it that matters at that distance. */
  function cameraFor(p) {
    const k = mix(1.42, 2.3, p.z) * p.zoom, ty = mix(76, 108, p.z) + p.lift, cp = Math.cos(p.tilt);
    return Sage3D.camera({ k, ox: 120 - p.camX * k, oy: 120 + (ty * cp + p.camY) * k, orbit: p.orbit, tilt: p.tilt });
  }

  /**
   * Sage in a pose, on a 240 by 240 canvas already black, at tick `t` (24 a second): its parts as shapes of a small
   * 3D world (design/sage-3d.js), from the model's own measurements, turned by `yaw` (and its head by `headYaw` on top),
   * seen through cameraFor(p). `extra(scene, sage)` adds the things around it, in the same world.
   */
  function drawSage(ctx, pose, t = 0, extra) {
    const g = flat(ctx);
    const p = { ...POSE, ...pose };
    const cam = cameraFor(p), S = Sage3D.scene(cam), k = cam.k;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    // a point of Sage (x across it, y up, z out of its front) in the world
    const W = (x, y, z) => [x * cy + z * sy + p.x, y + p.lift, -x * sy + z * cy + p.depth];
    const at = (x, y, z) => cam.at(...W(x, y, z));
    g.lineCap = "round"; g.lineJoin = "round"; g.globalAlpha = 1;

    // (a faint glow of the prism on the floor under it, so a view from above has ground)
    S.custom({ c: W(0, 0, 0), bias: -1e6, draw(gg) { const [fx, fy] = at(0, 0, 0); gg.save(); gg.globalAlpha = 0.07; gg.fillStyle = T.green; gg.beginPath(); gg.ellipse(fx, fy, 46 * k, Math.max(3, 40 * Math.abs(cam.sp)) * k, 0, 0, Math.PI * 2); gg.fill(); gg.restore(); } });
    if (p.charger) S.box({ c: W(0, 1.25, 3), yaw: p.yaw, W: 68, H: 2.5, D: 52, r: 2.5, tones: PAD, spec: 0.15, rimA: 0.3, bias: -1e5,
      top(gg, f) { gg.save(); gg.globalAlpha = 0.35 + 0.35 * p.charger; gg.fillStyle = T.green; gg.beginPath(); gg.ellipse(f.x + f.w / 2, f.y + f.h / 2, f.w * 0.3, Math.max(1, f.h * 0.3), 0, 0, Math.PI * 2); gg.fill(); gg.restore(); },
      front(gg, f) { gg.save(); gg.globalAlpha = 0.35 + 0.35 * p.charger; gg.fillStyle = T.green; rr(gg, f.x + f.w * 0.2, f.y + f.h * 0.35, f.w * 0.6, Math.max(1, f.h * 0.35), 1); gg.fill(); gg.restore(); } });

    // feet, wheels, legs and hips
    const legTop = 26 - p.crouch;
    for (const sd of [-1, 1]) {
      const up = sd === p.footSide ? p.foot : 0;
      S.box({ c: W(sd * 17, 6.5 + up, 3), yaw: p.yaw, W: 26, H: 13, D: 38, r: 6.2, tones: RUBBER, spec: 0.18, rimA: 0.2,
        front(gg, f) { gg.strokeStyle = T.tread; gg.lineWidth = Math.max(1, 0.8 * k); for (let i = 0; i < 5; i++) { const tx = f.x + (i + 0.6) * (f.w / 5.2); gg.beginPath(); gg.moveTo(tx, f.y + f.h * 0.88); gg.lineTo(tx + 1.5 * k, f.y + f.h * 0.72); gg.stroke(); } },
        bottom(gg, f) { gg.strokeStyle = T.tread; gg.lineWidth = Math.max(1, 0.8 * k); for (let i = 0; i < 6; i++) { const ty = f.y + (i + 0.5) * (f.h / 6); gg.beginPath(); gg.moveTo(f.x + f.w * 0.18, ty); gg.lineTo(f.x + f.w * 0.82, ty); gg.stroke(); } } });
      S.disc({ c: W(sd * 30.5, 6.5 + up, 3), yaw: p.yaw, R: 5.5, T: 2, tones: GRAPH, spin: p.wheel, hub: T.hub });
      S.rod({ c: W(sd * 17, (legTop + 12 + up) / 2, 0), yaw: p.yaw, r: 6.25, H: Math.max(2, legTop - 12 - up), tones: GRAPH, spec: 0.25 });
      S.ball({ c: W(sd * 17, legTop + 1, 0), R: 7.2, tones: SHELL, spec: 0.45 });
    }
    if (p.book) S.custom({ c: [p.x, 1, 24 + p.depth], draw(gg) { const [bx, byy] = cam.at(p.x, 0, 24 + p.depth); book(gg, (v) => bx + v * k, (v) => byy - v * k * Math.max(0.35, cam.cp), k, p); } });

    // the body, its belly plate, the neck, leaning about its hips
    const by = legTop + 2, neck = by + 32;
    const [hipX, hipY] = at(0, legTop, 0);
    const lean = p.lean ? [[hipX, hipY, p.lean]] : [];
    S.box({ c: W(0, by + 16, 0), yaw: p.yaw, W: 46, H: 32, D: 34, r: 13.5, tones: SHELL, spec: 0.55, turns: lean,
      front(gg, f) {
        const px = (v) => f.x + f.w / 2 + v * f.facing * k, py = (v) => f.y + f.h / 2 - v * cam.cp * k;
        Sage3D.shaded(gg, px(-14), py(8.5 + 1), 28 * f.facing * k, 19 * cam.cp * k, 4 * k, GRAPH, { spec: 0.15, rimA: 0.15 });
        for (let i = 0; i < 12; i++) {
          const hx = px(-7.5 + (i % 4) * 5), hy = py(4 - Math.floor(i / 4) * 4.5);
          gg.fillStyle = T.hole; gg.beginPath(); gg.ellipse(hx, hy, 1.05 * f.facing * k, 1.05 * cam.cp * k, 0, 0, Math.PI * 2); gg.fill();
          gg.fillStyle = T.holeLit; gg.beginPath(); gg.ellipse(hx + 0.35 * k * f.facing, hy + 0.35 * k * cam.cp, 0.55 * f.facing * k, 0.55 * cam.cp * k, 0, 0, Math.PI * 2); gg.fill();
        }
        for (const [sx, syy] of [[-11.5, 6], [11.5, 6], [-11.5, -8], [11.5, -8]]) { gg.fillStyle = T.screw; gg.beginPath(); gg.arc(px(sx), py(syy), 0.7 * k, 0, Math.PI * 2); gg.fill(); }
        glow(gg, px(9.5), py(-7), () => { gg.fillStyle = T.green; gg.beginPath(); gg.arc(px(9.5), py(-7), 1.3 * k, 0, Math.PI * 2); gg.fill(); });
      } });
    S.rod({ c: W(0, neck + 4, 0), yaw: p.yaw, r: 7.6, H: 10, tones: GRAPH, spec: 0.2, turns: lean });

    // the head, on its own yaw, rolled about the top of its neck, nodding by `nod`
    const hyaw = p.yaw + p.headYaw, hb = neck + 8 - p.nod;
    const [nx, ny] = at(0, hb, 0);
    const headTurns = [...lean, ...(p.roll ? [[nx, ny, p.roll]] : [])];
    const hc = Math.cos(hyaw), hs = Math.sin(hyaw);
    const HW = (x, y, z) => [x * hc + z * hs + p.x, y + p.lift, -x * hs + z * hc + p.depth];
    S.rod({ c: HW(22, hb + 68, -10), yaw: hyaw, r: 1.2, H: 16, tones: GRAPH, spec: 0.3, turns: headTurns });
    S.custom({ c: HW(22, hb + 77.5, -10), turns: headTurns, draw(gg) { const [ax, ay] = cam.at(...HW(22, hb + 77.5, -10)); gg.save(); gg.globalAlpha = 0.35 + 0.65 * p.antenna; glow(gg, ax, ay, () => Sage3D.ball(gg, ax, ay, 2.8 * k, ANT, 0.6)); gg.restore(); } });
    S.box({ c: HW(0, hb + 31, 0), yaw: hyaw, W: 76, H: 62, D: 58, r: 19, tones: SHELL, spec: 0.6, turns: headTurns,
      front(gg, f) {
        // the seam, the visor's bezel, the face (narrower as it turns, shorter as it is seen from above or below), the glass
        const cxh = f.x + f.w / 2, cyh = f.y + f.h / 2, fc = f.facing;
        gg.globalAlpha = 0.35; gg.strokeStyle = T.seam; gg.lineWidth = Math.max(1, 0.6 * k); rr(gg, cxh - 35.5 * fc * k, cyh - 28.5 * cam.cp * k, 71 * fc * k, 57 * cam.cp * k, 16.5 * k); gg.stroke(); gg.globalAlpha = 1;
        Sage3D.shaded(gg, cxh - 33.6 * fc * k, cyh - 28.6 * cam.cp * k, 67.2 * fc * k, 57.2 * cam.cp * k, 14.5 * k, GRAPH, { spec: 0, rimA: 0.2 });
        const fw = 64.5 * fc * k, fh = 54.5 * cam.cp * k, fx0 = cxh - fw / 2, fy0 = cyh - fh / 2 + 1 * k;
        const look = [Math.max(-1, Math.min(1, p.look[0] + hs * 0.6)), Math.max(-1, Math.min(1, p.look[1] - cam.sp * 0.5))];
        if (p.eyes) glow(gg, fx0 + fw / 2, fy0 + fh / 2, () => special(gg, fx0, fy0, fw, fh, p.eyes, t, p.bar));
        else glow(gg, fx0 + fw / 2, fy0 + fh / 2, () => drawSageFace(gg, fx0, fy0, fw, fh, p.mood, { radius: Math.min(fh, fw) * 0.24, scale: (64.5 * k) / 170, look, shut: p.shut, squeezed: p.squeezed }));
        gg.save(); rr(gg, fx0, fy0, fw, fh, Math.min(fh, fw) * 0.24); gg.clip();
        gg.globalAlpha = 0.13; gg.fillStyle = "#ffffff"; gg.beginPath(); gg.moveTo(fx0, fy0 + fh * 0.32); gg.quadraticCurveTo(fx0 + fw * 0.35, fy0 + fh * 0.05, fx0 + fw * 0.62, fy0); gg.lineTo(fx0, fy0); gg.closePath(); gg.fill();
        gg.restore();
        if (p.light) lightCone(gg, (v) => cam.at(v + p.x, 0, 22)[0], (v) => cam.at(p.x, v, 22)[1], k, p, fx0 + fw / 2, fy0 + fh);
      },
      back(gg, f) {
        // its back: a panel and its vent
        const cxh = f.x + f.w / 2, cyh = f.y + f.h / 2, fc = Math.abs(f.facing);
        gg.globalAlpha = 0.3; gg.strokeStyle = T.seam; gg.lineWidth = Math.max(1, 0.6 * k); rr(gg, cxh - 30 * fc * k, cyh - 20 * cam.cp * k, 60 * fc * k, 40 * cam.cp * k, 10 * k); gg.stroke();
        for (let i = 0; i < 4; i++) { const yy = cyh + (6 + i * 4) * cam.cp * k; gg.beginPath(); gg.moveTo(cxh - 14 * fc * k, yy); gg.lineTo(cxh + 14 * fc * k, yy); gg.stroke(); }
        gg.globalAlpha = 1;
      },
      edge(gg, e) {
        // seen from the side: the visor's edge at the front, an eye's glow showing there
        const bx = e.dir > 0 ? e.x - 4.5 * k : e.x + 0.5 * k;
        gg.fillStyle = GRAPH[0]; rr(gg, bx, e.y + 2 * k, 4 * k, e.h - 6 * k, 2 * k); gg.fill();
        glow(gg, bx + 2 * k, e.y + e.h * 0.5, () => { gg.fillStyle = T.green; rr(gg, bx + 1.4 * k, e.y + e.h * 0.38, 1.4 * k, e.h * 0.24, 0.7 * k); gg.fill(); });
      },
      top(gg, f) { gg.globalAlpha = 0.25; gg.strokeStyle = T.seam; gg.lineWidth = Math.max(1, 0.6 * k); rr(gg, f.x + f.w * 0.12, f.y + f.h * 0.15, f.w * 0.76, f.h * 0.7, 10 * k); gg.stroke(); gg.globalAlpha = 1; } });

    // marks in the air around its head (billboards at points of the world)
    const mark = (x, y, z, fn) => S.custom({ c: HW(x, y, z), bias: 200, turns: headTurns, draw(gg) { const [mx, my] = cam.at(...HW(x, y, z)); fn(gg, mx, my); } });
    if (p.sweat) mark(41, hb + 50, 10, (gg, x, y) => sweat(gg, x, y, k, p.sweat));
    if (p.alert) mark(-30, hb + 74, 0, (gg, x, y) => alertMark(gg, x, y, k, p.alert));
    if (p.dnd) mark(-26, hb + 74, 0, (gg, x, y) => dndSign(gg, x, y, k, p.dnd));
    const air = (x, y, fn) => S.custom({ c: W(x, y, 0), bias: 300, draw(gg) { const [mx, my] = at(x, y, 0); fn(gg, mx, my); } });
    if (p.letter) air(p.letter[0], p.letter[1], (gg, x, y) => letter(gg, x, y, k, p.letter[2] || 0));
    if (p.zz) air(30, neck + 70, (gg, x, y) => zz(gg, x, y, k, p.zz));
    if (p.hearts) air(0, neck + 74, (gg, x, y) => floatingHearts(gg, x, y, k, p.hearts));
    if (p.spark) air(30, neck + 70, (gg, x, y) => spark(gg, x, y, k, p.spark));

    if (p.things && window.SageThings) SageThings.add(S, p.things, k, t);
    if (extra) extra(S, { W, at, cam, k, p, t });
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
