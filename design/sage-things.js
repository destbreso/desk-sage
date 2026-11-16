// What comes into Sage's world for what the author is doing. Its desk is a board of the Game of Life, the website's
// own world: a test run lights a grid of cells and the failures stay amber, a deploy is a glider (the website's mark)
// that Sage sets off across the desk, a build is a pattern computed generation by generation by Life's own rule until
// it settles into still lifes. Besides the cells, the room's phone, buzzing with a message. Each thing is plain data
// in a pose ({ kind, x, z, ... }), so a drawing stays a pose; add() turns it into shapes of design/sage-3d.js. Part of
// Sage's art: see LICENSE-ART.md.
(function () {
  const { ramp, rr, frame, rotY, mixc } = Sage3D;
  // (three stops each, so a lit face is the website's green and not washed toward white)
  const GREEN = ["#123a1a", "#4fbf5c", "#c4ffbe"], LIT = ["#2a6a33", "#86e88f", "#f0fff0"], AMBER = ["#4f2406", "#e8891c", "#ffd59a"], PHONE = ramp("#15171a", "#4a4e55", 5);
  const tone3 = (T, s) => (s < 0.62 ? mixc(T[0], T[1], s / 0.62) : mixc(T[1], T[2], (s - 0.62) / 0.38));
  const cell = (g, x, y, s) => { rr(g, x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.22); g.fill(); };

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
    /** the board under them: its grid on the desk, faint, from cell (c0, r0) to (c1, r1), the cells' corner at (x, z) */
    board(S, th, cam) {
      const { size = 7, c0, r0, c1, r1 } = th, X = (c) => th.x + (c - 0.5) * size, Z = (r) => (th.z ?? 0) - (r - 0.5) * size;
      S.custom({ w: [th.x, 0, th.z ?? 0], bias: -9e5, draw(g) {
        g.strokeStyle = "#a0e299"; g.globalAlpha = th.alpha ?? 0.16; g.lineWidth = 1;
        g.beginPath();
        for (let c = c0; c <= c1 + 1; c++) { const a = cam.at([X(c), 0, Z(r0)]), b = cam.at([X(c), 0, Z(r1 + 1)]); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
        for (let r = r0; r <= r1 + 1; r++) { const a = cam.at([X(c0), 0, Z(r)]), b = cam.at([X(c1 + 1), 0, Z(r)]); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
        g.stroke(); g.globalAlpha = 1;
      } });
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
  function add(S, things, cam, t) { for (const th of things || []) DRAW[th.kind](S, { ...th, t }, cam); }

  window.SageThings = { add, life: { step, run, between } };
})();
