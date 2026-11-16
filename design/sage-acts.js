// What Sage does on the desk: a loop for each of the board's moods, drawn transitions between them, and acts (its
// fidgets, what it does for the author's work, the camera's moves, its moments made of the rain). Each is an exposure
// sheet of [drawing, ticks held] at 24 ticks a second; a drawing is a pose of design/sage-draw.js. The board's mood
// names are its interface; what Sage does in each is its own character (the website's rules for it: alive, never
// looping, its patience, its sleep), animated with a cartoon's licence: anticipation, overshoot and settle, squash and
// stretch, follow-through. Part of Sage's art: see LICENSE-ART.md.
(function () {
  const { between } = SageDraw;
  const FPS = 24;
  const D = {}, LOOPS = {}, TRANS = {}, CLIPS = {};
  const MOMENTS = ["idle", "working", "alert", "waiting", "done", "longhaul", "night", "meeting", "awake", "letter"];
  // (one hub: every mood is reached from idle and goes back through it, so every route the board asks for is drawn)
  const BASE = Object.fromEntries(MOMENTS.map((m) => [m, "idle"]));

  // ── timing ──
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const ease = (u) => u * u * (3 - 2 * u);
  const easeOut = (u) => 1 - (1 - u) * (1 - u);
  /** past the mark and back: a cartoon's overshoot */
  const back = (u) => { const c = 1.7; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  const wave = (t, period, lo = 0, hi = 1) => lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period));
  const round = (v, q = 0.25) => Math.round(v / q) * q;
  const q = (v, step = 0.05) => round(v, step);
  const blink = (t, at) => { const d = t - at; return d >= 0 && d < 6 ? [0.5, 0.9, 0.9, 0.5, 0.2, 0][d] : 0; };
  /** a hop at tick `at`: a crouch to wind up, the lift (stretching), the landing (a crouch again), `h` mm high */
  function hop(t, at, dur = 14, h = 7) {
    const wind = seg(t, at - 5, at), air = seg(t, at, at + dur), land = seg(t, at + dur, at + dur + 5);
    if (t < at - 5 || t > at + dur + 5) return { lift: 0, crouch: 0 };
    if (t < at) return { lift: 0, crouch: q(3.5 * easeOut(wind), 0.25) };
    if (t <= at + dur) return { lift: q(h * Math.sin(Math.PI * air), 0.25), crouch: 0 };
    return { lift: 0, crouch: q(2.5 * Math.sin(Math.PI * land), 0.25) };
  }

  // ── the cartoon: follow-through and squash and stretch, from each animation's own motion ──
  const angle = (a, b) => ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  /**
   * Springs run tick by tick over what a pose does: the antenna trails every move of the head and whips past when it
   * stops, the body stretches as it rises fast and squashes as it lands, the head rolls a little behind a sideways
   * move, and the eyes blink on a quick turn. A loop runs twice and keeps the second time round, so it closes on itself.
   */
  function cartoon(poseAt, ticks, loop) {
    const n = loop ? ticks * 2 : ticks, out = new Array(ticks);
    const s = { a: 0, av: 0, q: 0, qv: 0, r: 0, rv: 0 };
    let p0 = poseAt(loop ? ticks - 2 : 0), p1 = poseAt(loop ? ticks - 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = i % ticks, p = poseAt(t);
      const vx = (p.x || 0) - (p1.x || 0), vy = (p.lift || 0) - (p1.lift || 0), vy0 = (p1.lift || 0) - (p0.lift || 0);
      const vc = (p.crouch || 0) - (p1.crouch || 0);
      const turn = angle(p.yaw || 0, p1.yaw || 0) + angle(p.headYaw || 0, p1.headYaw || 0) + ((p.roll || 0) - (p1.roll || 0));
      const ax = vx - ((p1.x || 0) - (p0.x || 0));
      // antenna: pushed against the head's motion, a light, lively spring
      s.av += (-(vx * 0.07 + turn * 1.6 + vy * 0.03) - s.a) * 0.32; s.av *= 0.74; s.a += s.av;
      // squash and stretch: stretched by vertical speed, squashed by landing and by crouching into a jump
      const land = vy0 < -0.6 && vy >= -0.2 ? -Math.abs(vy0) * 0.12 : 0;
      s.qv += (Math.min(0.9, Math.abs(vy) * 0.09) - vc * 0.25 - s.q) * 0.38 + land; s.qv *= 0.68; s.q += s.qv;
      // the head rolling a little behind a sideways start or stop
      s.rv += (-ax * 0.05 - s.r) * 0.3; s.rv *= 0.7; s.r += s.rv;
      if (!loop || i >= ticks) {
        const quick = Math.abs(turn) > 0.09 && !p.eyes;
        out[t] = { ...p, antennaBend: q(Math.max(-0.9, Math.min(0.9, s.a + (p.antennaBend || 0))), 0.02), squash: q(Math.max(-0.6, Math.min(0.6, s.q + (p.squash || 0))), 0.02),
          roll: q((p.roll || 0) + s.r, 0.01), shut: quick ? Math.max(p.shut || 0, 0.8) : p.shut };
      }
      p0 = p1; p1 = p;
    }
    return out;
  }

  // A sheet from the cartooned poses, drawn every `step` ticks (on ones for motion); identical poses are one drawing.
  let made = 0;
  const ids = new Map();
  function drawing(pose) {
    const key = JSON.stringify(pose);
    if (!ids.has(key)) { const id = "s" + made++; ids.set(key, id); D[id] = pose; }
    return ids.get(key);
  }
  function sheet(ticks, poseAt, step = 2, loop = false) {
    const P = cartoon(poseAt, ticks, loop), out = [];
    for (let t = 0; t < ticks; t += step) {
      const id = drawing(P[t]);
      if (out.length && out[out.length - 1][0] === id) out[out.length - 1][1] += step;
      else out.push([id, step]);
    }
    return out;
  }

  // ── the loops ──
  const loopAt = {
    idle: (t) => ({ lift: q(wave(t, 48, 0, 0.6)), antenna: q(wave(t, 72, 0.55, 0.9)), shut: blink(t, 34) || blink(t, 118),
      headYaw: q(t < 52 ? 0 : t < 76 ? -0.35 * ease(seg(t, 52, 60)) : t < 88 ? -0.35 * (1 - ease(seg(t, 76, 84))) : t < 112 ? 0.35 * ease(seg(t, 88, 96)) : 0.35 * (1 - ease(seg(t, 112, 120)))) }),
    working: (t) => ({ crouch: 2, bow: 0.28, look: [0, 0.55], book: 1, light: 1, antenna: 0.8, page: t >= 96 && t < 120 ? q((t - 96) / 24, 0.125) : 0, shut: blink(t, 60), headYaw: q(wave(t, 144, -0.05, 0.05), 0.02) }),
    alert: (t) => ({ z: 1, mood: "worried", amber: true, signal: q((t % 24) / 24, 1 / 12), antenna: t % 12 < 6 ? 1 : 0.3, lift: q(wave(t, 24, 0, 0.6)) }),
    waiting: (t) => ({ mood: "annoyed", amber: true, footSide: 1, foot: t % 16 < 8 ? 4 : 0, roll: q(Math.sin((t / 48) * Math.PI * 2) * 0.05, 0.01), antenna: t % 16 < 8 ? 0.9 : 0.4 }),
    done: (t) => ({ mood: "content", bow: q(wave(t, 72, 0, 0.18), 0.02), rise: q((t % 72) / 72, 1 / 24), antenna: 0.95 }),
    longhaul: (t) => ({ crouch: 2, bow: q(wave(t, 96, 0.25, 0.45), 0.02), look: [0, 0.6], book: 1, light: 0.6, mood: "sleepy", shut: q(wave(t, 96, 0.2, 0.6), 0.1), antenna: 0.5 }),
    night: (t) => ({ crouch: 6, bow: 0.2, eyes: "sleep", antenna: q(wave(t, 96, 0.1, 0.3), 0.05) }),
    meeting: (t) => ({ z: 1, eyes: "shutter", antenna: 0.15, lift: q(wave(t, 96, 0, 0.3)) }),
    awake: (t) => ({ mood: "happy", ...hop(t % 24, 6, 12, 6), burst: t % 24 >= 10 ? q(((t % 24) - 10) / 14, 1 / 14) : 0, antenna: 1 }),
    letter: (t) => ({ headYaw: 0.5, bow: 0.25, roll: 0.1, look: [0.3, 0.5], antenna: 0.85, mood: t % 96 > 60 ? "happy" : "calm",
      things: [{ kind: "phone", x: 38, z: 30, buzz: t % 48 < 14 ? 1 : 0, yaw: 0.4 }] }),
  };
  const LENGTH = { idle: 144, working: 144, alert: 48, waiting: 48, done: 72, longhaul: 192, night: 96, meeting: 96, awake: 48, letter: 96 };
  for (const m of MOMENTS) LOOPS[m] = sheet(LENGTH[m], loopAt[m], 2, true);

  // ── transitions: from one mood's first pose to the next one's, with a little overshoot, on ones ──
  function transition(a, b, ticks = 14) {
    const from = loopAt[a](0), to = loopAt[b](0);
    return sheet(ticks, (t) => {
      const p = between(from, to, back(t / (ticks - 1)));
      for (const key of Object.keys(p)) if (typeof p[key] === "number") p[key] = q(p[key], 0.02);
      return p;
    }, 1);
  }
  for (const m of MOMENTS) if (m !== "idle") ((TRANS[`idle>${m}`] = transition("idle", m)), (TRANS[`${m}>idle`] = transition(m, "idle")));

  // ── acts, each from idle and back to it ──
  const act = (name, ticks, poseAt, step = 1) => (CLIPS[name] = { home: "idle", seq: sheet(ticks, poseAt, step) });

  // fidgets: so it never looks like a loop
  act("fidget_glance", 72, (t) => ({ headYaw: q(t < 18 ? -0.55 * back(seg(t, 0, 10)) : t < 36 ? -0.55 + 1.1 * back(seg(t, 18, 28)) : t < 54 ? 0.55 * (1 - ease(seg(t, 36, 46))) : 0, 0.02), look: [0, t >= 36 && t < 54 ? -0.5 : -0.1], bow: t >= 36 && t < 54 ? -0.12 : 0 }));
  act("fidget_antenna", 40, (t) => ({ antenna: t % 8 < 4 ? 1 : 0.2, roll: q(Math.sin(t / 2.6) * 0.06 * (1 - seg(t, 20, 40)), 0.01), antennaBend: q(Math.sin(t / 2) * 0.5 * (1 - seg(t, 10, 40)), 0.02) }));
  act("fidget_stretch", 72, (t) => ({ lift: q(3 * Math.sin(Math.PI * seg(t, 10, 50)), 0.25), squash: q(0.35 * Math.sin(Math.PI * seg(t, 10, 50)), 0.02), roll: q(Math.sin(seg(t, 10, 60) * Math.PI * 2) * 0.08, 0.01), mood: t > 18 && t < 54 ? "sleepy" : "calm", shut: t > 24 && t < 48 ? 0.6 : 0 }));
  act("fidget_mark", 72, (t) => ({ eyes: t > 6 && t < 66 ? "mark" : null, antenna: 1 }));
  act("hello", 48, (t) => ({ mood: "happy", ...hop(t, 8, 14, 9), headYaw: q(Math.sin(t / 5) * 0.12, 0.02), burst: t >= 14 ? q(seg(t, 14, 34), 0.05) : 0, antenna: 1 }));
  act("tap_hello", 40, (t) => ({ mood: "happy", ...hop(t, 6, 12, 6), roll: t < 20 ? 0.06 : -0.04, antenna: 1 }));
  act("tap_dizzy", 72, (t) => ({ eyes: "dizzy", roll: q(Math.sin(t / 4) * 0.14 * (1 - seg(t, 48, 72)), 0.01), headYaw: q(Math.sin(t / 6) * 0.2 * (1 - seg(t, 48, 72)), 0.02), antenna: t % 6 < 3 ? 1 : 0.3 }));
  act("done_glider", 96, (t) => ({ eyes: "glider", rise: q((t % 48) / 48, 1 / 24), antenna: 1 }));
  // a turn on the spot, all the way round: its head leading, its body following, past the front and back to it
  act("fidget_turn", 108, (t) => { const u = seg(t, 6, 90), body = 2 * Math.PI * back(u) - 2 * Math.PI; return { yaw: q(((body % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), 0.02), headYaw: q(0.45 * Math.sin(Math.PI * u), 0.02), mood: t > 92 ? "happy" : "calm", wheel: q(u * 6, 0.1), antenna: t > 92 ? 1 : 0.7 }; });
  act("fidget_look", 96, (t) => ({ headYaw: q(t < 30 ? -0.9 * back(seg(t, 0, 12)) : t < 60 ? -0.9 + 1.8 * back(seg(t, 30, 44)) : 0.9 * (1 - ease(seg(t, 60, 74))), 0.02), look: [0, -0.2] }));

  // what the author is doing, with the things that come for it
  // tests fail: its visor's cells break into amber, a glitch scuttles in, it turns, rolls over leaning into it, winds
  // up and stomps it, then a glider crosses its visor
  act("work_tests_fail", 140, (t) => {
    const turnOut = back(seg(t, 30, 44)), roll = ease(seg(t, 44, 72)), turnBack = back(seg(t, 98, 114));
    const x = q(22 * roll, 0.25), speed = 22 * (ease(seg(t + 1, 44, 72)) - ease(seg(t - 1, 44, 72))) / 2, squashed = t >= 90;
    const wind = seg(t, 74, 86), stomp = seg(t, 86, 90);
    return {
      eyes: t < 24 ? "ash" : t >= 116 ? "glider" : null, mood: t < 98 ? "worried" : "happy", amber: t < 98,
      headYaw: q(t < 30 ? 0.6 * back(seg(t, 10, 22)) : 0.6 * (1 - seg(t, 30, 38)), 0.02), yaw: q(Math.PI / 2 * (turnOut - turnBack), 0.02),
      x, wheel: q(x / 5.5, 0.1), lean: q(-speed * 0.12 + (t >= 72 && t < 82 ? 0.06 * Math.sin(Math.PI * seg(t, 72, 82)) : 0), 0.01),
      footSide: -1, foot: q(t < 86 ? 11 * easeOut(wind) : t < 90 ? 11 * (1 - stomp) : 0, 0.5), crouch: q(t < 86 ? 2 * wind : t < 96 ? 3 * Math.sin(Math.PI * seg(t, 88, 96)) : 0, 0.25),
      camY: t >= 89 && t < 95 ? q(Math.sin(t * 3) * 1.5, 0.5) : 0, camX: 14, zoom: 0.92, antenna: t >= 116 ? 1 : 0.6,
      things: [{ kind: "glitch", x: squashed ? 38 : q(90 - 50 * seg(t, 0, 30) - 4 * seg(t, 30, 84), 0.5), z: 20, step: q(t * 0.9, 0.3), squashed, fade: q(seg(t, 92, 132), 0.05) }],
    };
  });
  // a deploy: the website's prompt rises out of the desk beside it, its visor's cells light one by one, the prompt
  // takes off on a column of light, it follows it up with its whole head, and joy rises from its antenna
  act("work_deploy", 150, (t) => {
    const pop = seg(t, 0, 16), launch = seg(t, 72, 122), up = 260 * launch * launch;
    return {
      headYaw: q(0.6 * back(seg(t, 6, 18)), 0.02), bow: q(-0.35 * ease(seg(t, 76, 104)), 0.02), look: [0, q(-0.8 * ease(seg(t, 76, 104)))],
      eyes: t >= 16 && t < 66 ? "cells" : null, bar: q(seg(t, 16, 62), 0.1), mood: t >= 104 ? "happy" : "calm",
      ...(t >= 70 && t < 84 ? hop(t, 74, 8, 3) : {}), rise: t >= 108 ? q((t - 108) / 42, 1 / 24) : 0, antenna: t >= 104 ? 1 : 0.7, camX: 12, zoom: 0.92,
      things: [{ kind: "prompt", x: q(48 + (t >= 60 && t < 74 ? Math.sin(t * 2.3) * 0.7 : 0), 0.1), z: 6, scale: q(pop < 1 ? back(pop) : 1, 0.02), up: q(up, 0.5), thrust: q(t >= 62 ? (t < 74 ? 0.5 : 1) : 0, 0.5) }],
    };
  });
  // a build: its own modules drop one by one onto a pile, it flinches at each landing, then nods, pleased
  act("work_build", 160, (t) => {
    const drops = [[8, 0], [40, 22], [72, 44]];
    const mods = drops.map(([at, rest], i) => {
      if (t < at) return null;
      const fall = seg(t, at, at + 14), land = t - (at + 14);
      const y = fall < 1 ? rest + 150 * (1 - fall * fall) : rest + (land < 8 ? Math.max(0, Math.sin(Math.PI * land / 8)) * 3 : 0);
      return { kind: "module", x: 48 + (i === 1 ? -1 : i === 2 ? 1.5 : 0), y: q(y, 0.5), z: 12, size: 22, yaw: i === 2 ? 0.12 : 0, squash: q(fall >= 1 && land < 4 ? 0.22 * (1 - land / 4) : 0, 0.02) };
    }).filter(Boolean);
    const flinch = drops.some(([at]) => t >= at + 14 && t < at + 20);
    return { headYaw: q(0.55 * back(seg(t, 0, 10)) * (1 - ease(seg(t, 104, 116))), 0.02), look: [0, -0.2], squeezed: flinch, crouch: flinch ? 1.5 : 0, eyes: t >= 116 && t < 140 ? "glider" : null,
      bow: t >= 140 ? q(0.25 * Math.sin(Math.PI * seg(t, 140, 156)), 0.02) : 0, mood: t >= 140 ? "happy" : "calm", antenna: t >= 116 ? 1 : 0.7, camX: 14, zoom: 0.88, things: mods };
  });

  // made of the rain: Sage forming out of the website's glyphs, dissolving into them, or staying made of them
  const idlePose = (t) => loopAt.idle(t);
  act("glyph_form", 96, (t) => ({ ...idlePose(t), glyph: { mode: "form", reveal: q(ease(seg(t, 0, 64)), 0.02), rain: q(0.9 - 0.6 * seg(t, 0, 64), 0.05), blend: q(seg(t, 76, 96), 0.05) } }));
  act("glyph_dissolve", 96, (t) => ({ ...idlePose(t), mood: "calm", glyph: { mode: "dissolve", reveal: q(1 - ease(seg(t, 16, 80)), 0.02), rain: q(0.3 + 0.6 * seg(t, 16, 80), 0.05), blend: q(1 - seg(t, 0, 16), 0.05) } }));
  act("glyph_mode", 120, (t) => ({ ...idlePose(t), glyph: { mode: "full", reveal: 1, rain: 0.35 } }));
  act("glyph_rain", 192, (t) => {
    const out = t < 72, back2 = t >= 100;
    return { ...idlePose(t), glyph: out ? { mode: "dissolve", reveal: q(1 - ease(seg(t, 12, 72)), 0.02), rain: q(0.3 + 0.6 * seg(t, 12, 72), 0.05), blend: q(1 - seg(t, 0, 12), 0.05) }
      : back2 ? { mode: "form", reveal: q(ease(seg(t, 100, 160)), 0.02), rain: q(0.9 - 0.6 * seg(t, 100, 160), 0.05), blend: q(seg(t, 170, 192), 0.05) }
      : { mode: "form", reveal: 0, rain: 0.9 } };
  });

  // the camera's moves: the camera goes round, up and over; Sage stays itself
  act("cam_orbit", 144, (t) => ({ orbit: q((2 * Math.PI * t) / 144, 0.02), headYaw: q(Math.sin((2 * Math.PI * t) / 144) * 0.5, 0.02), tilt: 0.25, antenna: 0.85 }));
  act("cam_crane", 120, (t) => { const e = ease(seg(t, 0, 108)); return { tilt: q(-0.5 + 1.3 * e, 0.02), bow: q(-0.25 + 0.5 * e, 0.02), zoom: q(1.05 - 0.15 * e, 0.01), mood: t > 108 ? "happy" : "calm" }; });
  act("cam_top", 96, (t) => ({ tilt: 1.3, zoom: 0.9, yaw: q((2 * Math.PI * t) / 96, 0.02), wheel: q(t * 0.2, 0.1) }));
  act("cam_wake", 96, (t) => ({ z: 1, tilt: -0.45, shut: t < 24 ? 0.9 : t < 36 ? q(0.9 - ((t - 24) / 12) * 0.9, 0.1) : 0, bow: t < 48 ? 0 : 0.2, mood: t > 60 ? "happy" : "calm", antenna: t < 24 ? 0.2 : 1 }));

  // ── the interface the bake reads (tools/export_frames.py) ──
  const SEQ = (k) => LOOPS[k] || TRANS[k] || (CLIPS[k] && CLIPS[k].seq);
  const seqLen = (k) => SEQ(k).reduce((s, [, h]) => s + h, 0);
  function at(k, tick) {
    const L = SEQ(k), n = seqLen(k);
    let f = ((tick % n) + n) % n;
    for (let i = 0; i < L.length; i++) { if (f < L[i][1]) return { i, id: L[i][0] }; f -= L[i][1]; }
    return { i: L.length - 1, id: L[L.length - 1][0] };
  }
  function atSeq(k, tick) { return at(k, Math.max(0, Math.min(tick, seqLen(k) - 1))); }
  function render(ctx, _mood, id, tick) {
    ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 240, 240);
    // (a drawing made of the rain's glyphs goes through design/sage-glyphs.js, the rest is drawn as instructions)
    if (D[id].glyph && window.SageGlyphs) SageGlyphs.draw(ctx, D[id], tick);
    else SageDraw.drawSage(ctx, D[id], tick);
  }
  const meta = () => ({
    moments: MOMENTS.map((m) => ({ name: m, base: MOMENTS.indexOf(BASE[m]) })),
    seqs: [
      ...MOMENTS.map((m) => ({ key: m, kind: 0, from: m, to: m, name: m })),
      ...Object.keys(TRANS).map((k) => { const [a, b] = k.split(">"); return { key: k, kind: 1, from: a, to: b, name: k }; }),
      ...Object.keys(CLIPS).map((n) => ({ key: n, kind: 2, from: CLIPS[n].home, to: CLIPS[n].home, name: n })),
    ],
  });
  window.__sage = {
    FPS, D, LOOPS, TRANS, CLIPS, MOMENTS, BASE, render, at, atSeq, seqLen, meta,
    fxFor: () => "none",
    // (the bake's colour switches belong to another character's palette: Sage keeps its own colours)
    setTint() {}, setLine() {},
  };
})();
