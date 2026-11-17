// The page around the board: the prism, the click that taps it, the readouts, and the link to the
// bridge. The link is the bridge's emulator transport: the board's commands arrive as Server-Sent
// Events (events), what the board says goes back by POST (board), and clips come as the board's
// POST /clip would bring them (an event named clip, answered on clip). Served by the bridge
// (python3 tools/buddy_bridge.py --emulator), everything is same origin. A file's compressed frames are inflated
// when it arrives (prepare()), since the browser inflates only asynchronously and the board's loop does not wait.

import { Board } from './board.mjs';
import { W, H } from './vec.mjs';
import { prepare, prepared } from './packed.mjs';

const CLICK_JOLT = 1.0;                  // g: a knock on the glass, well over the board's default threshold of 0.35
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const artUrl = params.get('art') || 'art.bin';

const lcd = $('lcd').getContext('2d'), glow = $('glow').getContext('2d');
const image = lcd.createImageData(W, H), px = new Uint32Array(image.data.buffer);
let board, artName = '', page = 0, linked = false, replaced = false, events = null;

// ---- the log: what came in on the serial line, what the board said ----
const logEl = $('log'), logLines = [];
function log(text, cls = '') {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  el.textContent = text;
  logLines.push(el); logEl.append(el);
  while (logLines.length > 300) logLines.shift().remove();
  if (logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60) logEl.scrollTop = logEl.scrollHeight;
}

// ---- what the board says goes to the bridge, one request at a time so the order holds ----
const outbox = [];
let sending = false;
function said(line) {
  log('← ' + line);
  if (linked) { outbox.push(line); flush(); }
}
async function flush() {
  if (sending || !outbox.length) return;
  sending = true;
  const body = outbox.splice(0).join('\n') + '\n';
  try { await fetch(`board?page=${page}`, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } }); }
  catch { log('could not reach the bridge', 'note'); }
  sending = false;
  flush();
}

// ---- the display: RGB565 widened to RGBA, as the panel shows it; the backlight dims the whole screen ----
function present(fb) {
  for (let i = 0; i < W * H; i++) {
    const v = fb[i], r = ((v >> 11) << 3) | (v >> 13), g = (((v >> 5) & 63) << 2) | ((v >> 9) & 3), b = ((v & 31) << 3) | ((v >> 2) & 7);
    px[i] = 0xFF000000 | (b << 16) | (g << 8) | r;
  }
  lcd.putImageData(image, 0, 0);
  glow.drawImage(lcd.canvas, 0, 0, 60, 60);
}
function backlight(level) { $('screen').style.filter = `brightness(${(level / 255).toFixed(3)})`; }
function noDrawings() {                  // setup()'s message when the art is missing or bad
  lcd.fillStyle = '#000'; lcd.fillRect(0, 0, W, H);
  lcd.fillStyle = 'rgb(255,241,220)'; lcd.font = '14px monospace'; lcd.textAlign = 'center'; lcd.textBaseline = 'middle';
  lcd.fillText('no drawings yet', 120, 104); lcd.fillText('tools/ota.py --art', 120, 124);
  glow.drawImage(lcd.canvas, 0, 0, 60, 60);
}

// ---- booting: a new board, its art, its loop ----
let timer = 0;
function boot(art, name) {
  clearTimeout(timer);
  board = new Board({ say: said, push: present, backlight, inflate: prepared });
  artName = name;
  if (!board.setup(art)) noDrawings();
  setStatus();
  const step = () => { board.loop(); timer = setTimeout(step, 2); };    // the board's loop ends in delay(2)
  step();
}
async function loadArt() {
  try {
    const r = await fetch(artUrl, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const art = new Uint8Array(await r.arrayBuffer());
    await prepare(art);
    boot(art, artUrl.split('/').pop());
  } catch (e) {
    log(`no art at ${artUrl} (${e.message}): load a .bin below`, 'note');
    boot(null, '');
  }
}

// ---- the link to the bridge ----
function connect() {
  replaced = false;
  events = new EventSource('events');
  events.addEventListener('hello', e => { page = JSON.parse(e.data).page; linked = true; log(`bridge connected (page ${page})`, 'note'); setStatus(); });
  events.onmessage = e => { log('→ ' + e.data, 'in'); board.receive(e.data + '\n'); };
  events.addEventListener('clip', async e => {
    const c = JSON.parse(e.data), bytes = Uint8Array.from(atob(c.data), ch => ch.charCodeAt(0));
    await prepare(bytes);
    const res = board.postClip(bytes, c.name, c.tap);
    log(`→ POST /clip ${c.name} (${bytes.length} bytes${c.tap ? ', tap' : ''}): ${res.status} ${res.body}`, 'in');
    fetch(`clip?page=${page}&id=${c.id}`, { method: 'POST', body: res.body, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  });
  events.addEventListener('replaced', () => {
    events.close(); linked = false; replaced = true;
    log('another emulator page took over the link (the newest wins, as on the board)', 'note'); setStatus();
  });
  events.onerror = () => { if (linked) log('bridge gone: retrying', 'note'); linked = false; setStatus(); };
}

// ---- input ----
function tap() { board.sample(CLICK_JOLT); }
$('prism').addEventListener('pointerdown', e => { if (e.button === 0) tap(); });
$('prism').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) tap(); } });
$('cmd').addEventListener('submit', e => {
  e.preventDefault();
  const line = $('line').value.trim();
  if (!line) return;
  log('→ ' + line + '   (typed)', 'in'); board.receive(line + '\n'); $('line').value = '';
});
$('reboot').addEventListener('click', () => { log('reboot', 'note'); loadArt(); });
$('file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  await prepare(bytes);
  if (f.name.endsWith('.clip')) {                      // a clip goes in as POST /clip would put it
    const res = board.postClip(bytes, f.name.replace(/\.clip$/, ''), false);
    log(`POST /clip ${f.name}: ${res.status} ${res.body}`, 'note');
  } else { log(`reboot with ${f.name}`, 'note'); boot(bytes, f.name); }
  e.target.value = '';
});

// ---- readouts ----
function setStatus() {
  const l = $('link'), a = $('art');
  l.textContent = linked ? `bridge connected` : replaced ? 'another page has the link' : 'no bridge';
  l.className = linked ? 'on' : 'off';
  const s = board && board.state();
  a.textContent = s && s.ok ? `${artName}: ${s.frames} frames, ${s.seqs} sequences` : 'no art';
  a.className = s && s.ok ? 'on' : 'off';
}
let slowest = 0, slowestAt = 0;
function readouts() {
  if (!board) return;
  const s = board.state(), now = performance.now();
  if (s.drawMs > slowest || now - slowestAt > 2000) { slowest = s.drawMs; slowestAt = now; }
  const clock = s.clock === null ? 'unknown' : `${String(Math.floor(s.clock / 3600)).padStart(2, '0')}:${String(Math.floor(s.clock / 60) % 60).padStart(2, '0')}`;
  const hex = '#' + s.colour.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const rows = [
    ['mode', s.mode + (s.offlineMark ? (s.anchors ? ' (shown on its antenna)' : ' (unplugged mark)') : '')], ['antenna', s.antenna || 'its own ball'], ['target', s.target], ['playing', `${s.playing} (${s.kind})`],
    ['queued', s.pending || '-'], ['fps', s.fps.toFixed(1)], ['draw_ms', `${slowest.toFixed(2)} on this machine (the board's own is only measured on the board)`],
    ['backlight', `${s.backlight} / 255`], ['colour', `<span class="swatch" style="background:${hex}"></span>${hex}`],
    ['overlay', `working ${s.overlay[0]}, waiting ${s.overlay[1]}, unseen ${s.overlay[2]}`],
    ['clock', clock], ['taps', String(s.taps)], ['clips', s.clips.length ? `${s.clips.length} / 32: ${s.clips.map(c => c.name + (c.tap ? ' (tap)' : '')).join(', ')}` : 'none'],
  ];
  $('readouts').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${k === 'colour' ? v : escape(v)}</dd>`).join('');
  const p = $('problems');
  p.hidden = !s.problems.length;
  p.innerHTML = s.problems.map(t => `<li>${escape(t)}</li>`).join('');
  setStatus();
}
const escape = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
setInterval(readouts, 200);

// for checks driven from outside (emulator/checks/e2e.mjs)
window.__emu = { get board() { return board; }, state: () => ({ ...board.state(), linked, page }), tap };

loadArt().then(() => { if (location.protocol.startsWith('http')) connect(); });
