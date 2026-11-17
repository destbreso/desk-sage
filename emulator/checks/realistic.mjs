// Realistic end to end: the device in 3D with the board's picture on its display, in headless Chromium.
// With the real bridge (emulator mode, Sage's mind): the view loads with no console errors; its display shows the
// board's own pixels, frame after frame; a hook's act plays on it; a click on the device is a tap that reaches the
// bridge, and a drag or a click beside it is not; the link switch cuts it (the countdown, the wait skipped, the board
// offline with its antenna dark) and restores it (the relink and the hello); then the bridge is stopped and the
// antenna goes dark after the board's own minute. From a static server (no bridge): the committed art, the stand-in
// bridge's relink, the Serial box's command list and completion, and the choice of view remembered (or not, when
// storage is blocked). Prints what it measured; with --shots DIR, saves a contact sheet and the captures there.
//
//   node emulator/checks/realistic.mjs [--art firmware/data/sage.bin] [--shots DIR]
// It waits out one real minute of the board's own, so it takes about two and a half minutes.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serveStatic, freePort, waitFor, sleep, sheet } from './browser.mjs';
import { HOST_TIMEOUT_MS, NIGHT_FROM, NIGHT_UNTIL } from '../board.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const opt = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ART = resolve(opt('--art') || join(ROOT, 'firmware', 'data', 'sage.bin'));
const SHOTS = opt('--shots') && resolve(opt('--shots'));
const results = {}, failed = [], shots = [];
const check = (name, ok, detail = {}) => { results[name] = { ok: !!ok, ...detail }; if (!ok) failed.push(name); };
const night = () => { const h = new Date().getHours(); return h >= NIGHT_FROM && h < NIGHT_UNTIL; };   // asleep, it says no hello

// in the page: every change of the antenna, the act and the link, as it happens (polled every 10 ms)
const RECORD = `(() => { window.__rec = []; let last = ''; clearInterval(window.__recT);
  window.__recT = setInterval(() => { const s = window.__emu.state(); if (!s) return; const k = [s.antenna || '-', s.playing, s.mode, s.link.split(',')[0]].join('|');
    if (k !== last) { window.__rec.push({ t: Math.round(performance.now()), k }); last = k; } }, 10); })()`;
// in the page, just after the view has drawn a frame: the display's picture against the board's canvas
const PICTURE = `new Promise(r => requestAnimationFrame(() => {
  const d = window.__emu.realistic, a = d.picture(), b = document.getElementById('lcd').getContext('2d').getImageData(0, 0, 240, 240).data;
  let off = 0, h = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) off++;
  for (let i = 0; i < a.length; i += 12) h = (h * 31 + a[i] + a[i + 1] * 7) | 0;
  r({ off, hash: h, uploads: d.stats().uploads });
}))`;
const PRISM = { x: 0, y: 48, z: 0 };                              // the cube's middle, in the model's millimetres
const near = { az: 16, el: 8, D: 82, target: PRISM };             // near enough to see its antenna

const tmp = mkdtempSync(join(tmpdir(), 'desk-realistic-'));
let page, bridge, web;
const say = (...a) => console.error('-', ...a);

async function deviceShot(label, view) {
  if (view) { await page.ev(`window.__emu.realistic.view(${JSON.stringify(view)})`); await sleep(350); }
  const r = await page.ev(`(() => { document.getElementById('home').style.visibility = 'hidden'; const r = document.getElementById('device').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const png = await page.shot(r);
  await page.ev(`document.getElementById('home').style.visibility = ''`);
  shots.push({ label, png });
  return png;
}
async function pageShot(label, sel) {
  const r = sel ? await page.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`) : null;
  const png = await page.shot(r);
  shots.push({ label, png });
  return png;
}
const state = () => page.ev('window.__emu && window.__emu.state()');
const text = sel => page.ev(`document.querySelector(${JSON.stringify(sel)}).textContent`);
const centre = async sel => page.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const press = async sel => { const c = await centre(sel); await page.click(c.x, c.y); };
const rec = () => page.ev('window.__rec');

try {
  // ---------------- with the real bridge ----------------
  const home = join(tmp, 'home'), port = await freePort(), base = `http://127.0.0.1:${port}`;
  mkdirSync(home);
  bridge = spawn('python3', [join(ROOT, 'tools', 'buddy_bridge.py'), '--emulator', '--port', String(port), '--art', ART], { env: { ...process.env, DESKBUDDY_HOME: home }, stdio: 'ignore' });
  const blog = () => { try { return readFileSync(join(home, 'bridge.log'), 'utf8'); } catch { return ''; } };
  const hook = (event, extra = {}) => {            // posted the way tools/install_hooks.py has Claude Code post it
    const payload = JSON.stringify({ session_id: 'realistic', transcript_path: join(home, 'transcript.jsonl'), cwd: ROOT, permission_mode: 'default', hook_event_name: event, ...extra });
    execFileSync('curl', ['-s', '-m', '1', '-o', '/dev/null', '-H', 'Content-Type: application/json', '--data-binary', '@-', `${base}/hook`], { input: payload });
  };
  await waitFor('the bridge', () => fetch(`${base}/status`).then(r => r.ok, () => false));
  page = await browser({ width: 1180, height: 1000 });
  await page.go(`${base}/emulator/?mode=realistic`);
  await waitFor('the link', async () => { const s = await state(); return s && s.linked && s.mode === 'direct'; }, 20000);
  await waitFor('the 3D view', () => page.ev('!!(window.__emu.realistic && window.__emu.realistic.stats().uploads > 0)'), 30000);
  await waitFor('the mind', () => /mind: ready/.test(blog()), 20000);
  await page.ev(RECORD);
  say('linked; waiting for the boot form to end');
  await waitFor('the boot form to end', async () => (await state()).kind === 'loop', 20000);
  await sleep(1500);

  // the display is the board's picture, and it moves
  const pics = [];
  for (let i = 0; i < 12; i++) { pics.push(await page.ev(PICTURE)); await sleep(170); }
  const a = await deviceShot('three quarters (the default view)');
  await sleep(700);
  const b = await deviceShot('three quarters, 0.7 s later');
  const stats = await page.ev('window.__emu.realistic.stats()');
  check('the display shows the board\'s own pixels, frame after frame', pics.every(p => p.off === 0) && new Set(pics.map(p => p.hash)).size >= 3 && pics.at(-1).uploads > pics[0].uploads && a !== b,
    { pixels_off: Math.max(...pics.map(p => p.off)), distinct_pictures: new Set(pics.map(p => p.hash)).size, uploads: pics.at(-1).uploads - pics[0].uploads, screenshots_differ: a !== b });
  check('the view runs smoothly', stats.fps >= 50, { view_fps: +stats.fps.toFixed(1), board_fps: +(await state()).fps.toFixed(1), pixel_ratio: stats.pixelRatio });
  await deviceShot('from the front', { az: 0, el: 5, D: 150 });
  await deviceShot('from above', { az: 22, el: 52, D: 150 });
  await deviceShot('turning: from the left', { az: -40, el: 12, D: 150 });
  await page.ev('window.__emu.realistic.home()');

  // a hook: the mind's act plays on the device
  say('a push hook');
  const n0 = (await rec()).length;
  hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git push' }, tool_response: { stdout: '' } });
  const act = await waitFor('the push act', async () => { const s = await state(); return s.kind === 'event' && s.playing !== 'glyph_form' ? s.playing : null; }, 15000);
  await sleep(1800);
  const pic = await page.ev(PICTURE);
  await deviceShot(`a push hook: ${act}`, near);
  check('a hook\'s act plays on the device', pic.off === 0, { act, mind: (blog().match(/mind: .*push.*|-> e \S+/g) || []).slice(-2), pixels_off: pic.off, changes: (await rec()).slice(n0).map(r => r.k.split('|')[1]) });
  await waitFor('back to its loop', async () => (await state()).kind === 'loop', 20000);
  await page.ev('window.__emu.realistic.home()');
  await sleep(1000);

  // a click on the device is a tap; a click beside it and a drag are not
  say('taps');
  const taps = () => (blog().match(/board: tap$/gm) || []).length;
  const box = await page.ev(`(() => { const r = document.getElementById('device').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  let t0 = taps();
  await page.click(box.x + 20, box.y + box.h - 20);                  // the desk, beside the stand
  await sleep(1200);
  const besideTaps = taps() - t0;
  t0 = taps();
  const az0 = (await page.ev('window.__emu.realistic.orbit()')).az;
  const p = await page.ev('window.__emu.realistic.screenOf()');
  await page.drag(p.x, p.y, 90, 0);
  await sleep(900);
  const dragTaps = taps() - t0, turned = Math.abs((await page.ev('window.__emu.realistic.orbit()')).az - az0);
  await page.ev('window.__emu.realistic.home()');
  await sleep(400);
  t0 = taps();
  const q = await page.ev('window.__emu.realistic.screenOf()'), clicked = Date.now();
  await page.click(q.x, q.y);
  await waitFor('the tap in the bridge', () => taps() > t0, 5000);
  const tapMs = Date.now() - clicked;
  const answer = await waitFor('its answer', async () => { const s = await state(); return s.kind === 'event' ? s.playing : null; }, 8000).catch(() => null);
  await sleep(1200);
  await deviceShot(`a click on the prism: ${answer || 'no act'}`, near);
  check('a click on the device is a tap that reaches the bridge', taps() - t0 === 1 && besideTaps === 0 && dragTaps === 0 && turned > 5,
    { click_to_bridge_ms: tapMs, answer, beside_taps: besideTaps, drag_taps: dragTaps, drag_turned_degrees: +turned.toFixed(1), mind: (blog().match(/mind: tap.*/g) || []).slice(-1)[0] || null });
  await waitFor('back to its loop', async () => (await state()).kind === 'loop', 25000);
  await sleep(800);
  await page.ev('window.__emu.realistic.view(' + JSON.stringify(near) + ')');

  // the switch: cut, the countdown, the wait skipped, offline; restored, the relink and the hello
  say('the link switch');
  await press('#linkbtn');
  await waitFor('cut', async () => (await state()).link.startsWith('cut here'), 3000);
  await sleep(1200);
  const cutText = await text('#linktext'), cutButton = await text('#linkbtn'), gone = await waitFor('the bridge to see the page go', () => /emulator page 1 gone/.test(blog()), 5000).catch(() => false);
  await pageShot('cut: the countdown, and the skip', '#linkline');
  await pageShot('cut: the page', null);
  let r0 = (await rec()).length;
  await press('#skip');
  await waitFor('offline', async () => (await state()).offline, 3000);
  await waitFor('its antenna dark', async () => (await state()).antenna === 'dark', 20000);
  await sleep(300);
  await deviceShot('cut, skipped: offline, its antenna dark');
  const offSeq = (await rec()).slice(r0).map(r => r.k);
  check('cut: the countdown, then offline with its antenna dark', gone && /\d+ s left/.test(cutText) && cutButton === 'Connect the bridge' && (night() || offSeq.some(k => k.includes('glyph_dissolve'))),
    { line: cutText, button: cutButton, then: [...new Set(offSeq.map(k => k.split('|').slice(0, 2).join(' ')))].slice(0, 8) });
  r0 = (await rec()).length;
  await press('#linkbtn');
  await waitFor('linked again', async () => (await state()).linked, 5000);
  await waitFor('the hello', async () => night() || (await rec()).slice(r0).some(r => r.k.split('|')[1] === 'hello'), 5000).catch(() => null);
  await sleep(400);
  await deviceShot('restored: the relink, then hello');
  const backSeq = (await rec()).slice(r0).map(r => r.k);
  check('restored: the relink and the hello', backSeq.some(k => k.startsWith('relink')) && (night() || backSeq.some(k => k.split('|')[1] === 'hello')),
    { then: [...new Set(backSeq.map(k => k.split('|').slice(0, 2).join(' ')))].slice(0, 8), night: night(), button: await text('#linkbtn') });
  await waitFor('back to its loop', async () => (await state()).kind === 'loop', 20000);

  // the bridge stopped: the board waits its own minute, then goes offline and its antenna dark
  say('the bridge stopped: waiting the board\'s own minute');
  const before = page.errors.slice();
  bridge.kill(); bridge = null;
  const stoppedAt = Date.now();
  await waitFor('the page to notice', async () => !(await state()).linked, 5000);
  await sleep(1500);
  const goneText = await text('#linktext');
  await waitFor('offline', async () => (await state()).offline, HOST_TIMEOUT_MS + 20000, 100);
  const tookMs = Date.now() - stoppedAt;
  await waitFor('its antenna dark', async () => (await state()).antenna === 'dark', 20000);
  await sleep(300);
  await deviceShot('the bridge stopped: its antenna dark');
  check('with the bridge stopped, its antenna goes dark after the board\'s own minute', tookMs >= HOST_TIMEOUT_MS - 16000 && (await state()).antenna === 'dark',
    { seconds_to_offline: +(tookMs / 1000).toFixed(1), line_meanwhile: goneText, chip: await text('#link') });
  // once it is stopped, the page's attempts to reach it again fail, and Chromium logs each
  const after = page.errors.slice(before.length).filter(e => !/ERR_CONNECTION_REFUSED|\/emulator\/(events|board)/.test(e));
  check('no console errors with the bridge', !before.length && !after.length, { errors: before, after_it_stopped: page.errors.length - before.length + ' refused reconnections' });
  await page.close(); page = null;

  // ---------------- from a static server: no bridge ----------------
  say('a static server');
  web = await serveStatic(ROOT);
  page = await browser({ width: 1180, height: 1000 });
  await page.go(`${web.base}/emulator/?mode=realistic`);
  await waitFor('the art', async () => { const s = await state(); return s && s.ok; }, 20000);
  await waitFor('the 3D view', () => page.ev('!!(window.__emu.realistic && window.__emu.realistic.stats().uploads > 0)'), 30000);
  await page.ev(RECORD);
  check('from a static server it plays the committed art', /sage\.bin/.test(await text('#art')) && (await text('#linkbtn')) === 'Connect a stand-in bridge', { art: await text('#art'), chip: await text('#link'), button: await text('#linkbtn') });
  await waitFor('its antenna dark', async () => (await state()).antenna === 'dark', 20000);
  await page.ev('window.__emu.realistic.view(' + JSON.stringify(near) + ')');
  await sleep(400);
  await deviceShot('no bridge: on its own, its antenna dark');
  let s0 = (await rec()).length;
  await press('#linkbtn');
  await waitFor('the stand-in', async () => (await state()).mode === 'direct', 3000);
  await sleep(1200);
  const first = (await rec()).slice(s0).map(r => r.k), standText = await text('#linktext');
  await pageShot('the stand-in bridge on', '#linkline');
  await press('#linkbtn');
  await sleep(500);
  await press('#skip');
  await waitFor('its antenna dark', async () => (await state()).antenna === 'dark', 20000);
  s0 = (await rec()).length;
  await press('#linkbtn');
  await waitFor('the hello', async () => night() || (await rec()).slice(s0).some(r => r.k.split('|')[1] === 'hello'), 5000).catch(() => null);
  await sleep(500);
  await deviceShot('stand-in back: the relink, then hello');
  const second = (await rec()).slice(s0).map(r => r.k);
  check('a stand-in bridge: the relink, and the hello once it had a bridge before', first.some(k => k.startsWith('relink')) && !first.some(k => k.split('|')[1] === 'hello') && second.some(k => k.startsWith('relink')) && (night() || second.some(k => k.split('|')[1] === 'hello')),
    { first: [...new Set(first.map(k => k.split('|').slice(0, 2).join(' ')))].slice(0, 5), again: [...new Set(second.map(k => k.split('|').slice(0, 2).join(' ')))].slice(0, 5), line: standText });

  // the Serial box: the whole list, an example into the box, completion from the art
  say('the Serial box');
  await press('#commands');
  await sleep(200);
  await pageShot('Serial: every command', 'section:nth-of-type(2)');
  await press('#help-list button[data-ex="e tap"]');
  const example = await page.ev(`document.getElementById('line').value`);
  await press('#commands');
  await page.ev(`(() => { const i = document.getElementById('line'); i.value = ''; i.focus(); })()`);
  await page.type('e ho');
  await sleep(150);
  const offered = await page.ev(`[...document.querySelectorAll('#suggest li[data-i]')].map(li => li.firstChild.textContent)`);
  await page.key('ArrowDown'); await page.key('ArrowDown');
  await pageShot('Serial: completing an act', 'section:nth-of-type(2)');
  await page.key('Enter', 'Enter', '\r');
  const picked = await page.ev(`document.getElementById('line').value`);
  await page.key('Enter', 'Enter', '\r');
  await sleep(300);
  const sent = await state();
  await page.type('s ');
  await sleep(100);
  const moods = await page.ev(`[...document.querySelectorAll('#suggest li[data-i]')].map(li => li.firstChild.textContent)`);
  await page.key('Escape');
  const closed = await page.ev(`document.getElementById('suggest').hidden`);
  const artMoods = await page.ev('window.__emu.board.A.moodName.slice(0, window.__emu.board.A.nMoods)');
  check('the Serial box lists the commands and completes them from the art', example === 'e tap' && offered.length > 0 && offered.every(o => o.includes('ho')) && picked === 'e ' + offered[1] && [sent.playing, sent.pending].includes(offered[1]) && artMoods.every(m => moods.includes(m)) && closed,
    { example, offered, picked, then_playing: sent.pending || sent.playing, moods, escape_closes: closed });
  await page.ev(`document.getElementById('line').value = ''`);

  // the choice of view, remembered between visits; Simple when storage is blocked
  say('the view remembered');
  await press('.modes button[data-mode="simple"]');
  await page.go(`${web.base}/emulator/`);
  await waitFor('the page', async () => (await state())?.ok, 20000);
  const afterSimple = (await state()).view;
  await sleep(1500);
  await pageShot('Simple (the board from the front), same board', null);
  await press('.modes button[data-mode="realistic"]');
  await page.go(`${web.base}/emulator/`);
  await waitFor('the page', async () => (await state())?.ok, 20000);
  const afterRealistic = (await state()).view;
  await waitFor('the 3D view', () => page.ev('!!(window.__emu.realistic && window.__emu.realistic.stats().uploads > 0)'), 30000);
  await sleep(1500);
  await pageShot('Realistic, remembered', null);
  const staticErrors = page.errors.filter(e => !/404/.test(e) || !/\/emulator\/(art\.bin|events)/.test(e));
  check('no console errors from a static server (but its 404s for art.bin and events, where it looks for the bridge)', !staticErrors.length, { errors: page.errors.slice() });
  await page.close(); page = null;

  // storage blocked: Simple, and the page works
  page = await browser({ width: 1180, height: 1000 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });" });
  await page.go(`${web.base}/emulator/`);
  await waitFor('the page', async () => (await state())?.ok, 20000);
  const blockedFirst = (await state()).view;
  await press('.modes button[data-mode="realistic"]');
  await waitFor('the 3D view', () => page.ev('!!(window.__emu.realistic && window.__emu.realistic.stats().uploads > 0)'), 30000);
  const blockedErrors = page.errors.filter(e => !/404/.test(e) || !/\/emulator\/(art\.bin|events)/.test(e));
  check('with storage blocked it opens in Simple and still switches', blockedFirst === 'simple' && (await state()).view === 'realistic' && !blockedErrors.length, { first: blockedFirst, errors: blockedErrors });
  await page.close(); page = null;

  page = await browser({ width: 390, height: 844 });
  await page.go(`${web.base}/emulator/?mode=realistic`);
  await waitFor('the page', async () => (await state())?.ok, 20000);
  await waitFor('the 3D view', () => page.ev('!!(window.__emu.realistic && window.__emu.realistic.stats().uploads > 0)'), 30000);
  await sleep(1200);
  const overflow = await page.ev('document.documentElement.scrollWidth - innerWidth');
  await pageShot('a phone, 390 wide', null);
  check('a phone: no sideways scroll', overflow <= 0, { overflow });
  check('the choice is remembered between visits', afterSimple === 'simple' && afterRealistic === 'realistic', { after_simple: afterSimple, after_realistic: afterRealistic });
  await page.close(); page = null;

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    for (const [i, s] of shots.entries()) writeFileSync(join(SHOTS, `${String(i + 1).padStart(2, '0')}-${s.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')}.png`), Buffer.from(s.png, 'base64'));
    const tiles = shots.filter(s => !/the page|Simple|Realistic, rem|phone|Serial|countdown|stand-in bridge on/.test(s.label));
    page = await browser({ width: 400, height: 300 });                // the sheet is drawn on a blank page
    writeFileSync(join(SHOTS, 'sheet.png'), await sheet(page.ev, tiles, { tile: 300, cols: 4 }));
    results.shots = SHOTS;
  }
} catch (e) {
  failed.push(String(e.message || e));
} finally {
  if (page) await page.close();
  if (bridge) bridge.kill();
  if (web) await web.close();
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify({ results, failed }, null, 1));
process.exit(failed.length ? 1 : 0);
