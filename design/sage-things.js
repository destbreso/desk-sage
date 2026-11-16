// What comes into Sage's world for what the author is doing, all made for it (its materials, its green, the website's
// own marks, the objects of the room), never a stock picture. A glitch that scuttles in when tests fail, the website's
// prompt taking off for a deploy, Sage's own modules stacking up for a build, the room's phone buzzing with a message;
// and its desk as a board of the Game of Life, one of its themes: a test run as a grid of cells with the failures
// amber, a deploy as a glider (the website's mark) set off across the desk, a build as a pattern computed by Life's own
// rule until it settles. Each thing is plain data in a pose ({ kind, x, z, ... }), so a drawing stays a pose; add()
// turns it into shapes of design/sage-3d.js. Part of Sage's art: see LICENSE-ART.md.
(function () {
  const { ramp, rr, frame, rotY, rotZ, mixc } = Sage3D;
  const ERR = ramp("#5a1f10", "#ffb347", 5), PROMPT = ramp("#24502a", "#d8f7d2", 6), SHELL = ramp("#a99f8d", "#fbf8f1", 8), GRAPH = ramp("#33363c", "#8a8f98", 6);
  // (three stops each, so a lit face is the website's green and not washed toward white)
  const GREEN = ["#123a1a", "#4fbf5c", "#c4ffbe"], LIT = ["#2a6a33", "#86e88f", "#f0fff0"], AMBER = ["#4f2406", "#e8891c", "#ffd59a"], PHONE = ramp("#15171a", "#4a4e55", 5);
  const tone3 = (T, s) => (s < 0.62 ? mixc(T[0], T[1], s / 0.62) : mixc(T[1], T[2], (s - 0.62) / 0.38));
  const cell = (g, x, y, s) => { rr(g, x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.22); g.fill(); };
  /** draw on the floor's plane at a world point, in its millimetres (x across, y toward the camera) */
  function onFloor(g, cam, at, draw) { const o = cam.at(at), x = cam.at([at[0] + 1, at[1], at[2]]), y = cam.at([at[0], at[1], at[2] + 1]); g.save(); g.transform(x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], o[0], o[1]); draw(); g.restore(); }

  // ── the Game of Life (B3/S23) on a set of "c,r" keys ──
  function step(set) {
    const n = new Map();
    for (const k of set) { const [c, r] = k.split(",").map(Number); for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (dc || dr) { const kk = `${c + dc},${r + dr}`; n.set(kk, (n.get(kk) || 0) + 1); } }
    const out = new Set(); for (const [k, v] of n) if (v === 3 || (v === 2 && set.has(k))) out.add(k); return out;
  }
  /** the generations of a pattern, from its cells [[c, r], ...], as many as asked (the last one repeated past a still life) */
  function run(cells, gens) { const out = [new Set(cells.map(([c, r]) => `${c},${r}`))]; for (let i = 0; i < gens; i++) out.push(step(out[i])); return out; }
  /**
   * The cells at a moment between generations (`g` 2.4 is four tenths of the way from the second to the third): a cell
   * alive in both stays, one that dies sinks, one that is born rises, each [c, r, s] with s its size from 0 to 1.
   */
  function between(gens, g) {
    const i = Math.max(0, Math.min(gens.length - 1, Math.floor(g))), u = Math.min(1, Math.max(0, g - i)), a = gens[i], b = gens[Math.min(gens.length - 1, i + 1)];
    const rise = (v) => (v < 0.5 ? 0 : Math.min(1, (v - 0.5) * 2 * 1.15)), sink = (v) => Math.max(0, 1 - v * 2);
    const out = [];
    for (const k of a) { const [c, r] = k.split(",").map(Number); out.push([c, r, b.has(k) ? 1 : sink(u)]); }
    for (const k of b) if (!a.has(k)) { const [c, r] = k.split(",").map(Number); out.push([c, r, rise(u)]); }
    return out.filter(([, , s]) => s > 0.04);
  }

  /** a cell standing on the desk: a little block with its faces lit as Sage is, its top the brightest */
  function voxel(S, cam, at, w, h, tones, alpha = 1) {
    S.custom({ w: [at[0], at[1] + h / 2, at[2]], draw(g) {
      const hw = w / 2, P = (x, y, z) => cam.at([at[0] + x, at[1] + y, at[2] + z]);
      const faces = [
        [[0, 1, 0], [P(-hw, h, -hw), P(hw, h, -hw), P(hw, h, hw), P(-hw, h, hw)]],
        [[0, 0, 1], [P(-hw, 0, hw), P(hw, 0, hw), P(hw, h, hw), P(-hw, h, hw)]], [[0, 0, -1], [P(-hw, 0, -hw), P(hw, 0, -hw), P(hw, h, -hw), P(-hw, h, -hw)]],
        [[1, 0, 0], [P(hw, 0, -hw), P(hw, 0, hw), P(hw, h, hw), P(hw, h, -hw)]], [[-1, 0, 0], [P(-hw, 0, -hw), P(-hw, 0, hw), P(-hw, h, hw), P(-hw, h, -hw)]],
      ];
      if (alpha < 1) g.globalAlpha = alpha;
      for (const [n, q] of faces) {
        const nc = cam.dir(n); if (nc[2] <= 0.01) continue;
        const key = n[0] * cam.light[0] + n[1] * cam.light[1] + n[2] * cam.light[2], s = Math.max(0, Math.min(1, 0.22 + 0.62 * Math.max(0, key) + 0.18 * nc[2] + (n[1] > 0 ? 0.12 : 0)));
        g.fillStyle = tone3(tones, s); g.beginPath(); q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
    } });
  }

  const DRAW = {
    /** a glitch: a cluster of amber voxels that will not hold still, scuttling with `step`; scattered when `squashed` */
    glitch(S, th, cam) {
      const z = th.z ?? 20, t = th.t || 0;
      if (th.squashed) {
        // its voxels spread flat on the desk, going out as cells of the rain
        S.custom({ w: [th.x, 0.5, z], bias: -500, draw(g) { onFloor(g, cam, [th.x, 0.5, z], () => { g.fillStyle = ERR[3]; for (let i = 0; i < 9; i++) { const a = i * 0.7 + 0.4, r = 4 + (i % 3) * 3.4; g.globalAlpha = Math.max(0, 0.9 - (th.fade || 0)); cell(g, Math.cos(a) * r - 2, Math.sin(a) * r - 2, 4); } }); } });
        return;
      }
      const bob = Math.abs(Math.sin((th.step || 0) * 1.3)) * 2;
      const vox = [[0, 0, 0], [5, 0, 0], [0, 5, 0], [-5, 2, 2], [3, 6, -3], [6, 4, 3], [-2, 9, 0]];
      vox.forEach(([vx, vy, vz], i) => {
        // (each voxel a little off where it should be, and never the same way twice: it is a glitch)
        const j = (Math.sin(t * 2.7 + i * 1.9) > 0.6 ? 1.6 : 0) * (i % 2 ? 1 : -1);
        S.box({ f: frame([th.x + vx + j, 2.5 + vy + bob, z + vz], rotY(i * 0.4)), W: 4.6, H: 4.6, D: 4.6, r: 0.8, tones: ERR, spec: 0.3, rimA: 0.2 });
      });
    },
    /** the website's prompt, >_, in 3D and glowing: `up` off the desk, a column of light under it as it takes off */
    prompt(S, th, cam) {
      const z = th.z ?? 10, sc = th.scale ?? 1, base = 14 * sc + (th.up || 0), f = frame([th.x, base, z]);
      for (const sd of [1, -1]) S.box({ f: f.then([-3 * sc, sd * 5 * sc, 0], rotZ(-sd * 0.72)), W: 16 * sc, H: 4.4 * sc, D: 4.4 * sc, r: 1.8 * sc, tones: PROMPT, spec: 0.5, rimA: 0.15 });
      if (Math.floor((th.t || 0) / 12) % 2 === 0 || th.up) S.box({ f: f.then([10 * sc, -10 * sc, 0]), W: 11 * sc, H: 4.4 * sc, D: 4.4 * sc, r: 1.8 * sc, tones: PROMPT, spec: 0.5, rimA: 0.15 });
      if (th.thrust) {
        // a column of its green light down to the desk, and cells of the rain falling away below it
        S.custom({ w: [th.x, base / 2, z - 2], bias: -50, draw(g) {
          const a = cam.at([th.x - 5 * sc, base - 12 * sc, z]), b = cam.at([th.x + 5 * sc, base - 12 * sc, z]), c = cam.at([th.x + 7, 0, z]), d = cam.at([th.x - 7, 0, z]);
          // (fading as the prompt climbs away, so it never stands as a bar)
          g.globalAlpha = 0.16 * th.thrust * Math.max(0, 1 - (th.up || 0) / 120); g.fillStyle = "#a0e299"; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill(); g.globalAlpha = 1;
          for (let i = 0; i < 8; i++) { const v = (((th.t || 0) / 24) + i / 8) % 1, p = cam.at([th.x + Math.sin(i * 2.1) * 6, base - 14 * sc - v * 30, z]); g.globalAlpha = (1 - v) * th.thrust; g.fillStyle = "#c4ffbe"; cell(g, p[0] - p[3] * 1.2, p[1] - p[3] * 1.2, p[3] * 2.4); }
          g.globalAlpha = 1;
        } });
      }
    },
    /** one of Sage's own modules: its cream, a graphite band round it, a green light; squashed a little as it lands */
    module(S, th) {
      const sz = th.size || 22, sq = th.squash || 0, h = sz * (1 - sq), w = sz * (1 + sq * 0.6);
      const band = (g, fw, fh) => { g.fillStyle = GRAPH[2]; g.fillRect(0, fh * 0.42, fw, fh * 0.16); g.fillStyle = GRAPH[4]; g.fillRect(0, fh * 0.42, fw, fh * 0.03); };
      S.box({ f: frame([th.x, (th.y || 0) + h / 2, th.z ?? 14], rotY(th.yaw || 0)), W: w, H: h, D: w, r: 4, tones: SHELL, spec: 0.5,
        faces: { front(g, fw, fh) { band(g, fw, fh); g.fillStyle = "#a0e299"; g.beginPath(); g.arc(fw * 0.78, fh * 0.5, 1.2, 0, Math.PI * 2); g.fill(); }, right: band, left: band, back: band } });
    },
    /**
     * Cells of the Life board on the desk, the grid's corner at (x, z), `size` millimetres a cell, columns along x and
     * rows away from the camera: each [c, r, s] or [c, r, s, "amber"], s its size from 0 (gone) to 1, `lift` raising
     * any cell by millimetres ([c, r, s, tone, lift]).
     */
    cells(S, th, cam) {
      const size = th.size || 7, w = size * 0.8, h = size * 0.4;
      for (const [c, r, s = 1, tone, lift = 0] of th.cells) {
        if (s <= 0.04) continue;
        voxel(S, cam, [th.x + c * size, lift, (th.z ?? 0) - r * size], w * Math.min(1, s), h * s, tone === "amber" ? AMBER : tone === "lit" ? LIT : GREEN, th.alpha ?? 1);
      }
    },
    /** the board under them, from cell (c0, r0) to (c1, r1), the cells' corner at (x, z): a hologram's grid on the
     *  desk (design/sage-holo.js), and when `projected` Sage throws it there from its lens */
    board(S, th, cam) {
      S.custom({ w: [th.x, 0, th.z ?? 0], bias: -9e5, draw(g) { SageHolo.board(g, cam, th, th.projected ? th.eye : null, th.t || 0); } });
    },
    /** the room's phone, lying on the desk, its screen lit with a message, buzzing with `buzz` */
    phone(S, th) {
      const jit = th.buzz ? Math.sin((th.t || 0) * 3.1) * 0.8 * th.buzz : 0;
      S.box({ f: frame([th.x + jit, 2.2, th.z ?? 22], rotY(th.yaw ?? 0.35)), W: 30, H: 4.4, D: 62, r: 2.2, tones: PHONE, spec: 0.35, rimA: 0.25,
        faces: { top(g, fw, fh) {
          g.fillStyle = "#050607"; rr(g, 1.6, 1.6, fw - 3.2, fh - 3.2, 3); g.fill();
          // its screen: Sage's green in a ring round a cell, the way its app shows a message
          g.strokeStyle = "#a0e299"; g.lineWidth = 1.2; g.globalAlpha = 0.5 + 0.5 * (th.buzz || 0); g.beginPath(); g.arc(fw / 2, fh * 0.4, 6, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
          g.fillStyle = "#a0e299"; cell(g, fw / 2 - 2.5, fh * 0.4 - 2.5, 5);
          g.fillStyle = "#3e7a45"; for (let i = 0; i < 3; i++) rr(g, 6, fh * 0.62 + i * 4, fw - 12 - i * 5, 1.6, 0.8), g.fill();
        } } });
    },
  };

  /** the things of a pose, into the scene as shapes */
  function add(S, things, cam, t, eye) { for (const th of things || []) DRAW[th.kind](S, { ...th, t, eye }, cam); }

  window.SageThings = { add, life: { step, run, between } };
})();
