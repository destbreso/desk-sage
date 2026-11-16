// Sage drawn for the prism: flat with volume (two or three tones a material, lit from the upper left), from the 3D
// model's own measurements in millimetres (the floor at 0, y up), its face the site's own (design/site/sage-site.js).
// Everything goes through flat() so the board can draw it as instructions. Part of Sage's art: see LICENSE-ART.md.
(function () {
  const { drawSageFace, SAGE_GREEN } = SageSite;

  // Tones for the prism: black turns to glass, so the graphite is lifted from the room's #2a2c30 or it would vanish.
  const T = {
    shellLit: "#f1ede5", shellShade: "#cbc5b8", shellHi: "#fffdf8",
    graphLit: "#6a6e76", graphShade: "#4c5057", grille: "#8a8e95",
    rubber: "#3d3f43", rubberShade: "#2e3033",
    green: SAGE_GREEN, heart: "#ff6f8e", paper: "#efe9dc", paperShade: "#cfc6b4", ink: "#8f8676",
    pad: "#2f3d33", padLit: "#3f5446", red: "#ff5a5a",
  };

  // The camera: `z` 0 shows the whole of it, 1 its head close.
  const CAM = { body: { k: 1.42, x: 120, y: 228 }, close: { k: 2.3, x: 120, y: 368 } };
  const mix = (a, b, u) => a + (b - a) * u;

  /** A pose: everything a drawing of Sage can set, in millimetres and radians. */
  const POSE = {
    z: 0, x: 0, lift: 0, crouch: 0, lean: 0, roll: 0, nod: 0, foot: 0,
    mood: "calm", look: [0, 0], shut: 0, squeezed: false, eyes: null, antenna: 0.7,
    book: 0, page: 0, light: 0, letter: null, zz: 0, sweat: 0, alert: 0, dnd: 0, hearts: 0, charger: 0, spark: 0, dizzy: 0,
  };

  /**
   * The canvas the board can draw: arcTo (which the site's face uses) becomes the line and arc it traces, and shadows
   * (its glow) are dropped, as glow() draws them in flat layers instead. Nothing else is changed.
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
  /** A part lit from the upper left: its shade, then the lit shape a little up and left clipped to it, and a highlight. */
  function part(g, x, y, w, h, r, lit, shade, hi, off) {
    rr(g, x, y, w, h, r); g.fillStyle = shade; g.fill();
    g.save(); rr(g, x, y, w, h, r); g.clip(); rr(g, x - off, y - off, w, h, r); g.fillStyle = lit; g.fill();
    if (hi) { g.strokeStyle = hi; g.lineWidth = Math.max(1, off * 0.55); g.lineCap = "round"; g.beginPath(); g.moveTo(x + r * 0.9, y + off * 0.9); g.lineTo(x + w * 0.42, y + off * 0.9); g.stroke(); }
    g.restore();
  }
  function disc(g, cx, cy, r, lit, shade, off) {
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = shade; g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip(); g.beginPath(); g.arc(cx - off, cy - off, r, 0, Math.PI * 2); g.fillStyle = lit; g.fill(); g.restore();
  }
  /** The glow the room gets from a blur, as two larger, fainter copies behind the thing itself. */
  function glow(g, cx, cy, draw) {
    for (const [grow, a] of [[0.16, 0.1], [0.08, 0.18]]) { g.save(); g.globalAlpha = a; g.translate(cx, cy); g.scale(1 + grow, 1 + grow); g.translate(-cx, -cy); draw(); g.restore(); }
    draw();
  }

  // Eyes the site's face does not draw: hearts, dizzy spirals, the site's mark.
  function heart(g, cx, cy, s) {
    g.beginPath(); g.moveTo(cx, cy + s * 0.9);
    g.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.7, cy - s * 1.25, cx, cy - s * 0.45);
    g.bezierCurveTo(cx + s * 0.7, cy - s * 1.25, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
    g.closePath(); g.fill();
  }
  function special(g, x, y, w, h, eyes, t) {
    g.fillStyle = "#000"; rr(g, x, y, w, h, h * 0.24); g.fill();
    const cy = y + h / 2, ex = [x + w * 0.3, x + w * 0.7], s = h * 0.17;
    g.fillStyle = g.strokeStyle = eyes === "hearts" ? T.heart : T.green;
    g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = Math.max(2, h * 0.07);
    if (eyes === "hearts") for (const cx of ex) heart(g, cx, cy + s * 0.1, s * (1 + 0.08 * Math.sin(t * 0.9)));
    else if (eyes === "dizzy") for (const cx of ex) { g.beginPath(); for (let a = 0; a < Math.PI * 4; a += 0.35) { const r = s * (0.15 + a / (Math.PI * 4)), aa = a + t * 0.6; a === 0 ? g.moveTo(cx + r * Math.cos(aa), cy + r * Math.sin(aa)) : g.lineTo(cx + r * Math.cos(aa), cy + r * Math.sin(aa)); } g.stroke(); }
    else if (eyes === "mark") {
      // the site's prompt, >_, its cursor blinking
      g.beginPath(); g.moveTo(x + w * 0.27, cy - h * 0.2); g.lineTo(x + w * 0.45, cy); g.lineTo(x + w * 0.27, cy + h * 0.2); g.stroke();
      if (Math.floor(t / 12) % 2 === 0) { g.beginPath(); g.moveTo(x + w * 0.52, cy + h * 0.2); g.lineTo(x + w * 0.74, cy + h * 0.2); g.stroke(); }
    } else if (eyes === "x") for (const cx of ex) { g.beginPath(); g.moveTo(cx - s * 0.7, cy - s * 0.7); g.lineTo(cx + s * 0.7, cy + s * 0.7); g.moveTo(cx + s * 0.7, cy - s * 0.7); g.lineTo(cx - s * 0.7, cy + s * 0.7); g.stroke(); }
  }

  // Props, in millimetres from the floor.
  function book(g, X, Y, k, p) {
    // an open book on the floor in front of it, a page turning with `page` (0 to 1)
    const w = 36, h = 5, y = -1;
    g.fillStyle = T.paperShade; rr(g, X(-w / 2), Y(y + h), w * k, h * k, 1.5 * k); g.fill();
    g.fillStyle = T.paper; rr(g, X(-w / 2 + 1), Y(y + h + 1.2), (w / 2 - 1.5) * k, h * k, 1 * k); g.fill(); rr(g, X(0.5), Y(y + h + 1.2), (w / 2 - 1.5) * k, h * k, 1 * k); g.fill();
    if (p.page > 0 && p.page < 1) {
      // the turning page, rising from the right and laid on the left
      const a = Math.PI * p.page, len = (w / 2 - 2) * k;
      g.strokeStyle = T.paper; g.lineWidth = 1.6 * k; g.lineCap = "round";
      g.beginPath(); g.moveTo(X(0), Y(y + h + 1)); g.lineTo(X(0) + Math.cos(a) * len, Y(y + h + 1) - Math.sin(a) * len * 0.55); g.stroke();
    }
    g.strokeStyle = T.ink; g.lineWidth = Math.max(1, 0.6 * k);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(X(side * 3.5), Y(y + h + 0.3 - i * 0.9)); g.lineTo(X(side * 12), Y(y + h + 0.3 - i * 0.9)); g.stroke(); }
  }
  function lightCone(g, X, Y, k, p, faceX, faceY) {
    // its own light, from its face down onto the book
    g.save(); g.globalAlpha = 0.17 * p.light; g.fillStyle = T.green;
    g.beginPath(); g.moveTo(faceX - 14 * k, faceY); g.lineTo(faceX + 14 * k, faceY); g.lineTo(X(19), Y(5)); g.lineTo(X(-19), Y(5)); g.closePath(); g.fill(); g.restore();
  }
  function letter(g, cx, cy, k, rot) {
    g.save(); g.translate(cx, cy); g.rotate(rot);
    g.fillStyle = T.paper; rr(g, -11 * k, -7.5 * k, 22 * k, 15 * k, 1.6 * k); g.fill();
    g.strokeStyle = T.paperShade; g.lineWidth = Math.max(1, 1.1 * k); g.lineJoin = "round";
    g.beginPath(); g.moveTo(-10 * k, -6.5 * k); g.lineTo(0, 1.5 * k); g.lineTo(10 * k, -6.5 * k); g.stroke();
    g.fillStyle = T.green; g.beginPath(); g.arc(0, 1.5 * k, 2 * k, 0, Math.PI * 2); g.fill();
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
    g.beginPath(); g.moveTo(x, yy - 3.2 * k); g.quadraticCurveTo(x + 2.4 * k, yy, x, yy + 1.8 * k); g.quadraticCurveTo(x - 2.4 * k, yy, x, yy - 3.2 * k); g.fill(); g.restore();
  }
  function alertMark(g, x, y, k, u) {
    g.save(); g.globalAlpha = u; g.fillStyle = T.green;
    rr(g, x - 1.6 * k, y - 11 * k, 3.2 * k, 8 * k, 1.6 * k); g.fill();
    g.beginPath(); g.arc(x, y + 0.5 * k, 1.8 * k, 0, Math.PI * 2); g.fill(); g.restore();
  }
  function dndSign(g, x, y, k, u) {
    g.save(); g.globalAlpha = u; g.fillStyle = T.red;
    g.beginPath(); g.arc(x, y, 6.5 * k, 0, Math.PI * 2); g.fill();
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
    const X = (v) => fx + (v + p.x) * k, Y = (v) => fy - (v + p.lift) * k, off = Math.max(1.5, 2.2 * k);
    g.lineCap = "round"; g.lineJoin = "round"; g.globalAlpha = 1;

    if (p.charger) {
      // its charging pad, glowing as it charges
      part(g, X(-34), Y(2.5), 68 * k, 5 * k, 2.5 * k, T.padLit, T.pad, null, off * 0.4);
      g.save(); g.globalAlpha = 0.35 + 0.35 * p.charger; g.fillStyle = T.green; rr(g, X(-20), Y(1.6), 40 * k, 1.2 * k, 0.6 * k); g.fill(); g.restore();
    }

    // legs and feet: the right foot lifted by `foot`, the legs shorter as it crouches
    const legTop = 26 - p.crouch;
    for (const s of [-1, 1]) {
      const up = s > 0 ? p.foot : 0;
      part(g, X(s * 17 - 13), Y(13 + up), 26 * k, 13 * k, 6.2 * k, T.rubber, T.rubberShade, null, off * 0.6);
      part(g, X(s * 30.5 - 1), Y(12 + up), 2 * k, 11 * k, 1 * k, T.graphLit, T.graphShade, null, 0.5);
      part(g, X(s * 17 - 6.25), Y(legTop), 12.5 * k, Math.max(2, legTop - 12 - up) * k, 3 * k, T.graphLit, T.graphShade, null, off * 0.5);
      disc(g, X(s * 17), Y(legTop + 1), 7.2 * k, T.shellLit, T.shellShade, off * 0.7);
    }

    // (the book lies in front of its feet, where it looks down to read)
    if (p.book) book(g, (v) => fx + v * k, (v) => fy - v * k, k, p);

    // the body and what sits above it, leaning about its hips
    g.save();
    g.translate(X(0), Y(legTop)); g.rotate(p.lean); g.translate(-X(0), -Y(legTop));
    const by = legTop + 2; // the body's bottom
    part(g, X(-23), Y(by + 32), 46 * k, 32 * k, 13.5 * k, T.shellLit, T.shellShade, T.shellHi, off);
    part(g, X(-14), Y(by + 24.5), 28 * k, 19 * k, 4 * k, T.graphLit, T.graphShade, null, off * 0.5);
    g.fillStyle = T.grille;
    for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(X(-7.5 + (i % 4) * 5), Y(by + 20 - Math.floor(i / 4) * 4.5), 0.9 * k, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = T.green; g.beginPath(); g.arc(X(9.5), Y(by + 9), 1.3 * k, 0, Math.PI * 2); g.fill();
    const neck = by + 32;
    part(g, X(-7.6), Y(neck + 9), 15.2 * k, 10 * k, 3 * k, T.graphLit, T.graphShade, null, off * 0.5);

    // the head, rolled about the top of its neck and nodding down by `nod`
    const hb = neck + 8 - p.nod;
    g.save(); g.translate(X(0), Y(hb)); g.rotate(p.roll); g.translate(-X(0), -Y(hb));
    part(g, X(21), Y(hb + 76), 2.3 * k, 16 * k, 1 * k, T.graphLit, T.graphShade, null, 0.5);
    g.save(); g.globalAlpha = 0.35 + 0.65 * p.antenna; glow(g, X(22.2), Y(hb + 77.5), () => { g.fillStyle = T.green; g.beginPath(); g.arc(X(22.2), Y(hb + 77.5), 2.8 * k, 0, Math.PI * 2); g.fill(); }); g.restore();
    part(g, X(-38), Y(hb + 62), 76 * k, 62 * k, 19 * k, T.shellLit, T.shellShade, T.shellHi, off);
    const fxx = X(-32.25), fyy = Y(hb + 59.25), fw = 64.5 * k, fh = 54.5 * k;
    if (p.eyes) glow(g, fxx + fw / 2, fyy + fh / 2, () => special(g, fxx, fyy, fw, fh, p.eyes, t));
    else glow(g, fxx + fw / 2, fyy + fh / 2, () => drawSageFace(g, fxx, fyy, fw, fh, p.mood, { radius: fh * 0.24, scale: fw / 170, look: p.look, shut: p.shut, squeezed: p.squeezed }));
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
