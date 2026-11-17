// The board, as firmware/src/main.cpp runs it: the .bin parser, the player and its state graph, the
// things it does on its own, its antenna and the corner marks, the backlight, taps, the serial commands and clips.
// Each method names the function it mirrors in main.cpp; keep them in step. What the hardware does
// (the clock, the display, the backlight pin, the accelerometer, the serial line) comes in through
// the hooks the constructor takes, so a page and a test drive the same code. Inflating a compressed frame is one of
// them (`inflate`: inflate-node.mjs under Node, prepared() from packed.mjs in the page); without it such a frame is
// refused, as one that does not inflate.

import { Canvas, W, H } from './vec.mjs';
import * as glyphs from './glyphs.mjs';
import * as packed from './packed.mjs';
import * as antenna from './antenna.mjs';
import { Sprite, color565 } from './lgfx.mjs';

export const LOOP = 0, TRANS = 1, EVENT = 2;
export const MAX_MOODS = 12, MAX_SRC = 33, MAX_SEQ = 750 + MAX_SRC - 1;     // source 0 is the flash art, the rest are clips
export const ESCALATE_MS = 45000, LONGHAUL_MS = 10 * 60 * 1000;
export const BL_DAY = 255, BL_NIGHT = 70;
export const HOST_TIMEOUT_MS = 60000, OFFLINE_MARK_AFTER_MS = 8000;
export const NIGHT_FROM = 0, NIGHT_UNTIL = 8;
export const TAP_GAP_MS = 600;                                  // imuTask: a jolt this soon after a tap is the same tap
export const CLIP_MAX_BYTES = 2 * 1024 * 1024;

const rd16 = (b, p) => b[p] | (b[p + 1] << 8);
const rd32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const toInt = s => { const v = parseInt(s, 10); return Number.isNaN(v) ? 0 : v; };       // Arduino String::toInt
const toFloat = s => { const v = parseFloat(s); return Number.isNaN(v) ? 0 : v; };
const decoder = new TextDecoder('latin1');

function newSrc() { return { buf: null, offsets: 0, data: 0, end: 0, atlas: glyphs.emptyAtlas(), own: null, name: '', used: 0, tap: false }; }

function newAnim() {
  return {
    nFrames: 0, nSeqs: 0, fps: 24, nMoods: 0,
    base: new Array(MAX_MOODS).fill(0), moodName: new Array(MAX_MOODS).fill(''),
    kind: new Array(MAX_SEQ).fill(0), from: new Array(MAX_SEQ).fill(0), to: new Array(MAX_SEQ).fill(0), src: new Array(MAX_SEQ).fill(0),
    len: new Array(MAX_SEQ).fill(0), seqBuf: new Array(MAX_SEQ).fill(null), seq: new Array(MAX_SEQ).fill(0), name: new Array(MAX_SEQ).fill(''),
    loopOf: new Array(MAX_MOODS).fill(-1), transOf: Array.from({ length: MAX_MOODS }, () => new Array(MAX_MOODS).fill(-1)),
    srcs: Array.from({ length: MAX_SRC }, newSrc),
    anchors: false,                                            // its frames mark the antenna's ball (version 8's flags, bit 0)
    ok: false,
  };
}

export class Board {
  constructor({ millis, micros, random, say, push, backlight, inflate } = {}) {
    const t0 = globalThis.performance ? performance.now() : Date.now();
    this.millis = millis || (() => Math.floor(performance.now() - t0));          // since boot, as millis() is
    this.micros = micros || (() => (performance.now() - t0) * 1000);
    this.random = random || (n => Math.floor(Math.random() * n));                // Arduino's random(n): 0 .. n-1
    this.out = say || (() => {});                                                // a line to the serial port
    this.present = push || (() => {});                                           // fb.pushSprite
    this.analogWrite = backlight || (() => {});                                  // the backlight pin
    this.cv = new Canvas(); this.fb = this.cv.fb; this.gfx = new Sprite(this.fb);
    this.cv.recolour = c => this.recolour8(c);
    this.win = new packed.Window(inflate || (() => null));       // the window compressed frames are inflated into
    this.A = newAnim();
    this.problems = [];                                        // what the board would do wrong with this art (shown, not emulated)
    // player
    this.target = 0; this.curMood = 0; this.curSeq = 0; this.pendingEvent = -1;
    this.moodAfter = -1;                                       // a mood asked for while an act waits that has none drawn for it: it follows the act
    this.pendingThen = -1; this.follow = -1;                   // an act that goes on at once from the pending one, and from the one playing
    this.seqStart = 0; this.loopSince = 0; this.nextFidget = 0; this.lastFrame = -1; this.fps = 0;
    this.lastTapAct = ''; this.lastFidgetAct = '';
    this.demo = false; this.demoStep = -1; this.demoMood = -1; this.demoAct = -1; this.demoNext = 0;
    // body colour: Tangerine, fading toward its goal
    this.tintR = 255; this.tintG = 122; this.tintB = 69; this.goalR = 255; this.goalG = 122; this.goalB = 69;
    // backlight
    this.blLast = 0; this.blLevel = BL_DAY;
    // motion sensor
    this.tapPending = false; this.tapThreshold = 0.35; this.peakJolt = 0; this.peakAt = 0; this.tapCount = 0; this.lastTap = 0;
    // the bridge
    this.lastHost = 0; this.clockAt = 0; this.clockBase = -1; this.hostSeen = false; this.offline = true;
    this.offlineSince = 0; this.relinkAt = 0; this.relinking = false;      // when it went offline; when its ball lit again
    this.ovWorking = 0; this.ovWaiting = 0; this.ovUnseen = 0;
    // the loop's statics
    this.slowestDraw = 0; this.drawMs = 0; this.lastFade = 0; this.lastOverlayTick = 0; this.lastAntenna = -1; this.fpsT0 = null; this.fpsN = 0;
    this.antennaBuf = new Uint8Array(antenna.MAX); this.drawnOnAntenna = null;
    this.rx = ''; this.lineBuf = '';
    this.noArt = false;
  }

  say(line) { this.out(line); }                                // say(): USB (and the Wi-Fi client, which the emulator has not)

  // ---------- setup(): the art parsed, the boot mood started, and out of the rain if the art has it ----------
  setup(art) {
    this.analogWrite(BL_DAY);
    this.A.ok = !!art && this.parseArt(art, art.length, 0);
    if (!this.A.ok) {
      this.noArt = true;
      this.say('err art missing or bad (send it: tools/ota.py --art)');
      return false;
    }
    this.say(`sage ready: ${this.A.nMoods} moods, ${this.A.nSeqs} sequences, ${this.A.nFrames} frames`);
    this.say('imu ready');
    this.curMood = this.target = 0; this.startSeq(this.A.loopOf[0]); this.loopSince = this.millis();
    this.playEvent('glyph_form');
    this.say('wifi not set up');
    return true;
  }

  // ---------- parseArt(): the flash art (si 0), or a clip into source si, every read bounds-checked ----------
  parseArt(buf, size, si) {
    const A = this.A;
    if (!buf || size < 16) return false;
    let p = 0;
    const end = size, room = n => end - p >= n, clip = si > 0;
    const rdStr = () => { const n = buf[p++]; const s = decoder.decode(buf.subarray(p, p + n)); p += n; return s; };
    const magic = decoder.decode(buf.subarray(0, 4));
    if (magic !== 'SAGE' && magic !== 'LUMP') return false;     // LUMP: what the bake wrote before
    p += 4;
    const version = rd16(buf, p); p += 2;            // 3: every frame is pixels. 4: a frame may be instructions. 5: up to 65535 sequences. 6: glyph frames and their atlas. 7: compressed frames. 8: flags
    if (version < 3 || version > 8) return false;
    const nFrames = rd16(buf, p); p += 2;
    const nMoods = buf[p++], fps = buf[p++], moodOf = [];
    const flags = version >= 8 ? buf[p++] : 0;
    if (nMoods > MAX_MOODS) return false;
    for (let m = 0; m < nMoods; m++) {
      if (!room(2) || !room(2 + buf[p + 1])) return false;
      const base = buf[p++], name = rdStr();
      if (clip) { const k = this.moodIndex(name); if (k < 0) return false; moodOf[m] = k; continue; }
      A.base[m] = base; A.moodName[m] = name; A.loopOf[m] = -1; moodOf[m] = m;
      if (base >= nMoods) return false;
    }
    if (!clip) { A.nMoods = nMoods; A.fps = fps; A.nFrames = nFrames; A.nSeqs = 0; A.anchors = (flags & 1) === 1; for (const row of A.transOf) row.fill(-1); }
    const wide = version >= 5 ? 2 : 1;               // bytes in the sequence count
    if (!room(wide)) return false;
    const n = wide === 2 ? rd16(buf, p) : buf[p], first = A.nSeqs;
    p += wide;
    if (first + n > MAX_SEQ) return false;
    for (let i = first; i < first + n; i++) {
      if (!room(4) || !room(4 + buf[p + 3] + 2)) return false;
      if (buf[p + 1] >= nMoods || buf[p + 2] >= nMoods || (clip && buf[p] !== EVENT)) return false;
      A.kind[i] = buf[p]; A.from[i] = moodOf[buf[p + 1]]; A.to[i] = moodOf[buf[p + 2]]; A.src[i] = si; p += 3;
      A.name[i] = rdStr();
      A.len[i] = rd16(buf, p); p += 2;
      if (!A.len[i] || !room(A.len[i] * 2)) return false;
      A.seqBuf[i] = buf; A.seq[i] = p; p += A.len[i] * 2;
      for (let k = 0; k < A.len[i]; k++) if (rd16(buf, A.seq[i] + 2 * k) >= nFrames) return false;
      if (A.kind[i] === LOOP) A.loopOf[A.from[i]] = i;
      else if (A.kind[i] === TRANS) A.transOf[A.from[i]][A.to[i]] = i;
    }
    if (!clip) for (let m = 0; m < nMoods; m++) if (A.loopOf[m] < 0) return false;
    const atlas = glyphs.emptyAtlas();
    if (version >= 6 && (p = glyphs.parseAtlas(buf, p, end, atlas)) < 0) return false;
    if (!room(nFrames * 4)) return false;
    const S = A.srcs[si];
    S.buf = buf; S.offsets = p; p += nFrames * 4; S.data = p; S.end = end; S.atlas = atlas;
    const have = end - S.data;
    for (let f = 0; f < nFrames; f++) {      // the top two bits: 00 pixels, 01 compressed (version 7), 10 instructions, 11 glyphs (version 6)
      const o = rd32(buf, S.offsets + 4 * f), kind = o >>> 30, at = o & 0x3FFFFFFF;
      if ((kind === 1 && version < 7) || (kind === 3 && version < 6)) return false;
      if (kind === 1) { if (!packed.check(buf, S.offsets, S.data, have, nFrames, at)) return false; continue; }
      if (at >= have || (kind >= 2 && (at + 2 > have || at + 2 + rd16(buf, S.data + at) > have))) return false;
      if (kind === 3 && rd16(buf, S.data + at) < 2) return false;
    }
    A.nSeqs = first + n;
    return true;
  }
  moodIndex(n) { for (let m = 0; m < this.A.nMoods; m++) if (this.A.moodName[m] === n) return m; return -1; }
  eventIndex(n) { for (let i = this.A.nSeqs - 1; i >= 0; i--) if (this.A.kind[i] === EVENT && this.A.name[i] === n) return i; return -1; }   // newest first

  // ---------- body colour: recolor() for pixels, recolour8() for an instruction's colour ----------
  recolor(v) {                                       // v: RGB565
    const r = (v >> 11) << 3, g = ((v >> 5) & 63) << 2, b = (v & 31) << 3;
    if (r < 8 && g < 8 && b < 8) return v;                     // black stays black
    const beta = g / 241, alpha = r / 255 - beta;
    if (alpha <= 0.02) return v;                               // pure line colour: unchanged
    if (b < alpha * 255 + beta * 220 - 48) return v;           // a real colour: keep it
    return color565(Math.min(255, Math.trunc(alpha * this.tintR + beta * 255)), Math.min(255, Math.trunc(alpha * this.tintG + beta * 241)), Math.min(255, Math.trunc(alpha * this.tintB + beta * 220)));
  }
  recolour8(c) {
    const r = c[0], g = c[1], b = c[2];
    if (r < 8 && g < 8 && b < 8) return;
    const beta = g / 241, alpha = r / 255 - beta;
    if (alpha <= 0.02 || b < alpha * 255 + beta * 220 - 48) return;
    c[0] = Math.min(255, Math.trunc(alpha * this.tintR + beta * 255)); c[1] = Math.min(255, Math.trunc(alpha * this.tintG + beta * 241)); c[2] = Math.min(255, Math.trunc(alpha * this.tintB + beta * 220));
  }

  // ---------- drawFrame(): instructions through vec, glyphs through glyphs, or RLE runs of [count][rgb565 big-endian];
  // a compressed frame inflated into the window first, and one that does not inflate not drawn, and said once;
  // afterwards cv.anchored says whether the frame marked its antenna's ball, and where ----------
  drawFrame(src, idx) {
    const S = this.A.srcs[src];
    this.cv.anchored = false;
    let buf = S.buf;
    const o = rd32(buf, S.offsets + 4 * idx);
    let kind = o >>> 30, p = S.data + (o & 0x3FFFFFFF), end = S.end;
    if (kind === 1) {
      const h = packed.head(buf, p), base = h.base === packed.NONE ? -1 : S.data + (rd32(buf, S.offsets + 4 * h.base) & 0x3FFFFFFF);
      const w = this.win, known = w.bad !== null && w.bad[0] === buf && w.bad[1] === p;
      const q = w.open(buf, p, base);
      if (q < 0) { if (!known) this.say(`frame ${idx} does not inflate`); return; }
      kind = h.kind; buf = w.buf; p = q; end = q + h.size;
    }
    if (kind === 3) { glyphs.draw(this.fb, S.atlas, buf, p + 2, rd16(buf, p)); return; }     // glyphs keep their colours, as on the board
    if (kind === 2) { this.cv.play(buf, p + 2, rd16(buf, p)); return; }
    const out = this.fb, N = W * H;
    let i = 0, lastIn = 0xFFFF, lastOut = 0;           // as on the board: a frame whose first run is pure white starts it black
    while (i < N && p + 3 <= end) {
      let n = buf[p];
      let v = (buf[p + 1] << 8) | buf[p + 2]; p += 3;
      if (v !== lastIn) { lastIn = v; lastOut = this.recolor(v); }
      v = lastOut;
      if (i + n > N) n = N - i;
      out.fill(v, i, i + n);
      i += n;
    }
  }

  // ---------- the player: always inside one sequence; a new target waits for it to finish ----------
  startSeq(s) { this.curSeq = s; this.seqStart = this.millis(); this.lastFrame = -1; this.A.srcs[this.A.src[s]].used = this.seqStart; }
  nextHop(a, b) {
    const A = this.A;
    if (A.transOf[a][b] >= 0) return A.transOf[a][b];
    if (A.base[a] !== a) return A.transOf[a][A.base[a]];
    if (A.base[b] !== b && A.transOf[a][A.base[b]] >= 0) return A.transOf[a][A.base[b]];
    return -1;
  }
  variantFor(e, m) {                                           // act e as drawn for mood m (name_<mood>, else its base mood's), or -1
    const A = this.A, n = A.name[e], u = n.lastIndexOf('_');
    let e2 = -1;
    if (u > 0) { e2 = this.eventIndex(n.substring(0, u) + '_' + A.moodName[m]); if (e2 < 0) e2 = this.eventIndex(n.substring(0, u) + '_' + A.moodName[A.base[m]]); }
    return e2;
  }
  settle(m) {                                                  // arrived in mood m's loop
    const A = this.A;
    this.curMood = m;
    if (this.follow >= 0) { const f = this.follow; this.follow = -1; if (A.from[f] === m) return this.startSeq(f); }
    if (this.moodAfter >= 0 && this.pendingEvent < 0) { this.target = this.moodAfter; this.moodAfter = -1; }   // the act it waited for has played
    if (this.target !== m) {
      const h = this.nextHop(m, this.target);
      if (h >= 0) return this.startSeq(h);
      this.problem(`no transition drawn from ${A.moodName[m]} toward ${A.moodName[this.target]}: the board cuts`);
      this.curMood = m = this.target;                          // nothing drawn for this route: cut
    }
    // an act queued for a mood the board never settled in: the same act drawn for the mood it landed in (name_<mood>)
    if (this.pendingEvent >= 0 && A.from[this.pendingEvent] !== m) {
      const e2 = this.variantFor(this.pendingEvent, m);
      this.pendingEvent = e2;
      if (e2 < 0) this.pendingThen = -1;
    }
    if (this.pendingEvent >= 0 && A.from[this.pendingEvent] === m) {
      const e = this.pendingEvent;
      this.pendingEvent = -1; this.follow = this.pendingThen; this.pendingThen = -1;
      return this.startSeq(e);
    }
    this.startSeq(A.loopOf[m]); this.loopSince = this.millis();
  }
  setTarget(m) {
    if (m < 0) { this.problem('asked for a mood this art does not have (the board would read out of bounds)'); return; }
    this.target = m;
    if (this.A.kind[this.curSeq] === LOOP) this.settle(this.curMood);
  }
  problem(text) {
    if (!this.problems.includes(text)) this.problems.push(text);
  }

  // pickable(), moodTier() and pickAct(): the board's own choice of an act (a tap's, a fidget's) from whatever the art
  // and the clips hold: named prefix*, or for a tap one of a tap reaction's clip; never `except`; drawn for the target
  // mood if any is (else its base mood, else any); never the one chosen last time while there is another. '' if none.
  pickable(i, prefix, except) {
    const A = this.A;
    if (A.kind[i] !== EVENT || A.name[i] === except) return false;
    const tapClip = A.srcs[A.src[i]].tap && prefix === 'tap_';
    return (A.name[i].startsWith(prefix) || tapClip) && this.eventIndex(A.name[i]) === i;    // each name once: its newest
  }
  moodTier(i) { const A = this.A; return A.from[i] === this.target ? 0 : A.from[i] === A.base[this.target] ? 1 : 2; }
  pickAct(prefix, except, last) {                              // last: 'lastTapAct' or 'lastFidgetAct', the board's memory of it
    const A = this.A;
    let tier = 3, n = 0, fresh = 0;
    for (let i = 0; i < A.nSeqs; i++) if (this.pickable(i, prefix, except)) tier = Math.min(tier, this.moodTier(i));
    for (let i = 0; i < A.nSeqs; i++) if (this.pickable(i, prefix, except) && this.moodTier(i) === tier) { n++; if (A.name[i] !== this[last]) fresh++; }
    if (!n) return '';
    let k = this.random(fresh ? fresh : n);
    for (let i = 0; i < A.nSeqs; i++)
      if (this.pickable(i, prefix, except) && this.moodTier(i) === tier && (!fresh || A.name[i] !== this[last]) && k-- === 0) return (this[last] = A.name[i]);
    return '';
  }
  playEvent(n, then = -1) {                                    // false if there's no such act; then: one to go on to at once
    const A = this.A;
    if (n === 'tap') n = this.pickAct('tap_', 'tap_dizzy', 'lastTapAct');     // dizzy is its patience run out, not an answer to a tap
    else if (n === 'fidget') n = this.pickAct('fidget_', '', 'lastFidgetAct');
    if (!n.length) return false;
    let e = this.eventIndex(n);
    if (e < 0) {                                               // a name resolves per mood to the one drawn for it: name_idle, name_working, ...
      e = this.eventIndex(n + '_' + A.moodName[this.target]);
      if (e < 0) e = this.eventIndex(n + '_' + A.moodName[A.base[this.target]]);
    }
    if (e < 0) return false;
    this.pendingEvent = e; this.pendingThen = then;
    if (this.target !== A.from[e]) this.setTarget(A.from[e]); else if (A.kind[this.curSeq] === LOOP) this.settle(this.curMood);
    return true;
  }

  // ---------- runDemo(): every mood and every act of the art, in turn ----------
  runDemo(now) {
    const A = this.A;
    if (!this.demo || now < this.demoNext) return;
    if (++this.demoStep % 2 === 0) {                           // a mood for six seconds, with its transitions
      this.demoMood = (this.demoMood + 1) % A.nMoods; this.setTarget(this.demoMood); this.demoNext = now + 6000;
      return;
    }
    for (let k = 0; k < A.nSeqs; k++) if (A.kind[this.demoAct = (this.demoAct + 1) % A.nSeqs] === EVENT) break;
    this.demoNext = now + 1000;
    if (A.kind[this.demoAct] === EVENT && this.playEvent(A.name[this.demoAct])) this.demoNext = now + Math.floor(A.len[this.demoAct] * 1000 / A.fps) + 3000;
  }

  // ---------- autoBehaviour(): fidgets with no bridge, alert to waiting, working to longhaul ----------
  autoBehaviour(now) {
    const A = this.A;
    if (this.demo || A.kind[this.curSeq] !== LOOP || this.target !== this.curMood) return;
    const m = A.moodName[this.curMood];
    if (m === 'idle' && this.pendingEvent < 0 && !this.hostAlive(now)) {     // with the bridge connected, it decides when to fidget
      if (!this.nextFidget) this.nextFidget = now + 40000 + this.random(50000);
      if (now > this.nextFidget) { this.nextFidget = 0; this.playEvent('fidget'); }
    } else this.nextFidget = 0;
    const next = m === 'alert' && now - this.loopSince > ESCALATE_MS ? this.moodIndex('waiting') : m === 'working' && now - this.loopSince > LONGHAUL_MS ? this.moodIndex('longhaul') : -1;
    if (next >= 0) this.setTarget(next);                        // only a mood the art has
  }

  // ---------- backlight(): dims gently at night ----------
  backlight(now) {
    if (now - this.blLast < 20) return;
    this.blLast = now;
    const night = this.A.kind[this.curSeq] === LOOP && this.A.moodName[this.curMood] === 'night';
    this.blLevel += ((night ? BL_NIGHT : BL_DAY) - this.blLevel) * 0.04;
    this.analogWrite(Math.trunc(this.blLevel));
  }

  // ---------- imuTask(): one accelerometer reading, as its jolt in g ----------
  sample(jolt) {
    const now = this.millis();
    if (jolt > this.peakJolt || now - this.peakAt > 4000) { this.peakJolt = jolt; this.peakAt = now; }
    if (jolt > this.tapThreshold && now - this.lastTap > TAP_GAP_MS) { this.lastTap = now; this.tapCount++; this.tapPending = true; }
  }

  // ---------- on its own: no bridge ----------
  hostAlive(now) { return this.hostSeen && now - this.lastHost < HOST_TIMEOUT_MS; }
  nightHour(h) { return NIGHT_FROM < NIGHT_UNTIL ? (h >= NIGHT_FROM && h < NIGHT_UNTIL) : (h >= NIGHT_FROM || h < NIGHT_UNTIL); }
  nightNow(now) {                                              // the bridge's clock (the emulator has no internet clock)
    if (this.clockBase < 0) return false;
    return this.nightHour(Math.floor(((this.clockBase + Math.floor((now - this.clockAt) / 1000)) % 86400) / 3600));
  }
  asleep(now) { return this.nightNow(now) || this.A.moodName[this.target] === 'night'; }   // it notices neither the bridge going nor coming back
  heardFromHost() {
    const was = this.offline, back = this.offline && this.hostSeen;     // it had the bridge before, and lost it
    this.lastHost = this.millis();
    if (this.antennaDark(this.lastHost)) { this.relinking = true; this.relinkAt = this.lastHost; }   // its ball lights again, with a ring
    this.hostSeen = true; this.offline = false;
    if (was) this.say('resync');                               // the bridge resends mood, colour and corner extras
    if (back && this.A.ok && !this.demo && !this.asleep(this.lastHost)) this.playEvent('hello');
  }
  runOffline(now) {
    if (!this.offline && !this.hostAlive(now)) {                 // lost the bridge: forget what it last told us, and go into the rain
      this.offline = true; this.offlineSince = now; this.relinking = false;
      this.ovWorking = this.ovWaiting = this.ovUnseen = 0;
      this.goalR = 255; this.goalG = 122; this.goalB = 69;
      if (!this.demo && !this.asleep(now)) this.playEvent('glyph_dissolve', this.eventIndex('glyph_form'));
    }
    if (!this.offline || this.demo) return;
    const want = this.moodIndex(this.nightNow(now) ? 'night' : 'idle');
    if (want >= 0 && this.target !== want && this.pendingEvent < 0 && this.A.kind[this.curSeq] === LOOP) this.setTarget(want);
  }
  offlineMark(now) { return this.offline && !this.demo && now > OFFLINE_MARK_AFTER_MS; }
  // shown on its antenna when the art marks it, else in a corner
  antennaDark(now) { return this.A.anchors && this.offlineMark(now); }
  cornerMark(now) { return !this.A.anchors && this.offlineMark(now); }
  // antennaStep(): a number that changes whenever the antenna's drawing does: -1 nothing (the art's own ball), 0 the
  // ball dark, 1 + k the dark ball and the faint ring at step k, -2 - k the relink's ring at step k
  antennaStep(now) {
    if (this.antennaDark(now)) {
      const k = Math.floor(((now - this.offlineSince) >>> 0) % Math.floor(antenna.EVERY * 1000 / antenna.FPS) * antenna.FPS / 1000);
      return k < antenna.RING ? 1 + k : 0;
    }
    if (this.relinking && !this.offline) {
      const ms = (now - this.relinkAt) >>> 0;
      if (ms < 1000 && Math.floor(ms * antenna.FPS / 1000) < antenna.RELINK) return -2 - Math.floor(ms * antenna.FPS / 1000);
      this.relinking = false;
    }
    return -1;
  }
  drawAntenna(step) {                                          // over the frame just drawn, at the ball it marks
    const cv = this.cv, buf = this.antennaBuf;
    this.drawnOnAntenna = step === -1 || !cv.anchored ? null : step === 0 ? 'dark' : step > 0 ? 'ring' : 'relink';   // for the readouts and tests
    if (step === -1 || !cv.anchored) return;
    const n = step >= 0 ? antenna.offline(buf, cv.anchorX, cv.anchorY, cv.anchorR, step - 1)
                        : antenna.relink(buf, cv.anchorX, cv.anchorY, cv.anchorR, -2 - step);
    cv.play(buf, 0, n);
  }
  drawOfflineMark(now) {                                       // a little unplugged cable, reaching for its socket (art that does not mark its antenna)
    const g = this.gfx, t = now / 1000, k = 0.45 + 0.3 * Math.sin(t * 2.1);
    const c = color565(Math.trunc(255 * k), Math.trunc(241 * k), Math.trunc(220 * k));
    const px = 200 + Math.trunc(2.5 + 2.5 * Math.sin(t * 1.3));
    g.fillRect(186, 226, px - 186, 2, c);
    g.fillRoundRect(px, 221, 9, 12, 2, c);
    g.fillRect(px + 9, 223, 4, 2, c); g.fillRect(px + 9, 229, 4, 2, c);
    g.fillRoundRect(220, 219, 4, 16, 1, c);
  }

  // ---------- corner extras: overlayVisible() and drawOverlay() ----------
  overlayVisible(now = this.millis()) {
    if (this.cornerMark(now)) return true;
    const m = this.A.moodName[this.target];
    const workingMood = m === 'working' || m === 'longhaul', alertMood = m === 'alert' || m === 'waiting';
    return (this.ovWorking > 0 && !workingMood) || this.ovWaiting >= 2 || (this.ovWaiting >= 1 && !alertMood) || (this.ovUnseen > 0 && m !== 'done');
  }
  drawOverlay(now) {
    const g = this.gfx, m = this.A.moodName[this.target], t = now / 1000;
    const rgb = (r, gg, b) => color565(Math.trunc(r), Math.trunc(gg), Math.trunc(b));
    if (this.cornerMark(now)) this.drawOfflineMark(now);
    const workingMood = m === 'working' || m === 'longhaul', alertMood = m === 'alert' || m === 'waiting';
    if (this.ovWorking > 0 && !workingMood) {                  // bottom-left: three bouncing dots
      for (let i = 0; i < 3; i++) {
        const b = Math.max(0, Math.sin(t * 6 - i * 0.9));
        g.fillCircle(16 + i * 10, 226 - b * 4, 2.5, rgb(255 * (0.45 + 0.55 * b), 241 * (0.45 + 0.55 * b), 220 * (0.45 + 0.55 * b)));
      }
    }
    if (this.ovWaiting >= 2 || (this.ovWaiting >= 1 && !alertMood)) {        // top-left: amber dots, one per session waiting
      const pulse = 0.6 + 0.4 * Math.sin(t * 5);
      for (let i = 0; i < Math.min(this.ovWaiting, 5); i++) g.fillCircle(14 + i * 11, 14, 3.5, rgb(255 * pulse, 181 * pulse, 71 * pulse));
    }
    if (this.ovUnseen > 0 && m !== 'done') {                   // top-right: a sparkle for something finished, unseen
      for (let k = 0; k < Math.min(this.ovUnseen, 2); k++) {
        const s = (k ? 4 : 6) * (0.75 + 0.25 * Math.sin(t * 4 + k * 2)), x = 224 - k * 13, y = 16 + k * 6, c = rgb(200, 255, 210);
        g.fillTriangle(x, y - s, x + s * 0.3, y, x - s * 0.3, y, c); g.fillTriangle(x, y + s, x + s * 0.3, y, x - s * 0.3, y, c);
        g.fillTriangle(x - s, y, x, y - s * 0.3, x, y + s * 0.3, c); g.fillTriangle(x + s, y, x, y - s * 0.3, x, y + s * 0.3, c);
      }
    }
  }

  // ---------- serial: reply(), handleLine(), pollSerial() ----------
  reply() {
    const A = this.A, k = A.kind[this.curSeq];
    this.say(`ok mode=${this.demo ? 'demo' : this.offline ? 'offline' : 'direct'} target=${A.moodName[this.target]} playing=${A.name[this.curSeq]}(${k === LOOP ? 'loop' : k === TRANS ? 'transition' : 'event'}) fps=${this.fps.toFixed(1)} frames=${A.nFrames} seqs=${A.nSeqs} draw_ms=${this.slowestDraw.toFixed(0)}`);
    this.slowestDraw = 0;
  }
  handleLine(ln) {                                             // as over USB: no pairing
    ln = ln.trim();
    if (!ln.length) return;
    const cmd = ln[0];
    if (cmd === 'w') { this.say('err the emulator has no Wi-Fi to save'); return; }    // the board saves it and restarts
    if (cmd === 'W') { this.say('ok wifi=off'); return; }
    let arg = ln.substring(1).trim().toLowerCase();
    this.heardFromHost();
    if (cmd === 'h') { const s = toInt(arg); if (s >= 0 && s < 86400) { this.clockBase = s; this.clockAt = this.millis(); } return; }
    if (cmd === 's') {
      if (arg === 'demo' || arg === 'cycle') { this.demo = true; this.demoNext = 0; this.moodAfter = -1; return this.reply(); }
      const m = this.moodIndex(arg);
      if (m < 0) { this.say('err unknown mood'); return; }
      // repeating the current mood is a no-op, so the bridge can re-assert it without undoing the board's own escalation
      const cur = this.A.moodName[this.target], selfEscalated = cur === 'waiting' || cur === 'longhaul';
      const same = !this.demo && (m === this.target || (selfEscalated && this.A.base[this.target] === m));
      this.demo = false;
      // an act still waiting to play, with none drawn for this mood, would be lost on the way (the hello when the bridge
      // comes back during the rain): it plays first, and this mood follows it
      if (!same && this.pendingEvent >= 0 && this.A.from[this.pendingEvent] !== m && this.variantFor(this.pendingEvent, m) < 0) this.moodAfter = m;
      else if (!same) { this.moodAfter = -1; this.setTarget(m); }
      return this.reply();
    }
    if (cmd === 'e') {
      this.demo = false;
      if (!this.playEvent(arg)) { this.say('err unknown event'); return; }
      return this.reply();
    }
    if (cmd === 'o') {
      const v = [0, 0, 0], parts = arg.split(/\s+/).filter(Boolean);
      for (let i = 0; i < 3 && i < parts.length; i++) { const x = parseInt(parts[i], 10); if (Number.isNaN(x)) break; v[i] = x; }   // sscanf "%d %d %d"
      this.ovWorking = Math.max(0, v[0]); this.ovWaiting = Math.max(0, v[1]); this.ovUnseen = Math.max(0, v[2]); this.lastFrame = -1;
      this.say(`ok overlay working=${this.ovWorking} waiting=${this.ovWaiting} unseen=${this.ovUnseen}`);
      return;
    }
    if (cmd === 'i') {
      const peak = this.millis() - this.peakAt > 4000 ? 0 : this.peakJolt;     // the board samples all the time; quiet samples read 0 here
      this.say(`ok imu=on peak=${peak.toFixed(2)}g taps=${this.tapCount} threshold=${this.tapThreshold.toFixed(2)}g`);
      return;
    }
    if (cmd === 'T') { const t = toFloat(arg); if (t > 0.05 && t < 4) this.tapThreshold = t; this.say(`ok threshold=${this.tapThreshold.toFixed(2)}g`); return; }
    if (cmd === 'c') {
      if (arg.startsWith('#')) arg = arg.substring(1);
      if (arg.length !== 6) { this.say('err bad colour'); return; }
      let c = parseInt(arg, 16);                               // strtol: leading hex digits, else 0
      if (Number.isNaN(c)) c = 0;
      this.goalR = (c >> 16) & 255; this.goalG = (c >> 8) & 255; this.goalB = c & 255;
      this.say(`ok colour ${c.toString(16).toUpperCase().padStart(6, '0')}`);
      return;
    }
    if (cmd === 'X') { this.tapPending = true; return; }       // pretend the glass was tapped
    if (cmd === '?') return this.reply();
    this.say('err unknown command');
  }
  receive(text) { this.rx += text; }                           // bytes arriving on the serial line
  pollSerial() {
    const s = this.rx;
    this.rx = '';
    for (const ch of s) {
      if (ch === '\n' || ch === '\r') { if (this.lineBuf.length) this.handleLine(this.lineBuf); this.lineBuf = ''; }
      else if (this.lineBuf.length < 240) this.lineBuf += ch;
    }
  }

  // ---------- clips: POST /clip ----------
  clipBusy(si) { return [this.curSeq, this.pendingEvent, this.pendingThen, this.follow].some(s => s >= 0 && this.A.src[s] === si); }
  dropClip(si) {                                               // its sequences close up in the list and its memory is freed
    const A = this.A;
    let w = 0;
    for (let s = 0; s < A.nSeqs; s++) {
      if (A.src[s] === si) continue;
      if (w !== s) {
        A.kind[w] = A.kind[s]; A.from[w] = A.from[s]; A.to[w] = A.to[s]; A.src[w] = A.src[s]; A.len[w] = A.len[s];
        A.seqBuf[w] = A.seqBuf[s]; A.seq[w] = A.seq[s]; A.name[w] = A.name[s];
        if (this.curSeq === s) this.curSeq = w;
        if (this.pendingEvent === s) this.pendingEvent = w;
        if (this.pendingThen === s) this.pendingThen = w;
        if (this.follow === s) this.follow = w;
      }
      w++;
    }
    A.nSeqs = w; this.win.forget(); A.srcs[si] = newSrc();
  }
  dropOldestClip() {                                           // the clip played longest ago; false if none can go
    const A = this.A;
    let old = -1;
    for (let i = 1; i < MAX_SRC; i++) if (A.srcs[i].own && !A.srcs[i].tap && !this.clipBusy(i) && (old < 0 || ((A.srcs[i].used - A.srcs[old].used) | 0) < 0)) old = i;
    if (old < 0) return false;
    this.say(`clip gone ${A.srcs[old].name}`);
    this.dropClip(old);
    return true;
  }
  addClip(buf, name, tap) {                                    // '' or what went wrong; a clip of a name already there replaces it
    const A = this.A;
    name = name.toLowerCase();
    if (!name.length) return 'a clip needs a name (X-Sage-Name)';
    for (let i = 1; i < MAX_SRC; i++) if (A.srcs[i].own && A.srcs[i].name === name) {
      if (this.clipBusy(i)) return 'that clip is playing, try again';
      this.dropClip(i);
    }
    for (;;) {
      let si = -1;
      for (let i = 1; i < MAX_SRC && si < 0; i++) if (!A.srcs[i].own) si = i;
      if (si > 0 && this.parseArt(buf, buf.length, si)) {
        Object.assign(A.srcs[si], { own: buf, name, used: this.millis(), tap });
        this.say(`clip ${name}: ${buf.length} bytes`);
        return '';
      }
      if (si > 0) A.srcs[si] = newSrc();
      if (!this.dropOldestClip()) return 'not a clip it can read';     // with nothing left to drop, the clip itself is the problem
    }
  }
  // onClipData() and onClipDone(): the HTTP status and body the board answers with
  postClip(buf, name, tap = false) {
    let err = '';
    if (!this.A.ok) err = 'it has no drawings to add it to';
    else if (!buf.length || buf.length > CLIP_MAX_BYTES) err = 'missing X-Sage-Size, or over 2 MB';
    else err = this.addClip(buf, name, tap);
    return err ? { status: 400, body: 'err ' + err } : { status: 200, body: 'ok' };
  }
  clips() {
    const out = [];
    for (let i = 1; i < MAX_SRC; i++) if (this.A.srcs[i].own) out.push({ slot: i, name: this.A.srcs[i].name, tap: this.A.srcs[i].tap, used: this.A.srcs[i].used });
    return out;
  }

  // ---------- loop() ----------
  loop() {
    this.pollSerial();
    if (!this.A.ok) return;
    const A = this.A;
    if (this.tapPending) {
      this.tapPending = false;
      this.say('tap');                                         // the bridge decides what a tap means, and its mind what plays
      if (this.offline) this.playEvent('tap');                 // on its own, it answers itself
    }
    const now = this.millis();                                 // read after the tap: an act started this pass must not look old
    this.runDemo(now); this.runOffline(now); this.autoBehaviour(now); this.backlight(now);
    const age = (now - this.seqStart) | 0;                     // signed: something started after 'now' is age 0
    let tick = age > 0 ? Math.floor((Math.imul(age, A.fps) >>> 0) / 1000) : 0;   // uint32 arithmetic, as on the board
    if (A.kind[this.curSeq] !== LOOP && tick >= A.len[this.curSeq]) { this.settle(A.to[this.curSeq]); tick = 0; }
    const cur = this.curSeq;
    const pos = A.kind[cur] === LOOP ? tick % A.len[cur] : Math.min(tick, A.len[cur] - 1);
    const idx = rd16(A.seqBuf[cur], A.seq[cur] + 2 * pos);
    if (now - this.lastFade >= 30 && (Math.abs(this.goalR - this.tintR) + Math.abs(this.goalG - this.tintG) + Math.abs(this.goalB - this.tintB)) > 1.5) {
      this.lastFade = now;                                     // fade the body colour toward its goal (~1 s)
      this.tintR += (this.goalR - this.tintR) * 0.12; this.tintG += (this.goalG - this.tintG) * 0.12; this.tintB += (this.goalB - this.tintB) * 0.12;
      this.lastFrame = -1;
    }
    const overlayTick = Math.floor(now / 100), ov = this.overlayVisible(now);    // corner extras animate at ~10 fps
    const ant = this.antennaStep(now);                         // its antenna at 24 steps a second while a ring goes out
    const frame = (A.src[cur] << 16) | idx;
    if (frame !== this.lastFrame || ant !== this.lastAntenna || (ov && overlayTick !== this.lastOverlayTick)) {
      this.lastOverlayTick = overlayTick;
      const began = this.micros();
      this.drawFrame(A.src[cur], idx);
      this.drawAntenna(ant);
      this.drawMs = (this.micros() - began) / 1000;            // this machine's time, not the board's
      this.slowestDraw = Math.max(this.slowestDraw, this.drawMs);
      if (ov) this.drawOverlay(now);
      this.present(this.fb);
      this.lastFrame = frame; this.lastAntenna = ant;
      if (this.fpsT0 === null) this.fpsT0 = now;
      this.fpsN++;
      if (now - this.fpsT0 >= 2000) { this.fps = this.fpsN * 1000 / (now - this.fpsT0); this.fpsN = 0; this.fpsT0 = now; }
      this.shown = { seq: cur, pos, idx, at: now };
    }
  }

  // what the page's readouts and the tests look at
  state() {
    const A = this.A, k = A.kind[this.curSeq], now = this.millis();
    return {
      ok: A.ok, mode: this.demo ? 'demo' : this.offline ? 'offline' : 'direct',
      target: A.moodName[this.target], mood: A.moodName[this.curMood], playing: A.name[this.curSeq],
      kind: k === LOOP ? 'loop' : k === TRANS ? 'transition' : 'event', pending: this.pendingEvent >= 0 ? A.name[this.pendingEvent] : null,
      fps: this.fps, drawMs: this.drawMs, backlight: Math.trunc(this.blLevel),
      colour: [this.tintR, this.tintG, this.tintB].map(v => Math.round(v)), overlay: [this.ovWorking, this.ovWaiting, this.ovUnseen],
      offline: this.offline, heard: this.hostSeen ? now - this.lastHost : null, offlineMark: this.offlineMark(now), anchors: this.A.anchors, antenna: this.drawnOnAntenna, taps: this.tapCount,
      clock: this.clockBase < 0 ? null : (this.clockBase + Math.floor((now - this.clockAt) / 1000)) % 86400,
      frames: A.nFrames, seqs: A.nSeqs, clips: this.clips(), problems: this.problems.slice(),
    };
  }
}
