// Sage turning: poses drawn straight through SageDraw, each at the board's size, with a check that every canvas call is
// one the board can draw.
const { chromium } = await import(process.env.PLAYWRIGHT + "/index.mjs");
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1300, height: 400 } });
const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto("file://" + process.env.PAGE + "?sheet");
await p.waitForFunction(() => document.title === "sheet ready");
const bad = await p.evaluate(([poses, process_size]) => {
  const OK = new Set(["beginPath","closePath","moveTo","lineTo","quadraticCurveTo","bezierCurveTo","arc","ellipse","rect","fillRect","fill","stroke","clip","save","restore","translate","rotate","scale","setTransform","=fillStyle","=strokeStyle","=lineWidth","=globalAlpha","setLineDash","roundRect","=lineDashOffset","=lineCap","=lineJoin"]);
  document.body.innerHTML = ""; document.body.style.cssText = "margin:0;background:#111;display:flex;flex-wrap:wrap;gap:6px;padding:6px";
  const used = new Set();
  for (const [label, pose] of poses) {
    const c = document.createElement("canvas"); c.width = c.height = 240; c.style.width = c.style.height = (process_size || "150") + "px";
    const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 240, 240);
    const rec = new Proxy(g, { get(o, k) { const v = o[k]; return typeof v === "function" ? (...a) => { used.add(k); return v.apply(o, a); } : v; }, set(o, k, v) { used.add("=" + k); o[k] = v; return true; } });
    SageDraw.drawSage(rec, pose, 12);
    const d = document.createElement("div"); d.style.cssText = "color:#999;font:11px monospace;text-align:center"; d.append(c, label); document.body.append(d);
  }
  return [...used].filter((k) => !OK.has(k));
}, [JSON.parse(process.env.POSES), process.env.SIZE]);
await p.screenshot({ path: process.env.OUT, fullPage: true });
console.log("not drawable on the board:", bad.join(", ") || "none", "| errors:", errors.join(" | ") || "none");
await b.close();
