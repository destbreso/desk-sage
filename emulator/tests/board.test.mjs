// The board's logic on a fake clock: parsing, the state graph and its routes, what it does on its
// own over time, taps, clips, colour, the corner marks and the backlight.
//   cd emulator && node --test

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Board, ESCALATE_MS, LONGHAUL_MS, HOST_TIMEOUT_MS, BL_NIGHT, MAX_SRC } from '../board.mjs';
import { encode, solid, solidOps, clip, sageLike } from './fixture.mjs';
import { inflate } from '../inflate-node.mjs';

const TESTCARD = new Uint8Array(readFileSync(new URL('../testcard/testcard.bin', import.meta.url)));

function make(art = TESTCARD, { random = () => 0, draw = true } = {}) {
  const clock = { t: 0 }, said = [];
  const b = new Board({ millis: () => clock.t, micros: () => clock.t * 1000, random, say: l => said.push(l), inflate });
  if (!draw) { b.drawFrame = () => {}; b.drawOverlay = () => {}; }      // long runs only need the logic
  b.setup(art);
  const run = (ms, step = 4) => { for (let i = 0; i < ms; i += step) { clock.t += step; b.loop(); } };
  const cmd = line => { b.receive(line + '\n'); run(4); };
  const bridged = (ms, step = 20) => {                         // time passing with the bridge's heartbeat every 15 s
    for (let left = ms; left > 0; left -= 15000) { cmd('h 43200'); run(Math.min(15000, left), step); }
  };
  const playing = () => { const s = b.state(); return `${s.playing}(${s.kind})`; };
  return { b, clock, said, run, cmd, bridged, playing };
}

// the sequence names a run goes through, in order, sampled every few milliseconds
function trace(m, ms) {
  const seen = [];
  for (let i = 0; i < ms; i += 4) { m.run(4); const p = m.b.state().playing; if (seen.at(-1) !== p) seen.push(p); }
  return seen;
}

describe('parsing', () => {
  test('the test card: its moods, bases, sequences and frames', () => {
    const { b } = make();
    const A = b.A;
    assert.equal(A.ok, true);
    assert.deepEqual(A.moodName.slice(0, A.nMoods), ['idle', 'working', 'alert', 'waiting', 'done', 'longhaul', 'night', 'meeting', 'awake', 'letter']);
    assert.equal(A.moodName[A.base[b.moodIndex('waiting')]], 'alert');
    assert.equal(A.moodName[A.base[b.moodIndex('longhaul')]], 'working');
    assert.equal(A.nFrames, 787);
    assert.equal(A.nSeqs, 149);
    assert.equal(A.fps, 24);
    const bases = [...Array(A.nMoods).keys()].filter(m => A.base[m] === m);
    for (const a of bases) for (const c of bases) if (a !== c) assert.ok(A.transOf[a][c] >= 0, `${A.moodName[a]} to ${A.moodName[c]}`);
  });

  const small = () => encode({ moods: [['idle', 0], ['working', 1]], seqs: [[0, 0, 0, 'idle', [0, 1]], [0, 1, 1, 'working', [1]], [1, 0, 1, 'idle_to_working', [0]]], frames: [solid(0x001F), solidOps(255, 0, 0)] });

  test('every truncation fails cleanly, never throws', () => {
    const full = small();
    assert.equal(new Board().parseArt(full, full.length, 0), true);
    for (let n = 0; n < full.length; n++) assert.equal(new Board().parseArt(full.subarray(0, n), n, 0), false, `cut at ${n}`);
  });

  test('wrong magic or version is refused; version 4 has a one-byte sequence count', () => {
    const bad = small(); bad[0] = 0x58;
    assert.equal(new Board().parseArt(bad, bad.length, 0), false);
    for (const magic of ['SAGE', 'LUMP']) { const art = sageLike({ magic }); assert.equal(new Board().parseArt(art, art.length, 0), true, magic); }
    for (const v of [2, 8]) { const x = small(); x[4] = v; assert.equal(new Board().parseArt(x, x.length, 0), false, `version ${v}`); }
    const v4 = encode({ version: 4, moods: [['idle', 0]], seqs: [[0, 0, 0, 'idle', [0]]], frames: [solid(0)] });
    assert.equal(new Board().parseArt(v4, v4.length, 0), true);
  });

  test('a frame index past the end, or a mood with no loop, is refused', () => {
    const past = encode({ moods: [['idle', 0]], seqs: [[0, 0, 0, 'idle', [3]]], frames: [solid(0)] });
    assert.equal(new Board().parseArt(past, past.length, 0), false);
    const loopless = encode({ moods: [['idle', 0], ['working', 1]], seqs: [[0, 0, 0, 'idle', [0]]], frames: [solid(0)] });
    assert.equal(new Board().parseArt(loopless, loopless.length, 0), false);
  });
});

describe('the state graph', () => {
  test('a new mood plays its drawn transition, then loops', () => {
    const m = make(); m.cmd('h 43200');
    m.cmd('s working');
    assert.equal(m.playing(), 'idle_to_working(transition)');
    m.run(8 * 1000 / 24 + 10);
    assert.equal(m.playing(), 'working(loop)');
  });

  test('a target waits for the transition under way, then routes on', () => {
    const m = make(); m.cmd('h 43200');
    m.cmd('s working');
    m.run(100); m.cmd('s done');
    assert.equal(m.playing(), 'idle_to_working(transition)');
    assert.deepEqual(trace(m, 1000), ['idle_to_working', 'working_to_done', 'done']);
  });

  test('routes through base moods, as nextHop does', () => {
    const m = make(); m.cmd('h 43200');
    m.b.receive('s waiting\n');
    assert.deepEqual(trace(m, 1000), ['idle_to_alert', 'alert_to_waiting', 'waiting']);
    m.b.receive('s done\n');
    assert.deepEqual(trace(m, 1000), ['waiting_to_alert', 'alert_to_done', 'done']);
  });

  test('re-asserting the base of a mood the board escalated to is a no-op', () => {
    const m = make(); m.cmd('h 43200');
    m.cmd('s waiting'); m.run(1000);
    m.cmd('s alert');
    assert.equal(m.playing(), 'waiting(loop)');
  });

  test('with no transition drawn the board cuts, and the emulator says so', () => {
    const art = encode({ moods: [['idle', 0], ['working', 1]], seqs: [[0, 0, 0, 'idle', [0]], [0, 1, 1, 'working', [1]]], frames: [solid(0x001F), solid(0xF800)] });
    const m = make(art); m.cmd('h 43200');
    m.cmd('s working');
    assert.equal(m.playing(), 'working(loop)');
    assert.match(m.b.problems[0], /no transition drawn from idle toward working/);
  });

  test('an act queued for a mood the board never settled in plays the one drawn for the mood it lands in', () => {
    const m = make(); m.cmd('h 43200');
    m.cmd('s working');                                        // under way: idle_to_working
    m.cmd('e tap');                                            // the board's choice for working: tap_shock_working, queued
    assert.equal(m.b.state().pending, 'tap_shock_working');
    m.cmd('s done');
    assert.ok(trace(m, 2000).includes('tap_shock_done'));
  });

  test('an event walks to its home mood first and stays there', () => {
    const m = make(); m.cmd('h 43200');
    m.cmd('e oops');
    assert.deepEqual(trace(m, 2000), ['idle_to_working', 'oops', 'working']);
    assert.equal(m.b.state().target, 'working');
  });
});

describe('on its own, over time', () => {
  test('alert turns into waiting after 45 s in the loop, not before', () => {
    const m = make(TESTCARD, { draw: false }); m.cmd('h 43200');
    m.cmd('s alert'); m.run(500);
    const settled = m.b.loopSince;
    m.run(settled + ESCALATE_MS - m.clock.t - 20, 20);
    assert.equal(m.b.state().target, 'alert');
    m.run(60, 20);
    assert.equal(m.b.state().target, 'waiting');
  });

  test('working turns into longhaul after 10 minutes', () => {
    const m = make(TESTCARD, { draw: false }); m.cmd('h 43200');
    m.cmd('s working'); m.run(500);
    m.bridged(LONGHAUL_MS - 1000);
    assert.equal(m.b.state().target, 'working');
    m.bridged(2000);
    assert.equal(m.b.state().target, 'longhaul');
  });

  test('a minute without the bridge: offline, idle, the corner marks and the colour forgotten', () => {
    const m = make(TESTCARD, { draw: false }); m.cmd('h 43200');
    m.cmd('s working'); m.cmd('o 2 1 1'); m.cmd('c 3D8BFF'); m.run(1000);
    m.run(HOST_TIMEOUT_MS - 1200, 20);
    assert.equal(m.b.state().mode, 'direct');
    m.run(400, 20);
    const s = m.b.state();
    assert.equal(s.mode, 'offline');
    assert.equal(s.target, 'idle');
    assert.deepEqual(s.overlay, [0, 0, 0]);
    assert.deepEqual([m.b.goalR, m.b.goalG, m.b.goalB], [255, 122, 69]);
    m.cmd('?');
    assert.ok(m.said.includes('resync'));                      // the bridge is told to resend
  });

  test("offline at night by the bridge's clock: night", () => {
    const m = make(TESTCARD, { draw: false });
    m.cmd('h 7100');                                           // 01:58
    m.run(HOST_TIMEOUT_MS + 2000, 20);
    assert.equal(m.b.state().target, 'night');
  });

  test('offline in idle it fidgets every 40 to 90 s; with the bridge there it leaves that to the bridge', () => {
    const m = make(TESTCARD, { draw: false });
    m.run(40500, 20);
    assert.equal(m.b.state().playing, 'fidget_toss');          // random() = 0: the first fidget, at 40 s
    const n = make(TESTCARD, { draw: false });
    for (let i = 0; i < 8; i++) { n.cmd('h 43200'); n.run(15000, 20); assert.equal(n.b.state().kind, 'loop'); }
  });

  test('the unplugged mark shows only 8 s after boot', () => {
    const m = make(TESTCARD, { draw: false });
    m.run(7900, 20); assert.equal(m.b.state().offlineMark, false);
    m.run(200, 20); assert.equal(m.b.state().offlineMark, true);
  });
});

describe('taps', () => {
  test('with the bridge there a knock is only said; offline the board answers it with a tap of the art', () => {
    const m = make(sageLike()); m.cmd('h 43200'); m.run(5000);
    m.b.sample(1.0); m.run(100);
    assert.equal(m.said.at(-1), 'tap');
    assert.equal(m.b.state().kind, 'loop');                    // nothing plays: the bridge's mind chooses
    const off = make(sageLike()); off.run(5000);               // never heard from the bridge
    off.b.sample(1.0); off.run(4);
    assert.equal(off.said.at(-1), 'tap');
    assert.equal(off.playing(), 'tap_hello(event)');
  });

  test('a second knock within 600 ms is the same tap: the board has no double tap', () => {
    const m = make(); m.cmd('h 43200'); m.clock.t = 1000;
    m.b.sample(1.0); m.run(250); m.b.sample(1.0); m.run(4);
    assert.equal(m.said.filter(l => l === 'tap').length, 1);
    m.run(400); m.b.sample(1.0); m.run(4);
    assert.equal(m.said.filter(l => l === 'tap').length, 2);
  });

  test('its own taps: any tap_* act but tap_dizzy, never the same twice running', () => {
    let seed = 7;
    const random = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const m = make(sageLike({ acts: ['tap_hello', 'tap_knock', 'tap_dizzy'] }), { random }); m.run(5000);
    const taps = [];
    for (let i = 0; i < 40; i++) { m.b.sample(1.0); m.run(4); taps.push(m.b.state().playing); m.run(1600); }
    assert.deepEqual(new Set(taps), new Set(['tap_hello', 'tap_knock']));
    for (let i = 1; i < taps.length; i++) assert.notEqual(taps[i], taps[i - 1], `tap ${i}`);
  });

  test('with one tap act it plays that one every time; with none, a knock plays nothing', () => {
    const one = make(sageLike({ acts: ['tap_hello', 'tap_dizzy'] })); one.run(5000);
    for (let i = 0; i < 3; i++) { one.b.sample(1.0); one.run(4); assert.equal(one.playing(), 'tap_hello(event)'); one.run(1600); }
    const none = make(sageLike({ acts: ['tap_dizzy', 'fidget_look'] })); none.run(5000);
    none.b.sample(1.0); none.run(4);
    assert.equal(none.b.state().kind, 'loop');
    none.cmd('e tap'); assert.equal(none.said.at(-1), 'err unknown event');
  });

  test('e tap and e fidget are the board\'s choice; it prefers the acts drawn for its mood', () => {
    const m = make(); m.cmd('h 43200');
    m.cmd('e fidget'); assert.equal(m.b.state().playing, 'fidget_toss');
    m.run(3000);
    m.cmd('s night'); m.run(1000);
    m.cmd('e tap'); assert.equal(m.b.state().pending ?? m.b.state().playing, 'tap_startle_night');
    m.run(3000);
    m.cmd('s meeting'); m.run(2000);
    m.cmd('e tap'); assert.equal(m.b.state().pending ?? m.b.state().playing, 'tap_prep_meeting');
  });

  test('a clip sent as a tap reaction is in the running for a tap', () => {
    const m = make(sageLike({ acts: ['tap_hello'] })); m.run(5000);
    m.b.postClip(clip('wobble'), 'wobble', true);
    const seen = new Set();
    for (let i = 0; i < 4; i++) { m.b.sample(1.0); m.run(4); seen.add(m.b.state().playing); m.run(1600); }
    assert.deepEqual(seen, new Set(['tap_hello', 'wobble']));
  });

  test('a knock under the threshold is no tap', () => {
    const m = make(); m.cmd('h 43200'); m.cmd('T 2'); m.clock.t = 1000;
    m.b.sample(1.0); m.run(4);
    assert.ok(!m.said.includes('tap'));
  });
});

describe('the rain at its own moments', () => {
  const until = (m, ok, ms = 70000) => { for (let t = 0; t < ms && !ok(m.b.state()); t += 20) m.run(20); assert.ok(ok(m.b.state()), 'timed out'); };
  const offlineAfter = m => { m.cmd('h 43200'); m.run(3000); until(m, s => s.mode === 'offline'); };   // the moment it decides

  test('out of the rain once the art is loaded after a boot, if the art has it', () => {
    assert.equal(make(sageLike()).playing(), 'glyph_form(event)');
    assert.equal(make().playing(), 'idle(loop)');              // the test card has no rain
  });

  test('the bridge gone: it dissolves into the rain and forms again at once, then lives on its own', () => {
    const m = make(sageLike(), { draw: false }); m.cmd('h 43200'); m.run(3000);
    m.cmd('s working'); m.run(2000);
    m.run(HOST_TIMEOUT_MS - 6000, 20);
    assert.equal(m.b.state().mode, 'direct');
    const seen = trace(m, 9000);
    assert.equal(m.b.state().mode, 'offline');
    assert.deepEqual(seen.slice(seen.indexOf('working_to_idle')), ['working_to_idle', 'glyph_dissolve', 'glyph_form', 'idle']);
  });

  test('the bridge back: a hello, before the mood the bridge sends; in the middle of an act, after the rain', () => {
    const m = make(sageLike(), { draw: false }); offlineAfter(m); m.run(5000);
    m.cmd('h 43200'); m.cmd('s working');                      // as the bridge does on "resync"
    assert.deepEqual(trace(m, 4000), ['hello', 'idle_to_working', 'working']);
    const n = make(sageLike(), { draw: false }); offlineAfter(n);
    assert.equal(n.b.state().playing, 'glyph_dissolve');
    n.cmd('h 43200');
    assert.deepEqual(trace(n, 4000), ['glyph_dissolve', 'glyph_form', 'hello', 'idle']);
    // queued behind the rain, the hello gives way to a mood sent after it, as any act asked for before a mood does
    const o = make(sageLike(), { draw: false }); offlineAfter(o);
    o.cmd('h 43200'); o.cmd('s working');
    assert.deepEqual(trace(o, 4000), ['glyph_dissolve', 'glyph_form', 'idle_to_working', 'working']);
  });

  test('asleep it notices neither, and without the acts nothing plays', () => {
    const m = make(sageLike(), { draw: false }); m.cmd('h 3600'); m.cmd('s night'); m.run(3000);
    const seen = trace(m, HOST_TIMEOUT_MS + 2000);
    assert.ok(!seen.includes('glyph_dissolve'), seen.join(' '));
    m.cmd('h 3700');
    assert.equal(m.b.state().playing, 'night');
    const bare = make(sageLike({ acts: ['tap_hello'] }), { draw: false }); offlineAfter(bare);
    assert.equal(bare.b.state().kind, 'loop');
    bare.cmd('h 43200'); assert.equal(bare.b.state().kind, 'loop');
  });

  test('an act asked for while it dissolves waits for the form: it never cuts from the rain', () => {
    const m = make(sageLike(), { draw: false }); offlineAfter(m);
    assert.equal(m.b.state().playing, 'glyph_dissolve');
    m.cmd('e tap_knock');
    assert.deepEqual(trace(m, 4000).slice(0, 4), ['glyph_dissolve', 'glyph_form', 'tap_knock', 'idle']);
  });
});

describe('clips', () => {
  test('a clip plays like an event', () => {
    const m = make(); m.cmd('h 43200');
    assert.deepEqual(m.b.postClip(clip('wave'), 'wave'), { status: 200, body: 'ok' });
    m.cmd('e wave');
    assert.equal(m.playing(), 'wave(event)');
  });

  test('32 at most: the next one evicts the clip played longest ago', () => {
    const m = make(TESTCARD, { draw: false }); m.cmd('h 43200');
    for (let i = 1; i <= MAX_SRC - 1; i++) { m.clock.t += 10; assert.equal(m.b.postClip(clip(`c${i}`), `c${i}`).status, 200); }
    m.cmd('e c1'); m.run(500);                                 // c1 was played: c2 is now the oldest
    m.clock.t += 10; m.b.postClip(clip('c33'), 'c33');
    assert.ok(m.said.includes('clip gone c2'));
    assert.equal(m.b.clips().length, 32);
    assert.ok(m.b.clips().some(c => c.name === 'c1'));
  });

  test('tap reactions and the clip playing are never evicted; a clip of the same name replaces it', () => {
    const m = make(TESTCARD, { draw: false }); m.cmd('h 43200');
    m.b.postClip(clip('keep'), 'keep', true);
    for (let i = 1; i <= MAX_SRC - 2; i++) { m.clock.t += 10; m.b.postClip(clip(`c${i}`), `c${i}`); }
    m.b.postClip(clip('more'), 'more');
    assert.ok(m.said.includes('clip gone c1'));
    assert.ok(m.b.clips().some(c => c.name === 'keep'));
    const before = m.b.clips().length;
    m.b.postClip(clip('more', 'idle', 6), 'more');
    assert.equal(m.b.clips().length, before);
  });

  test('a clip whose moods the art does not have, or with a loop in it, is refused', () => {
    const m = make(); m.cmd('h 43200');
    assert.equal(m.b.postClip(clip('x', 'disco', 4, [['disco', 0]]), 'x').status, 400);
    const loop = encode({ moods: [['idle', 0]], seqs: [[0, 0, 0, 'x', [0]]], frames: [solid(0)] });
    assert.deepEqual(m.b.postClip(loop, 'x'), { status: 400, body: 'err not a clip it can read' });
  });

  test('as in the firmware, a clip that does not parse first evicts every clip that can go', () => {
    const m = make(); m.cmd('h 43200');
    for (const n of ['a', 'b', 'c']) m.b.postClip(clip(n), n);
    m.b.postClip(new Uint8Array(64), 'junk');
    assert.deepEqual(m.said.filter(l => l.startsWith('clip gone')), ['clip gone a', 'clip gone b', 'clip gone c']);
    assert.equal(m.b.clips().length, 0);
  });

  test('without art there is nothing to add a clip to', () => {
    const m = make(null);
    assert.deepEqual(m.b.postClip(clip('x'), 'x'), { status: 400, body: 'err it has no drawings to add it to' });
  });
});

describe('pixels, colour, corner marks, backlight', () => {
  const art = encode({ moods: [['idle', 0], ['night', 1]], seqs: [[0, 0, 0, 'idle', [0]], [0, 1, 1, 'night', [1]], [1, 0, 1, 'idle_to_night', [1]], [1, 1, 0, 'night_to_idle', [0]]],
                       frames: [solid(0xF81F), { rle: [[1, 0xFFFF], ...solid(0x001F).rle.slice(1), [254, 0x001F]] }] });

  const rgb = v => [(v >> 11) << 3, ((v >> 5) & 63) << 2, (v & 31) << 3];
  const near = (v, want) => rgb(v).every((c, i) => Math.abs(c - want[i]) <= 16);

  test('pixel frames are recoloured from the magenta marker, and the colour fades in about a second', () => {
    const m = make(art); m.cmd('h 43200'); m.run(100);
    assert.ok(near(m.b.fb[1000], [255, 122, 69]), String(rgb(m.b.fb[1000])));   // Tangerine, the default
    m.cmd('c 3D8BFF'); m.run(300);
    assert.ok(!near(m.b.fb[1000], [61, 139, 255]));
    m.run(1500);
    assert.ok(near(m.b.fb[1000], [61, 139, 255]), String(rgb(m.b.fb[1000])));
  });

  test('as on the board, a pixel frame starting with a pure white run starts it black', () => {
    const m = make(art); m.cmd('h 43200'); m.cmd('s night'); m.run(200);
    assert.equal(m.b.fb[0], 0x0000);
    assert.equal(m.b.fb[1], 0x001F);
  });

  test('the corner marks show only where the mood does not already say it', () => {
    const m = make(); m.cmd('h 43200');
    m.cmd('o 1 0 0');
    assert.equal(m.b.overlayVisible(), true);
    m.cmd('s working'); assert.equal(m.b.overlayVisible(), false);
    m.cmd('o 0 1 0'); assert.equal(m.b.overlayVisible(), true);
    m.cmd('s alert'); assert.equal(m.b.overlayVisible(), false);
    m.cmd('o 0 2 0'); assert.equal(m.b.overlayVisible(), true);
    m.cmd('o 0 0 1'); m.cmd('s done'); assert.equal(m.b.overlayVisible(), false);
  });

  test('the backlight dims toward 70 once the night loop plays', () => {
    const levels = [];
    const m = make(); m.b.analogWrite = v => levels.push(v); m.cmd('h 43200');
    m.cmd('s night'); m.run(4000);
    assert.ok(levels.at(-1) < BL_NIGHT + 5, String(levels.at(-1)));
    m.cmd('s idle'); m.run(4000);
    assert.ok(levels.at(-1) > 245, String(levels.at(-1)));
  });
});

describe('commands', () => {
  test('replies as the firmware formats them', () => {
    const m = make(); m.cmd('h 43200');
    m.cmd('?');
    assert.match(m.said.at(-1), /^ok mode=direct target=idle playing=idle\(loop\) fps=\d+\.\d frames=787 seqs=149 draw_ms=\d+$/);
    m.cmd('o 1 2 3'); assert.equal(m.said.at(-1), 'ok overlay working=1 waiting=2 unseen=3');
    m.cmd('c #3d8bff'); assert.equal(m.said.at(-1), 'ok colour 3D8BFF');
    m.cmd('p 1'); assert.equal(m.said.at(-1), 'err unknown command');   // the meeting prep flag left with Lump's taps
    m.cmd('T 0.5'); assert.equal(m.said.at(-1), 'ok threshold=0.50g');
    m.cmd('s nowhere'); assert.equal(m.said.at(-1), 'err unknown mood');
    m.cmd('e nothing'); assert.equal(m.said.at(-1), 'err unknown event');
    m.cmd('c 12'); assert.equal(m.said.at(-1), 'err bad colour');
    m.cmd('Q'); assert.equal(m.said.at(-1), 'err unknown command');
  });

  test('s demo walks every mood and every act of the art on its own', () => {
    const m = make(TESTCARD, { draw: false }); m.cmd('h 43200');
    m.cmd('s demo');
    const targets = new Set(), played = new Set();
    for (let i = 0; i < 20 * 60 * 10; i++) {
      m.run(100, 20); if (i % 150 === 0) m.cmd('h 43200');
      const s = m.b.state(); targets.add(s.target); if (s.kind === 'event') played.add(s.playing);
    }
    const A = m.b.A;
    assert.deepEqual([...targets].sort(), A.moodName.slice(0, A.nMoods).sort());
    for (let i = 0; i < A.nSeqs; i++) if (A.kind[i] === 2) assert.ok(played.has(A.name[i]), A.name[i]);
  });

  test('an escalation to a mood the art lacks is not made', () => {
    const art = encode({ moods: [['idle', 0], ['alert', 1]], seqs: [[0, 0, 0, 'idle', [0]], [0, 1, 1, 'alert', [0]], [1, 0, 1, 'idle_to_alert', [0]]], frames: [solidOps(9, 9, 9)] });
    const m = make(art, { draw: false }); m.cmd('h 43200'); m.cmd('s alert');
    m.bridged(ESCALATE_MS + 5000);
    assert.equal(m.b.state().target, 'alert');
    assert.deepEqual(m.b.problems, []);
  });
});
