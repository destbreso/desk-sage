// The glyph acts' frames: how many are unique and how many glyphs each draws (7 bytes a glyph on the board).
const { chromium } = await import(process.env.PLAYWRIGHT + "/index.mjs");
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--allow-file-access-from-files"] });
const p = await b.newPage();
const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto("file://" + process.env.PAGE + "?sheet");
await p.waitForFunction(() => document.title === "sheet ready");
const r = await p.evaluate(() => {
  const S = window.__sage, c = document.createElement("canvas"); c.width = c.height = 240; const g = c.getContext("2d");
  const out = {}; let total = 0, frames = 0, worst = 0, other = new Set();
  for (const s of S.meta().seqs.filter((x) => x.key.startsWith("glyph_"))) {
    const uniq = new Map();
    for (let t = 0; t < S.seqLen(s.key); t++) {
      let n = 0, sig = []; const rec = new Proxy(g, { get(o, k) { const v = o[k]; return typeof v === "function" ? (...a) => { if (k === "fillText") { n++; sig.push(a[0], Math.round(a[1]), Math.round(a[2]), o.fillStyle); } else if (k !== "fillRect") other.add(k); return v.apply(o, a); } : v; }, set(o, k, v) { o[k] = v; return true; } });
      const a = S.atSeq(s.key, t); S.render(rec, s.key, a.id, t);
      uniq.set(JSON.stringify(sig), n);
    }
    const bytes = [...uniq.values()].reduce((s, n) => s + 4 + 7 * n, 0); worst = Math.max(worst, ...uniq.values());
    out[s.key] = `${uniq.size} frames ${Math.round(bytes / 1024)} KB`; total += bytes; frames += uniq.size;
  }
  return { out, totalKB: Math.round(total / 1024), frames, worst, other: [...other] };
});
console.log(JSON.stringify(r, null, 1)); console.log("errors:", errors.join(" | ") || "none");
await b.close();
