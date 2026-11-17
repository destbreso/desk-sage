// The page around the board: its two views (Simple, the bare board from the front; Realistic, the device in 3D), the click that
// taps it, the readouts, the Serial box, and the link to the bridge. The link is the bridge's emulator transport:
// the board's commands arrive as Server-Sent Events (events), what the board says goes back by POST (board), and
// clips come as the board's POST /clip would bring them (an event named clip, answered on clip). Served by the bridge
// (python3 tools/buddy_bridge.py --emulator), everything is same origin. A file's compressed frames are inflated
// when it arrives (prepare()), since the browser inflates only asynchronously and the board's loop does not wait.

import { Board, HOST_TIMEOUT_MS } from './board.mjs';
import { W, H } from './vec.mjs';
import { prepare, prepared } from './packed.mjs';
import { attach, renderHelp } from './commands.mjs';
import { drawFront } from './front.mjs';

const CLICK_JOLT = 1.0;                  // g: a knock on the glass, well over the board's default threshold of 0.35
const HEARTBEAT_EVERY_MS = 15000;        // tools/buddy_bridge.py's HEARTBEAT_EVERY, for the stand-in bridge
const MODE_KEY = 'desk-emulator.mode';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');   // the captures: the board's clock steps only when told, Realistic alone on the page
// art.bin is the bridge's; from a static server at the repository's root, the committed art
const artUrls = params.get('art') ? [params.get('art')] : ['art.bin', '../firmware/data/sage.bin'];

const lcd = $('lcd').getContext('2d');
drawFront($('front'), $('lcd'));
const image = lcd.createImageData(W, H), px = new Uint32Array(image.data.buffer);
let board, artName = '', page = 0, linked = false, replaced = false, events = null;
let hasBridge = null;                    // null until known: true once the bridge said hello, false when there is none here
let standIn = 0;                         // the stand-in bridge's heartbeat timer, when it is on
let mode = 'simple', device = null, deviceLoading = null, lastBacklight = 255;

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
  shown();
}
function shown() {                       // a new picture on the canvas: each view takes it in its own way
  if (device) device.pushed();
}
function backlight(level) {
  $('lcd').style.filter = `brightness(${(level / 255).toFixed(3)})`;
  if (device && level !== lastBacklight) device.backlight(level);
  lastBacklight = level;
}
function noDrawings() {                  // setup()'s message when the art is missing or bad
  lcd.fillStyle = '#000'; lcd.fillRect(0, 0, W, H);
  lcd.fillStyle = 'rgb(255,241,220)'; lcd.font = '14px monospace'; lcd.textAlign = 'center'; lcd.textBaseline = 'middle';
  lcd.fillText('no drawings yet', 120, 104); lcd.fillText('tools/ota.py --art', 120, 124);
  shown();
}

// ---- the board's clock: the wall clock since boot, plus whatever "Skip the wait" moved it on; virtual when capturing ----
let bootAt = 0, skew = 0, vnow = 0;
const clock = () => CAPTURE ? vnow : performance.now() - bootAt + skew;

// ---- booting: a new board, its art, its loop ----
let timer = 0;
function boot(art, name) {
  clearTimeout(timer);
  bootAt = performance.now(); skew = 0; vnow = 0;
  board = new Board({ say: said, push: present, backlight, inflate: prepared, millis: () => Math.floor(clock()), micros: () => performance.now() * 1000 });
  artName = name;
  if (!board.setup(art)) noDrawings();
  setStatus();
  if (CAPTURE) return;                   // __emu.advance() runs its loop
  const step = () => { board.loop(); timer = setTimeout(step, 2); };    // the board's loop ends in delay(2)
  step();
}
async function loadArt() {
  const tried = [];
  for (const url of artUrls) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      const art = new Uint8Array(await r.arrayBuffer());
      await prepare(art);
      boot(art, url.split('/').pop());
      return;
    } catch (e) { tried.push(`${url} (${e.message})`); }
  }
  log(`no art at ${tried.join(', ')}: load a .bin below`, 'note');
  boot(null, '');
}

// ---- the link to the bridge, which the page can cut and restore; with no bridge here, a stand-in for one ----
function connect() {
  replaced = false;
  const es = events = new EventSource('events');
  es.addEventListener('hello', e => { page = JSON.parse(e.data).page; linked = true; hasBridge = true; log(`bridge connected (page ${page})`, 'note'); setStatus(); });
  es.onmessage = e => { log('→ ' + e.data, 'in'); board.receive(e.data + '\n'); };
  es.addEventListener('clip', async e => {
    const c = JSON.parse(e.data), bytes = Uint8Array.from(atob(c.data), ch => ch.charCodeAt(0));
    await prepare(bytes);
    const res = board.postClip(bytes, c.name, c.tap);
    log(`→ POST /clip ${c.name} (${bytes.length} bytes${c.tap ? ', tap' : ''}): ${res.status} ${res.body}`, 'in');
    fetch(`clip?page=${page}&id=${c.id}`, { method: 'POST', body: res.body, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  });
  es.addEventListener('replaced', () => {
    es.close(); events = null; linked = false; replaced = true;
    log('another emulator page took over the link (the newest wins, as on the board)', 'note'); setStatus();
  });
  es.onerror = () => {
    if (hasBridge === null && es.readyState === EventSource.CLOSED) {     // a static server: there is no bridge here
      events = null; hasBridge = false; setStatus();
      return;
    }
    if (linked) log('bridge gone: retrying', 'note');
    linked = false; setStatus();
  };
}
function cut() {
  if (events) events.close();
  events = null; linked = false; outbox.length = 0;
  log('link cut here: no line reaches the board and nothing it says goes back', 'note');
}
function heartbeat() {                   // what the bridge sends every 15 s: h and the time of day
  const d = new Date(), line = `h ${d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()}`;
  log('→ ' + line + '   (stand-in bridge)', 'in');
  board.receive(line + '\n');
}
$('linkbtn').addEventListener('click', () => {
  if (hasBridge === false) {
    if (standIn) { clearInterval(standIn); standIn = 0; log('stand-in bridge off: no more heartbeats', 'note'); }
    else { log('stand-in bridge on: a heartbeat now and every 15 s, nothing else', 'note'); heartbeat(); standIn = setInterval(heartbeat, HEARTBEAT_EVERY_MS); }
  } else if (events) cut();
  else { log('link restored', 'note'); connect(); }
  setStatus(); readouts();
});
$('skip').addEventListener('click', () => {
  const s = board.state(), left = s.heard === null ? 0 : HOST_TIMEOUT_MS - s.heard;
  if (s.offline || left <= 0) return;
  skew += left + 5;
  log(`skipped ${Math.ceil(left / 1000)} s: the board's clock moved ahead (on its own it waits them out)`, 'note');
  readouts();
});
// what the link is doing, in a few words for the status and the readouts, and a sentence under the switch
function linkState(s) {
  const left = s && s.heard !== null && !s.offline ? Math.max(0, HOST_TIMEOUT_MS - s.heard) : null;
  const wait = left === null ? '' : `in ${Math.ceil(left / 1000)} s`, leftText = left === null ? '' : `<b>${Math.ceil(left / 1000)} s</b> left`;
  const lone = !s || !s.ok || !s.offline ? '' : !s.offlineMark ? 'offline' : s.anchors ? 'offline, its antenna dark' : 'offline, the unplugged mark showing';
  const waits = `The board itself waits ${HOST_TIMEOUT_MS / 1000} s after the last line before it goes offline: `;
  if (CAPTURE) return { chip: 'captured', on: false, button: '', text: '', skip: false, short: 'none (capture)' };
  if (hasBridge === false) {
    if (standIn) return { chip: 'stand-in bridge', on: true, button: 'Disconnect the stand-in bridge', skip: false, short: 'stand-in: a heartbeat every 15 s',
      text: 'No bridge here: a stand-in sends the board the heartbeat the bridge sends (h and the time of day) every 15 s, and nothing else.' };
    return { chip: 'no bridge', on: false, button: 'Connect a stand-in bridge', skip: !!wait, short: wait ? `none, offline ${wait}` : `none${lone ? ', ' + lone : ''}`,
      text: wait ? `Stand-in off: no line reaches the board. ${waits}${leftText}.` : `No bridge here, so the board is on its own${lone ? ', ' + lone : ''}. A stand-in can send it the bridge's heartbeat, to try the relink without Python running.` };
  }
  if (linked) return { chip: 'bridge connected', on: true, button: 'Disconnect the bridge', skip: false, short: `bridge, connected (page ${page})`,
    text: 'Linked: the bridge\'s lines reach the board and what it says goes back.' };
  const why = !events && !replaced ? 'Cut here: nothing reaches the board or goes back.' : replaced ? 'Another emulator page has the link (the newest wins, as on the board).' : 'The bridge is gone; the page tries again every second.';
  const chip = !events && !replaced ? 'cut here' : replaced ? 'another page has the link' : hasBridge === null ? 'looking for the bridge' : 'bridge gone';
  return { chip, on: false, button: events ? 'Disconnect the bridge' : 'Connect the bridge', skip: !!wait, short: `${chip}${wait ? ', offline ' + wait : lone ? ', ' + lone : ''}`,
    text: `${why} ${wait ? `${waits}${leftText}.` : lone ? `The board is ${lone}.` : ''}` };
}

// ---- Simple or Realistic: the same board and the same link behind both ----
function storedMode() { try { return localStorage.getItem(MODE_KEY); } catch { return null; } }
function storeMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* a convenience only */ } }
function loadDevice() {
  if (!deviceLoading) {
    deviceLoading = import('./device.mjs')
      .then(({ createDevice }) => createDevice($('device'), { source: lcd.canvas, onTap: tap, capture: CAPTURE }))
      .then(d => { device = d; d.backlight(lastBacklight); $('device-note').hidden = true; if (mode === 'realistic') d.show(); return d; })
      .catch(e => {
        deviceLoading = null;
        $('device-note').textContent = 'Realistic draws the device with WebGL and loads three.js from a CDN: one of them is not available here. Simple needs neither.';
        log(`Realistic could not start: ${e.message}`, 'note');
      });
  }
  return deviceLoading;
}
function setMode(m, remember = true) {
  mode = m === 'realistic' ? 'realistic' : 'simple';
  if (remember) storeMode(mode);
  document.body.dataset.mode = mode;
  $('simple').hidden = mode !== 'simple';
  $('realistic').hidden = mode !== 'realistic';
  document.querySelectorAll('.modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  if (mode === 'realistic') { if (device) device.show(); else loadDevice(); }
  else if (device) device.hide();
}
document.querySelectorAll('.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('home').addEventListener('click', () => device && device.home());

// ---- input ----
function tap() { board.sample(CLICK_JOLT); }
$('front').addEventListener('pointerdown', e => { if (e.button === 0) tap(); });
for (const id of ['front', 'device'])
  $(id).addEventListener('keydown', e => { if (e.target === $(id) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!e.repeat) tap(); } });
const completion = attach({ input: $('line'), list: $('suggest'), board: () => board });
$('cmd').addEventListener('submit', e => {
  e.preventDefault();
  completion.close();
  const line = $('line').value.trim();
  if (!line) return;
  log('→ ' + line + '   (typed)', 'in'); board.receive(line + '\n'); $('line').value = '';
});
renderHelp($('help-list'), ex => { $('line').value = ex; $('line').focus(); completion.close(); });
$('commands').addEventListener('click', () => {
  const open = $('help').hidden;
  $('help').hidden = !open;
  $('commands').setAttribute('aria-expanded', String(open));
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
  const l = $('link'), a = $('art'), s = board && board.state(), k = linkState(s);
  l.textContent = k.chip;
  l.className = k.on ? 'on' : 'off';
  a.textContent = s && s.ok ? `${artName}: ${s.frames} frames, ${s.seqs} sequences` : 'no art';
  a.className = s && s.ok ? 'on' : 'off';
  const btn = $('linkbtn');
  btn.hidden = !k.button;
  if (btn.textContent !== k.button) btn.textContent = k.button;
  if ($('linktext').innerHTML !== k.text) $('linktext').innerHTML = k.text;
  $('skip').hidden = !k.skip;
  return k;
}
let slowest = 0, slowestAt = 0;
function readouts() {
  if (!board) return;
  const s = board.state(), now = performance.now(), k = setStatus();
  if (s.drawMs > slowest || now - slowestAt > 2000) { slowest = s.drawMs; slowestAt = now; }
  const clock = s.clock === null ? 'unknown' : `${String(Math.floor(s.clock / 3600)).padStart(2, '0')}:${String(Math.floor(s.clock / 60) % 60).padStart(2, '0')}`;
  const hex = '#' + s.colour.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const view = device && mode === 'realistic' ? device.stats() : null;
  const rows = [
    ['link', k.short],
    ['mode', s.mode + (s.offlineMark ? (s.anchors ? ' (shown on its antenna)' : ' (unplugged mark)') : '')], ['antenna', s.antenna || 'its own ball'], ['target', s.target], ['playing', `${s.playing} (${s.kind})`],
    ['queued', s.pending || '-'], ['fps', s.fps.toFixed(1) + (view ? `, the 3D view ${view.fps.toFixed(0)}` : '')], ['draw_ms', `${slowest.toFixed(2)} on this machine (the board's own is only measured on the board)`],
    ['backlight', `${s.backlight} / 255`], ['colour', `<span class="swatch" style="background:${hex}"></span>${hex}`],
    ['overlay', `working ${s.overlay[0]}, waiting ${s.overlay[1]}, unseen ${s.overlay[2]}`],
    ['clock', clock], ['taps', String(s.taps)], ['clips', s.clips.length ? `${s.clips.length} / 32: ${s.clips.map(c => c.name + (c.tap ? ' (tap)' : '')).join(', ')}` : 'none'],
  ];
  $('readouts').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${k === 'colour' ? v : escape(v)}</dd>`).join('');
  const p = $('problems');
  p.hidden = !s.problems.length;
  p.innerHTML = s.problems.map(t => `<li>${escape(t)}</li>`).join('');
}
const escape = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
if (!CAPTURE) setInterval(readouts, 200);

// for checks driven from outside (emulator/checks/e2e.mjs, emulator/checks/realistic.mjs) and the captures
window.__emu = {
  get board() { return board; },
  get realistic() { return device; },
  state: () => board ? { ...board.state(), linked, page, view: mode, link: linkState(board.state()).short, standIn: !!standIn, hasBridge } : null,
  tap, setMode, ready: () => loadDevice(),
  send(line) { board.receive(line + '\n'); },
  advance(ms) { for (const end = vnow + ms; vnow < end;) { vnow += 2; board.loop(); } },     // ?capture: the board's loop, 2 ms a pass
  still: v => device.still(v),
};

if (CAPTURE) document.body.classList.add('capture');
setMode(CAPTURE ? 'realistic' : params.get('mode') || storedMode() || 'simple', !CAPTURE && !params.get('mode'));
loadArt().then(() => { if (location.protocol.startsWith('http') && !CAPTURE) connect(); else { hasBridge = false; setStatus(); } });
