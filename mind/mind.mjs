// Sage's mind on the desk, the engine: told what happened (a signal), it chooses the act Sage plays from the table of
// reactions (table.mjs: priorities, cooldowns, no repeats, weights, only acts the art holds) and its patience, which is
// the website's own code (site.mjs). It chooses acts, never moods: those stay the bridge's.

import { loadSite } from './site.mjs';
import { PRIORITY, QUIET, REACTIONS, RECENT, SIGNALS } from './table.mjs';

/** A tap is a poke: a finger on the glass this long (shorter than the board's 600 ms between two taps). */
export const TOUCH = 0.5;
/** Its battery is the author's Claude usage left: below a quarter it droops, and this near empty it is charging. */
export const LOW = 0.25, CHARGING = 0.03;
/** How it reads your taps: a gentle one comes this long after the one before; a knock is two this close after a quiet
 *  (the board reports taps no closer than 0.6 s); a beat is four taps evenly spaced, each this far apart. */
export const GENTLE = 2.5, KNOCK = 0.95, QUIET_BEFORE = 3, BEAT = [0.6, 1.6];
/** How fond of you it is, from 0 to 1: gentle taps warm it, a sulk cools it, and it fades by half in this many hours. */
export const FOND_HALF = 8;
/** Before an act starts the board walks back to idle; an act whose length the art does not say is taken as this long. */
const LEAD = 0.5, GUESS = 4;
const HISTORY = 50;
const QUIET_WHILE = { night: 'asleep', meeting: 'a meeting starts', alert: 'something needs you' };
/** A signal's context matches a pattern of the table when every value the pattern names is the same. */
const matches = (pattern, s) => Object.entries(pattern).every(([k, v]) => s[k] === v);

const nothing = (why) => ({ why });
const percent = (x) => `${Math.round(x * 100)}%`;
const ALONE = { hovered: false, goneTo: false, lifted: false, apart: false, charging: false };

export class Mind {
  constructor({ site = loadSite(), random = Math.random } = {}) {
    this.site = site;
    this.random = random;
    this.acts = null;                  // act -> seconds, once the art is known
    this.recent = [];                  // the acts chosen, newest last
    this.lastAt = {};                  // reaction -> when it last played
    this.playing = null;               // what it is playing: { act, priority, until }
    this.patience = site.newPatience();
    this.calm = null;                  // when its patience was last stepped
    this.crossUntil = -Infinity;
    this.battery = null;               // the author's Claude usage left, 0 to 1
    this.low = false;                  // below a quarter: it has drooped and will not again until it goes back above
    this.charged = false;              // near empty: it has gone to charge and will not again until it goes back above
    this.taps = [];                    // when you last tapped, newest last
    this.tapDay = null;                // the day of your last tap
    this.grudge = false;               // it sulked, and has not made up yet
    this.fond = 0; this.fondAt = 0;    // how fond of you it is, and when that was last set
  }

  /** What the art holds: a list of names, or names with their length in seconds. */
  know(acts) {
    this.acts = Array.isArray(acts) ? Object.fromEntries(acts.map((a) => [String(a), null])) : { ...acts };
    const table = [...new Set(Object.values(REACTIONS).flatMap((r) => Object.keys(r.acts)))];
    const lacking = table.filter((a) => !(a in this.acts));
    const n = Object.keys(this.acts).length;
    return { acts: n, why: `the art holds ${n} acts` + (lacking.length ? `; not these of the table: ${lacking.join(', ')}` : '') };
  }

  /** A signal from the bridge ({signal, now, ...context}): the act to play ({play, why}), or why there is none ({why}).
   *  Its battery, its idling and its patience are the mind's own; every other signal goes to the first reaction of the
   *  table it matches. */
  signal(s) {
    const now = typeof s.now === 'number' ? s.now : Date.now() / 1000;
    if (!Object.hasOwn(SIGNALS, s.signal)) return nothing('not a signal it knows');
    if (s.signal === 'usage') return this.usage(now, s);
    if (s.signal === 'idle') return this.idle(now, s);
    if (s.signal === 'tap') return this.touched(now, s);
    if (s.signal === 'shake') return this.spend(now, s, { lifted: true }) || nothing(now < this.crossUntil ? this.site.CROSS_ANSWER || 'still cross' : 'shaken, and patient still');
    const name = Object.keys(REACTIONS).find((n) => (REACTIONS[n].on || []).some((p) => matches(p, s)));
    if (name) return this.react(name, now, s);
    return nothing(`nothing in the table for ${SIGNALS[s.signal]}${s.ok === false ? ' that failed' : ''}${s.busy ? ', with other work going on' : ''}`);
  }

  busy(now) {
    return !!this.playing && now < this.playing.until;
  }

  /** One of a reaction's acts, if this is a moment for it: the art holds it, the mood is not a quiet one, it has not
   *  played too lately, and nothing more urgent is playing. */
  react(name, now, s = {}) {
    const r = REACTIONS[name];
    if (!this.acts) return nothing(`${r.what}: the art is not known yet`);
    if (QUIET[s.mood] && !QUIET[s.mood].includes(name)) return nothing(`${r.what}: quiet while ${QUIET_WHILE[s.mood]}`);
    const since = now - (this.lastAt[name] ?? -Infinity);
    if (since < r.cooldown) return nothing(`${r.what}: played ${Math.round(since)} s ago`);
    if (this.busy(now) && PRIORITY[r.priority] < PRIORITY[this.playing.priority]) return nothing(`${r.what}: busy with ${this.playing.act}`);
    const all = Object.keys(r.acts), held = all.filter((a) => a in this.acts), lacking = all.filter((a) => !(a in this.acts));
    if (!held.length) return nothing(`${r.what}: the art holds none of ${all.join(', ')}`);
    const act = this.pick(held, r);
    if (!act) return nothing(`${r.what}: its only act just played`);
    this.lastAt[name] = now;
    this.recent = [...this.recent, act].slice(-HISTORY);
    this.playing = { act, priority: r.priority, until: now + LEAD + (this.acts[act] ?? GUESS) };
    return { play: act, why: r.what + (lacking.length ? `; not in the art: ${lacking.join(', ')}` : '') };
  }

  /** Weighted, and none of the last several chosen while at least two others are left to weigh. Otherwise as the
   *  website picks a pastime: each less likely the sooner it was chosen, and never the one just chosen unless
   *  repeating it is the reaction's meaning (a tap, its battery). */
  pick(held, r) {
    const ago = (a) => { const i = this.recent.lastIndexOf(a); return i < 0 ? Infinity : this.recent.length - i; };
    let pool = held.filter((a) => ago(a) > RECENT).map((a) => [a, r.acts[a]]);
    if (pool.length < 2) {
      pool = held.map((a) => [a, r.acts[a] * (ago(a) === 1 ? (r.repeats ? 1 : 0) : Math.min(1, ((ago(a) - 1) / RECENT) ** 2))]);
      pool = pool.filter(([, w]) => w > 0);
    }
    if (!pool.length) return null;
    let x = this.random() * pool.reduce((sum, [, w]) => sum + w, 0);
    for (const [a, w] of pool) if ((x -= w) < 0) return a;
    return pool[pool.length - 1][0];
  }

  /** About once a minute while idle: late at night with the author still at it, the clock once a night and dozing now
   *  and then; with the author away, only fidgets. */
  idle(now, s) {
    const around = s.around !== false, late = around && !!s.late;
    if (late) {
      const d = this.react('late', now, s);
      if (d.play) return d;
    }
    return this.react(!around ? 'idle_away' : late ? 'idle_late' : 'idle', now, s);
  }

  /** Its battery: drooping once when it falls below a quarter, not again until it has gone back above. The first
   *  reading is where it starts, not a fall. */
  usage(now, s) {
    const b = Number(s.battery);
    if (s.battery === null || s.battery === undefined || !Number.isFinite(b)) return nothing('no battery reading');
    const first = this.battery === null, low = b < LOW, empty = b <= CHARGING;
    this.battery = b;
    // near empty it goes to charge by itself, once, before it runs out (and has drooped by then, whatever it played)
    if (empty && !first && !this.charged) { this.charged = this.low = true; return this.react('battery_charge', now, s); }
    if (!empty && b > CHARGING + 0.02) this.charged = false;
    if (first || !low || this.low) {
      this.low = low;
      this.charged = this.charged || (first && empty);
      return nothing(`battery at ${percent(b)}`);
    }
    this.low = true;
    return this.react('battery_low', now, s);
  }

  charging(s) {
    const b = typeof s.battery === 'number' ? s.battery : this.battery;
    return b !== null && b <= CHARGING;
  }

  /** Left alone since the last bother: its patience comes back (the website's stepPatience, alone). */
  rest(now) {
    if (this.calm !== null && now > this.calm) this.site.stepPatience(this.patience, ALONE, now - this.calm);
    this.calm = Math.max(this.calm ?? now, now);
  }

  /** How fond of you it is now: what it was, faded by half every FOND_HALF hours. */
  fondness(now) { return this.fond * 0.5 ** (Math.max(0, now - this.fondAt) / (FOND_HALF * 3600)); }
  warm(now, by) { this.fond = Math.max(0, Math.min(1, this.fondness(now) + by)); this.fondAt = now; }

  /** Four taps evenly spaced, a beat apart: play, not a bother. */
  rhythm() {
    const t = this.taps.slice(-4); if (t.length < 4) return false;
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    return gaps.every((g) => g >= BEAT[0] && g <= BEAT[1]) && Math.max(...gaps) / Math.min(...gaps) < 1.4;
  }

  /**
   * How it takes a touch. What a tap means depends on the moment (asleep, reading, needing you), on the rhythm of your
   * taps (a knock, a beat to dance to) and on your history with it (the first tap of the day, a grudge after it sulked,
   * how fond of you it has grown). Only a plain poke spends its patience, as the website counts it; running out, it
   * stays cross a while, and a gentle tap after that makes up.
   */
  touched(now, s) {
    this.rest(now);
    const prev = this.taps[this.taps.length - 1] ?? -Infinity, before = this.taps[this.taps.length - 2] ?? -Infinity, gap = now - prev;
    this.taps = [...this.taps, now].slice(-8);
    const day = new Date(now * 1000).toDateString(), firstToday = this.tapDay !== null && this.tapDay !== day;
    this.tapDay = day;
    // cross, whatever the moment: answered with the website's words for it
    if (now < this.crossUntil) return nothing(this.site.CROSS_ANSWER || 'still cross');
    // asleep: the first tap stirs it, the next wakes it, and woken again and again it sulks
    if (s.mood === 'night') {
      const lately = this.taps.filter((x) => now - x < 90).length;
      if (lately === 1) return this.react('stir', now, s);
      if (lately === 2) return this.react('woken', now, s);
      return this.runOut(now, s, 'sulk');
    }
    // (a moment with no act to show it, or one that has just played, is a plain poke instead)
    const as = (name) => { const d = this.react(name, now, s); return d.play ? d : null; };
    let d;
    if (this.grudge && gap >= GENTLE && (d = as('make_up'))) { this.grudge = false; this.warm(now, 0.2); return d; }
    // a beat is play while it is play: once it has danced, more of the same is poking again
    if (this.rhythm() && (d = as('rhythm'))) { this.taps = []; return d; }
    if (gap < KNOCK && prev - before > QUIET_BEFORE && (d = as('knock'))) return d;
    if (s.mood === 'alert') return this.react('seen', now, s);
    if (firstToday && s.around !== false && (d = as('morning'))) { this.warm(now, 0.1); return d; }
    const out = this.spend(now, s, { hovered: true });
    if (out) return out;
    if (gap >= GENTLE) this.warm(now, 0.04);
    if (s.mood === 'working' && (d = as('look_up'))) return d;
    if (this.fondness(now) > 0.6 && this.random() < 0.35 && (d = as('loved'))) return d;
    return this.react('tap', now, s);
  }

  /** A bother, counted as the website counts it: a tap is a poke (a shake, being picked up), a bother in the middle of
   *  an act is being gone to, and at its limit it is on its charger. Its decision if its patience ran out, or null. */
  spend(now, s, how) {
    this.rest(now);
    const bother = { hovered: !!how.hovered, goneTo: this.busy(now), lifted: !!how.lifted, apart: false, charging: this.charging(s) };
    const ran = this.site.stepPatience(this.patience, bother, TOUCH);
    this.calm = Math.max(this.calm, now + TOUCH);
    if (!ran) return null;
    const out = this.site.outOfPatience(bother);
    return this.runOut(now, s, out === 'dizzy' || out === 'glitch' || out === 'dnd' ? out : 'sulk');
  }

  /** Out of patience: what that looks like, then cross a while (30 to 50 seconds, as on the website), a grudge until a
   *  gentle tap makes up, and a little less fond of you. */
  runOut(now, s, name) {
    this.crossUntil = now + 30 + this.random() * 20;
    this.grudge = true;
    this.warm(now, -0.15);
    return this.react(name, now, s);
  }
}
