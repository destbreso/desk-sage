// Sage's reactions on the desk: what it does when something happens on the author's computer. Plain data: a new
// reaction is one entry. Each names the signals it answers (`on`: the signal and the context values it needs), the
// acts it may play (from design/sage-acts.js, weighted: a lower weight is a rarer act), how urgent it is, and how long
// before it plays again. Only acts the art holds are ever chosen. Part of Sage's character: see CLAUDE.md.

/** The signals the bridge sends, and what each is: the vocabulary of mind/README.md. */
export const SIGNALS = {
  tests: 'a test command ran', build: 'a build ran', push: 'a git push', deploy: 'a deploy command',
  conflict: 'a merge conflict', rollback: 'a rollback', lint: 'a linter ran', big_diff: 'a big diff read',
  done: 'Claude stopped', compact: 'the context compacted', hello: 'a new session after a long quiet',
  oops: 'a failed tool call', waiting: 'waiting for the author', idle: 'idle, about once a minute',
  tap: 'a tap on the glass', shake: 'shaken', usage: 'the Claude usage left (its battery)',
};

/** A reaction to work preempts one to the author, which preempts life's small things, which preempt idling. */
export const PRIORITY = { idle: 0, life: 1, you: 2, work: 3 };

/** Acts chosen this recently are not chosen again while at least two others are left to weigh. */
export const RECENT = 6;

const FIDGETS = { fidget_glance: 6, fidget_antenna: 6, fidget_stretch: 6, fidget_mark: 6, fidget_turn: 6, fidget_look: 6 };
const NOW_AND_THEN = {
  cam_orbit: 1.5, cam_crane: 1.5, cam_top: 1.5, cam_peek: 1.5,
  holo_self: 1.5, holo_life: 1.5,
  glyph_mode: 0.75, glyph_eyes: 0.75, glyph_wind: 0.75, glyph_turn: 0.75, glyph_ascii: 0.75, glyph_decode: 0.75, glyph_scan: 0.75,
  glyph_think: 0.75, glyph_catch: 0.75,
};

export const REACTIONS = {
  tests_fail: { on: [{ signal: 'tests', ok: false }], what: 'tests failed', priority: 'work', cooldown: 60,
    acts: { work_tests_fail: 3, life_tests_fail: 3, holo_tests: 3, holo_screen_tests: 1, glyph_glitch: 1 } },
  // tests passing and a Stop with nothing else going on share one celebration, about ten minutes apart
  done: { on: [{ signal: 'tests', ok: true }, { signal: 'done', busy: false }], what: 'done', priority: 'you', cooldown: 10 * 60,
    acts: { done_glider: 4, done_hearts: 4, glyph_joy: 1.5, holo_screen_self: 0.5 } },
  build_ok: { on: [{ signal: 'build', ok: true }], what: 'a build worked', priority: 'work', cooldown: 60,
    acts: { work_build: 1, life_build: 1, holo_build: 1 } },
  build_fail: { on: [{ signal: 'build', ok: false }], what: 'a build failed', priority: 'work', cooldown: 60,
    acts: { glyph_glitch: 1, work_tests_fail: 1 } },
  push: { on: [{ signal: 'push', ok: true }], what: 'a push', priority: 'work', cooldown: 60, acts: { life_deploy: 1, done_glider: 1 } },
  deploy: { on: [{ signal: 'deploy', ok: true }], what: 'a deploy', priority: 'work', cooldown: 60, acts: { work_deploy: 1, life_deploy: 1 } },
  conflict: { on: [{ signal: 'conflict' }], what: 'a merge conflict', priority: 'work', cooldown: 60, acts: { tap_dizzy: 1, glyph_glitch: 1 } },
  // it falls apart into the rain and comes back (dizzy, forgets, reboots)
  compact: { on: [{ signal: 'compact' }], what: 'the context compacted', priority: 'work', cooldown: 60,
    acts: { glyph_rain: 1, glyph_decode: 1 } },
  hello: { on: [{ signal: 'hello' }], what: 'a new session after a long quiet', priority: 'you', cooldown: 60, acts: { hello: 4, glyph_form: 1 } },
  // it looks at you
  waiting: { on: [{ signal: 'waiting' }], what: 'waiting for you', priority: 'you', cooldown: 3 * 60, acts: { fidget_look: 1, fidget_glance: 1 } },

  // the ones below the mind plays itself: its battery (usage), its idling (idle) and its patience (tap, shake)
  battery_low: { what: 'its battery fell below a quarter', priority: 'you', cooldown: 0, repeats: true, acts: { holo_battery: 1 } },
  // late at night, the author still at it: it shows the time and yawns, once a night
  late: { what: 'late at night', priority: 'life', cooldown: 12 * 3600, repeats: true, acts: { holo_clock: 1 } },
  idle: { what: 'idle', priority: 'idle', cooldown: 0, acts: { ...FIDGETS, ...NOW_AND_THEN } },
  idle_late: { what: 'idle, late', priority: 'idle', cooldown: 0, acts: { ...FIDGETS, ...NOW_AND_THEN, glyph_doze: 6 } },
  // the author away: only its fidgets
  idle_away: { what: 'idle, alone', priority: 'idle', cooldown: 0, acts: FIDGETS },
  tap: { what: 'a tap', priority: 'you', cooldown: 0, repeats: true, acts: { tap_hello: 1 } },
  // its patience run out (the website's outOfPatience): dizzy, a glitch; do not disturb and minding it have no act yet
  dizzy: { what: 'out of patience: dizzy', priority: 'you', cooldown: 0, repeats: true, acts: { tap_dizzy: 1 } },
  glitch: { what: 'out of patience: a glitch', priority: 'you', cooldown: 0, repeats: true, acts: { glyph_glitch: 1 } },
};

/** Moods in which acts would break in on something: nothing plays there but these reactions. */
export const QUIET = {
  night: ['tap', 'dizzy', 'glitch'],
  meeting: ['tap', 'dizzy', 'glitch'],
  alert: ['waiting', 'tap', 'dizzy', 'glitch'],          // needs you: only looking at you, and taps
};
