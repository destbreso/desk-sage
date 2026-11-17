// A proposal sheet: rows of tiles at the board's size, each a pose, a full-screen hologram, or a frame of an act.
const { chromium } = await import(process.env.PLAYWRIGHT + "/index.mjs");
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1300, height: 1200 } });
const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto("file://" + process.env.PAGE + "?sheet");
await p.waitForFunction(() => document.title === "sheet ready");
const bad = await p.evaluate((rows) => {
  const OK = new Set(["beginPath","closePath","moveTo","lineTo","quadraticCurveTo","bezierCurveTo","arc","ellipse","rect","fillRect","fill","stroke","clip","save","restore","translate","rotate","scale","setTransform","=fillStyle","=strokeStyle","=lineWidth","=globalAlpha","setLineDash","roundRect","=lineDashOffset","=lineCap","=lineJoin"]);
  const used = new Set();
  document.body.innerHTML = ""; document.body.style.cssText = "margin:0;background:#111;padding:6px;font:12px monospace;color:#9c9";
  for (const [title, tiles] of rows) {
    const h = document.createElement("div"); h.textContent = title; h.style.margin = "6px 2px"; document.body.append(h);
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:6px"; document.body.append(row);
    for (const [kind, obj, t] of tiles) {
      const c = document.createElement("canvas"); c.width = c.height = 240; c.style.cssText = "width:240px;height:240px"; const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 240, 240);
      const rec = new Proxy(g, { get(o, k) { const v = o[k]; return typeof v === "function" ? (...a) => { used.add(k); return v.apply(o, a); } : v; }, set(o, k, v) { used.add("=" + k); o[k] = v; return true; } });
      if (kind === "pose") SageDraw.drawSage(rec, obj, t);
      else if (kind === "screen") SageHolo.screen(rec, obj, t);
      else { const S = window.__sage, a = S.atSeq(obj, t); S.render(rec, obj, a.id, t); }
      row.append(c);
    }
  }
  return [...used].filter((k) => !OK.has(k));
}, JSON.parse(process.env.ROWS));
await p.screenshot({ path: process.env.OUT, fullPage: true });
console.log("not drawable on the board:", bad.join(", ") || "none", "| errors:", errors.join(" | ") || "none");
await b.close();
