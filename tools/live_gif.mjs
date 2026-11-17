// The README's live device: the emulator's Realistic view, the device slowly turning with Sage alive in the prism,
// as one GIF. The page runs in its capture mode (?capture): the board's clock steps only when told, so every frame
// of the GIF is the board's own picture at that moment, drawn on the 3D device, one frame at a time. The board is
// told what a bridge would tell it (its heartbeat, so its antenna is lit, and two acts), never drawn by hand.
//
//   node tools/live_gif.mjs [out.gif] [sage.bin]
//   (defaults: gallery/hardware/live.gif, firmware/data/sage.bin; needs ffmpeg and Chromium, see emulator/checks/browser.mjs)

import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serveStatic, waitFor } from '../emulator/checks/browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [out = join(ROOT, 'gallery', 'hardware', 'live.gif'), art = join(ROOT, 'firmware', 'data', 'sage.bin')] = process.argv.slice(2);
const SIZE = 400, FPS = 12, SECONDS = 10, COLOURS = 72;          // under 1.5 MB: no dither, few colours, no desk grid
// what the board is told, at which second of the GIF: idle, a knock, idle, hearts, idle again so the loop closes
const SCRIPT = [[0, 'h 43200'], [0, 's idle'], [0.8, 'e tap_knock'], [5.6, 'e done_hearts']];
// the camera: a slow swing either side of the front, once in the GIF's length, so the loop has no seam; wider, the
// cube's edge would cut Sage's reflection, as it does on the real prism
const view = t => ({ az: 8 + 20 * Math.sin(2 * Math.PI * t / SECONDS), el: 11 - 3 * Math.cos(2 * Math.PI * t / SECONDS), D: 118, target: { x: 0, y: 41, z: -1 } });

const web = await serveStatic(ROOT);
const page = await browser({ width: SIZE, height: SIZE });
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-vf', `split[a][b];[a]palettegen=max_colors=${COLOURS}:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0', out], { stdio: ['pipe', 'inherit', 'inherit'] });
try {
  await page.go(`${web.base}/emulator/?capture&art=${encodeURIComponent('/' + relative(ROOT, art))}`);
  await waitFor('the board and the 3D view', () => page.ev('!!(window.__emu && window.__emu.board && window.__emu.board.A.ok && window.__emu.realistic)'), 30000);
  // boot: it forms out of the rain; let that end in its idle loop before the GIF starts
  await page.ev(`(() => { window.__emu.send('h 43200'); window.__emu.advance(6000); })()`);
  const steps = SCRIPT.slice();
  for (let f = 0; f < FPS * SECONDS; f++) {
    const t = f / FPS;
    while (steps.length && steps[0][0] <= t) await page.ev(`window.__emu.send(${JSON.stringify(steps.shift()[1])})`);
    await page.ev(`(() => { window.__emu.advance(${1000 / FPS}); window.__emu.still(${JSON.stringify(view(t))}); })()`);
    const png = Buffer.from(await page.shot(), 'base64');
    if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  const code = await new Promise(r => ff.on('close', r));
  console.log(JSON.stringify({ out, frames: FPS * SECONDS, seconds: SECONDS, bytes: statSync(out).size, ffmpeg: code, errors: page.errors.filter(e => !/404.*\/emulator\/art\.bin|events/.test(e)) }));
} finally {
  await page.close();
  await web.close();
}
