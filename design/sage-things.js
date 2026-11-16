// The things that appear around Sage for what the author is doing, each in Sage's 3D world (design/sage-3d.js): a bug
// that runs in when tests fail, a rocket for a deploy, crates for a build. A thing is plain data in a pose ({ kind, x,
// y, z, ... }), so a drawing stays a pose; add() turns it into shapes. Part of Sage's art: see LICENSE-ART.md.
(function () {
  const { ramp, rr, shaded } = Sage3D;
  const BUG = ramp("#3a0f14", "#d94a5a", 5), WOOD = ramp("#5a3a1e", "#d9a86a", 6), HULL = ramp("#9aa3ad", "#ffffff", 6), FIN = ramp("#7a1f2b", "#ff5a6a", 4), SMOKE = ramp("#3b3f45", "#c9ccd1", 4);

  const DRAW = {
    /** a beetle on the floor, facing `dir` (1 right, -1 left), its legs at `step`; flat and splattered when `squashed` */
    bug(S, th, k) {
      const c = [th.x, 5, th.z || 20];
      S.custom({ c, draw(g, cam) {
        // (twice a beetle's size: read on a 25 mm cube)
        const [x, y0] = cam.at(...c), d = th.dir || -1;
        g.save(); g.translate(x, y0); g.scale(2, 2); g.translate(-x, -y0); const y = y0;
        if (th.squashed) {
          g.fillStyle = BUG[1]; g.beginPath(); g.ellipse(x, y + 1.5 * k, 8 * k, 2 * k * Math.max(0.4, cam.cp), 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = BUG[2]; g.lineWidth = Math.max(1, 0.8 * k); g.lineCap = "round";
          for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.beginPath(); g.moveTo(x + Math.cos(a) * 6 * k, y + 1.5 * k + Math.sin(a) * 1.6 * k); g.lineTo(x + Math.cos(a) * 10 * k, y + 1.5 * k + Math.sin(a) * 2.6 * k); g.stroke(); }
          g.restore(); return;
        }
        // its legs, three a side, swinging with its step
        g.strokeStyle = BUG[0]; g.lineWidth = Math.max(1, 0.7 * k); g.lineCap = "round";
        for (let i = 0; i < 3; i++) { const sw = Math.sin((th.step || 0) + i * 2.1) * 1.6; g.beginPath(); g.moveTo(x + (-3 + i * 3) * k, y); g.lineTo(x + (-4 + i * 3 + sw) * k, y + 3 * k); g.stroke(); }
        Sage3D.ball(g, x, y - 0.5 * k, 4.4 * k, BUG, 0.55);
        g.strokeStyle = "#1a0608"; g.lineWidth = Math.max(1, 0.5 * k); g.beginPath(); g.moveTo(x, y - 4.6 * k); g.lineTo(x, y + 3.6 * k); g.stroke();
        Sage3D.ball(g, x + d * 4.8 * k, y + 0.4 * k, 2.2 * k, ramp("#1a0608", "#5a2026", 3), 0.3);
        g.strokeStyle = "#1a0608"; g.beginPath(); g.moveTo(x + d * 6 * k, y - 0.6 * k); g.quadraticCurveTo(x + d * 8 * k, y - 3 * k, x + d * 9.5 * k, y - 2.4 * k); g.stroke();
        g.fillStyle = "#fff"; g.beginPath(); g.arc(x + d * 5.6 * k, y, 0.6 * k, 0, Math.PI * 2); g.fill();
        g.restore();
      } });
    },
    /** a little rocket standing on the floor, `up` millimetres off it, its flame `flame` (0 to 1), smoke behind */
    rocket(S, th, k) {
      const z = th.z || 10, base = (th.up || 0) + 2, sc = th.scale ?? 1;
      S.box({ c: [th.x, base + 17 * sc, z], W: 12 * sc, H: 34 * sc, D: 12 * sc, r: 6 * sc, tones: HULL, spec: 0.6,
        front(g, f) { // its window, a ring and the sky in it
          const cx = f.x + f.w / 2, cy = f.y + f.h * 0.32;
          g.fillStyle = "#4c5057"; g.beginPath(); g.ellipse(cx, cy, 3.4 * k * sc * Math.abs(f.facing), 3.4 * k * sc, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#8fd3ff"; g.beginPath(); g.ellipse(cx, cy, 2.4 * k * sc * Math.abs(f.facing), 2.4 * k * sc, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = FIN[2]; rr(g, f.x, f.y + f.h * 0.62, f.w, 2.5 * k * sc, 1); g.fill();
        } });
      S.custom({ c: [th.x, base + 36 * sc, z + 0.1], draw(g, cam) { // its nose
        const [x, y] = cam.at(th.x, base + 34 * sc, z);
        g.fillStyle = FIN[2]; g.beginPath(); g.moveTo(x - 6 * k * sc, y); g.quadraticCurveTo(x - 4 * k * sc, y - 8 * k * sc, x, y - 11 * k * sc); g.quadraticCurveTo(x + 4 * k * sc, y - 8 * k * sc, x + 6 * k * sc, y); g.closePath(); g.fill();
        g.globalAlpha = 0.5; g.fillStyle = FIN[3]; g.beginPath(); g.moveTo(x - 3.5 * k * sc, y - 1 * k); g.quadraticCurveTo(x - 2.4 * k * sc, y - 6 * k * sc, x - 0.5 * k, y - 9.5 * k * sc); g.lineTo(x - 1.6 * k, y - 1 * k); g.closePath(); g.fill(); g.globalAlpha = 1;
      } });
      S.custom({ c: [th.x, base + 4, z + 0.2], draw(g, cam) { // its fins, and the flame under them
        const [x, y] = cam.at(th.x, base, z);
        for (const sd of [-1, 1]) { g.fillStyle = FIN[sd > 0 ? 1 : 3]; g.beginPath(); g.moveTo(x + sd * 5 * k * sc, y - 12 * k * sc); g.lineTo(x + sd * 11 * k * sc, y + 1 * k); g.lineTo(x + sd * 5 * k * sc, y - 1 * k); g.closePath(); g.fill(); }
        if (th.flame) {
          const f = th.flame, flick = 0.8 + 0.2 * Math.sin((th.t || 0) * 1.7);
          for (const [col, w, h] of [["#ff7a2a", 5, 16], ["#ffd34d", 3.4, 11], ["#fffbe0", 1.8, 6]]) { g.fillStyle = col; g.beginPath(); g.moveTo(x - w * k, y); g.quadraticCurveTo(x, y + h * f * flick * k * 1.4, x + w * k, y); g.closePath(); g.fill(); }
        }
      } });
      for (const [i, puff] of (th.smoke || []).entries()) S.custom({ c: [th.x + puff[0], puff[1], z + 2 + i * 0.01], draw(g, cam) { const [x, y] = cam.at(th.x + puff[0], puff[1], z + 2); g.save(); g.globalAlpha = puff[3]; Sage3D.ball(g, x, y, puff[2] * k, SMOKE, 0.2); g.restore(); } });
    },
    /** a wooden crate, `size` across, sitting `y` off the floor, squashed a little as it lands */
    crate(S, th, k) {
      const sz = th.size || 18, sq = th.squash || 0, h = sz * (1 - sq), w = sz * (1 + sq * 0.6);
      const plank = (g, f) => { g.strokeStyle = "#6b4523"; g.lineWidth = Math.max(1, 0.7 * k); g.beginPath(); g.rect(f.x + 1.2 * k, f.y + 1.2 * k, f.w - 2.4 * k, f.h - 2.4 * k); g.stroke(); g.beginPath(); g.moveTo(f.x + 1.6 * k, f.y + 1.6 * k); g.lineTo(f.x + f.w - 1.6 * k, f.y + f.h - 1.6 * k); g.stroke(); };
      S.box({ c: [th.x, (th.y || 0) + h / 2, th.z || 14], yaw: th.yaw || 0, W: w, H: h, D: w, r: 1.6, tones: WOOD, spec: 0.25, rimA: 0.25, front: plank, top: plank });
    },
  };

  /** the things of a pose, into the scene as shapes */
  function add(S, things, k, t) { for (const th of things || []) DRAW[th.kind](S, { ...th, t }, k); }

  window.SageThings = { add };
})();
