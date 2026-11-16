// The things that appear around Sage for what the author is doing, each in Sage's 3D world (design/sage-3d.js): a bug
// that runs in when tests fail, a rocket for a deploy, crates for a build. A thing is plain data in a pose ({ kind, x,
// y, z, ... }), so a drawing stays a pose; add() turns it into shapes. Part of Sage's art: see LICENSE-ART.md.
(function () {
  const { ramp, rr, frame, rotY } = Sage3D;
  const BUG = ramp("#3a0f14", "#d94a5a", 5), WOOD = ramp("#5a3a1e", "#d9a86a", 6), HULL = ramp("#9aa3ad", "#ffffff", 6), FIN = ramp("#7a1f2b", "#ff5a6a", 4), SMOKE = ramp("#3b3f45", "#c9ccd1", 4);

  const DRAW = {
    /** a beetle on the floor, facing `dir` (1 right, -1 left), its legs at `step`; flat and splattered when `squashed` */
    bug(S, th, cam) {
      const w = [th.x, 5, th.z ?? 20];
      S.custom({ w, draw(g) {
        // (twice a beetle's size: read on a 25 mm cube)
        const [x, y, , k0] = cam.at(w), k = k0 * 2, d = th.dir || -1;
        if (th.squashed) {
          g.fillStyle = BUG[1]; g.beginPath(); g.ellipse(x, y + 1.5 * k, 8 * k, 2 * k * Math.max(0.4, cam.cp), 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = BUG[2]; g.lineWidth = Math.max(1, 0.8 * k); g.lineCap = "round";
          for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.beginPath(); g.moveTo(x + Math.cos(a) * 6 * k, y + 1.5 * k + Math.sin(a) * 1.6 * k); g.lineTo(x + Math.cos(a) * 10 * k, y + 1.5 * k + Math.sin(a) * 2.6 * k); g.stroke(); }
          return;
        }
        g.strokeStyle = BUG[0]; g.lineWidth = Math.max(1, 0.7 * k); g.lineCap = "round";
        for (let i = 0; i < 3; i++) { const sw = Math.sin((th.step || 0) + i * 2.1) * 1.6; g.beginPath(); g.moveTo(x + (-3 + i * 3) * k, y); g.lineTo(x + (-4 + i * 3 + sw) * k, y + 3 * k); g.stroke(); }
        Sage3D.ball(g, x, y - 0.5 * k, 4.4 * k, BUG, 0.55);
        g.strokeStyle = "#1a0608"; g.lineWidth = Math.max(1, 0.5 * k); g.beginPath(); g.moveTo(x, y - 4.6 * k); g.lineTo(x, y + 3.6 * k); g.stroke();
        Sage3D.ball(g, x + d * 4.8 * k, y + 0.4 * k, 2.2 * k, ramp("#1a0608", "#5a2026", 3), 0.3);
        g.beginPath(); g.moveTo(x + d * 6 * k, y - 0.6 * k); g.quadraticCurveTo(x + d * 8 * k, y - 3 * k, x + d * 9.5 * k, y - 2.4 * k); g.stroke();
        g.fillStyle = "#ffffff"; g.beginPath(); g.arc(x + d * 5.6 * k, y, 0.6 * k, 0, Math.PI * 2); g.fill();
      } });
    },
    /** a little rocket standing on the floor, `up` millimetres off it, its flame `flame` (0 to 1), smoke behind */
    rocket(S, th, cam) {
      const z = th.z ?? 10, sc = th.scale ?? 1, base = (th.up || 0) + 2, f = frame([th.x, base, z]);
      S.box({ f, c: [0, 17 * sc, 0], W: 12 * sc, H: 34 * sc, D: 12 * sc, r: 6 * sc, tones: HULL, spec: 0.6,
        faces: { front(g, w, h) {
          g.fillStyle = "#4c5057"; g.beginPath(); g.arc(w / 2, h * 0.32, 3.4 * sc, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#8fd3ff"; g.beginPath(); g.arc(w / 2, h * 0.32, 2.4 * sc, 0, Math.PI * 2); g.fill();
          g.fillStyle = FIN[2]; g.fillRect(0, h * 0.62, w, 2.5 * sc);
        } } });
      S.custom({ w: f.at([0, 36 * sc, 0.1]), draw(g) { // its nose
        const [x, y, , k] = cam.at(f.at([0, 34 * sc, 0]));
        g.fillStyle = FIN[2]; g.beginPath(); g.moveTo(x - 6 * k * sc, y); g.quadraticCurveTo(x - 4 * k * sc, y - 8 * k * sc, x, y - 11 * k * sc); g.quadraticCurveTo(x + 4 * k * sc, y - 8 * k * sc, x + 6 * k * sc, y); g.closePath(); g.fill();
      } });
      S.custom({ w: f.at([0, 4, 0.2]), draw(g) { // its fins, and its flame under them
        const [x, y, , k] = cam.at(f.at([0, 0, 0]));
        for (const sd of [-1, 1]) { g.fillStyle = FIN[sd > 0 ? 1 : 3]; g.beginPath(); g.moveTo(x + sd * 5 * k * sc, y - 12 * k * sc); g.lineTo(x + sd * 11 * k * sc, y + 1 * k); g.lineTo(x + sd * 5 * k * sc, y - 1 * k); g.closePath(); g.fill(); }
        if (th.flame) {
          const fl = th.flame, flick = 0.8 + 0.2 * Math.sin((th.t || 0) * 1.7);
          for (const [col, w, h] of [["#ff7a2a", 5, 16], ["#ffd34d", 3.4, 11], ["#fffbe0", 1.8, 6]]) { g.fillStyle = col; g.beginPath(); g.moveTo(x - w * k, y); g.quadraticCurveTo(x, y + h * fl * flick * k * 1.4, x + w * k, y); g.closePath(); g.fill(); }
        }
      } });
      for (const [i, puff] of (th.smoke || []).entries()) { const w = [th.x + puff[0], puff[1], z + 2 + i * 0.01]; S.custom({ w, draw(g) { const [x, y, , k] = cam.at(w); g.save(); g.globalAlpha = puff[3]; Sage3D.ball(g, x, y, puff[2] * k, SMOKE, 0.2); g.restore(); } }); }
    },
    /** a wooden crate, `size` across, sitting `y` off the floor, squashed a little as it lands */
    crate(S, th) {
      const sz = th.size || 18, sq = th.squash || 0, h = sz * (1 - sq), w = sz * (1 + sq * 0.6);
      const plank = (g, fw, fh) => { g.strokeStyle = "#6b4523"; g.lineWidth = 0.7; g.beginPath(); g.rect(1.2, 1.2, fw - 2.4, fh - 2.4); g.stroke(); g.beginPath(); g.moveTo(1.6, 1.6); g.lineTo(fw - 1.6, fh - 1.6); g.stroke(); };
      S.box({ f: frame([th.x, (th.y || 0) + h / 2, th.z ?? 14], rotY(th.yaw || 0)), W: w, H: h, D: w, r: 1.6, tones: WOOD, spec: 0.25, rimA: 0.25, faces: { front: plank, top: plank, right: plank, left: plank } });
    },
  };

  /** the things of a pose, into the scene as shapes */
  function add(S, things, cam, t) { for (const th of things || []) DRAW[th.kind](S, { ...th, t }, cam); }

  window.SageThings = { add };
})();
