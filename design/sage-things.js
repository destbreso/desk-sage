// The things that come into Sage's world for what the author is doing, all made for Sage (its materials, its green,
// the website's own marks, the objects of the room), never generic: a glitch that scuttles in when tests fail, the
// website's prompt taking off for a deploy, Sage's own modules stacking up for a build, and the room's phone buzzing
// with a message. Each is plain data in a pose ({ kind, x, y, z, ... }), so a drawing stays a pose; add() turns it into
// shapes of design/sage-3d.js. Part of Sage's art: see LICENSE-ART.md.
(function () {
  const { ramp, rr, frame, rotY, rotZ, mul } = Sage3D;
  const ERR = ramp("#5a1f10", "#ffb347", 5), GREEN = ramp("#24502a", "#d8f7d2", 6), SHELL = ramp("#a99f8d", "#fbf8f1", 8), GRAPH = ramp("#33363c", "#8a8f98", 6), PHONE = ramp("#15171a", "#4a4e55", 5);
  const cell = (g, x, y, s) => { rr(g, x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.22); g.fill(); };
  /** draw on the floor's plane at a world point, in its millimetres (x across, y toward the camera) */
  function onFloor(g, cam, at, draw) { const o = cam.at(at), x = cam.at([at[0] + 1, at[1], at[2]]), y = cam.at([at[0], at[1], at[2] + 1]); g.save(); g.transform(x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], o[0], o[1]); draw(); g.restore(); }

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
      for (const sd of [1, -1]) S.box({ f: f.then([-3 * sc, sd * 5 * sc, 0], rotZ(-sd * 0.72)), W: 16 * sc, H: 4.4 * sc, D: 4.4 * sc, r: 1.8 * sc, tones: GREEN, spec: 0.5, rimA: 0.15 });
      if (Math.floor((th.t || 0) / 12) % 2 === 0 || th.up) S.box({ f: f.then([10 * sc, -10 * sc, 0]), W: 11 * sc, H: 4.4 * sc, D: 4.4 * sc, r: 1.8 * sc, tones: GREEN, spec: 0.5, rimA: 0.15 });
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

  window.SageThings = { add };
})();
