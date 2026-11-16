// What Sage does on the desk: a loop for each of the board's moods, drawn transitions between them, and short acts
// (fidgets and surprises). Each is an exposure sheet of [drawing, ticks held] at 24 ticks a second; a drawing is a
// pose of design/sage-draw.js. The board's mood names are its own interface; what Sage does in each is its own
// character (the site's rules for it: alive, never looping, its patience, its sleep). Part of Sage's art: see
// LICENSE-ART.md.
(function () {
  const { between } = SageDraw;
  const FPS = 24;
  const D = {}, LOOPS = {}, TRANS = {}, CLIPS = {};
  const MOMENTS = ["idle", "working", "alert", "waiting", "done", "longhaul", "night", "meeting", "awake", "letter"];
  // (one hub: every mood is reached from idle and goes back through it, so every route the board asks for is drawn)
  const BASE = Object.fromEntries(MOMENTS.map((m) => [m, "idle"]));

  // A sheet from a pose at each tick, drawn on twos (12 drawings a second); identical poses are one drawing.
  let made = 0;
  const ids = new Map();
  function drawing(pose) {
    const key = JSON.stringify(pose);
    if (!ids.has(key)) { const id = "s" + made++; ids.set(key, id); D[id] = pose; }
    return ids.get(key);
  }
  function sheet(ticks, poseAt, step = 2) {
    const out = [];
    for (let t = 0; t < ticks; t += step) {
      const id = drawing(poseAt(t));
      if (out.length && out[out.length - 1][0] === id) out[out.length - 1][1] += step;
      else out.push([id, step]);
    }
    return out;
  }
  const wave = (t, period, lo = 0, hi = 1) => lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period));
  const round = (v, q = 0.25) => Math.round(v / q) * q;
  // a blink: shut over a few ticks around `at`
  const blink = (t, at) => { const d = t - at; return d >= 0 && d < 6 ? [0.5, 0.9, 0.9, 0.5, 0.2, 0][d] : 0; };

  // ── the loops ──
  const loopAt = {
    idle: (t) => ({ lift: round(wave(t, 48, 0, 0.6)), antenna: round(wave(t, 72, 0.55, 0.9), 0.05), shut: blink(t, 34) || blink(t, 118),
      look: t < 52 ? [0, 0] : t < 76 ? [-0.6, 0] : t < 88 ? [0, 0] : t < 112 ? [0.6, 0] : [0, 0] }),
    working: (t) => ({ crouch: 3, nod: 4, look: [0, 0.75], book: 1, light: 1, antenna: 0.8, page: t >= 96 && t < 120 ? round((t - 96) / 24, 0.125) : 0, shut: blink(t, 60) }),
    alert: (t) => ({ z: 1, mood: "worried", alert: round(wave(t, 24, 0.55, 1), 0.15), antenna: t % 12 < 6 ? 1 : 0.2, lift: round(wave(t, 24, 0, 0.5)) }),
    waiting: (t) => ({ mood: "annoyed", foot: t % 16 < 8 ? 3 : 0, sweat: round((t % 48) / 48, 0.125), antenna: 0.5 }),
    done: (t) => ({ mood: "content", nod: round(wave(t, 72, 0, 3)), spark: t < 24 ? round(t / 24, 0.125) : 0, antenna: 0.9 }),
    longhaul: (t) => ({ crouch: 3, nod: round(wave(t, 96, 4, 7)), look: [0, 0.75], book: 1, light: 0.6, mood: "sleepy", antenna: 0.5 }),
    night: (t) => ({ crouch: 6, nod: 5, mood: "sleepy", shut: 0.85, zz: round((t % 96) / 96, 1 / 24), antenna: 0.2 }),
    meeting: (t) => ({ z: 1, mood: "content", shut: 0.6, dnd: 1, antenna: round(wave(t, 96, 0.2, 0.4), 0.05) }),
    awake: (t) => ({ mood: "happy", lift: round(Math.max(0, Math.sin((Math.PI * (t % 24)) / 24)) * 6, 0.5), antenna: 1 }),
    letter: (t) => ({ roll: 0.12, look: [0.7, -0.3], letter: [44, 70 + round(wave(t, 48, 0, 3)), round(wave(t, 72, -0.15, 0.15), 0.05)], antenna: 0.85 }),
  };
  const LENGTH = { idle: 144, working: 144, alert: 48, waiting: 48, done: 72, longhaul: 192, night: 96, meeting: 96, awake: 48, letter: 144 };
  for (const m of MOMENTS) LOOPS[m] = sheet(LENGTH[m], loopAt[m]);

  // ── transitions: from one mood's first pose to the next one's, eased, on ones ──
  const ease = (u) => u * u * (3 - 2 * u);
  function transition(a, b, ticks = 12) {
    const from = loopAt[a](0), to = loopAt[b](0);
    return sheet(ticks, (t) => {
      const p = between(from, to, ease(t / (ticks - 1)));
      for (const k of Object.keys(p)) if (typeof p[k] === "number") p[k] = round(p[k], 0.05);
      return p;
    }, 1);
  }
  for (const m of MOMENTS) if (m !== "idle") ((TRANS[`idle>${m}`] = transition("idle", m)), (TRANS[`${m}>idle`] = transition(m, "idle")));

  // ── short acts, each from idle and back to it ──
  const act = (name, ticks, poseAt, step = 2) => (CLIPS[name] = { home: "idle", seq: sheet(ticks, poseAt, step) });
  act("fidget_glance", 72, (t) => ({ look: t < 18 ? [-0.7, -0.2] : t < 36 ? [0.7, -0.3] : t < 54 ? [0, -0.6] : [0, 0], roll: t < 18 ? -0.06 : t < 36 ? 0.06 : 0 }));
  act("fidget_antenna", 36, (t) => ({ antenna: t % 8 < 4 ? 1 : 0.15, roll: round(Math.sin(t / 3) * 0.05, 0.01) }));
  act("fidget_stretch", 72, (t) => ({ lift: round(wave(t, 72, 0, 3), 0.5), roll: round(Math.sin((t / 72) * Math.PI * 2) * 0.08, 0.01), mood: t > 18 && t < 54 ? "sleepy" : "calm", shut: t > 24 && t < 48 ? 0.6 : 0 }));
  act("fidget_mark", 72, (t) => ({ eyes: t > 6 && t < 66 ? "mark" : null, antenna: 1 }));
  act("hello", 48, (t) => ({ mood: "happy", lift: round(Math.max(0, Math.sin((Math.PI * (t % 24)) / 24)) * 6, 0.5), spark: round((t % 24) / 24, 0.125), antenna: 1 }));
  act("tap_hello", 36, (t) => ({ mood: "happy", lift: round(Math.max(0, Math.sin((Math.PI * t) / 18)) * 4, 0.5), roll: t < 18 ? 0.06 : -0.04, antenna: 1 }));
  act("tap_dizzy", 72, (t) => ({ eyes: "dizzy", roll: round(Math.sin(t / 4) * 0.12, 0.01), antenna: t % 6 < 3 ? 1 : 0.3 }));
  act("done_hearts", 72, (t) => ({ eyes: "hearts", hearts: round((t % 48) / 48, 1 / 24), antenna: 1 }));
  // ── camera acts: the camera moves, Sage stays itself ──
  // the camera goes all the way round it while it keeps its eyes on you
  act("cam_orbit", 144, (t) => ({ orbit: round((2 * Math.PI * t) / 144, 0.02), headYaw: round(-Math.sin((2 * Math.PI * t) / 144) * 0.6, 0.02), tilt: 0.25, antenna: 0.85 }), 1);
  // a crane shot: from low on the desk, looking up at it, to high above, looking down; it looks up to follow
  act("cam_crane", 120, (t) => { const u = Math.min(1, t / 108), e = u * u * (3 - 2 * u); return { tilt: round(-0.5 + 1.3 * e, 0.02), look: [0, round(0.4 - 0.9 * e, 0.05)], zoom: round(1.05 - 0.15 * e, 0.01), mood: t > 108 ? "happy" : "calm" }; }, 1);
  // from straight above as it turns on the spot, the floor's glow under it
  act("cam_top", 96, (t) => ({ tilt: 1.3, zoom: 0.9, yaw: round((2 * Math.PI * t) / 96, 0.02), wheel: round(t * 0.2, 0.1) }), 1);
  // close and from below as it wakes: eyes open, a look down at you, pleased
  act("cam_wake", 96, (t) => ({ z: 1, tilt: -0.45, shut: t < 24 ? 0.9 : t < 36 ? round(0.9 - (t - 24) / 12 * 0.9, 0.1) : 0, look: [0, t < 48 ? 0 : 0.4], mood: t > 60 ? "happy" : "calm", antenna: t < 24 ? 0.2 : 1 }), 1);
  // a turn on the spot, all the way round and back to you, pleased with itself
  act("fidget_turn", 96, (t) => ({ yaw: round(((2 * Math.PI) * (t < 84 ? t / 84 : 1)) % (2 * Math.PI), 0.02), mood: t > 84 ? "happy" : "calm", wheel: round(t * 0.2, 0.1), antenna: t > 84 ? 1 : 0.7 }), 1);
  // a look over one shoulder, then the other, its body still
  act("fidget_look", 96, (t) => ({ headYaw: t < 30 ? round(-0.9 * Math.min(1, t / 10), 0.05) : t < 60 ? round(-0.9 + 1.8 * Math.min(1, (t - 30) / 12), 0.05) : round(0.9 * Math.max(0, 1 - (t - 60) / 12), 0.05), look: [0, -0.2] }), 2);

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
    SageDraw.drawSage(ctx, D[id], tick);
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
