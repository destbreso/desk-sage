// A moment on my Mac, all the way to the glass: a Claude Code hook posts to the bridge, the bridge keeps one mood for
// every session and tells Sage's mind only the kind of thing that happened, the mind plays an act or nothing, and the
// line goes over the link to the board, which plays it. A tap goes back up the same way; a heartbeat keeps the board
// in touch, and when it stops the board goes its own way.
//
// A dissect model (github.com/destbreso/dissect): it runs as a seeded discrete-event simulation, and the figure only
// moves what the simulation moves. Build the page from the repository's root:
//   node <dissect>/skills/dissect/scripts/build.mjs docs/figures/flow.model.mjs --out docs/figures/flow.html --audit --check
//
// The numbers are read from the code when the model loads, so a change there changes the figure:
// - tools/buddy_bridge.py: HEARTBEAT_EVERY (15 s), MIND_ANSWER (0.3 s), MIND_RETRY (2 s, doubling to 300 s), the
//   serial link (115,200 baud, a read that waits up to its 0.3 s timeout for 256 bytes, as pyserial does).
// - tools/install_hooks.py: the hook command, curl -m 1, async, answered 204 before the bridge does anything.
// - mind/table.mjs: each reaction's acts and weights and its cooldown (tests failing 60 s, done 10 min, looking up).
// - mind/mind.mjs and design/site/sage-site.js: its patience (the website's PATIENCE: a poke costs 0.12, it comes back
//   at 0.035 a second, it runs out at 1) and the 30 to 50 s it stays cross.
// - firmware/src/main.cpp: HOST_TIMEOUT_MS (60 s), the fidgets it plays on its own (40 to 90 s apart).
// - firmware/data/sage.bin, read with the emulator's parser (emulator/board.mjs): every act's length at 24 frames a
//   second, and the walk from working back to idle that comes before an act.
// Measured on my Mac (Apple M4, otherwise idle) by measure.py in this folder: the installed hook command, sh -c curl,
// 8.2 ms at the median and 10.3 at the 95th percentile; the bridge's own handling of a hook, 0.020 ms (p95 0.027); a
// failing test, which also asks the mind and waits for its answer, 0.070 ms (p95 0.24), so the mind's part is about
// 0.05 ms (p95 0.2). Under load all three were several times slower.
// Assumed, and said so where the figure shows them: the workload (one session firing a hook about every 4 s, a test
// run about every 3 minutes with one in three failing, Claude stopping about every 4 minutes; in a fix loop a test run
// about every 20 s, nine in ten failing), a tap every 1 to 4 minutes, USB's own latency on top of the baud rate (up to
// a millisecond), Wi-Fi's (the firmware leaves its modem sleep on, so a line can wait for the next beacon: 5 to
// 300 ms), the emulator's and QEMU's.
//
// What the figure leaves out, or bends: the moods the bridge sends (`s <mood>`) are not drawn as lines of their own;
// the mind's busier-act rule and its no-repeat rule are told in the inspector, not simulated; a tap is always answered
// (its patience, how long it stays cross, a knock and a beat to dance to are told, not simulated: the taps here come
// minutes apart, where its patience is always back), and every answer is looking up from its reading; the board keeps
// one act waiting and the figure two items, the oldest rather than the newest; and while my Mac is asleep the board's
// own fidgets and its own answers to taps, which begin after its minute alone, are told and not drawn.
//
// A reaction's cooldown is the simulator's way of holding a memory, not a step of its own (Dissect makes new items
// only on the top level, so the mind's memory is drawn there rather than inside a step). Each signal leaves a mark
// on its reaction's clock first, and the clock holds the mark for the cooldown, turning away any that comes while it
// holds one; a turned-away mark makes the check behind it busy for that instant only, so the signal that follows finds
// it busy and plays nothing, or free and plays. The check takes 20 microseconds, a device of the model, not a time of
// the code.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");
const num = (text, re, what) => {
  const m = text.match(re);
  if (!m) throw new Error(`flow.model.mjs: ${what} not found in the code`);
  return Number(m[1]);
};

const bridge = src("tools/buddy_bridge.py");
const firmware = src("firmware/src/main.cpp");
const mindSrc = src("mind/mind.mjs");
const HEARTBEAT_EVERY = num(bridge, /^HEARTBEAT_EVERY = (\d+)/m, "HEARTBEAT_EVERY");
const MIND_ANSWER = num(bridge, /^MIND_ANSWER = ([\d.]+)/m, "MIND_ANSWER");
const BAUD = num(bridge, /s\.baudrate, s\.timeout = p, (\d+), [\d.]+/, "the serial link's baud rate");
const READ_TIMEOUT = num(bridge, /s\.baudrate, s\.timeout = p, \d+, ([\d.]+)/, "the serial read's timeout");
const HOST_TIMEOUT = num(firmware, /HOST_TIMEOUT_MS = (\d+)/, "HOST_TIMEOUT_MS") / 1000;
const OWN_FROM = num(firmware, /nextFidget = now \+ (\d+) \+ random\(\d+\)/, "the board's own fidgets") / 1000;
const OWN_SPAN = num(firmware, /nextFidget = now \+ \d+ \+ random\((\d+)\)/, "the board's own fidgets") / 1000;
const CROSS_FROM = num(mindSrc, /crossUntil = now \+ (\d+) \+ this\.random\(\) \* \d+/, "how long it stays cross");
const CROSS_SPAN = num(mindSrc, /crossUntil = now \+ \d+ \+ this\.random\(\) \* (\d+)/, "how long it stays cross");
const TAP_G = num(firmware, /tapThreshold = ([\d.]+)f/, "the tap's threshold");
const TAP_GAP = num(firmware, /now - lastTap > (\d+)\)/, "the tap's debounce") / 1000;

const { REACTIONS } = await import(pathToFileURL(join(ROOT, "mind", "table.mjs")).href);
const { loadSite } = await import(pathToFileURL(join(ROOT, "mind", "site.mjs")).href);
const { PATIENCE } = loadSite();

// every act's length and the walk to idle, read from the art as the board reads it
const { Board, EVENT } = await import(pathToFileURL(join(ROOT, "emulator", "board.mjs")).href);
const bin = new Uint8Array(readFileSync(join(ROOT, "firmware", "data", "sage.bin")));
const board = new Board({});
if (!board.parseArt(bin, bin.length, 0)) throw new Error("flow.model.mjs: the emulator's parser refused firmware/data/sage.bin");
const A = board.A;
const FPS = A.fps || 24;
const seconds = {};
let WALK = null;
for (let i = 0; i < A.nSeqs; i++) {
  if (A.kind[i] === EVENT) seconds[A.name[i]] = A.len[i] / FPS;
  if (A.name[i] === "working>idle") WALK = A.len[i] / FPS;
}
if (WALK == null) throw new Error("flow.model.mjs: the art has no walk from working to idle");
const r3 = (x) => Math.round(x * 1000) / 1000;
/** A reaction's acts as a duration: one of them, as often as its weight says, each with the walk to idle first. */
function playOf(reaction, walk = WALK) {
  const acts = REACTIONS[reaction].acts;
  const unit = Math.min(...Object.values(acts));
  const list = [];
  for (const [act, w] of Object.entries(acts)) {
    if (!(act in seconds)) continue;
    for (let k = 0; k < Math.round(w / unit); k++) list.push(r3(walk + seconds[act]));
  }
  return `pick ${list.join(" ")}`;
}

// the line on the wire: 6 to 20 bytes at 10 bits a byte, and up to a millisecond of USB (assumed)
const wire = (bytes) => (bytes * 10) / BAUD;
const USB = `uni ${r3(wire(6) * 1000) / 1000} ${r3((wire(20) + 0.001) * 1000) / 1000}`;
const LINKS = { usb: USB, wifi: "uni 0.005 0.3", emulator: "uni 0.0002 0.002", qemu: USB };

// the workload (assumed): one session firing a hook about every 4 s
const HOOK_EVERY = 4;
const mix = (testsEvery, failing, stopsEvery) => {
  const rate = 1 / HOOK_EVERY;
  const tests = 1 / testsEvery / rate, stops = 1 / stopsEvery / rate;
  const fail = r3(tests * failing), fin = r3(tests * (1 - failing) + stops);
  return { "tool calls": r3(1 - fail - fin), "tests failed": fail, finishes: fin };
};
const WORKING = mix(180, 1 / 3, 240);
const FIX_LOOP = mix(20, 0.9, 240);

// the check: a device of the simulator (see the top), far below anything the code takes
const CHECK = 0.00002, BEHIND = 0.00001;
// a signal asked of the mind and answered, as the bridge sees it (measured: see the top)
const ASK = "logn 0.00005 0.0002";
const COOLDOWNS = { tests_fail: 60, done: 600 };
for (const [r, want] of Object.entries(COOLDOWNS))
  if (REACTIONS[r].cooldown !== want) throw new Error(`flow.model.mjs: ${r}'s cooldown is now ${REACTIONS[r].cooldown} s: update the clock's label`);
const PLAYS = ["tests_fail", "done", "look_up"].flatMap((r) => playOf(r).split(" ").slice(1).map(Number)).concat(seconds.hello);
const words = (s) => (s >= 120 ? `${s / 60} minutes` : `${s} s`);
const actsOf = (r) => Object.entries(REACTIONS[r].acts).map(([a, w]) => `${a} (${w})`).join(", ");

const reaction = (id, r, label, at, about) => ({
  id,
  kind: "station",
  lane: "mind",
  at,
  label,
  glyph: "doc",
  servers: "inf",
  work: 0,
  spec: `${Object.keys(REACTIONS[r].acts).length} acts, weighted`,
  about: `${about} The reaction ${r} in mind/table.mjs: ${actsOf(r)}, weighted, none of the last six acts while two others are left to weigh, and at most one every ${words(REACTIONS[r].cooldown)}. The mind leaves a mark on its clock as it looks.`,
});
const clock = (id, r, at) => ({
  id,
  kind: "station",
  lane: "mind",
  at,
  label: `${words(REACTIONS[r].cooldown).replace(" minutes", " min")} apart`,
  glyph: "queue",
  servers: 1,
  capacity: 0,
  work: REACTIONS[r].cooldown,
  spec: "holds its last act",
  about: `${r}'s cooldown, ${words(REACTIONS[r].cooldown)} from its last act (lastAt in mind/mind.mjs): the mark it holds is that act. A mark that comes while it holds one is turned away, and so is the signal right behind it.`,
});

export default {
  id: "desk-sage-flow",
  title: "A moment on my Mac, all the way to the glass",
  about: `A Claude Code hook posts to the bridge on my Mac; the bridge keeps one mood for every session and tells Sage's mind only the kind of thing that happened; the mind plays an act or nothing; the act goes over the link to the board, which plays it. A tap goes back up, and a heartbeat every ${HEARTBEAT_EVERY} s keeps the board in touch. Each dot is one hook, signal, line or tap.`,
  item: "moment",
  unit: "s",
  seed: 4,
  horizon: 900,
  lanes: [
    { id: "cc", label: "Claude Code" },
    { id: "mac", label: "Bridge" },
    { id: "mind", label: "Mind" },
    { id: "link", label: "Link" },
    { id: "board", label: "Board" },
  ],
  parts: [
    {
      id: "hooks",
      kind: "start",
      lane: "cc",
      at: [0, 0],
      label: "hooks",
      every: `exp ${HOOK_EVERY}`,
      classes: WORKING,
      about: "Every Claude Code event that matters to Sage (a session starting, a prompt, every tool call before and after, a permission, a Stop, a compaction) runs one small async hook: curl -s -m 1 posts its JSON to the bridge on 127.0.0.1:47823 and never blocks or fails Claude Code. Here, one session at work: a hook about every 4 s, a test run about every 3 minutes with one in three failing, and Claude stopping about every 4 minutes (assumed). Starting the shell and curl is most of the trip: 8 ms at the median on my Mac.",
      dials: [{ label: "Claude is", options: [{ label: "working" }, { label: "in a fix loop", set: { classes: FIX_LOOP } }] }],
    },
    {
      id: "post",
      kind: "station",
      lane: "mac",
      at: [0, 0],
      label: "POST /hook",
      glyph: "server",
      servers: 1,
      work: "logn 0.00002 0.000027",
      switch: {
        label: "Mac awake",
        off: [
          { part: "hooks", set: { paused: true } },
          { part: "post", set: { servers: 0 } },
          { part: "check", set: { servers: 0 } },
          { part: "down", set: { servers: 0 } },
        ],
      },
      about: "tools/buddy_bridge.py answers 204 first, so the hook never waits, then keeps a little state per session and merges every session into one mood: any waiting on me is alert, else any working is working, else something finished I have not looked at is awake, else idle (night from midnight to 8). The board hears s <mood> only when the mood changes. A Bash command is read for its kind (tests, a build, a commit, a push, a deploy, a conflict), and only the kind goes on to the mind. Its switch puts my Mac to sleep.",
    },
    { id: "noted", kind: "end", lane: "mac", at: [1, 0], label: "the mood only", about: "Most hooks only keep the mood: a tool call while Claude works changes nothing, so nothing goes to the board." },
    reaction("fail", "tests_fail", "tests failed", [1, 0], "A test command Claude ran failed (PostToolUseFailure)."),
    reaction("done", "done", "done", [1, 1], "Claude stopped with nothing else going on, or a test command passed: they share one celebration."),
    clock("fail-clock", "tests_fail", [2, 1]),
    clock("done-clock", "done", [2, 2]),
    {
      id: "check",
      kind: "station",
      lane: "mind",
      at: [3, 0],
      label: "an act?",
      glyph: "check",
      servers: 1,
      capacity: 0,
      work: CHECK,
      spec: "or nothing",
      failLabel: "nothing",
      about: `Sage's mind (mind/, a small Node process beside the bridge, one JSON line each way and one answer at a time) hears only the kind of thing that happened, with the time and the mood, never a command, a prompt or a path, and answers with an act or nothing. The bridge gives it MIND_ANSWER, ${MIND_ANSWER * 1000} ms; it answers in about 0.05 ms. A tap is answered while its patience lasts (a poke costs ${PATIENCE.poke} of it, it comes back at ${PATIENCE.back} a second, and out of it Sage sulks and stays cross ${CROSS_FROM} to ${CROSS_FROM + CROSS_SPAN} s); a knock and a beat get their own acts. Here the check is the simulator's way of reading a clock: busy for the instant a mark is turned away, so the signal behind it plays nothing.`,
    },
    { id: "nothing", kind: "end", lane: "mind", at: [4, 0], label: "nothing", about: "Played too lately, or nobody to ask: the answer is only a why for the bridge's log (\"played 40 s ago\")." },
    { id: "forgot", kind: "end", lane: "mind", at: [3, 2], label: "mark gone", about: "A mark leaves its clock when the cooldown is over, or at once when it was turned away." },
    {
      id: "beat",
      kind: "start",
      lane: "link",
      at: [2, 0],
      label: "heartbeat",
      every: HEARTBEAT_EVERY,
      classes: { heartbeats: 1 },
      about: `Every HEARTBEAT_EVERY, ${HEARTBEAT_EVERY} s, the bridge sends h and the seconds since midnight: the board's clock, and its sign that the bridge is there.`,
    },
    {
      id: "down",
      kind: "station",
      lane: "link",
      at: [3, 0],
      label: "lines down",
      glyph: "network",
      servers: 1,
      capacity: 1,
      work: LINKS.usb,
      about: `One line at a time: e <act>, h <time>, and s <mood>, c <colour> and o <corner counts> when they change. USB serial through the board's CH343 at ${BAUD.toLocaleString("en-US")} baud is 6 to 20 bytes in under 2 ms; Wi-Fi is TCP to sage.local:4210 with a pairing token, and a line can wait for the next beacon (the firmware leaves Wi-Fi's modem sleep on); the emulator gets the same lines as Server-Sent Events from GET /emulator/events; the real firmware in QEMU reads them on a pty. Choose the link with its setting.`,
      dials: [{ label: "Link", options: [{ label: "USB serial" }, { label: "Wi-Fi", set: { work: LINKS.wifi } }, { label: "emulator", set: { work: LINKS.emulator } }, { label: "QEMU", set: { work: LINKS.qemu } }] }],
    },
    { id: "unsent", kind: "end", lane: "link", at: [4, 0], label: "not sent", about: "My Mac asleep: the heartbeat falls due and nothing runs. One waits for the Mac to wake; the rest are never sent." },
    { id: "heard", kind: "end", lane: "board", at: [3, 0], label: "clock set", about: "Any line counts as hearing from the bridge; h also sets the board's clock." },
    {
      id: "player",
      kind: "station",
      lane: "board",
      at: [4, 0],
      label: "plays it",
      glyph: "phone",
      spec: `an act, ${Math.floor(Math.min(...PLAYS))} to ${Math.ceil(Math.max(...PLAYS))} s`,
      servers: 1,
      capacity: 2,
      work: { "tests failed": playOf("tests_fail"), finishes: playOf("done"), taps: playOf("look_up"), heartbeats: r3(seconds.hello), else: 0 },
      about: `The ESP32-S3 plays one sequence at a time from sage.bin at ${FPS} frames a second, drawing every frame itself, mirrored for the prism. An act starts from idle, so it first walks there from working (${r3(WALK)} s), and it never cuts an act short: the next waits for it to end (the board keeps one waiting, the newest). Each act is as long as the art says. After a minute with no line (HOST_TIMEOUT_MS, ${HOST_TIMEOUT} s) it falls apart into the rain and forms again, its antenna goes dark, and it goes its own way: it fidgets every ${OWN_FROM} to ${OWN_FROM + OWN_SPAN} s and answers taps itself.`,
    },
    { id: "played", kind: "end", lane: "board", at: [4, 1], label: "played" },
    { id: "dropped", kind: "end", lane: "board", at: [3, 1], label: "dropped", outcome: "rejected", about: "A third line while one plays and one waits: the board keeps only the newest waiting one." },
    {
      id: "taps",
      kind: "start",
      lane: "board",
      at: [1, 0],
      label: "a tap",
      every: "uni 60 240",
      classes: { taps: 1 },
      about: `A knock on the glass: the board's motion sensor, sampled every 2 ms, feels a jolt over ${TAP_G} g, and another within ${TAP_GAP} s is the same tap. The board prints tap; over USB the bridge reads the port 256 bytes at a time with a ${READ_TIMEOUT} s timeout, so a short line waits up to ${READ_TIMEOUT} s for the read to end. Here, one every 1 to 4 minutes (assumed).`,
    },
  ],
  routes: [
    { from: "hooks", to: "post", latency: "logn 0.0082 0.0103", label: "" },
    { id: "keep", from: "post", to: "noted", when: "class:tool calls", label: "mood only" },
    { id: "to-fail", from: "post", to: "fail", when: "class:tests failed", label: "tests", latency: ASK },
    { id: "to-done", from: "post", to: "done", when: "else", label: "done", latency: ASK },
    { id: "fail-mark", from: "fail", to: "fail-clock", emit: "marks", label: "mark" },
    { id: "fail-ask", from: "fail", to: "check", latency: BEHIND },
    { id: "done-mark", from: "done", to: "done-clock", emit: "marks", label: "mark" },
    { id: "done-ask", from: "done", to: "check", latency: BEHIND },
    { id: "fail-held", from: "fail-clock", to: "check", when: "rejected", label: "held", seldom: true },
    { id: "fail-over", from: "fail-clock", to: "forgot", when: "else", label: "" },
    { id: "done-held", from: "done-clock", to: "check", when: "rejected", label: "held" },
    { id: "done-over", from: "done-clock", to: "forgot", when: "else", label: "" },
    { id: "check-gone", from: "check", to: "forgot", when: "class:marks", label: "" },
    { id: "none", from: "check", to: "nothing", when: "rejected", label: "lately" },
    { id: "act", from: "check", to: "down", when: "else", label: "e <act>" },
    { from: "taps", to: "check", latency: `uni 0 ${READ_TIMEOUT}`, label: "tap" },
    { from: "beat", to: "down", label: "h" },
    { id: "asleep", from: "down", to: "unsent", when: "rejected", label: "", seldom: true },
    { id: "relink", from: "down", to: "player", when: `late:${HOST_TIMEOUT - HEARTBEAT_EVERY}`, label: "hello", seldom: true },
    { id: "beat-in", from: "down", to: "heard", when: "class:heartbeats", label: "" },
    { id: "line", from: "down", to: "player", when: "else", label: "" },
    { id: "full", from: "player", to: "dropped", when: "rejected", label: "", seldom: true },
    { id: "done-play", from: "player", to: "played", when: "else", label: "" },
  ],
  claims: [
    { metric: "kind.finishes.end.nothing", min: 0.4, say: "most finishes play nothing: Sage celebrates at most once in ten minutes" },
    { metric: "kind.tool calls.end.noted", min: 0.99, say: "a tool call only keeps the mood" },
    { metric: "lead.p50", max: 0.1, say: "most moments cross my Mac in milliseconds" },
  ],
};

// what the caption measures, from a run's log
const HOOKS = ["tool calls", "tests failed", "finishes"], SIGNALS = ["tests failed", "finishes"];
function measure(log) {
  const born = new Map(log.filter((r) => r.k === "born").map((r) => [r.tok, r]));
  const kind = (tok) => born.get(tok)?.cls;
  const m = { hooks: 0, signals: 0, played: 0, fail: 0, failPlayed: 0, fin: 0, finNothing: 0, unsent: 0, relinks: 0, line: [], acts: [], trip: [] };
  const starts = new Map();
  for (const r of log) {
    if (r.k === "start" && r.at === "player") starts.set(r.tok, r.t);
    if (r.k === "finish" && r.at === "player" && SIGNALS.includes(kind(r.tok))) m.acts.push(r.t - starts.get(r.tok));
    if (r.k === "finish" && r.at === "down" && SIGNALS.includes(kind(r.tok))) m.line.push(r.t - born.get(r.tok).t);
    if (r.k === "move" && r.route === "::hooks>post") m.trip.push(r.t1 - r.t);
    if (r.k === "move" && r.route === "::relink") m.relinks += 1;
    if (r.k !== "done") continue;
    const k = kind(r.tok);
    if (HOOKS.includes(k)) m.hooks += 1;
    if (SIGNALS.includes(k)) m.signals += 1;
    if (SIGNALS.includes(k) && r.at === "played") m.played += 1;
    if (k === "tests failed") { m.fail += 1; if (r.at === "played") m.failPlayed += 1; }
    if (k === "finishes") { m.fin += 1; if (r.at === "nothing") m.finNothing += 1; }
    if (k === "heartbeats" && r.at === "unsent") m.unsent += 1;
  }
  return m;
}
const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const ms = (v) => (v < 0.01 ? `${(v * 1000).toFixed(1)} ms` : `${Math.round(v * 1000)} ms`);
const s1 = (v) => `${v.toFixed(1)} s`;
const asleep = (t, span) => {
  const off = [{ part: "hooks", set: { paused: true } }, { part: "post", set: { servers: 0 } }, { part: "check", set: { servers: 0 } }, { part: "down", set: { servers: 0 } }];
  const on = [{ part: "hooks", set: { paused: false } }, { part: "post", set: { servers: 1 } }, { part: "check", set: { servers: 1 } }, { part: "down", set: { servers: 1 } }];
  return [...off.map((c) => ({ ...c, t })), ...on.map((c) => ({ ...c, t: t + span }))];
};

export const figure = {
  fig: "Fig 1",
  pace: 3,
  speed: 1,
  outage: 120,
  burst: 120,
  watch: { kinds: ["tests failed", "finishes", "taps"], label: "moments played", window: 300 },
  embedHeight: true,
  caption: ({ sim, variant }) => {
    const base = measure(sim.log);
    const fix = measure(variant(null, { changes: [{ t: 0, part: "hooks", set: { classes: FIX_LOOP } }] }).log);
    const night = measure(variant(null, { changes: asleep(300, 120) }).log);
    const wifi = measure(variant(null, { changes: [{ t: 0, part: "down", set: { work: LINKS.wifi } }] }).log);
    const relink = night.relinks ? ` The heartbeat that waited finds the board more than a minute alone, and it plays hello.` : "";
    return (
      `A quarter of an hour of one Claude Code session at work, simulated: ${base.hooks} hooks reach the bridge, and only ${base.signals} of them are news for Sage's mind (a test run that finished, or Claude stopping); the rest only keep the mood. ` +
      `The mind plays ${base.played} of those ${base.signals}: it celebrates at most once in ten minutes and reacts to a failing test at most once a minute, however often they come, so ${base.finNothing} of the ${base.fin} finishes play nothing. ` +
      `An act's line is on the link ${ms(median(base.line))} after its hook fired, ${median(base.trip) / median(base.line) >= 0.9 ? "almost all of it" : `${ms(median(base.trip))} of that`} the hook command starting curl (${ms(median(wifi.line))} over Wi-Fi, whose wait for the next beacon is assumed); then the board walks to idle and plays it, ${s1(median(base.acts))} at the median. ` +
      `Put Claude in a fix loop and ${fix.fail} failing test runs play ${fix.failPlayed} acts. Put my Mac to sleep for two minutes and ${night.unsent} heartbeats are never sent.${relink} ` +
      `Click hooks to choose what Claude is doing, the switch on POST /hook to put my Mac to sleep, and lines down to change the link.`
    );
  },
};
