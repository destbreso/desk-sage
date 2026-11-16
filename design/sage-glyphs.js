// Sage made of the rain of destbreso.com: the illustrated Sage read cell by cell into the rain's own glyphs (katakana,
// digits and signs), cream where its shell catches the light, green where its eyes are, with the rain falling behind.
// It forms out of the rain from its eyes outward, falls apart into it, is blown away
// and back, bursts and gathers again, tears like a bad signal, is rained in from the top, scrambles and decodes, or is
// read as ASCII art. Only text and a background fill, so the board draws every frame as a glyph frame
// (firmware/src/glyphs.h). Part of Sage's art: see LICENSE-ART.md.
(function () {
  const RAIN = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF{}[]|:;=+-*#$%?!";
  const RAMP = ".:-=+*#%@";
  const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const KANA = (px) => `bold ${px}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", monospace`, MONO = (px) => `bold ${px}px Menlo, monospace`;
  const rgba = (r, g, b, a) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  let off = null;

  /** Sage's cells at a cell size: [c, r, R, G, B, L, green] for each cell it covers */
  function cellsOf(d, CELL) {
    const N = 240 / CELL, out = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      let R = 0, Gr = 0, B = 0;
      for (let y = r * CELL; y < r * CELL + CELL; y++) for (let x = c * CELL; x < c * CELL + CELL; x++) { const i = (y * 240 + x) * 4; R += d[i]; Gr += d[i + 1]; B += d[i + 2]; }
      const n = CELL * CELL; R /= n; Gr /= n; B /= n;
      const L = 0.2126 * R + 0.7152 * Gr + 0.0722 * B;
      // (its eyes are its bright green: the glow on the desk is green too, but faint)
      if (L >= 12) out.push([c, r, R, Gr, B, L, Gr > R * 1.25 && Gr > B * 1.1 && L > 70]);
    }
    return out;
  }

  /**
   * Sage in a pose, made of glyphs. `pose.glyph` holds what it is doing, every value from 0 to 1 unless said:
   * mode "form" | "dissolve" | "catch" | "full" with `reveal`; `rain` (how many columns fall behind); `ascii` (how far
   * down the screen it is ASCII art); `ink` "cream" | "green" | "amber"; and the
   * effects `wind` (blown away to the right), `windIn` (blown back in from the left), `burst` (flying apart), `glitch`
   * (torn in slices), `scan` (a band passing down), `decode` (rows settled from the top, the rest scrambling), `pulse`
   * (a ring going out), `think` (glyphs streaming into its head), `zzz` (asleep); `flash` 0 keeps a forming edge unlit.
   * `t` is its own time in ticks.
   */
  function draw(ctx, pose, tick) {
    const G = { mode: "full", reveal: 1, rain: 0.3, ink: "cream", ...pose.glyph };
    const t = G.t ?? tick, plain = { ...pose, glyph: undefined };
    off = off || Object.assign(document.createElement("canvas"), { width: 240, height: 240 });
    const o = off.getContext("2d", { willReadFrequently: true });
    o.fillStyle = "#000000"; o.fillRect(0, 0, 240, 240);
    SageDraw.drawSage(o, plain, tick);
    const d = o.getImageData(0, 0, 240, 240).data;

    ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 240, 240);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const text = (font, ch, x, y, color) => { if (ctx.font !== font) ctx.font = font; ctx.fillStyle = color; ctx.fillText(ch, Math.round(x), Math.round(y)); };

    // the rain behind: columns falling at their own speed, a bright head and a fading trail
    const K8 = KANA(9);
    if (G.rain > 0) for (let col = 0; col < 30; col++) {
      if (hash(col, 7) > G.rain) continue;
      const speed = (0.35 + hash(col, 3) * 0.5) * (G.rainSpeed ?? 1), len = 6 + Math.floor(hash(col, 5) * 10), head = ((t * speed + hash(col, 11) * 60) % (30 + len)) | 0;
      for (let i = 0; i < len; i++) {
        const row = head - i; if (row < 0 || row >= 30) continue;
        text(K8, RAIN[Math.floor(hash(col, row, Math.floor(t / 5)) * RAIN.length)], col * 8 + 4, row * 8 + 4, i === 0 ? rgba(200, 255, 195, 0.55) : rgba(160, 226, 153, 0.3 * (1 - i / len)));
      }
    }

    // Sage's cells: as ASCII art above the line `ascii` has come down to, in the rain's glyphs below it
    const cut = 240 * clamp01(G.ascii ?? 0), passes = [];
    if (cut > 0) passes.push(["ascii", 6, 0, cut]);
    if (cut < 240) passes.push(["rain", 8, cut, 240]);
    for (const [style, CELL, yFrom, yTo] of passes) {
      const N = 240 / CELL, font = style === "ascii" ? MONO(CELL + 2) : KANA(CELL + 1);
      const slice = (r) => Math.floor((r * CELL) / 24);
      for (const [c, r, R, Gr, B, L, green] of cellsOf(d, CELL)) {
        const cy0 = r * CELL + CELL / 2; if (cy0 < yFrom || cy0 >= yTo) continue;
        const dist = Math.hypot(c - N / 2, r - N / 2) / (N * 0.7);
        const order = green ? 0.05 * hash(c, r, 1) : 0.12 + dist * 0.8 + 0.08 * hash(c, r, 2);
        let x = c * CELL + CELL / 2, y = cy0, alpha = 1, flash = 0, churn = false, amber = G.ink === "amber";
        if (G.mode === "form") { const left = G.reveal * 1.1 - order; if (left < 0) continue; flash = Math.max(0, 1 - left * 8) * (G.flash ?? 1); }
        else if (G.mode === "dissolve") {
          // a cell lets go in the reverse order and falls as rain
          const gone = (1 - G.reveal) * 1.1 - (1 - order);
          if (gone > 0) { y += gone * 240 * (0.6 + hash(c, r, 3)); alpha = Math.max(0, 1 - gone * 2.2); if (alpha <= 0 || y > 240) continue; }
        } else if (G.mode === "catch") {
          // rained in: each column's rain comes down and stays where it meets Sage
          const head = G.reveal * (N + 12) - 6 * hash(c, 21);
          if (r > head) continue;
          flash = Math.max(0, 1 - (head - r) / 2.5);
        }
        if (G.wind) {
          const v = clamp01(G.wind * 1.7 - (c / N) * 0.55 - 0.3 * hash(c, r, 5));
          x += v * v * 300 * (0.7 + 0.6 * hash(c, r, 6)); y += -v * 50 * hash(c, r, 7) + Math.sin(v * 7 + hash(c, r, 8) * 6) * 5 * v; alpha *= 1 - v * v;
          if (v > 0) churn = true;
        }
        if (G.windIn !== undefined && G.windIn < 1) {
          const v = 1 - clamp01(G.windIn * 1.7 - (1 - c / N) * 0.55 - 0.3 * hash(c, r, 5));
          x -= v * v * 300 * (0.7 + 0.6 * hash(c, r, 6)); y += -v * 50 * hash(c, r, 7) + Math.sin(v * 7 + hash(c, r, 8) * 6) * 5 * v; alpha *= 1 - v * v;
          if (v > 0) churn = true;
        }
        if (G.burst) {
          const dx = x - 120, dy = y - 118, a = Math.atan2(dy, dx) + (hash(c, r, 9) - 0.5) * 0.9, k = G.burst * (40 + 160 * hash(c, r, 10));
          x += Math.cos(a) * k; y += Math.sin(a) * k + G.burst * G.burst * 90; alpha *= 1 - clamp01((G.burst - 0.55) * 2.4); churn = G.burst > 0.05;
        }
        if (G.glitch) {
          const s = slice(r), f = Math.floor(t / 2), hit = hash(s, f, 9) < G.glitch * 0.75;
          if (hit) { x += Math.round((hash(s, f, 10) - 0.5) * 10 * G.glitch) * CELL; churn = true; if (G.ink !== "cream" || hash(s, f, 11) < 0.35) amber = G.ink !== "green"; }
          if (hash(c, r, f) < G.glitch * 0.08) continue;
        }
        if (G.decode !== undefined) {
          const row = G.decode * (N + 2) - 1;
          if (r > row) { churn = true; flash = Math.max(flash, 0.25); } else if (r > row - 1.2) flash = 1;
        }
        if (G.scan !== undefined) { const row = G.scan * (N + 4) - 2; if (Math.abs(r - row) < 1.4) { flash = Math.max(flash, 1 - Math.abs(r - row) / 1.4); churn = true; } }
        if (G.pulse) { const ring = G.pulse * N * 0.85, dd = Math.hypot(c - N / 2, r - N * 0.45); if (Math.abs(dd - ring) < 1.3) flash = Math.max(flash, 0.7 * (1 - G.pulse)); }
        if (G.think && green) churn = true;
        if (x < -CELL || x > 240 + CELL || y < -CELL || y > 240 + CELL || alpha <= 0.02) continue;

        const ch = style === "ascii" ? (green ? "@" : RAMP[Math.min(RAMP.length - 1, Math.floor((L / 255) * RAMP.length * 1.05))])
          : RAIN[Math.floor(hash(c, r, churn ? t : Math.floor((t + hash(c, r, 4) * 40) / 9)) * RAIN.length)];
        const k = Math.min(1, 0.35 + L / 230);
        let color;
        if (flash > 0) color = rgba(235, 255, 230, alpha * (0.6 + 0.4 * flash));
        else if (green) color = rgba(196, 255, 190, alpha * Math.min(1, 0.55 + L / 255));
        else if (amber) color = rgba(255, 179 + 40 * k, 71 + 60 * k, alpha * (0.5 + 0.5 * k));
        else if (G.ink === "green" || style === "ascii") color = rgba(120 + 90 * k, 200 + 55 * k, 120 + 80 * k, alpha * (0.45 + 0.55 * k));
        else color = rgba(R * 0.25 + 230 * k * 0.75, Gr * 0.25 + 226 * k * 0.75, B * 0.25 + 214 * k * 0.75, alpha);
        text(font, ch, x, y, color);
      }
    }

    // glyphs streaming down out of the rain into its head, as it thinks
    if (G.think) for (let i = 0; i < 16; i++) {
      const ph = (t / 26 + hash(i, 31)) % 1, sx = 16 + hash(i, 32) * 208, ex = 120 + (hash(i, 33) - 0.5) * 40, e = ph * ph;
      text(K8, RAIN[Math.floor(hash(i, Math.floor(t / 2), 34) * RAIN.length)], sx + (ex - sx) * e, -6 + (70 - -6) * e, rgba(196, 255, 190, G.think * Math.sin(Math.PI * ph) * 0.9));
    }
    // asleep: three z's rising beside its head (over it they would be lost among its own glyphs), each a size of its own
    if (G.zzz) for (let i = 0; i < 3; i++) {
      const ph = (t / 60 + i / 3) % 1;
      text(MONO(9 + i * 3), "z", 198 + i * 8 + Math.sin(ph * 6 + i) * 4, 64 - ph * 56, rgba(196, 255, 190, G.zzz * Math.sin(Math.PI * ph)));
    }
  }

  window.SageGlyphs = { draw };
})();
