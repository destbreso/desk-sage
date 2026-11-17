// Sage's desk page, checked: no errors, every canvas call one the board's instructions have, the sizes, and a sheet.
const { chromium } = await import(process.env.PLAYWRIGHT + "/index.mjs");
const page_ = process.env.PAGE;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto("file://" + page_ + "?sheet");
await p.waitForFunction(() => document.title === "sheet ready", null, { timeout: 30000 });
const r = await p.evaluate(() => {
  const OK = new Set(["beginPath","closePath","moveTo","lineTo","quadraticCurveTo","bezierCurveTo","arc","ellipse","rect","fillRect","fill","stroke","clip","save","restore","translate","rotate","scale","setTransform","=fillStyle","=strokeStyle","=lineWidth","=globalAlpha","setLineDash","roundRect","=lineDashOffset","=lineCap","=lineJoin"]);
  const S = window.__sage, c = document.createElement("canvas"); c.width = c.height = 240; const g = c.getContext("2d");
  const per = {}; const used = new Map(); let frames = 0, bytes = 0, maxBytes = 0, uniq = new Set();
  const seqs = S.meta().seqs;
  for (const s of seqs.filter((x) => !x.key.startsWith("glyph_"))) for (let t = 0; t < S.seqLen(s.key); t++) {
    let ops = []; const rec = new Proxy(g, { get(o, k) { const v = o[k]; return typeof v === "function" ? (...a) => { ops.push([k, ...a]); return v.apply(o, a); } : v; }, set(o, k, v) { ops.push(["=" + k, v]); o[k] = v; return true; } });
    const a = s.kind === 0 ? S.at(s.key, t) : S.atSeq(s.key, t);
    S.render(rec, s.key, a.id, t);
    const key = JSON.stringify(ops); frames++; per[s.key] = per[s.key] || [0, 0];
    if (!uniq.has(key)) { uniq.add(key); const n = ops.reduce((s, op) => s + 1 + 2 * op.slice(1).filter((x) => typeof x === "number").length + (typeof op[1] === "string" && op[0].startsWith("=") ? 4 : 0), 0); bytes += n; maxBytes = Math.max(maxBytes, n); per[s.key][0]++; per[s.key][1] += n; }
    for (const op of ops) used.set(op[0], (used.get(op[0]) || 0) + 1);
  }
  const bad = [...used.keys()].filter((k) => !OK.has(k));
  return { per: Object.entries(per).map(([k, [n, b]]) => k + " " + n + " " + Math.round(b / 1024)).join("\n"), seqs: seqs.length, loops: S.MOMENTS.length, trans: Object.keys(S.TRANS).length, acts: Object.keys(S.CLIPS).length, drawings: Object.keys(S.D).length, ticks: frames, unique: uniq.size, kb: Math.round(bytes / 1024), avg: Math.round(bytes / uniq.size), max: maxBytes, bad };
});
console.log(JSON.stringify(r));
console.log("errors:", errors.join(" | ") || "none");
await p.screenshot({ path: process.env.OUT, fullPage: true });
await b.close();
