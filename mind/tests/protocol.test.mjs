// The process as the bridge talks to it, and the contract of mind/README.md from the mind's side: the first message
// and its protocol version, JSON lines in, one answer a line out, in order and with its id, nothing else written,
// nothing logged, a bad line answered without taking it down, and every signal of the vocabulary documented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { SIGNALS } from '../table.mjs';
import { readArt } from '../art.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const SAGE_BIN = join(ROOT, 'firmware', 'data', 'sage.bin');
const PROTOCOL = 1;                                // mind/README.md

function start(t) {
  const p = spawn(process.execPath, [join(ROOT, 'mind', 'sage-mind.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => p.kill());
  const lines = [], waiting = [];
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  createInterface({ input: p.stdout }).on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
  const next = () => (lines.length ? Promise.resolve(lines.shift()) : new Promise((r, no) => (waiting.push(r), setTimeout(() => no(new Error('no answer')), 5000).unref())));
  return {
    p, next, stderr: () => err,
    ask: async (s) => (p.stdin.write((typeof s === 'string' ? s : JSON.stringify(s)) + '\n'), JSON.parse(await next())),
    end: () => new Promise((r) => (p.on('exit', (code) => r(code)), p.stdin.end())),
  };
}

test('the art first, in the protocol both speak, then one answer a signal, in order, with its id', async (t) => {
  const m = start(t);
  const art = await m.ask({ id: 0, signal: 'art', protocol: PROTOCOL, path: SAGE_BIN });
  // (whatever the committed art holds today: counted through the same parser, never written down here)
  assert.deepEqual([art.id, art.protocol, art.acts], [0, PROTOCOL, Object.keys(await readArt(SAGE_BIN)).length]);
  const many = [
    { id: 2, signal: 'tests', ok: false, now: 1000, mood: 'working' },
    { id: 3, signal: 'tests', ok: false, now: 1010, mood: 'working' },
    { id: 4, signal: 'oops', now: 1011, mood: 'working' },
    { id: 5, signal: 'usage', battery: 0.5, now: 1012, mood: 'working' },
  ];
  m.p.stdin.write(many.map((s) => JSON.stringify(s)).join('\n') + '\n');
  const answers = [];
  for (const _ of many) answers.push(JSON.parse(await m.next()));
  assert.deepEqual(answers.map((a) => a.id), [2, 3, 4, 5]);
  assert.match(answers[0].play, /^(work_tests_fail|life_tests_fail|holo_tests|holo_screen_tests|glyph_glitch)$/);
  assert.equal(answers[1].play, undefined);
  assert.match(answers[1].why, /played 10 s ago/);
  for (const a of answers) assert.deepEqual(Object.keys(a).filter((k) => !['id', 'play', 'why'].includes(k)), []);
  assert.equal(await m.end(), 0, 'it ends when the bridge closes its input');
  assert.equal(m.stderr(), '', 'it logs nothing');
});

test('another protocol is refused, and nothing is chosen until the art is known', async (t) => {
  const m = start(t);
  assert.match((await m.ask({ id: 1, signal: 'tap', now: 5 })).why, /art is not known/);
  const other = await m.ask({ id: 0, signal: 'art', protocol: 2, acts: ['tap_hello'] });
  assert.deepEqual([other.protocol, other.acts], [PROTOCOL, 0]);
  assert.match(other.why, /protocol 2/);
  assert.match((await m.ask({ id: 2, signal: 'tap', now: 6 })).why, /art is not known/);
  assert.equal((await m.ask({ id: 0, signal: 'art', protocol: PROTOCOL, acts: ['tap_hello', 'hello'] })).acts, 2);
  assert.deepEqual(await m.ask({ id: 3, signal: 'tap', now: 7 }), { id: 3, play: 'tap_hello', why: 'a tap' });
  await m.end();
});

test('a bad line is answered, and the next one still is', async (t) => {
  const m = start(t);
  assert.match((await m.ask('this is not json')).why, /not a signal/);
  assert.match((await m.ask({ id: 9, nothing: true })).why, /not a signal/);
  assert.match((await m.ask({ id: 10, signal: 'art', protocol: PROTOCOL, path: '/no/such/art.bin' })).why, /could not answer/);
  assert.equal((await m.ask({ id: 0, signal: 'art', protocol: PROTOCOL, acts: ['hello'] })).acts, 1);
  assert.equal((await m.ask({ id: 12, signal: 'hello', now: 1 })).play, 'hello');
  assert.equal(await m.end(), 0);
  assert.equal(m.stderr(), '');
});

test('the contract: every signal of the vocabulary is answered, and documented in mind/README.md', async (t) => {
  const readme = readFileSync(join(ROOT, 'mind', 'README.md'), 'utf8');
  const documented = new Set([...readme.matchAll(/^\| ([^|]+) \|/gm)].flatMap(([, cell]) => [...cell.matchAll(/`([a-z_]+)`/g)].map((x) => x[1])));
  for (const s of Object.keys(SIGNALS)) assert.ok(documented.has(s), `${s} is not in mind/README.md's table of signals`);
  assert.match(readme, new RegExp(`protocol ${PROTOCOL}\\)`));
  const m = start(t);
  await m.ask({ id: 0, signal: 'art', protocol: PROTOCOL, path: SAGE_BIN });
  let id = 0;
  for (const signal of Object.keys(SIGNALS)) {
    const a = await m.ask({ id: ++id, signal, now: 2000 + id * 700, mood: 'idle', ok: true, busy: false, around: true, late: false, battery: 0.5 });
    assert.notEqual(a.why, 'not a signal it knows', signal);
    assert.equal(typeof a.why, 'string', signal);
    if (a.play) assert.match(a.play, /^[a-z0-9_]{1,40}$/);
  }
  await m.end();
});
