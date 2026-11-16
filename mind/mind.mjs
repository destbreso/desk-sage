// Sage's mind on the desk, the engine: told what happened (a signal), it chooses the act Sage plays from the table of
// reactions (table.mjs: priorities, cooldowns, no repeats, weights, only acts the art holds) and its patience, which is
// the website's own code (site.mjs). It chooses acts, never moods: those stay the bridge's.

import { loadSite } from './site.mjs';
import { PRIORITY, QUIET, REACTIONS, RECENT, SIGNALS } from './table.mjs';

/** A tap is a poke: a finger on the glass this long (shorter than the board's 600 ms between two taps). */
export const TOUCH = 0.5;
/** Its battery is the author's Claude usage left: below a quarter it droops, and this near empty it is charging. */
export const LOW = 0.25, CHARGING = 0.03;
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
    if (s.signal === 'tap') return this.bothered(now, s, { hovered: true });
    if (s.signal === 'shake') return this.bothered(now, s, { lifted: true });
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
    const first = this.battery === null, low = b < LOW;
    this.battery = b;
    if (first || !low || this.low) {
      this.low = low;
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

  /** A bother, counted as the website counts it: a tap is a poke (a shake, being picked up), a bother in the middle of
   *  an act is being gone to, and at its limit it is on its charger. Run out, it is dizzy, glitches, will not be
   *  disturbed or minds it, and stays cross a while (30 to 50 seconds, as on the website). */
  bothered(now, s, how) {
    this.rest(now);
    const bother = { hovered: !!how.hovered, goneTo: this.busy(now), lifted: !!how.lifted, apart: false, charging: this.charging(s) };
    const ran = this.site.stepPatience(this.patience, bother, TOUCH);
    this.calm = Math.max(this.calm, now + TOUCH);
    if (ran) {
      this.crossUntil = now + 30 + this.random() * 20;
      const out = this.site.outOfPatience(bother);
      if (out === 'dizzy' || out === 'glitch') return this.react(out, now, s);
      return nothing(out === 'dnd' ? 'out of patience on its charger: do not disturb (no act for it yet)' : 'out of patience: it minds, and sulks (no act for sulking yet)');
    }
    if (now < this.crossUntil) return nothing(this.site.CROSS_ANSWER || 'still cross');
    return how.hovered ? this.react('tap', now, s) : nothing('shaken, and patient still');
  }
}
