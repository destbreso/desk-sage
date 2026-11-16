// Sage made of the rain of destbreso.com: the illustrated Sage read cell by cell into the rain's own glyphs (katakana,
// digits and signs), cream where its shell catches the light, green where its eyes are, with the rain falling behind.
// It forms out of the rain from its middle outward, eyes first (as it is found on the website), dissolves back into
// it, or stays made of it. Text is not one of the board's instructions, so these frames are kept as pixels. Part of
// Sage's art: see LICENSE-ART.md.
(function () {
  const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF{}[]|:;=+-*#$%?!";
  const CELL = 8, N = 240 / CELL;
  const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  let off = null;

  /**
   * Sage in a pose, made of glyphs: `pose.glyph` is { mode: "form" | "dissolve" | "full", reveal: 0 to 1, rain: 0 to 1,
   * blend: 0 to 1 }, where `blend` lays the illustrated Sage over the glyphs (a hand-over from one to the other).
   */
  function draw(ctx, pose, t) {
    const G = { mode: "full", reveal: 1, rain: 0.3, blend: 0, ...pose.glyph };
    const plain = { ...pose, glyph: undefined };
    off = off || Object.assign(document.createElement("canvas"), { width: 240, height: 240 });
    const o = off.getContext("2d", { willReadFrequently: true });
    o.fillStyle = "#000000"; o.fillRect(0, 0, 240, 240);
    SageDraw.drawSage(o, plain, t);
    const d = o.getImageData(0, 0, 240, 240).data;

    ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 240, 240);
    ctx.font = `bold ${CELL + 1}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";

    // the rain behind: columns falling at their own speed, a bright head and a fading trail
    if (G.rain > 0) for (let col = 0; col < N; col++) {
      if (hash(col, 7) > G.rain) continue;
      const speed = 0.35 + hash(col, 3) * 0.5, len = 6 + Math.floor(hash(col, 5) * 10), head = ((t * speed + hash(col, 11) * 60) % (N + len)) | 0;
      for (let i = 0; i < len; i++) {
        const row = head - i; if (row < 0 || row >= N) continue;
        const a = i === 0 ? 0.55 : 0.3 * (1 - i / len);
        ctx.fillStyle = i === 0 ? `rgba(200,255,195,${a})` : `rgba(160,226,153,${a})`;
        ctx.fillText(GLYPHS[Math.floor(hash(col, row, Math.floor(t / 5)) * GLYPHS.length)], col * CELL + CELL / 2, row * CELL + CELL / 2);
      }
    }

    // Sage's cells: shown in the order they resolve (its eyes first, then from its middle outward)
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      let R = 0, Gr = 0, B = 0;
      for (let y = r * CELL; y < r * CELL + CELL; y++) for (let x = c * CELL; x < c * CELL + CELL; x++) { const i = (y * 240 + x) * 4; R += d[i]; Gr += d[i + 1]; B += d[i + 2]; }
      const n = CELL * CELL; R /= n; Gr /= n; B /= n;
      const L = 0.2126 * R + 0.7152 * Gr + 0.0722 * B;
      if (L < 12) continue;
      const green = Gr > R * 1.25 && Gr > B * 1.1;
      const dist = Math.hypot(c - N / 2, r - N / 2) / (N * 0.7);
      const order = green ? 0.05 * hash(c, r, 1) : 0.12 + dist * 0.8 + 0.08 * hash(c, r, 2);
      let x = c * CELL + CELL / 2, y = r * CELL + CELL / 2, alpha = 1, flash = 0;
      if (G.mode === "form") { const left = G.reveal * 1.1 - order; if (left < 0) continue; flash = Math.max(0, 1 - left * 8); }
      else if (G.mode === "dissolve") {
        // a cell lets go in the reverse order and falls as rain
        const gone = (1 - G.reveal) * 1.1 - (1 - order);
        if (gone > 0) { y += gone * 240 * (0.6 + hash(c, r, 3)); alpha = Math.max(0, 1 - gone * 2.2); if (alpha <= 0 || y > 240) continue; }
      }
      const glyph = GLYPHS[Math.floor(hash(c, r, Math.floor((t + hash(c, r, 4) * 40) / 9)) * GLYPHS.length)];
      const k = Math.min(1, 0.35 + L / 230);
      ctx.fillStyle = flash > 0 ? `rgba(235,255,230,${alpha})` : green ? `rgba(196,255,190,${alpha * Math.min(1, 0.55 + L / 255)})`
        : `rgba(${Math.round(R * 0.25 + 230 * k * 0.75)},${Math.round(Gr * 0.25 + 226 * k * 0.75)},${Math.round(B * 0.25 + 214 * k * 0.75)},${alpha})`;
      ctx.fillText(glyph, x, y);
    }

    // the hand-over: the illustrated Sage laid over its glyphs
    if (G.blend > 0) { ctx.save(); ctx.globalAlpha = G.blend; ctx.drawImage(off, 0, 0); ctx.restore(); }
  }

  window.SageGlyphs = { draw };
})();
