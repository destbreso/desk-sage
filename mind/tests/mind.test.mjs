// The mind on a fake clock and a seeded random: the table, priorities, cooldowns, no repeats, weights, acts the art
// lacks, its patience (the website's) running out into each of its outcomes, and its battery.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Mind, TOUCH, CHARGING } from '../mind.mjs';
import { loadSite } from '../site.mjs';
import { readArt } from '../art.mjs';
import { PRIORITY, REACTIONS, RECENT, SIGNALS } from '../table.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const SAGE_BIN = join(ROOT, 'firmware', 'data', 'sage.bin');
const site = loadSite();
const TABLE = [...new Set(Object.values(REACTIONS).flatMap((r) => Object.keys(r.acts)))];

/** A seeded random (mulberry32), so a failing run can be read again. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A mind whose art holds every act of the table, each three seconds long, unless told otherwise. */
function mindWith(acts = Object.fromEntries(TABLE.map((a) => [a, 3])), seed = 1) {
  const m = new Mind({ site, random: seeded(seed) });
  m.know(acts);
  return m;
}
const T0 = 1_763_300_000;

test('every act in the table is one of Sage\'s acts', () => {
  const acts = readFileSync(join(ROOT, 'design', 'sage-acts.js'), 'utf8');
  for (const a of TABLE) assert.ok(acts.includes(`"${a}"`), `${a} is not in design/sage-acts.js`);
});

test('the table is data the engine can trust: its signals, priorities and weights', () => {
  for (const [name, r] of Object.entries(REACTIONS)) {
    for (const p of r.on || []) assert.ok(Object.hasOwn(SIGNALS, p.signal), `${name} answers ${p.signal}, not a signal of the vocabulary`);
    assert.ok(Object.hasOwn(PRIORITY, r.priority), name);
    assert.ok(r.cooldown >= 0 && typeof r.what === 'string', name);
    for (const w of Object.values(r.acts)) assert.ok(w > 0, name);
  }
});

test('a new reaction is one entry in the table, and no code', () => {
  REACTIONS.lint_ok = { on: [{ signal: 'lint', ok: true }], what: 'a clean lint', priority: 'work', cooldown: 60, acts: { fidget_mark: 1 } };
  try {
    assert.deepEqual(mindWith().signal({ signal: 'lint', ok: true, now: T0, mood: 'working' }), { play: 'fidget_mark', why: 'a clean lint' });
  } finally {
    delete REACTIONS.lint_ok;
  }
  assert.match(mindWith().signal({ signal: 'lint', ok: true, now: T0 }).why, /nothing in the table for a linter ran/);
});

test('each signal plays one of its reaction\'s acts', () => {
  const cases = [
    [{ signal: 'tests', ok: false }, 'tests_fail'], [{ signal: 'tests', ok: true }, 'done'], [{ signal: 'done', busy: false }, 'done'],
    [{ signal: 'build', ok: true }, 'build_ok'], [{ signal: 'build', ok: false }, 'build_fail'], [{ signal: 'push', ok: true }, 'push'],
    [{ signal: 'deploy', ok: true }, 'deploy'], [{ signal: 'conflict' }, 'conflict'], [{ signal: 'compact' }, 'compact'],
    [{ signal: 'hello' }, 'hello'], [{ signal: 'waiting' }, 'waiting'], [{ signal: 'tap' }, 'tap'],
    [{ signal: 'idle', around: true }, 'idle'], [{ signal: 'idle', around: false }, 'idle_away'],
  ];
  for (const [s, reaction] of cases) {
    const d = mindWith().signal({ ...s, now: T0, mood: 'idle' });
    assert.ok(d.play in REACTIONS[reaction].acts, `${JSON.stringify(s)} played ${d.play}`);
    assert.equal(typeof d.why, 'string');
  }
});

test('what has no reaction, or is not a moment for one, plays nothing and says why', () => {
  const m = mindWith();
  for (const [s, why] of [
    [{ signal: 'done', busy: true }, /other work/], [{ signal: 'push', ok: false }, /push that failed/],
    [{ signal: 'rollback' }, /rollback/], [{ signal: 'lint', ok: true }, /linter/], [{ signal: 'what' }, /not a signal/],
    [{ signal: 'tests', ok: false, mood: 'alert' }, /needs you/], [{ signal: 'idle', mood: 'night' }, /asleep/],
    [{ signal: 'hello', mood: 'meeting' }, /meeting/],
  ]) {
    const d = m.signal({ now: T0, ...s });
    assert.equal(d.play, undefined, JSON.stringify(s));
    assert.match(d.why, why);
  }
  assert.ok(m.signal({ signal: 'waiting', now: T0, mood: 'alert' }).play, 'looking at you is what it does while it needs you');
  assert.ok(m.signal({ signal: 'tap', now: T0, mood: 'night' }).play, 'a tap wakes it');
});

test('nothing is chosen before the art is known', () => {
  const m = new Mind({ site });
  assert.match(m.signal({ signal: 'tests', ok: false, now: T0 }).why, /art is not known/);
});

test('the committed art is read through the emulator\'s parser, and acts it lacks are never chosen', async () => {
  const all = await readArt(SAGE_BIN);
  assert.ok('tap_hello' in all && 'work_tests_fail' in all && 'glyph_glitch' in all);
  assert.equal(all.tap_hello, 40 / 24);
  // (an art without some of the table's acts, made from the committed one, so the test does not hang on what it holds)
  const LACKS = ['holo_clock', 'holo_battery', 'life_tests_fail', 'done_hearts', 'glyph_form', 'holo_tests', 'holo_screen_tests', 'life_deploy', 'holo_self', 'holo_life', 'holo_screen_self'];
  const acts = Object.fromEntries(Object.entries(all).filter(([k]) => !LACKS.includes(k)));
  for (const a of LACKS) assert.ok(!(a in acts), a);
  const m = mindWith(acts, 7);
  const said = m.know(acts);
  assert.match(said.why, /not these of the table: .*holo_clock/);
  const seen = new Set();
  for (let k = 0; k < 40; k++) {
    const d = m.signal({ signal: 'tests', ok: false, now: T0 + k * 61, mood: 'working' });
    assert.ok(d.play in acts, d.play);
    seen.add(d.play);
    assert.match(d.why, /not in the art: life_tests_fail, holo_tests, holo_screen_tests/);
  }
  assert.deepEqual([...seen].sort(), ['glyph_glitch', 'work_tests_fail']);
  for (let k = 0; k < 200; k++) {
    const d = m.signal({ signal: 'idle', around: true, late: k % 2 === 0, now: T0 + 10_000 + k * 60, mood: 'idle' });
    assert.ok(d.play in acts, d.play);
  }
  assert.match(m.signal({ signal: 'conflict', now: T0 + 30_000 }).play, /^(tap_dizzy|glyph_glitch)$/);
  const art = new Mind({ site });
  art.know(['fidget_look']);
  assert.match(art.signal({ signal: 'tests', ok: false, now: T0 }).why, /holds none of work_tests_fail, life_tests_fail/);
});

test('a reaction to work preempts an idle one, and an idle one waits for it', () => {
  const m = mindWith();
  const idle = m.signal({ signal: 'idle', around: true, now: T0, mood: 'idle' });
  assert.ok(idle.play);
  const work = m.signal({ signal: 'tests', ok: false, now: T0 + 1, mood: 'idle' });
  assert.ok(work.play, 'work breaks in on idling');
  assert.match(m.signal({ signal: 'idle', around: true, now: T0 + 2, mood: 'idle' }).why, new RegExp(`busy with ${work.play}`));
  assert.match(m.signal({ signal: 'tap', now: T0 + 2.5, mood: 'idle' }).why, /busy/, 'a tap does not break in on work either');
  assert.ok(m.signal({ signal: 'idle', around: true, now: T0 + 1 + 0.5 + 3 + 0.01, mood: 'idle' }).play, 'once the act is over');
});

test('each reaction keeps its cooldown, and passing tests and a Stop share the celebration\'s ten minutes', () => {
  const m = mindWith();
  assert.ok(m.signal({ signal: 'tests', ok: false, now: T0 }).play);
  assert.match(m.signal({ signal: 'tests', ok: false, now: T0 + 30 }).why, /played 30 s ago/);
  assert.ok(m.signal({ signal: 'tests', ok: false, now: T0 + 61 }).play);
  assert.ok(m.signal({ signal: 'done', busy: false, now: T0 + 100 }).play);
  assert.match(m.signal({ signal: 'tests', ok: true, now: T0 + 400 }).why, /done: played 300 s ago/);
  assert.ok(m.signal({ signal: 'tests', ok: true, now: T0 + 701 }).play);
  assert.ok(m.signal({ signal: 'waiting', now: T0 + 1000, mood: 'alert' }).play);
  assert.ok(!m.signal({ signal: 'waiting', now: T0 + 1170, mood: 'alert' }).play);
  assert.ok(m.signal({ signal: 'waiting', now: T0 + 1181, mood: 'alert' }).play);
});

test('idle never repeats an act within the last several, and never twice in a row even alone', () => {
  const m = mindWith(undefined, 3);
  const played = [];
  for (let k = 0; k < 400; k++) played.push(m.signal({ signal: 'idle', around: true, now: T0 + k * 60, mood: 'idle' }).play);
  for (let k = 1; k < played.length; k++) {
    const lately = played.slice(Math.max(0, k - RECENT), k);
    assert.ok(!lately.includes(played[k]), `${played[k]} again within ${RECENT} at ${k}`);
  }
  const away = [];
  for (let k = 0; k < 200; k++) away.push(m.signal({ signal: 'idle', around: false, now: T0 + 30_000 + k * 60, mood: 'idle' }).play);
  assert.ok(away.every((a) => a.startsWith('fidget_')), 'only fidgets while the author is away');
  for (let k = 1; k < away.length; k++) assert.notEqual(away[k], away[k - 1]);
});

test('weights: mostly fidgets, the camera and holograms now and then, the rain\'s acts each rarer, the rarest rarest', () => {
  const m = mindWith(undefined, 11);
  const n = {};
  let t = T0;
  for (let k = 0; k < 6000; k++) {
    const a = m.signal({ signal: 'idle', around: true, now: (t += 60), mood: 'idle' }).play;
    n[a] = (n[a] || 0) + 1;
  }
  const count = (re) => Object.entries(n).filter(([a]) => re.test(a)).reduce((s, [, c]) => s + c, 0);
  assert.ok(count(/^fidget_/) / 6000 > 0.5, JSON.stringify(n));
  const fewestFidget = Math.min(...Object.keys(REACTIONS.idle.acts).filter((a) => a.startsWith('fidget_')).map((a) => n[a]));
  for (const a of Object.keys(REACTIONS.idle.acts).filter((x) => /^(cam|holo|glyph)_/.test(x))) assert.ok(n[a] < fewestFidget, `${a} ${n[a]}`);
  // the celebrations, ten minutes apart with its idling in between, as on the desk
  const done = {};
  for (let k = 0; k < 3000; k++) {
    for (let i = 0; i < 10; i++) m.signal({ signal: 'idle', around: true, now: (t += 60), mood: 'idle' });
    const a = m.signal({ signal: 'done', busy: false, now: (t += 1), mood: 'done' }).play;
    done[a] = (done[a] || 0) + 1;
  }
  assert.ok(done.holo_screen_self < done.glyph_joy && done.glyph_joy < done.done_glider && done.glyph_joy < done.done_hearts, JSON.stringify(done));
  // tests failing: the rarer acts rarer
  const fail = {};
  for (let k = 0; k < 3000; k++) {
    for (let i = 0; i < 3; i++) m.signal({ signal: 'idle', around: true, now: (t += 60), mood: 'idle' });
    const a = m.signal({ signal: 'tests', ok: false, now: (t += 1), mood: 'working' }).play;
    fail[a] = (fail[a] || 0) + 1;
  }
  for (const rare of ['holo_screen_tests', 'glyph_glitch']) for (const common of ['work_tests_fail', 'life_tests_fail', 'holo_tests']) assert.ok(fail[rare] < fail[common], JSON.stringify(fail));
});

test('late at night with the author still at it: the clock once a night, dozing now and then', () => {
  const m = mindWith(undefined, 5);
  const first = m.signal({ signal: 'idle', around: true, late: true, now: T0, mood: 'idle' });
  assert.equal(first.play, 'holo_clock');
  const played = [];
  for (let k = 1; k <= 300; k++) played.push(m.signal({ signal: 'idle', around: true, late: true, now: T0 + k * 60, mood: 'idle' }).play);
  assert.ok(!played.includes('holo_clock'), 'once a night');
  assert.ok(played.filter((a) => a === 'glyph_doze').length > 10, 'dozing now and then');
  assert.equal(m.signal({ signal: 'idle', around: true, late: true, now: T0 + 13 * 3600, mood: 'idle' }).play, 'holo_clock', 'the next night');
  const day = mindWith(undefined, 5), awake = [];
  for (let k = 0; k < 300; k++) awake.push(day.signal({ signal: 'idle', around: true, late: false, now: T0 + k * 60, mood: 'idle' }).play);
  assert.ok(!awake.includes('holo_clock') && !awake.includes('glyph_doze'));
  assert.notEqual(mindWith().signal({ signal: 'idle', around: false, late: true, now: T0, mood: 'idle' }).play, 'holo_clock', 'not for nobody');
});

test('its battery: drooping once when it falls below a quarter, not again until it has been back above', () => {
  const m = mindWith();
  const at = (battery, k) => m.signal({ signal: 'usage', battery, now: T0 + k, mood: 'idle' });
  assert.equal(at(0.2, 0).play, undefined, 'the first reading is where it starts');
  assert.equal(at(0.5, 10).play, undefined);
  assert.equal(at(0.24, 20).play, 'holo_battery');
  assert.equal(at(0.1, 30).play, undefined);
  assert.equal(at(0.02, 40).play, 'go_charge', 'near empty, it goes to charge by itself');
  assert.equal(at(0.01, 45).play, undefined, 'once');
  assert.equal(at(0.3, 50).play, undefined);
  assert.equal(at(0.2, 60).play, 'holo_battery');
  assert.equal(at(0.02, 70).play, 'go_charge', 'and again once it has been back above');
});

// its patience, the website's: taps on and on run it out; how it runs out depends on how it is bothered
const tap = (m, now, extra = {}) => m.signal({ signal: 'tap', now, mood: 'idle', ...extra });

test('a tap is a poke, as the website counts it, and patience comes back when it is left alone', () => {
  const m = mindWith({ tap_hello: 1 });
  assert.equal(tap(m, T0).play, 'tap_hello');
  assert.equal(m.patience.used, site.PATIENCE.poke);
  tap(m, T0 + 2);
  const used = m.patience.used;
  assert.ok(Math.abs(used - (site.PATIENCE.poke * 2 - site.PATIENCE.back * (2 - TOUCH))) < 1e-9, String(used));
  assert.equal(tap(m, T0 + 100).play, 'tap_hello');
  assert.equal(m.patience.used, site.PATIENCE.poke, 'all of it back after a while, and this tap\'s poke');
});

test('tapped on and on in the middle of its acts, it runs out with a glitch, and is cross a while', () => {
  const m = mindWith({ tap_hello: 40 / 24, glyph_glitch: 176 / 24, fidget_look: 4 });
  let d, t = T0, n = 0;
  // (a second apart is a beat, but this art has no dance: each is a poke, in the middle of the act before)
  do d = tap(m, (t += 1)), n++; while (d.play === 'tap_hello' && n < 30);
  assert.equal(d.play, 'glyph_glitch', JSON.stringify(d));
  assert.ok(n >= 4 && n <= 8, `ran out after ${n} taps`);
  assert.equal(m.patience.used, site.PATIENCE.after);
  d = tap(m, t + 20);
  assert.equal(d.play, undefined);
  assert.equal(d.why, site.CROSS_ANSWER);
  assert.equal(tap(m, t + 120).play, 'tap_hello', 'no longer cross, and patient again');
});

test('tapped on and on, but each time after its act, it minds it and sulks', () => {
  const m = mindWith({ tap_hello: 40 / 24, sulk: 156 / 24 });
  let d, t = T0, n = 0;
  do d = tap(m, (t += 2.4)), n++; while (d.play === 'tap_hello' && n < 60);
  assert.equal(d.play, 'sulk');
  assert.match(d.why, /minds it, and sulks/);
  assert.ok(n > 10, `ran out after ${n} taps`);
  const without = mindWith({ tap_hello: 40 / 24 });
  t = T0; n = 0;
  do d = tap(without, (t += 2.4)), n++; while (d.play === 'tap_hello' && n < 60);
  assert.equal(d.play, undefined, 'an art without the act plays nothing, and says so');
  assert.match(d.why, /sulks: the art holds none of sulk/);
});

test('bothered on its charger (its usage at the limit), it will not be disturbed', () => {
  const m = mindWith({ tap_hello: 40 / 24 });
  m.signal({ signal: 'usage', battery: 0.5, now: T0 - 1 });
  m.signal({ signal: 'usage', battery: CHARGING / 2, now: T0 });
  let d, t = T0, n = 0;
  do d = tap(m, (t += 2.4)), n++; while (d.play === 'tap_hello' && n < 60);
  assert.match(d.why, /do not disturb/);
  const off = mindWith({ tap_hello: 40 / 24 });
  let k = 0;
  for (t = T0; tap(off, (t += 2.4)).play === 'tap_hello' && k < 60; k++);
  assert.ok(n < k, `on its charger it runs out sooner (${n} taps against ${k})`);
});

test('shaken (picked up, as the board will feel it) on top of being poked, it gets dizzy', () => {
  const m = mindWith();
  // (unevenly spaced, so not a beat, and none gentle)
  for (const k of [0, 1, 2.9, 3.9]) assert.equal(tap(m, T0 + k).play, 'tap_hello');
  const d = m.signal({ signal: 'shake', now: T0 + 4.5, mood: 'idle' });
  assert.equal(d.play, 'tap_dizzy', JSON.stringify(d));
  assert.equal(m.signal({ signal: 'shake', now: T0 + 100 }).play, undefined, 'one shake alone is no bother worth an act');
});

// how it takes a touch on the desk: the moment, the rhythm of your taps, and your history with it
test('asleep, the first tap stirs it, the next wakes it, and woken again and again it sulks', () => {
  const m = mindWith();
  const night = (k) => tap(m, T0 + k, { mood: 'night' });
  assert.equal(night(0).play, 'sleep_stir');
  assert.equal(night(5).play, 'cam_wake');
  assert.equal(night(12).play, 'sulk');
  assert.equal(night(20).why, site.CROSS_ANSWER, 'and cross a while');
});

test('a knock: two quick taps after a quiet, and it looks out to see who is there', () => {
  const m = mindWith();
  assert.equal(tap(m, T0).play, 'tap_hello');
  assert.equal(tap(m, T0 + 0.8).play, 'tap_knock');
});

test('taps in a beat make it dance, once; more of the same is poking again', () => {
  const m = mindWith();
  const plays = [0, 1, 2].map((k) => tap(m, T0 + 10 + k).play), used = m.patience.used;
  plays.push(tap(m, T0 + 13).play);
  assert.equal(plays[3], 'rhythm_dance');
  assert.ok(m.patience.used <= used, 'play is not a bother');
  const more = [4, 5, 6, 7].map((k) => tap(m, T0 + 10 + k).play);
  assert.ok(!more.includes('rhythm_dance'), 'it does not dance again so soon: ' + more);
});

test('while it needs you a tap is "seen", and it nods; while it reads, it looks up at you', () => {
  assert.equal(tap(mindWith(), T0, { mood: 'alert' }).play, 'nod');
  assert.match(tap(mindWith(), T0, { mood: 'working' }).play, /^fidget_(look|glance)$/);
});

test('the first tap of a new day is a greeting', () => {
  const m = mindWith();
  tap(m, T0);
  assert.match(tap(m, T0 + 24 * 3600).play, /^(hello|glyph_eyes|glyph_form)$/);
});

test('after it sulked and the crossness passed, a gentle tap makes up, with hearts', () => {
  const m = mindWith({ tap_hello: 40 / 24, sulk: 156 / 24, done_hearts: 3 });
  let d, t = T0, n = 0;
  do d = tap(m, (t += 2.4)), n++; while (d.play !== 'sulk' && n < 60);
  assert.equal(d.play, 'sulk');
  assert.equal(tap(m, t + 10).why, site.CROSS_ANSWER);
  assert.equal(tap(m, t + 60).play, 'done_hearts', 'made up');
  assert.equal(m.grudge, false);
});

test('fond of you after many gentle taps, it sometimes answers with hearts', () => {
  const m = mindWith(undefined, 3);
  const plays = [];
  for (let k = 0; k < 60; k++) plays.push(tap(m, T0 + k * 30).play);
  assert.ok(m.fondness(T0 + 60 * 30) > 0.6, 'fond of you: ' + m.fondness(T0 + 60 * 30));
  assert.ok(plays.slice(30).includes('done_hearts'), 'hearts now and then');
  assert.ok(m.fondness(T0 + 60 * 30 + 24 * 3600) < 0.2, 'and it fades over a day apart');
});

test('a failed tool call startles it, and a commit gets a nod', () => {
  const m = mindWith();
  assert.equal(m.signal({ signal: 'oops', now: T0, mood: 'working' }).play, 'work_oops');
  assert.equal(m.signal({ signal: 'commit', now: T0 + 100, mood: 'working' }).play, 'nod');
});

