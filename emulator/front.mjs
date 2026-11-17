// Simple: the bare board seen square from the front, display side up, at its real proportions. The measurements are
// hardware/model.js's (Waveshare's drawings), in millimetres from the board's centre, x right and y down, its USB-C
// edge at the top. Only the display, the black tape over the panel's bonded edge, and the pads that show past the
// display's edges are seen from the front: everything else on that side is under the display.

const PCB = { w: 26.25, h: 29.22 };
const M2 = { dx: 22.55 / 2, y: [-12.61, 12.83], drill: 1.1, pad: 1.95 };
const HDR = { dx: 23.72 / 2, y0: 8.99 - 7 * 2.54, pitch: 2.54, drill: 0.5, pad: 0.85 };
const DISP = { w: 23.4, top: -14.5, bottom: 8.9, active: 22.6 };
const TAPE = { bottom: 14.52 };                     // over the panel's ledge and its driver, round the bottom edge
const ACTIVE_CY = (DISP.top + DISP.bottom) / 2;

const NS = 'http://www.w3.org/2000/svg';
const pct = (v, of) => `${(100 * v / of).toFixed(4)}%`;

function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}

// Draws the board into `host` (sized in the page's CSS to the board's proportions) behind its canvas (the board's picture) and places the canvas on the display's active area.
export function drawFront(host, canvas) {
  const svg = el('svg', { viewBox: `${-PCB.w / 2} ${-PCB.h / 2} ${PCB.w} ${PCB.h}`, 'aria-hidden': 'true' }, host);
  host.insertBefore(svg, host.firstChild);

  const defs = el('defs', {}, svg);
  const mask = el('linearGradient', { id: 'front-mask', x1: '0', y1: '0', x2: '0.35', y2: '1' }, defs);
  el('stop', { offset: '0', 'stop-color': '#17191b' }, mask);
  el('stop', { offset: '1', 'stop-color': '#0a0b0b' }, mask);
  const gold = el('radialGradient', { id: 'front-gold', cx: '0.35', cy: '0.3', r: '0.8' }, defs);
  el('stop', { offset: '0', 'stop-color': '#f1d58e' }, gold);
  el('stop', { offset: '0.55', 'stop-color': '#d2a650' }, gold);
  el('stop', { offset: '1', 'stop-color': '#8c6a2c' }, gold);

  // the board's black mask, then the pads (the display covers most of each)
  el('rect', { x: -PCB.w / 2, y: -PCB.h / 2, width: PCB.w, height: PCB.h, rx: 0.3, fill: 'url(#front-mask)' }, svg);
  const clip = el('clipPath', { id: 'front-outline' }, defs);
  el('rect', { x: -PCB.w / 2, y: -PCB.h / 2, width: PCB.w, height: PCB.h, rx: 0.3 }, clip);
  const pads = el('g', { 'clip-path': 'url(#front-outline)' }, svg);   // the M2 pads run a little past the board's edge
  const ring = (cx, cy, r, drill) => {
    el('circle', { cx, cy, r, fill: 'url(#front-gold)' }, pads);
    el('circle', { cx, cy, r: drill, fill: '#040404' }, pads);
  };
  for (const s of [-1, 1]) {
    for (const y of M2.y) ring(s * M2.dx, y, M2.pad, M2.drill);
    for (let i = 0; i < 8; i++) ring(s * HDR.dx, HDR.y0 + i * HDR.pitch, HDR.pad, HDR.drill);
  }

  // the display: its glass, edged in black tape, and the tape over the panel's bonded edge below it
  const x0 = -DISP.w / 2;
  el('rect', { x: x0, y: DISP.bottom, width: DISP.w, height: TAPE.bottom - DISP.bottom, fill: '#0e0f10' }, svg);
  el('rect', { x: x0, y: DISP.top, width: DISP.w, height: DISP.bottom - DISP.top, fill: '#050607' }, svg);
  el('rect', { x: x0 + 0.03, y: DISP.top + 0.03, width: DISP.w - 0.06, height: DISP.bottom - DISP.top - 0.06, fill: 'none', stroke: 'rgba(255,255,255,0.09)', 'stroke-width': 0.06 }, svg);
  el('line', { x1: x0, y1: DISP.bottom + 0.05, x2: -x0, y2: DISP.bottom + 0.05, stroke: 'rgba(255,255,255,0.05)', 'stroke-width': 0.08 }, svg);

  // the picture on the active area, and a faint sheen over the glass
  const a = DISP.active;
  Object.assign(canvas.style, {
    left: pct(PCB.w / 2 - a / 2, PCB.w), top: pct(PCB.h / 2 + ACTIVE_CY - a / 2, PCB.h), width: pct(a, PCB.w), height: pct(a, PCB.h),
  });
  const sheen = host.querySelector('.sheen');
  if (sheen) Object.assign(sheen.style, {
    left: pct(PCB.w / 2 + x0, PCB.w), top: pct(PCB.h / 2 + DISP.top, PCB.h), width: pct(DISP.w, PCB.w), height: pct(DISP.bottom - DISP.top, PCB.h),
  });
}
