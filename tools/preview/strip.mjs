// A strip of chosen frames at the board's own size, each on the prism's black, to look at closely.
const { chromium } = await import(process.env.PLAYWRIGHT + "/index.mjs");
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1260, height: 300 } });
await p.goto("file://" + process.env.PAGE + "?sheet");
await p.waitForFunction(() => document.title === "sheet ready");
await p.evaluate((picks) => {
  document.body.innerHTML = ""; document.body.style.cssText = "margin:0;background:#111;display:flex;gap:8px;padding:8px";
  const S = window.__sage;
  for (const [key, t] of picks) {
    const c = document.createElement("canvas"); c.width = c.height = 240; c.style.cssText = "width:240px;height:240px"; const g = c.getContext("2d");
    const a = S.LOOPS[key] ? S.at(key, t) : S.atSeq(key, t); S.render(g, key, a.id, t);
    const d = document.createElement("div"); d.style.cssText = "color:#999;font:11px monospace;text-align:center"; d.append(c, `${key} ${t}`); document.body.append(d);
  }
}, JSON.parse(process.env.PICKS));
await p.screenshot({ path: process.env.OUT, fullPage: true });
await b.close();
