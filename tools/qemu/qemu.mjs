// What tools/qemu/check.mjs and tools/qemu/bridge.mjs share: QEMU started through run.sh, its UART0 as lines, its
// control protocol (QMP), and a screendump of the virtual panel set against the emulator's board drawing the same art.

import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Board } from '../../emulator/board.mjs';
import { W, H } from '../../emulator/vec.mjs';
import { inflate } from '../../emulator/inflate-node.mjs';
import * as antenna from '../../emulator/antenna.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUN = join(ROOT, 'tools', 'qemu', 'run.sh');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
export async function waitFor(what, fn, ms = 15000, every = 25) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  throw new Error('timed out waiting for ' + what);
}
async function connect(port, ms = 20000) {
  return waitFor(`127.0.0.1:${port}`, () => new Promise((res) => {
    const s = createConnection({ host: '127.0.0.1', port }, () => res(s));
    s.on('error', () => res(null));
  }), ms, 100);
}

// The emulated chip. UART0 on TCP (`serial`) or a pty (`pty`, whose path is in `.pty`), QMP always on TCP.
export class Qemu {
  static async start({ pty = false } = {}) {
    const q = new Qemu(), qmpPort = await freePort(), serialPort = pty ? 0 : await freePort();
    const args = ['--no-build', '--snapshot', '--qmp', String(qmpPort), ...(pty ? ['--serial', 'pty'] : ['--serial', `tcp:${serialPort}`, '--wait'])];
    q.proc = spawn(RUN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    q.said = '';                                  // what QEMU prints (the pty's path, warnings)
    q.proc.stderr.on('data', (d) => { q.said += d; });
    q.proc.stdout.on('data', (d) => { q.said += d; });
    q.exited = new Promise((r) => q.proc.on('exit', r));
    if (pty) q.pty = await waitFor('the pty', () => (q.said.match(/redirected to (\/dev\/\S+)/) || [])[1]);
    else q.attach(await connect(serialPort));
    q.qmpSock = await connect(qmpPort);
    q.qmpBuf = ''; q.qmpN = 0; q.qmpWait = new Map(); q.qmpGreeting = null;
    q.qmpSock.on('data', (d) => {
      q.qmpBuf += d;
      let i;
      while ((i = q.qmpBuf.indexOf('\n')) >= 0) {
        const m = JSON.parse(q.qmpBuf.slice(0, i)); q.qmpBuf = q.qmpBuf.slice(i + 1);
        if (m.QMP) q.qmpGreeting = m;
        else if (m.id !== undefined && q.qmpWait.has(m.id)) { const w = q.qmpWait.get(m.id); q.qmpWait.delete(m.id); m.error ? w.reject(new Error(m.error.desc)) : w.resolve(m.return); }
      }
    });
    await waitFor('QMP', () => q.qmpGreeting);
    await q.qmp('qmp_capabilities');
    return q;
  }

  // UART0 as lines, each with when it came (ms since this process started)
  attach(sock) {
    this.sock = sock; this.lines = [];
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        this.lines.push({ t: performance.now(), line });
      }
    });
  }
  send(line) { this.sock.write(line + '\n'); }
  async waitLine(re, { from = 0, ms = 10000 } = {}) {
    return waitFor(String(re), () => this.lines.slice(from).find((l) => re.test(l.line)), ms, 10);
  }
  // a command and the line that answers it
  async ask(cmd, re = /^(ok|err)\b/, ms = 5000) {
    const from = this.lines.length;
    this.send(cmd);
    return (await this.waitLine(re, { from, ms })).line;
  }
  qmp(execute, args) {
    const id = ++this.qmpN;
    this.qmpSock.write(JSON.stringify({ execute, ...(args ? { arguments: args } : {}), id }) + '\n');
    return new Promise((resolve, reject) => this.qmpWait.set(id, { resolve, reject }));
  }
  // the panel as RGB565, read while the chip is stopped so it is one whole frame
  async screendump(file) {
    await this.qmp('screendump', { filename: file });
    return ppm565(readFileSync(file));
  }
  async kill() {
    try { this.sock && this.sock.destroy(); this.qmpSock && this.qmpSock.destroy(); } catch {}
    this.proc.kill('SIGTERM');
    await Promise.race([this.exited, sleep(3000)]);
    if (this.proc.exitCode === null) { this.proc.kill('SIGKILL'); await this.exited; }
  }
}

// A P6 PPM from QEMU (its 16-bit surface widened to 8 bits a channel) back to RGB565
export function ppm565(buf) {
  let p = 0, fields = [];
  while (fields.length < 4) {
    while (/\s/.test(String.fromCharCode(buf[p]))) p++;
    let s = p; while (!/\s/.test(String.fromCharCode(buf[p]))) p++;
    fields.push(buf.toString('latin1', s, p));
  }
  p++;
  const [magic, w, h] = [fields[0], +fields[1], +fields[2]];
  if (magic !== 'P6' || w !== W || h !== H) throw new Error(`screendump is ${magic} ${w}x${h}, not P6 ${W}x${H}`);
  const out = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = ((buf[p + 3 * i] >> 3) << 11) | ((buf[p + 3 * i + 1] >> 2) << 5) | (buf[p + 3 * i + 2] >> 3);
  return out;
}

// RGB565 widened as the fidelity checks widen it (tools/vec_check.cpp)
const r8 = (v) => ((v >> 11) << 3) | (v >> 13), g8 = (v) => (((v >> 5) & 63) << 2) | ((v >> 9) & 3), b8 = (v) => ((v & 31) << 3) | ((v >> 2) & 7);
// the bake's measure: the mean of each pixel's largest channel difference, as % of full scale, and the pixels off by
// more than a quarter (tools/export_frames.py MAX_MEAN, MAX_FAR); also how many pixels differ at all, and the most
export const MAX_MEAN = 2.0, MAX_FAR = 300;
export function diff(a, b, region) {
  let sum = 0, far = 0, n = 0, differ = 0, most = 0;
  const [x0, y0, x1, y1] = region || [0, 0, W, H];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * W + x, u = a[i], v = b[i];
    n++;
    if (u === v) continue;
    const d = Math.max(Math.abs(r8(u) - r8(v)), Math.abs(g8(u) - g8(v)), Math.abs(b8(u) - b8(v)));
    sum += d; far += d > 64; differ++; most = Math.max(most, d);
  }
  return { mean: +(sum / n / 2.55).toFixed(3), far, differ, most };
}
export const within = (d) => d.mean <= MAX_MEAN && d.far <= MAX_FAR;

// The art as the emulator's board draws it (emulator/board.mjs, the firmware's code line for line)
export class Reference {
  constructor(file = join(ROOT, 'firmware', 'data', 'sage.bin')) {
    const art = new Uint8Array(readFileSync(file));
    this.board = new Board({ inflate });
    if (!this.board.parseArt(art, art.length, 0)) throw new Error(`${file}: the emulator's parser refused it`);
    const A = this.A = this.board.A;
    this.seqOf = {};
    for (let i = 0; i < A.nSeqs; i++) this.seqOf[A.name[i]] = i;
    this.moods = A.moodName.slice(0, A.nMoods);
  }
  frames(name) {
    const A = this.A, i = this.seqOf[name];
    if (i === undefined) throw new Error(`the art has no sequence ${name}`);
    return Array.from({ length: A.len[i] }, (_, k) => A.seqBuf[i][A.seq[i] + 2 * k] | (A.seqBuf[i][A.seq[i] + 2 * k + 1] << 8));
  }
  // frame idx with the antenna at `step` (antennaStep's numbering: -1 none, 0 dark, 1 + k a ring, -2 - k the relink)
  draw(idx, step = -1) {
    const b = this.board;
    b.drawFrame(0, idx);
    b.drawAntenna(step);
    return Uint16Array.from(b.fb);
  }
  // The frame of these sequences (with one of these antenna steps) closest to `pic`: the best, the closest that
  // looks different from it (an animation repeats frames), and the best with no antenna drawn.
  match(pic, names, steps = [-1]) {
    const seen = new Map();
    for (const name of [].concat(names)) this.frames(name).forEach((idx, k) => { if (!seen.has(idx)) seen.set(idx, { name, k, idx }); });
    const all = [];
    for (const c of seen.values()) for (const s of new Set([-1, ...steps])) all.push({ ...c, step: s, ...diff(pic, this.draw(c.idx, s)) });
    all.sort((a, b) => a.mean - b.mean || a.far - b.far || a.differ - b.differ);
    const ok = all.filter((c) => steps.includes(c.step)), best = ok[0], ref = this.draw(best.idx, best.step);
    const other = ok.find((c) => { return diff(ref, this.draw(c.idx, c.step)).differ > 0; });
    return { best, other, plain: all.find((c) => c.step === -1), ref };
  }
}
export const OFFLINE_STEPS = [0, ...Array.from({ length: antenna.RING }, (_, k) => 1 + k)];
export const RELINK_STEPS = Array.from({ length: antenna.RELINK }, (_, k) => -2 - k);

// A contact sheet: one row a moment, QEMU's panel beside the emulator's frame and their difference (x4)
export function sheet(file, rows) {
  const cols = 3, gap = 4, w = cols * W + (cols + 1) * gap, h = rows.length * (H + gap) + gap;
  const px = Buffer.alloc(w * h * 3, 24);
  const put = (x0, y0, pic, f) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = ((y0 + y) * w + x0 + x) * 3, c = f(y * W + x); px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; } };
  rows.forEach(({ qemu, ref }, r) => {
    const y0 = gap + r * (H + gap);
    put(gap, y0, qemu, (i) => [r8(qemu[i]), g8(qemu[i]), b8(qemu[i])]);
    put(2 * gap + W, y0, ref, (i) => [r8(ref[i]), g8(ref[i]), b8(ref[i])]);
    put(3 * gap + 2 * W, y0, null, (i) => { const d = Math.min(255, 4 * Math.max(Math.abs(r8(qemu[i]) - r8(ref[i])), Math.abs(g8(qemu[i]) - g8(ref[i])), Math.abs(b8(qemu[i]) - b8(ref[i])))); return [d, d, d]; });
  });
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
