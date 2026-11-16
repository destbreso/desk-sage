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
    z: 0, x: 0, lift: 0, crouch: 0, lean: 0, roll: 0, nod: 0, foot: 0,
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
  function special(g, x, y, w, h, eyes, t) {
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
    } else if (eyes === "x") for (const cx of ex) { g.beginPath(); g.moveTo(cx - s * 0.7, cy - s * 0.7); g.lineTo(cx + s * 0.7, cy + s * 0.7); g.moveTo(cx + s * 0.7, cy - s * 0.7); g.lineTo(cx - s * 0.7, cy + s * 0.7); g.stroke(); }
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

  /** Sage in a pose, on a 240 by 240 canvas already black, at tick `t` (24 a second). */
  function drawSage(ctx, pose, t = 0) {
    const g = flat(ctx);
    const p = { ...POSE, ...pose };
    const k = mix(CAM.body.k, CAM.close.k, p.z), fx = mix(CAM.body.x, CAM.close.x, p.z), fy = mix(CAM.body.y, CAM.close.y, p.z);
    const X = (v) => fx + (v + p.x) * k, Y = (v) => fy - (v + p.lift) * k;
    g.lineCap = "round"; g.lineJoin = "round"; g.globalAlpha = 1;

    if (p.charger) {
      // its charging pad, glowing as it charges
      shaded(g, X(-34), Y(2.5), 68 * k, 5 * k, 2.5 * k, PAD, { spec: 0.15, rimA: 0.3 });
      g.save(); g.globalAlpha = 0.35 + 0.35 * p.charger; g.fillStyle = T.green; rr(g, X(-20), Y(1.6), 40 * k, 1.2 * k, 0.6 * k); g.fill(); g.restore();
    }

    // legs and feet: the right foot lifted by `foot`, the legs shorter as it crouches
    const legTop = 26 - p.crouch;
    for (const s of [-1, 1]) {
      const up = s > 0 ? p.foot : 0;
      shaded(g, X(s * 17 - 13), Y(13 + up), 26 * k, 13 * k, 6.2 * k, RUBBER, { spec: 0.18, rimA: 0.2 });
      g.strokeStyle = T.tread; g.lineWidth = Math.max(1, 0.8 * k);
      for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(X(s * 17 - 10 + i * 5), Y(1.2 + up)); g.lineTo(X(s * 17 - 8.5 + i * 5), Y(3.4 + up)); g.stroke(); }
      shaded(g, X(s * 30.5 - 1.6), Y(12.5 + up), 3.2 * k, 12 * k, 1.5 * k, GRAPH, { spec: 0.3, rimA: 0.3 });
      g.fillStyle = T.hub; g.beginPath(); g.arc(X(s * 30.5), Y(6.5 + up), 1.1 * k, 0, Math.PI * 2); g.fill();
      shaded(g, X(s * 17 - 6.25), Y(legTop), 12.5 * k, Math.max(2, legTop - 12 - up) * k, 3 * k, GRAPH, { spec: 0.25 });
      shadowUnder(g, X(s * 17), Y(legTop - 4.5), 6 * k, 2 * k, 0.4);
      ball(g, X(s * 17), Y(legTop + 1), 7.2 * k, SHELL, 0.45);
    }

    // (the book lies in front of its feet, where it looks down to read)
    if (p.book) book(g, (v) => fx + v * k, (v) => fy - v * k, k, p);

    // the body and what sits above it, leaning about its hips
    g.save();
    g.translate(X(0), Y(legTop)); g.rotate(p.lean); g.translate(-X(0), -Y(legTop));
    const by = legTop + 2; // the body's bottom
    shadowUnder(g, X(0), Y(by + 0.5), 22 * k, 3 * k, 0.5);
    shaded(g, X(-23), Y(by + 32), 46 * k, 32 * k, 13.5 * k, SHELL, { spec: 0.55 });
    // the belly plate: recessed, its grille holes each with its own shade, four screws, the LED
    shaded(g, X(-14), Y(by + 24.5), 28 * k, 19 * k, 4 * k, GRAPH, { spec: 0.15, rimA: 0.15 });
    g.globalAlpha = 0.5; g.strokeStyle = "#1c1e21"; g.lineWidth = Math.max(1, 0.7 * k); rr(g, X(-14), Y(by + 24.5), 28 * k, 19 * k, 4 * k); g.stroke(); g.globalAlpha = 1;
    for (let i = 0; i < 12; i++) {
      const hx = X(-7.5 + (i % 4) * 5), hy = Y(by + 20 - Math.floor(i / 4) * 4.5);
      g.fillStyle = T.hole; g.beginPath(); g.arc(hx, hy, 1.05 * k, 0, Math.PI * 2); g.fill();
      g.fillStyle = T.holeLit; g.beginPath(); g.arc(hx + 0.35 * k, hy + 0.35 * k, 0.55 * k, 0, Math.PI * 2); g.fill();
    }
    for (const [sx, sy] of [[-11.5, 22], [11.5, 22], [-11.5, 8], [11.5, 8]]) { g.fillStyle = T.screw; g.beginPath(); g.arc(X(sx), Y(by + sy), 0.7 * k, 0, Math.PI * 2); g.fill(); }
    glow(g, X(9.5), Y(by + 9), () => { g.fillStyle = T.green; g.beginPath(); g.arc(X(9.5), Y(by + 9), 1.3 * k, 0, Math.PI * 2); g.fill(); });
    const neck = by + 32;
    shaded(g, X(-7.6), Y(neck + 9), 15.2 * k, 10 * k, 3 * k, GRAPH, { spec: 0.2 });
    shadowUnder(g, X(0), Y(neck), 16 * k, 2.4 * k, 0.55);

    // the head, rolled about the top of its neck and nodding down by `nod`
    const hb = neck + 8 - p.nod;
    g.save(); g.translate(X(0), Y(hb)); g.rotate(p.roll); g.translate(-X(0), -Y(hb));
    shaded(g, X(21.1), Y(hb + 76), 2.4 * k, 16 * k, 1.1 * k, GRAPH, { spec: 0.3 });
    g.save(); g.globalAlpha = 0.35 + 0.65 * p.antenna; glow(g, X(22.2), Y(hb + 77.5), () => ball(g, X(22.2), Y(hb + 77.5), 2.8 * k, ANT, 0.6)); g.restore();
    shaded(g, X(-38), Y(hb + 62), 76 * k, 62 * k, 19 * k, SHELL, { spec: 0.6 });
    // a seam round the head's front, and the visor's bezel
    g.globalAlpha = 0.35; g.strokeStyle = T.seam; g.lineWidth = Math.max(1, 0.6 * k); rr(g, X(-35.5), Y(hb + 59.5), 71 * k, 57 * k, 16.5 * k); g.stroke(); g.globalAlpha = 1;
    shaded(g, X(-33.6), Y(hb + 60.6), 67.2 * k, 57.2 * k, 14.5 * k, GRAPH, { spec: 0, rimA: 0.2 });
    const fxx = X(-32.25), fyy = Y(hb + 59.25), fw = 64.5 * k, fh = 54.5 * k;
    if (p.eyes) glow(g, fxx + fw / 2, fyy + fh / 2, () => special(g, fxx, fyy, fw, fh, p.eyes, t));
    else glow(g, fxx + fw / 2, fyy + fh / 2, () => drawSageFace(g, fxx, fyy, fw, fh, p.mood, { radius: fh * 0.24, scale: fw / 170, look: p.look, shut: p.shut, squeezed: p.squeezed }));
    // the glass: a reflection of the room across its upper left, and a thin highlight on its edge
    g.save(); rr(g, fxx, fyy, fw, fh, fh * 0.24); g.clip();
    g.globalAlpha = 0.13; g.fillStyle = "#ffffff"; g.beginPath(); g.moveTo(fxx, fyy + fh * 0.32); g.quadraticCurveTo(fxx + fw * 0.35, fyy + fh * 0.05, fxx + fw * 0.62, fyy); g.lineTo(fxx, fyy); g.closePath(); g.fill();
    g.globalAlpha = 0.25; g.strokeStyle = "#ffffff"; g.lineWidth = Math.max(1, 0.7 * k); g.beginPath(); g.arc(fxx + fh * 0.24, fyy + fh * 0.24, fh * 0.2, Math.PI * 1.05, Math.PI * 1.45); g.stroke();
    g.restore();
    if (p.light) lightCone(g, X, Y, k, p, fxx + fw / 2, fyy + fh);
    if (p.sweat) sweat(g, X(41), Y(hb + 52), k, p.sweat);
    if (p.alert) alertMark(g, X(-30), Y(hb + 78), k, p.alert);
    if (p.dnd) dndSign(g, X(-26), Y(hb + 74), k, p.dnd);
    g.restore();
    g.restore();

    if (p.letter) letter(g, X(p.letter[0]), Y(p.letter[1]), k, p.letter[2] || 0);
    if (p.zz) zz(g, X(30), Y(neck + 70), k, p.zz);
    if (p.hearts) floatingHearts(g, X(0), Y(neck + 74), k, p.hearts);
    if (p.spark) spark(g, X(30), Y(neck + 70), k, p.spark);
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

  window.SageDraw = { drawSage, between, POSE, flat };
})();
