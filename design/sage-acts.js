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

  // A sheet from the cartooned poses, drawn every `step` ticks; identical poses are one drawing. Step "auto" is on twos
  // (a drawing held two ticks, as cartoons are animated) except where the pose changes fast, which goes on ones.
  let made = 0;
  const ids = new Map();
  function drawing(pose) {
    const key = JSON.stringify(pose);
    if (!ids.has(key)) { const id = "s" + made++; ids.set(key, id); D[id] = pose; }
    return ids.get(key);
  }
  // (only its own moves count: the camera always moves on twos)
  const ANGLES = ["yaw", "headYaw", "bow", "roll", "lean", "squash", "antennaBend"], MM = ["lift", "crouch", "x", "foot"];
  const delta = (a, b) => ANGLES.reduce((d, k) => d + Math.abs((a[k] || 0) - (b[k] || 0)), 0) + MM.reduce((d, k) => d + Math.abs((a[k] || 0) - (b[k] || 0)) * 0.08, 0);
  function sheet(ticks, poseAt, step = 2, loop = false) {
    const P = cartoon(poseAt, ticks, loop), out = [];
    const push = (id, n) => { if (out.length && out[out.length - 1][0] === id) out[out.length - 1][1] += n; else out.push([id, n]); };
    if (step === "auto") {
      for (let t = 0; t < ticks; t += 2) {
        if (t + 1 < ticks && delta(P[t], P[t + 1]) > 0.07) { push(drawing(P[t]), 1); push(drawing(P[t + 1]), 1); }
        else push(drawing(P[t]), Math.min(2, ticks - t));
      }
      return out;
    }
    for (let t = 0; t < ticks; t += step) push(drawing(P[t]), step);
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
  const act = (name, ticks, poseAt, step = "auto") => (CLIPS[name] = { home: "idle", seq: sheet(ticks, poseAt, step) });

  // fidgets: so it never looks like a loop
  act("fidget_glance", 72, (t) => ({ headYaw: q(t < 18 ? -0.55 * back(seg(t, 0, 10)) : t < 36 ? -0.55 + 1.1 * back(seg(t, 18, 28)) : t < 54 ? 0.55 * (1 - ease(seg(t, 36, 46))) : 0, 0.02), look: [0, t >= 36 && t < 54 ? -0.5 : -0.1], bow: t >= 36 && t < 54 ? -0.12 : 0 }));
  act("fidget_antenna", 40, (t) => ({ antenna: t % 8 < 4 ? 1 : 0.2, roll: q(Math.sin(t / 2.6) * 0.06 * (1 - seg(t, 20, 40)), 0.01), antennaBend: q(Math.sin(t / 2) * 0.5 * (1 - seg(t, 10, 40)), 0.02) }));
  act("fidget_stretch", 72, (t) => ({ lift: q(3 * Math.sin(Math.PI * seg(t, 10, 50)), 0.25), squash: q(0.35 * Math.sin(Math.PI * seg(t, 10, 50)), 0.02), roll: q(Math.sin(seg(t, 10, 60) * Math.PI * 2) * 0.08, 0.01), mood: t > 18 && t < 54 ? "sleepy" : "calm", shut: t > 24 && t < 48 ? 0.6 : 0 }));
  act("fidget_mark", 72, (t) => ({ eyes: t > 6 && t < 66 ? "mark" : null, antenna: 1 }));
  act("hello", 48, (t) => ({ mood: "happy", ...hop(t, 8, 14, 9), headYaw: q(Math.sin(t / 5) * 0.12, 0.02), burst: t >= 14 ? q(seg(t, 14, 34), 0.05) : 0, antenna: 1 }));
  act("tap_hello", 40, (t) => ({ mood: "happy", ...hop(t, 6, 12, 6), roll: t < 20 ? 0.06 : -0.04, antenna: 1 }));
  act("tap_dizzy", 72, (t) => ({ eyes: "dizzy", roll: q(Math.sin(t / 4) * 0.14 * (1 - seg(t, 48, 72)), 0.01), headYaw: q(Math.sin(t / 6) * 0.2 * (1 - seg(t, 48, 72)), 0.02), antenna: t % 6 < 3 ? 1 : 0.3 }));
  act("done_glider", 96, (t) => ({ eyes: "glider", rise: q((t % 48) / 48, 1 / 24), antenna: 1 }));
  // it loves what it sees: its eyes the room's red hearts, beating, and hearts rising from its antenna
  act("done_hearts", 72, (t) => ({ eyes: "hearts", hearts: q((t % 48) / 48, 1 / 24), antenna: 1 }));
  // a turn on the spot, all the way round: its head leading, its body following, past the front and back to it
  act("fidget_turn", 108, (t) => { const u = seg(t, 6, 90), body = 2 * Math.PI * back(u) - 2 * Math.PI; return { yaw: q(((body % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), 0.02), headYaw: q(0.45 * Math.sin(Math.PI * u), 0.02), mood: t > 92 ? "happy" : "calm", wheel: q(u * 6, 0.1), antenna: t > 92 ? 1 : 0.7 }; });
  act("fidget_look", 96, (t) => ({ headYaw: q(t < 30 ? -0.9 * back(seg(t, 0, 12)) : t < 60 ? -0.9 + 1.8 * back(seg(t, 30, 44)) : 0.9 * (1 - ease(seg(t, 60, 74))), 0.02), look: [0, -0.2] }));

  // ── what the author is doing: its desk is a board of the Game of Life ──
  const L = SageThings.life, idle0 = loopAt.idle(0);
  /** an act that starts from idle's first drawing and settles back into it, so neither end jumps */
  const settled = (ticks, poseAt, inT = 8, outT = 14) => (t) => {
    const p = poseAt(t);
    if (t < inT) return between(idle0, p, ease((t + 1) / (inT + 1)));
    if (t >= ticks - outT) return between(p, idle0, ease((t - (ticks - outT) + 1) / (outT + 1)));
    return p;
  };
  // (the camera rises over the desk for these, so the board reads)
  const DESKCAM = { tilt: 0.66, camY: -24 };

  // tests fail, a deploy and a build, each with what comes for it
  // tests fail: its visor's cells break into amber, a glitch scuttles in, it turns, rolls over leaning into it, winds
  // up and stomps it, then a glider crosses its visor
  act("work_tests_fail", 140, settled(140, (t) => {
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
  }));
  // a deploy: the website's prompt rises out of the desk beside it, its visor's cells light one by one, the prompt
  // takes off on a column of light, it follows it up with its whole head, and joy rises from its antenna
  act("work_deploy", 150, settled(150, (t) => {
    const pop = seg(t, 0, 16), launch = seg(t, 72, 122), up = 260 * launch * launch;
    return {
      headYaw: q(0.6 * back(seg(t, 6, 18)), 0.02), bow: q(-0.35 * ease(seg(t, 76, 104)), 0.02), look: [0, q(-0.8 * ease(seg(t, 76, 104)))],
      eyes: t >= 16 && t < 66 ? "cells" : null, bar: q(seg(t, 16, 62), 0.1), mood: t >= 104 ? "happy" : "calm",
      ...(t >= 70 && t < 84 ? hop(t, 74, 8, 3) : {}), rise: t >= 108 ? q((t - 108) / 42, 1 / 24) : 0, antenna: t >= 104 ? 1 : 0.7, camX: 12, zoom: 0.92,
      things: [{ kind: "prompt", x: q(48 + (t >= 60 && t < 74 ? Math.sin(t * 2.3) * 0.7 : 0), 0.1), z: 6, scale: q(pop < 1 ? back(pop) : 1, 0.02), up: q(up, 0.5), thrust: q(t >= 62 ? (t < 74 ? 0.5 : 1) : 0, 0.5) }],
    };
  }));
  // a build: its own modules drop one by one onto a pile, it flinches at each landing, then nods, pleased
  act("work_build", 160, settled(160, (t) => {
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
  }));

  // the same moments on the Life board, as variants of them
  // tests fail: a test run lights a grid of cells one by one, and one comes up amber and will not hold still. It
  // glances back at you as if nothing happened, does a double take, leans in to look, and turns to tell you.
  const FAILS = new Set([6, 9]);
  act("life_tests_fail", 168, settled(168, (t) => {
    const cells = [];
    for (let i = 0; i < 12; i++) {
      const at = 14 + i * 4.5; if (t < at) continue;
      const fail = FAILS.has(i), s = back(seg(t, at, at + 6)) * (1 - ease(seg(t, 132, 150)));
      cells.push([i % 4, Math.floor(i / 4), q(s, 0.05), fail ? "amber" : "green", fail && t > at + 6 && t < 132 ? (Math.floor(t / 3) % 2) * 2 : 0]);
    }
    const look = t < 47 ? 1 : t < 56 ? 1 - back(seg(t, 47, 53)) : t < 100 ? back(seg(t, 56, 61)) : 1 - ease(seg(t, 100, 112));
    const lean = t >= 62 && t < 100 ? ease(seg(t, 62, 74)) : 0, worried = t >= 56, into = ease(seg(t, 0, 10));
    return {
      ...DESKCAM, headYaw: q(0.55 * look * into, 0.01), bow: q(0.12 * look * into + 0.16 * lean, 0.01), look: [q(0.35 * look), q(0.45 * look)],
      lean: q(0.07 * lean, 0.01), crouch: q(1.5 * lean, 0.25), squeezed: t >= 56 && t < 60, mood: worried ? "worried" : "calm", amber: worried,
      eyes: t >= 76 && t < 98 ? "ash" : null, signal: t >= 112 && t < 140 ? q(((t - 112) % 24) / 24, 1 / 12) : 0, antenna: worried ? (t % 12 < 6 ? 1 : 0.4) : 0.7,
      camX: 26, zoom: 0.92, things: [{ kind: "board", x: 44, z: 16, size: 13, c0: -1, r0: -1, c1: 4, r1: 3, alpha: q(0.18 * ease(seg(t, 0, 12)) * (1 - ease(seg(t, 136, 152))), 0.02) }, ...(cells.length ? [{ kind: "cells", x: 44, z: 16, size: 13, cells }] : [])],
    };
  }));

  // a deploy: a glider, the website's mark, is put together cell by cell on the desk while its visor counts the cells;
  // it gives it a nudge, the glider sets off by Life's own rule across the desk and away, and it watches it go
  const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]], GLIDE = L.run(GLIDER, 60);
  act("life_deploy", 184, settled(184, (t) => {
    const g = t < 60 ? 0 : t < 84 ? (t - 60) / 6 : 4 + (t - 84) / 2.4, away = clamp01((g - 2) / 38);
    const cells = t < 60 ? GLIDER.map(([c, r], i) => [c, r, q(back(seg(t, 10 + i * 6, 16 + i * 6)), 0.05)]).filter(([, , s]) => s > 0)
      : L.between(GLIDE, g).map(([c, r, s]) => [c, r, q(s, 0.05)]);
    const into = ease(seg(t, 0, 10));
    return {
      ...DESKCAM, headYaw: q(0.45 * into + 0.4 * away, 0.01), bow: q(0.2 * into - 0.3 * away, 0.01), look: [q(0.3 + 0.3 * away), q(0.4 - 0.9 * away)],
      eyes: t >= 10 && t < 46 ? "cells" : null, bar: q(seg(t, 10, 40), 0.1), mood: t >= 120 ? "happy" : "calm",
      ...(t >= 44 && t < 70 ? hop(t, 54, 8, 4) : {}), rise: t >= 124 ? q(((t - 124) % 48) / 48, 1 / 24) : 0, antenna: t >= 50 ? 1 : 0.7,
      camX: q(22 + 14 * away, 0.25), zoom: q(0.94 - 0.08 * away, 0.01), things: [{ kind: "board", x: 34, z: 30, size: 11, c0: -1, r0: -1, c1: 4, r1: 4, alpha: q(0.18 * ease(seg(t, 0, 12)) * (1 - ease(seg(t, 150, 168))), 0.02) }, ...(cells.length ? [{ kind: "cells", x: 34, z: 30, size: 11, cells }] : [])],
    };
  }));

  // a build: a handful of cells lands on the desk and Life computes them, generation by generation, cells born and
  // dying, until they settle into two loaves (still lifes); it watches every step, flinches when the pattern boils
  // over, and is pleased when it settles
  const SEED = [[1, 1], [1, 2], [2, 2], [3, 2], [4, 3], [0, 4], [1, 4], [4, 4]], BUILD = L.run(SEED, 17), POP = BUILD.map((s) => s.size);
  act("life_build", 184, settled(184, (t) => {
    const g = t < 34 ? 0 : Math.min(17, (t - 34) / 5), gi = Math.floor(g), done = t >= 34 + 17 * 5;
    const fade = 1 - ease(seg(t, 152, 168)), lit = done && t < 152 && Math.floor((t - 119) / 6) % 2 === 0;
    const cells = (t < 34 ? SEED.map(([c, r], i) => [c, r, back(seg(t, 8 + i * 3, 13 + i * 3))]).filter(([, , s]) => s > 0) : L.between(BUILD, g))
      .map(([c, r, s]) => [c, r, q(s * fade, 0.05), lit ? "lit" : "green"]);
    const boil = t >= 34 && gi < 17 && Math.abs(POP[gi + 1] - POP[gi]) >= 4 && (t - 34) % 5 < 3, into = ease(seg(t, 0, 10));
    return {
      ...DESKCAM, headYaw: q(0.6 * into * (1 - ease(seg(t, 126, 138))), 0.01), bow: q(0.22 * into * (1 - ease(seg(t, 126, 138))), 0.01), look: [q(0.4 * into), q(0.5 * into)],
      squeezed: boil, crouch: boil ? 1 : 0, eyes: done && t >= 124 && t < 146 ? "glider" : null, mood: done ? "happy" : "calm",
      rise: done && t >= 128 ? q(((t - 128) % 48) / 48, 1 / 24) : 0, antenna: done ? 1 : 0.7,
      camX: 40, zoom: 0.84, things: [{ kind: "board", x: 66, z: 18, size: 9, c0: -4, r0: -2, c1: 7, r1: 7, alpha: q(0.16 * ease(seg(t, 0, 12)) * (1 - ease(seg(t, 152, 168))), 0.02) }, ...(cells.length ? [{ kind: "cells", x: 66, z: 18, size: 9, cells }] : [])],
    };
  }));

  // ── the camera's moves, and Sage minding the camera ──
  // (a block, a beehive and a blinker on the desk, so the world turns as the camera does)
  const BLINK = L.run([[0, 1], [1, 1], [2, 1]], 2);
  /** the desk at tick `t` of an act `ticks` long: it comes up out of the black as the act starts and goes as it ends */
  const DESK = (t, ticks) => {
    const k = q(ease(seg(t, 0, 16)) * (1 - ease(seg(t, ticks - 16, ticks - 1))), 0.05), at = (cells) => cells.map(([c, r, s = 1]) => [c, r, q(s * k, 0.05)]);
    return k <= 0 ? [] : [
      { kind: "board", x: -84, z: 84, size: 12, c0: 0, r0: 0, c1: 13, r1: 13, alpha: q(0.1 * k, 0.01) },
      { kind: "cells", x: -66, z: 34, size: 7, cells: at([[0, 0], [1, 0], [0, 1], [1, 1]]) },
      { kind: "cells", x: 44, z: -36, size: 7, cells: at([[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2]]) },
      { kind: "cells", x: -58, z: -34, size: 7, cells: at(L.between(BLINK, (t / 12) % 2)) },
    ];
  };
  // all the way round it: its head keeps you in sight, and its body catches up in three little hops
  act("cam_orbit", 192, (t) => {
    const u = seg(t, 0, 184), o = 2 * Math.PI * ease(u);
    let body = 0, h = { lift: 0, crouch: 0 };
    for (const at of [58, 102, 146]) { body += ((2 * Math.PI) / 3) * back(seg(t, at, at + 10)); const hh = hop(t, at, 9, 3); if (hh.lift || hh.crouch) h = hh; }
    const head = Math.max(-0.9, Math.min(0.9, o - body));
    return { orbit: o, yaw: body, headYaw: head, look: [q(Math.max(-0.7, Math.min(0.7, (o - body - head) * 1.2))), 0], ...h, wheel: q(body * 2, 0.05),
      tilt: 0.12 + 0.22 * Math.sin(Math.PI * u), zoom: 1 - 0.18 * Math.sin(Math.PI * u), mood: t > 170 ? "happy" : "calm", shut: blink(t, 176), things: DESK(t, 192) };
  });
  // from below to above: it looks down at the camera low, lifts its head to keep it in sight as it rises, and hops
  // for it at the top
  const craneTilt = (t) => (t < 20 ? 0.12 - 0.47 * ease(seg(t, 0, 20)) : t < 100 ? -0.35 + 1.5 * ease(seg(t, 20, 100)) : t < 128 ? 1.15 : 1.15 - 1.03 * ease(seg(t, 128, 152)));
  act("cam_crane", 156, (t) => {
    const tilt = craneTilt(t), seen = craneTilt(Math.max(0, t - 5)), top = t >= 104 && t < 128;
    return { tilt, orbit: 0.35 * Math.sin(Math.PI * seg(t, 0, 152)), zoom: 1 + 0.08 * Math.sin(Math.PI * seg(t, 0, 40)) - 0.06 * Math.sin(Math.PI * seg(t, 60, 152)),
      bow: q(Math.max(-0.6, Math.min(0.3, -0.55 * (seen - 0.12))), 0.01), look: [0, q(Math.max(-0.7, Math.min(0.5, -0.6 * (seen - 0.12))))],
      ...(top ? hop(t, 110, 10, 6) : {}), burst: t >= 114 && t < 128 ? q(seg(t, 114, 128), 0.05) : 0, mood: t >= 104 ? "happy" : "calm", antenna: top ? 1 : 0.75, things: DESK(t, 156) };
  });
  // from straight above: it looks up into the camera, then a glider crawls by on the desk and it turns to follow it
  const PASS = L.run(GLIDER, 44);
  act("cam_top", 172, (t) => {
    const up = ease(seg(t, 0, 24)) * (1 - ease(seg(t, 148, 170))), g = t < 30 ? 0 : Math.min(44, (t - 30) / 2.6);
    const gx = -15 + (g / 4) * 10 + 10, gz = 110 - (g / 4) * 10 - 10, want = Math.atan2(gx, gz), follow = t >= 34 && t < 140 ? 1 : 0;
    const body = follow ? want * 0.7 : t >= 140 ? want * 0.7 * (1 - ease(seg(t, 140, 160))) : 0;
    const looking = t < 30 || t >= 136 ? 1 : 0;
    return { tilt: 0.12 + 1.26 * up, zoom: 1 - 0.22 * up, yaw: q(body, 0.01), headYaw: q(follow ? want - body : 0, 0.01), wheel: q(body * 3, 0.05),
      bow: q(looking ? -0.6 * up : 0.12 * up, 0.01), look: [0, q(looking ? -0.6 * up : 0.5 * up)], mood: looking ? "happy" : "calm", shut: blink(t, 20) || blink(t, 150),
      things: [...DESK(t, 172), ...(t >= 30 && t < 150 ? [{ kind: "cells", x: -15, z: 110, size: 10, cells: L.between(PASS, g) }] : [])] };
  });
  act("cam_wake", 96, (t) => ({ z: 1, tilt: -0.45, shut: t < 24 ? 0.9 : t < 36 ? q(0.9 - ((t - 24) / 12) * 0.9, 0.1) : 0, bow: t < 48 ? 0 : 0.2, mood: t > 60 ? "happy" : "calm", antenna: t < 24 ? 0.2 : 1 }));
  // over its shoulder: it is reading, it feels the camera behind it, looks back at you, and the camera comes round
  act("cam_peek", 176, (t) => {
    const go = ease(seg(t, 0, 34)), back2 = ease(seg(t, 104, 146)), o = 2.2 * go * (1 - back2);
    const turn = t >= 84 ? back(seg(t, 84, 96)) : 0, reading = t < 150;
    return { orbit: o, tilt: 0.12 + 0.5 * go * (1 - back2), zoom: 1 - 0.04 * go * (1 - back2), camY: -16 * go * (1 - back2),
      bow: q(reading ? 0.28 * ease(seg(t, 0, 16)) * (1 - turn * 0.8) : 0.06, 0.01), book: reading ? 1 : 0, light: reading ? 1 : 0, page: t >= 46 && t < 62 ? q(seg(t, 46, 62), 0.125) : 0,
      look: [q(0.5 * turn * (1 - back2)), q(0.55 * (1 - turn))], headYaw: q(Math.min(1.35, o) * turn, 0.01),
      antennaBend: t >= 70 && t < 82 ? q(Math.sin((t - 70) * 1.3) * 0.4, 0.02) : 0, squeezed: t >= 84 && t < 88, mood: t >= 90 ? "happy" : "calm",
      ...(t >= 150 ? hop(t, 156, 9, 4) : {}), crouch: reading ? 2 * ease(seg(t, 0, 16)) : 0 };
  });

  // ── what it projects: holograms from its visor, as its mind shows on the website ──
  const HOLO = { at: [84, 104, 12], w: 64, h: 46, yaw: 0.35 };
  /** a hologram act: it turns a little to the side, throws the picture into the air, and switches it off; `show(t)` is
   *  what the picture shows, `poseAt(t)` what Sage does meanwhile */
  function holoAct(name, ticks, poseAt, show) {
    act(name, ticks, settled(ticks, (t) => {
      const open = q(Math.min(seg(t, 12, 26), 1 - seg(t, ticks - 36, ticks - 24)), 0.04), turn = ease(seg(t, 4, 14)) * (1 - ease(seg(t, ticks - 24, ticks - 14)));
      return { headYaw: q(0.4 * turn, 0.01), look: [q(0.5 * turn), 0], camX: 34, zoom: 0.84, ...poseAt(t), holo: open > 0 ? { ...HOLO, open, ...show(t) } : null };
    }));
  }
  // a test run, a cell a test as each finishes; two come up amber, and it turns to tell you
  holoAct("holo_tests", 180, (t) => ({ mood: t >= 72 ? "worried" : "calm", amber: t >= 72, squeezed: t >= 72 && t < 76, antenna: t >= 72 ? (t % 12 < 6 ? 1 : 0.4) : 0.7,
    ...(t >= 112 && t < 146 ? { headYaw: 0, look: [0, 0], signal: q(((t - 112) % 24) / 24, 1 / 12) } : {}) }),
    (t) => ({ kind: "tests", count: 12, done: Math.max(0, Math.min(12, Math.floor((t - 28) / 5))), fails: [7, 10], glitch: t >= 72 && t < 110 ? 0.4 : 0 }));
  // a build's progress round a ring, a stall halfway, and a hop when it reaches a hundred
  const buildP = (t) => (t < 30 ? 0 : t < 64 ? 0.55 * seg(t, 30, 64) : t < 80 ? 0.55 : 0.55 + 0.45 * ease(seg(t, 80, 112)));
  holoAct("holo_build", 168, (t) => ({ mood: t >= 112 ? "happy" : "calm", ...(t >= 112 && t < 136 ? hop(t, 118, 10, 5) : {}), burst: t >= 122 && t < 138 ? q(seg(t, 122, 138), 0.05) : 0, antenna: t >= 112 ? 1 : 0.7,
    bow: t >= 64 && t < 80 ? q(0.1 * Math.sin(Math.PI * seg(t, 64, 80)), 0.01) : 0 }),
    (t) => ({ kind: "ring", progress: q(buildP(t), 0.01) }));
  // late at night: it shows you the time, yawns, and switches it off
  holoAct("holo_clock", 180, (t) => ({ crouch: 2, mood: "sleepy", shut: t >= 80 && t < 104 ? q(0.7 * Math.sin(Math.PI * seg(t, 80, 104)), 0.1) : 0.2,
    squash: t >= 80 && t < 104 ? q(0.25 * Math.sin(Math.PI * seg(t, 80, 104)), 0.02) : 0, antenna: 0.4 }),
    () => ({ kind: "clock", time: "02:14" }));
  // its battery, the author's Claude usage, below a quarter: it droops and sighs
  holoAct("holo_battery", 164, (t) => ({ crouch: q(3 * ease(seg(t, 20, 40)), 0.25), bow: q(0.16 * ease(seg(t, 20, 40)), 0.01), mood: "sleepy", antenna: q(0.35 + 0.1 * Math.sin(t / 6), 0.05),
    squash: t >= 76 && t < 96 ? q(-0.22 * Math.sin(Math.PI * seg(t, 76, 96)), 0.02) : 0 }),
    () => ({ kind: "battery", level: 0.23 }));
  // a board of the Game of Life in the air, a glider going round it
  holoAct("holo_life", 176, (t) => ({ mood: "content", bow: q(0.04 * Math.sin(t / 5), 0.01), antenna: 0.85 }),
    (t) => ({ kind: "life", gen: Math.max(0, Math.floor((t - 26) / 4)) }));
  // itself, as a wireframe turning in the air; it tilts its head at it, pleased
  holoAct("holo_self", 176, (t) => ({ roll: q(t >= 50 && t < 120 ? 0.1 * ease(seg(t, 50, 62)) * (1 - ease(seg(t, 108, 120))) : 0, 0.01), mood: t >= 120 ? "happy" : "calm", antenna: 0.9 }),
    (t) => ({ kind: "self", turn: q(Math.max(0, t - 20) / 22, 0.01) }));

  // ── made of the rain ──
  /**
   * A glyph act: it leaves the illustrated Sage by tearing like a bad signal into glyphs, and comes back the same way;
   * an act that starts in the rain (`handIn` false) or ends in it (`handOut` false) tears only where it meets Sage.
   */
  function glyphAct(name, ticks, poseAt, { handIn = true, handOut = true } = {}) {
    act(name, ticks, (t) => {
      const p = poseAt(t);
      if ((handIn && t < 2) || (handOut && t >= ticks - 2)) return { ...p, glyph: undefined };
      const torn = handIn && t < 10 ? 1 - (t - 2) / 8 : handOut && t >= ticks - 10 ? (t - (ticks - 10)) / 8 : 0;
      return { ...p, glyph: { ...p.glyph, t: t - (t % 2), glitch: q(Math.max(p.glyph.glitch || 0, torn), 0.05) } };
    }, 2);
  }
  const idleAt = (t) => loopAt.idle(t % 144);
  // made of glyphs, going about its idle, a ring going out through it now and then
  glyphAct("glyph_mode", 144, (t) => ({ ...idleAt(t), glyph: { rain: 0.35, pulse: t >= 64 && t < 88 ? q(seg(t, 64, 88), 0.05) : 0 } }));
  // just its eyes: the rest of it goes dark and only its eyes are left in the rain; they look about,
  // blink, and it forms round them
  glyphAct("glyph_eyes", 176, (t) => {
    const reveal = t < 12 ? 1 : t < 34 ? 1 - 0.95 * ease(seg(t, 12, 34)) : t < 92 ? 0.05 : t < 150 ? 0.05 + 0.95 * ease(seg(t, 92, 150)) : 1;
    return { ...idleAt(0), look: [t >= 40 && t < 56 ? -0.7 : t >= 60 && t < 76 ? 0.7 : 0, 0], shut: blink(t, 82) || blink(t, 30), mood: t >= 150 ? "happy" : "calm",
      glyph: { mode: "form", reveal: q(reveal, 0.02), rain: reveal < 0.5 ? 0.75 : 0.35, flash: t >= 92 ? 1 : 0 } };
  });
  // forming out of the rain, eyes first, for waking and after a reboot
  glyphAct("glyph_form", 96, (t) => ({ ...idleAt(t), glyph: { mode: "form", reveal: q(ease(seg(t, 0, 64)), 0.02), rain: q(0.9 - 0.6 * seg(t, 0, 64), 0.05) } }), { handIn: false });
  // dissolving into the rain, for when the bridge is gone
  glyphAct("glyph_dissolve", 96, (t) => ({ ...idleAt(t), mood: "calm", glyph: { mode: "dissolve", reveal: q(1 - ease(seg(t, 16, 80)), 0.02), rain: q(0.3 + 0.6 * seg(t, 16, 80), 0.05) } }), { handOut: false });
  // falling apart into the rain, and forming back out of it
  glyphAct("glyph_rain", 192, (t) => ({ ...idleAt(t), glyph: t < 74 ? { mode: "dissolve", reveal: q(1 - ease(seg(t, 12, 72)), 0.02), rain: q(0.3 + 0.6 * seg(t, 12, 72), 0.05) }
    : t < 100 ? { mode: "form", reveal: 0, rain: 0.9 } : { mode: "form", reveal: q(ease(seg(t, 100, 164)), 0.02), rain: q(0.9 - 0.6 * seg(t, 100, 164), 0.05) } }));
  // blown away to the right, glyph by glyph, and blown back in from the left; it shakes itself when it is whole
  glyphAct("glyph_wind", 176, (t) => ({ ...idleAt(0), headYaw: q(t < 74 ? -0.4 * ease(seg(t, 8, 16)) : 0, 0.02), squeezed: t >= 12 && t < 74, mood: t >= 132 ? "happy" : "calm",
    roll: t >= 132 && t < 154 ? q(Math.sin((t - 132) / 2.2) * 0.1 * (1 - seg(t, 132, 154)), 0.01) : 0,
    glyph: { rain: q(0.3 + 0.35 * Math.sin(Math.PI * seg(t, 16, 132)), 0.05), ...(t < 80 ? { wind: q(ease(seg(t, 16, 74)), 0.02) } : { windIn: q(ease(seg(t, 84, 132)), 0.02) }) } }));
  // a turn on the spot, all the way round, made of glyphs
  glyphAct("glyph_turn", 156, (t) => { const u = seg(t, 14, 128), body = 2 * Math.PI * back(u) - 2 * Math.PI;
    return { ...idleAt(0), yaw: q(((body % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), 0.02), headYaw: q(0.45 * Math.sin(Math.PI * u), 0.02), wheel: q(u * 6, 0.1), mood: t > 130 ? "happy" : "calm", glyph: { rain: 0.35 } }; });
  // ASCII art: a line comes down it turning the rain into ASCII, it looks about and hops, and the line goes back up
  glyphAct("glyph_ascii", 168, (t) => ({ ...idleAt(0), headYaw: q(t >= 48 && t < 78 ? -0.5 * Math.sin(Math.PI * seg(t, 48, 78)) : t >= 80 && t < 110 ? 0.5 * Math.sin(Math.PI * seg(t, 80, 110)) : 0, 0.02),
    ...(t >= 108 && t < 136 ? hop(t, 116, 10, 6) : {}), mood: t >= 110 ? "happy" : "calm", glyph: { rain: 0.3, ascii: q(ease(seg(t, 12, 40)) * (1 - ease(seg(t, 136, 158))), 0.02) } }));
  // scrambled from the bottom up, then decoded row by row from the top, a bright line where it is decoding
  glyphAct("glyph_decode", 168, (t) => ({ ...idleAt(0), shut: blink(t, 96), mood: t >= 140 ? "happy" : "calm",
    glyph: { rain: 0.3, ...(t >= 12 && t < 144 ? { decode: q(t < 34 ? 1 - ease(seg(t, 12, 34)) : t < 50 ? 0 : ease(seg(t, 50, 140)), 0.02) } : {}) } }));
  // a scan passing down it and back up, its eyes following the bright band
  glyphAct("glyph_scan", 156, (t) => { const s = t < 74 ? ease(seg(t, 16, 70)) : 1 - ease(seg(t, 80, 134));
    return { ...idleAt(0), look: [0, q((s - 0.42) * 1.4)], bow: q((s - 0.42) * 0.3, 0.01), glyph: { rain: 0.3, ...(t >= 14 && t < 138 ? { scan: q(s, 0.02) } : {}) } }; });
  // tests failing, in glyphs: it tears like a bad signal and goes amber, shakes it off, and comes back whole
  glyphAct("glyph_glitch", 176, (t) => { const bad = t < 96;
    return { ...idleAt(0), mood: t >= 24 && bad ? "worried" : t >= 100 ? "content" : "calm", amber: t >= 24 && bad, antenna: t >= 24 && bad ? (t % 12 < 6 ? 1 : 0.4) : 0.7,
      roll: t >= 82 && t < 98 ? q(Math.sin((t - 82) / 1.6) * 0.12, 0.01) : 0, squash: t >= 98 && t < 110 ? q(-0.2 * Math.sin(Math.PI * seg(t, 98, 110)), 0.02) : 0,
      glyph: { rain: 0.3, ink: t >= 24 && bad ? "amber" : "cream", glitch: q(t < 80 ? 0.85 * ease(seg(t, 20, 80)) : 0.85 * (1 - ease(seg(t, 80, 96))), 0.05) } }; });
  // joy: it hops, flies apart into glyphs at the top, and they all come flying back
  glyphAct("glyph_joy", 136, (t) => ({ ...idleAt(0), mood: "happy", ...(t < 50 ? hop(t, 26, 14, 8) : {}), antenna: 1,
    glyph: { rain: 0.3, burst: q(t < 68 ? ease(seg(t, 32, 62)) : 1 - ease(seg(t, 70, 112)), 0.02) } }));
  // dozing, made of a slow, thin rain, z's rising from its head
  glyphAct("glyph_doze", 192, (t) => ({ ...loopAt.night(t % 96), glyph: { rain: 0.18, rainSpeed: 0.45, zzz: q(ease(seg(t, 20, 44)) * (1 - ease(seg(t, 160, 180))), 0.05) } }));
  // rained in: it falls apart, and the rain comes down and builds it again from the top, glyph by glyph
  glyphAct("glyph_catch", 176, (t) => ({ ...idleAt(0), mood: t >= 144 ? "happy" : "calm", shut: blink(t, 150),
    glyph: t < 44 ? { mode: "dissolve", reveal: q(1 - ease(seg(t, 10, 40)), 0.02), rain: q(0.3 + 0.6 * seg(t, 10, 40), 0.05) }
      : { mode: "catch", reveal: q(t < 56 ? 0 : ease(seg(t, 56, 140)), 0.01), rain: q(0.9 - 0.55 * seg(t, 56, 140), 0.05) } }));
  // thinking: glyphs stream down out of the rain into its head and its eyes churn, rings go out, and then it has it
  glyphAct("glyph_think", 176, (t) => ({ ...idleAt(0), headYaw: 0.15, look: [0.25, -0.5], bow: -0.12, antenna: 1, mood: t >= 138 ? "happy" : "calm", shut: blink(t, 140),
    glyph: { rain: 0.3, think: q(ease(seg(t, 16, 36)) * (1 - ease(seg(t, 120, 136))), 0.05), pulse: t >= 60 && t < 84 ? q(seg(t, 60, 84), 0.05) : t >= 136 && t < 160 ? q(seg(t, 136, 160), 0.05) : 0 } }));

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
    // (and what moves with time moves on even ticks, so a drawing held two ticks is the same frame twice)
    const even = tick - (tick % 2);
    if (D[id].glyph && window.SageGlyphs) SageGlyphs.draw(ctx, D[id], even);
    else SageDraw.drawSage(ctx, D[id], even);
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
