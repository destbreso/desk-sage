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
    z: 0, x: 0, lift: 0, crouch: 0, lean: 0, roll: 0, nod: 0, foot: 0, yaw: 0, headYaw: 0, wheel: 0,
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

  /**
   * A box of its (W across, D deep, between heights y0 and y1, corners r) at body point (cx, cz), turned by its yaw
   * (c, s are the yaw's cosine and sine): its silhouette shaded, the side that shows darkened when it faces away from
   * the light, the edge between the two faces catching it. Returns where its front face is and how wide it shows.
   */
  function box(g, X, Y, k, c, s, cx, cz, W, D, y0, y1, r, tones, opts) {
    const w = W * Math.abs(c) + D * Math.abs(s), xc = cx * c + cz * s;
    shaded(g, X(xc - w / 2), Y(y1), w * k, (y1 - y0) * k, r * k, tones, opts);
    const front = cx * c + (cz + Math.sign(c || 1) * D / 2) * s, fw = W * Math.abs(c), sw = D * Math.abs(s);
    if (sw > 0.5) {
      const onRight = front < xc, x0 = onRight ? xc + w / 2 - sw : xc - w / 2;
      g.save(); rr(g, X(xc - w / 2), Y(y1), w * k, (y1 - y0) * k, r * k); g.clip();
      // (darkest when it is the narrow side beside a front in the light; seen square on, a side is the face that shows)
      g.globalAlpha = onRight ? 0.06 + 0.2 * Math.min(1, fw / 20) : 0.07; g.fillStyle = onRight ? "#000000" : "#ffffff"; g.fillRect(X(x0), Y(y1), sw * k, (y1 - y0) * k);
      g.globalAlpha = 0.35; g.strokeStyle = T.rim; g.lineWidth = Math.max(1, 0.5 * k);
      const edge = onRight ? x0 : x0 + sw;
      g.beginPath(); g.moveTo(X(edge), Y(y1 - r * 0.6)); g.lineTo(X(edge), Y(y0 + r * 0.6)); g.stroke();
      g.restore();
    }
    return { front, fw, facing: c };
  }
  /** A wheel at the side of a foot: a thin edge seen from the front, a disc with turning spokes seen from the side. */
  function wheelAt(g, X, Y, k, c, s, cx, cz, angle, up) {
    const x = cx * c + cz * s, rx = 5.5 * Math.abs(s) + 1 * Math.abs(c), cy = 6.5 + up;
    g.fillStyle = GRAPH[1]; g.beginPath(); g.ellipse(X(x), Y(cy), Math.max(1, rx * k), 5.5 * k, 0, 0, Math.PI * 2); g.fill();
    if (Math.abs(s) > 0.3) {
      g.fillStyle = GRAPH[3]; g.beginPath(); g.ellipse(X(x), Y(cy), rx * 0.8 * k, 4.4 * k, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = GRAPH[5]; g.lineWidth = Math.max(1, 0.7 * k); g.lineCap = "round";
      for (let i = 0; i < 4; i++) { const a = angle + (i * Math.PI) / 2; g.beginPath(); g.moveTo(X(x), Y(cy)); g.lineTo(X(x + 4 * Math.cos(a) * s), Y(cy + 4 * Math.sin(a))); g.stroke(); }
    }
    g.fillStyle = T.hub; g.beginPath(); g.arc(X(x), Y(cy), 1.1 * k, 0, Math.PI * 2); g.fill();
  }

  /**
   * Sage in a pose, on a 240 by 240 canvas already black, at tick `t` (24 a second). `yaw` turns it about its own
   * axis (0 faces you, a quarter turn shows its right side, half a turn its back) and `headYaw` turns its head on top
   * of that; `wheel` is how far its wheels have rolled (radians).
   */
  function drawSage(ctx, pose, t = 0) {
    const g = flat(ctx);
    const p = { ...POSE, ...pose };
    const k = mix(CAM.body.k, CAM.close.k, p.z), fx = mix(CAM.body.x, CAM.close.x, p.z), fy = mix(CAM.body.y, CAM.close.y, p.z);
    const X = (v) => fx + (v + p.x) * k, Y = (v) => fy - (v + p.lift) * k;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    g.lineCap = "round"; g.lineJoin = "round"; g.globalAlpha = 1;

    if (p.charger) {
      shaded(g, X(-34), Y(2.5), 68 * k, 5 * k, 2.5 * k, PAD, { spec: 0.15, rimA: 0.3 });
      g.save(); g.globalAlpha = 0.35 + 0.35 * p.charger; g.fillStyle = T.green; rr(g, X(-20), Y(1.6), 40 * k, 1.2 * k, 0.6 * k); g.fill(); g.restore();
    }

    // legs and feet, the far one first: the right foot lifted by `foot`, the legs shorter as it crouches
    const legTop = 26 - p.crouch;
    const sides = [-1, 1].sort((a, b) => -a * 17 * s - -b * 17 * s);
    for (const sd of sides) {
      const up = sd > 0 ? p.foot : 0, lx = sd * 17 * c, outer = -sd * 30.5 * s;
      // (the wheel on the far side of a foot is behind it, the near one in front)
      if (outer < 0) wheelAt(g, X, Y, k, c, s, sd * 30.5, 3, p.wheel, up);
      const foot = box(g, X, Y, k, c, s, sd * 17, 3, 26, 38, up, 13 + up, 6.2, RUBBER, { spec: 0.18, rimA: 0.2 });
      g.strokeStyle = T.tread; g.lineWidth = Math.max(1, 0.8 * k);
      const tw = 26 * Math.abs(c) + 38 * Math.abs(s);
      for (let i = 0; i < 5; i++) { const tx = sd * 17 * c + 3 * s - tw / 2 + (i + 0.6) * (tw / 5.2); g.beginPath(); g.moveTo(X(tx), Y(1.2 + up)); g.lineTo(X(tx + 1.5), Y(3.4 + up)); g.stroke(); }
      if (outer >= 0) wheelAt(g, X, Y, k, c, s, sd * 30.5, 3, p.wheel, up);
      shaded(g, X(lx - 6.25), Y(legTop), 12.5 * k, Math.max(2, legTop - 12 - up) * k, 3 * k, GRAPH, { spec: 0.25 });
      shadowUnder(g, X(lx), Y(legTop - 4.5), 6 * k, 2 * k, 0.4);
      ball(g, X(lx), Y(legTop + 1), 7.2 * k, SHELL, 0.45);
      void foot;
    }

    if (p.book) book(g, (v) => fx + v * k, (v) => fy - v * k, k, p);

    // the body and what sits above it, leaning about its hips
    g.save();
    g.translate(X(0), Y(legTop)); g.rotate(p.lean); g.translate(-X(0), -Y(legTop));
    const by = legTop + 2;
    shadowUnder(g, X(0), Y(by + 0.5), 22 * k, 3 * k, 0.5);
    const body = box(g, X, Y, k, c, s, 0, 0, 46, 34, by, by + 32, 13.5, SHELL, { spec: 0.55 });
    if (c > 0.15) {
      // the belly plate on its front: recessed, the grille's holes each with its own shade, four screws, the LED
      const bx = (v) => body.front + v * c;
      shaded(g, X(bx(-14)), Y(by + 24.5), 28 * c * k, 19 * k, 4 * k, GRAPH, { spec: 0.15, rimA: 0.15 });
      g.globalAlpha = 0.5; g.strokeStyle = "#1c1e21"; g.lineWidth = Math.max(1, 0.7 * k); rr(g, X(bx(-14)), Y(by + 24.5), 28 * c * k, 19 * k, 4 * k); g.stroke(); g.globalAlpha = 1;
      for (let i = 0; i < 12; i++) {
        const hx = X(bx(-7.5 + (i % 4) * 5)), hy = Y(by + 20 - Math.floor(i / 4) * 4.5);
        g.fillStyle = T.hole; g.beginPath(); g.ellipse(hx, hy, 1.05 * c * k, 1.05 * k, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = T.holeLit; g.beginPath(); g.ellipse(hx + 0.35 * k * c, hy + 0.35 * k, 0.55 * c * k, 0.55 * k, 0, 0, Math.PI * 2); g.fill();
      }
      for (const [sx, sy] of [[-11.5, 22], [11.5, 22], [-11.5, 8], [11.5, 8]]) { g.fillStyle = T.screw; g.beginPath(); g.arc(X(bx(sx)), Y(by + sy), 0.7 * k, 0, Math.PI * 2); g.fill(); }
      glow(g, X(bx(9.5)), Y(by + 9), () => { g.fillStyle = T.green; g.beginPath(); g.arc(X(bx(9.5)), Y(by + 9), 1.3 * k, 0, Math.PI * 2); g.fill(); });
    }
    const neck = by + 32;
    shaded(g, X(-7.6), Y(neck + 9), 15.2 * k, 10 * k, 3 * k, GRAPH, { spec: 0.2 });
    shadowUnder(g, X(0), Y(neck), 16 * k, 2.4 * k, 0.55);

    // the head, turned by its own yaw on top of the body's, rolled about the top of its neck, nodding by `nod`
    const hc = Math.cos(p.yaw + p.headYaw), hs = Math.sin(p.yaw + p.headYaw);
    const hb = neck + 8 - p.nod;
    g.save(); g.translate(X(0), Y(hb)); g.rotate(p.roll); g.translate(-X(0), -Y(hb));
    const ax = 22 * hc - 10 * hs, antennaFront = -22 * hs - 10 * hc > 0;
    const antenna = () => {
      shaded(g, X(ax - 1.2), Y(hb + 76), 2.4 * k, 16 * k, 1.1 * k, GRAPH, { spec: 0.3 });
      g.save(); g.globalAlpha = 0.35 + 0.65 * p.antenna; glow(g, X(ax + 0.2), Y(hb + 77.5), () => ball(g, X(ax + 0.2), Y(hb + 77.5), 2.8 * k, ANT, 0.6)); g.restore();
    };
    if (!antennaFront) antenna();
    const head = box(g, X, Y, k, hc, hs, 0, 0, 76, 58, hb, hb + 62, 19, SHELL, { spec: 0.6 });
    if (hc > 0.12) {
      // the seam round its front, the visor's bezel, the face (narrower as it turns), the glass
      const fw = 64.5 * hc, fx0 = head.front - fw / 2;
      g.globalAlpha = 0.35; g.strokeStyle = T.seam; g.lineWidth = Math.max(1, 0.6 * k); rr(g, X(head.front - 35.5 * hc), Y(hb + 59.5), 71 * hc * k, 57 * k, 16.5 * k); g.stroke(); g.globalAlpha = 1;
      shaded(g, X(head.front - 33.6 * hc), Y(hb + 60.6), 67.2 * hc * k, 57.2 * k, 14.5 * k, GRAPH, { spec: 0, rimA: 0.2 });
      const fxx = X(fx0), fyy = Y(hb + 59.25), fwp = fw * k, fh = 54.5 * k;
      const look = [Math.max(-1, Math.min(1, p.look[0] + hs * 0.6)), p.look[1]];
      if (p.eyes) glow(g, fxx + fwp / 2, fyy + fh / 2, () => special(g, fxx, fyy, fwp, fh, p.eyes, t));
      else glow(g, fxx + fwp / 2, fyy + fh / 2, () => drawSageFace(g, fxx, fyy, fwp, fh, p.mood, { radius: Math.min(fh, fwp) * 0.24, scale: (64.5 * k) / 170, look, shut: p.shut, squeezed: p.squeezed }));
      g.save(); rr(g, fxx, fyy, fwp, fh, Math.min(fh, fwp) * 0.24); g.clip();
      g.globalAlpha = 0.13; g.fillStyle = "#ffffff"; g.beginPath(); g.moveTo(fxx, fyy + fh * 0.32); g.quadraticCurveTo(fxx + fwp * 0.35, fyy + fh * 0.05, fxx + fwp * 0.62, fyy); g.lineTo(fxx, fyy); g.closePath(); g.fill();
      g.restore();
      if (p.light) lightCone(g, X, Y, k, p, fxx + fwp / 2, fyy + fh);
    } else if (hc < -0.12) {
      // its back: a panel and its vent
      g.globalAlpha = 0.3; g.strokeStyle = T.seam; g.lineWidth = Math.max(1, 0.6 * k); rr(g, X(head.front - 30 * -hc), Y(hb + 52), 60 * -hc * k, 40 * k, 10 * k); g.stroke();
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(X(head.front - 14 * -hc), Y(hb + 20 + i * 4)); g.lineTo(X(head.front + 14 * -hc), Y(hb + 20 + i * 4)); g.stroke(); }
      g.globalAlpha = 1;
    } else {
      // seen from the side: the visor's edge, a dark band at its front
      // (by the side it faces: a quarter turn's cosine is a hair either side of zero)
      const ex = 29 * Math.sign(hs || 1);
      const dir = Math.sign(hs || 1), bx = dir > 0 ? ex - 4.5 : ex + 0.5;
      g.fillStyle = GRAPH[0]; rr(g, X(bx), Y(hb + 58), 4 * k, 52 * k, 2 * k); g.fill();
      g.fillStyle = GRAPH[3]; rr(g, X(dir > 0 ? bx : bx + 2.8), Y(hb + 56), 1.2 * k, 48 * k, 0.6 * k); g.fill();
      // (an eye's glow showing at the visor's edge)
      glow(g, X(bx + 2), Y(hb + 32), () => { g.fillStyle = T.green; rr(g, X(bx + 1.4), Y(hb + 40), 1.4 * k, 14 * k, 0.7 * k); g.fill(); });
    }
    if (antennaFront) antenna();
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
