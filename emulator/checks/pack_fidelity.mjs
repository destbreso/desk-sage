// Does the emulator inflate what the board inflates? Every compressed frame of a .bin (version 7) is inflated cold by
// the emulator (packed.mjs with Node's zlib), by the page's way of doing it (prepare(), with DecompressionStream as
// Node has it), and by tools/pack_check.cpp, which builds the firmware's own packed.h with the tinfl of the board's ROM
// (tools/tinfl.h, miniz 1.15). They must agree byte for byte, and on which frames they refuse. With --time, also the
// native inflate times (this machine's, not the board's).
//
//   node emulator/checks/pack_fidelity.mjs file.bin [--time]

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameTable, unpack, prepare, prepared } from '../packed.mjs';
import { inflate } from '../inflate-node.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function buildPackCheck() {
  const src = join(ROOT, 'tools', 'pack_check.cpp'), hdr = join(ROOT, 'firmware', 'src', 'packed.h'), tinfl = join(ROOT, 'tools', 'tinfl.h');
  const exe = join(tmpdir(), 'desk_sage_pack_check');
  if (!existsSync(exe) || statSync(exe).mtimeMs < Math.max(...[src, hdr, tinfl].map(p => statSync(p).mtimeMs)))
    execFileSync('clang++', ['-O2', '-std=c++17', '-I', dirname(hdr), '-I', dirname(tinfl), src, '-o', exe]);
  return exe;
}

function feed(buf) {
  const T = frameTable(buf), head = Buffer.alloc(16);
  head.writeUInt32LE(T.nFrames, 0); head.writeUInt32LE(T.offsets, 4); head.writeUInt32LE(T.data, 8); head.writeUInt32LE(buf.length, 12);
  return Buffer.concat([head, Buffer.from(buf)]);
}

// What the board's code inflates: frame index -> its bytes, or null where it refuses.
export function native(buf, exe = buildPackCheck()) {
  const out = execFileSync(exe, { input: feed(buf), maxBuffer: 1 << 28 }), got = new Map();
  for (let p = 0; p < out.length;) {
    const f = out.readUInt32LE(p), size = out.readUInt32LE(p + 4); p += 8;
    if (size >= 0xFFFFFFFE) { got.set(f, null); continue; }
    got.set(f, out.subarray(p, p + size)); p += size;
  }
  return got;
}

export function timing(buf, exe = buildPackCheck()) {
  return execFileSync(exe, ['--time'], { input: feed(buf), maxBuffer: 1 << 26 }).toString().trim().split('\n').filter(Boolean).map(line => {
    const [frame, kind, size, base, cold, warm] = line.split(' ').map(Number);
    return { frame, kind, size, base, cold, warm };
  });
}

const same = (a, b) => a === null ? b === null : b !== null && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

export async function compare(buf, exe = buildPackCheck()) {
  const board = native(buf, exe), emulator = unpack(buf, inflate);
  await prepare(buf);
  const page = unpack(buf, prepared), bytes = fr => fr ? fr.buf.subarray(fr.p, fr.end) : null;
  const rows = [...board].map(([f, b]) => ({ frame: f, board: b, emulator: bytes(emulator[f]), page: bytes(page[f]) }));
  return {
    compressed: rows.length, refused: rows.filter(r => r.board === null).length,
    emulator: { identical: rows.filter(r => same(r.board, r.emulator)).length, disagree: rows.filter(r => !same(r.board, r.emulator)).map(r => r.frame) },
    page: { identical: rows.filter(r => same(r.board, r.page)).length, disagree: rows.filter(r => !same(r.board, r.page)).map(r => r.frame) },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node emulator/checks/pack_fidelity.mjs file.bin [--time]'); process.exit(2); }
  const buf = new Uint8Array(readFileSync(file)), r = await compare(buf);
  if (process.argv.includes('--time')) {
    const t = timing(buf), worst = k => t.reduce((a, b) => b[k] > a[k] ? b : a, t[0]);
    const sum = k => t.reduce((a, b) => a + b[k], 0);
    r.time_ns = t.length ? { worstCold: worst('cold'), worstWarm: worst('warm'), medianWarm: t.map(x => x.warm).sort((a, b) => a - b)[t.length >> 1],
                             bytesPerSecondWarm: Math.round(t.reduce((a, b) => a + b.size, 0) / sum('warm') * 1e9) } : null;
  }
  console.log(JSON.stringify({ file, ...r }, null, 1));
  process.exit(r.emulator.disagree.length || r.page.disagree.length || r.refused ? 1 : 0);
}
