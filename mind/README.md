# Sage's mind

A small Node process beside the bridge (`tools/buddy_bridge.py`) that chooses the act Sage plays when something happens on the author's computer. The bridge keeps everything else: the link to the board, Claude Code's hooks, the commands it reads, the calendar, Slack, the usage, the sounds and the board's moods. It tells the mind what kind of thing happened and plays what the mind answers with the board's `e <act>`; the acts are in the art, so nothing goes over Wi-Fi for them.

## The pieces

| File | What it is |
|---|---|
| `table.mjs` | The reactions, as plain data: the signals each answers, its acts with their weights, its priority and its cooldown. A new reaction is one entry. Also the vocabulary of signals below. |
| `mind.mjs` | The engine: priorities, cooldowns, no repeats, weights, acts the art lacks, its battery, its idling and its patience. |
| `site.mjs` | The website's own code for Sage's face, mood and patience (`design/site/sage-site.js`), run as it is in a `vm` context, never copied. |
| `art.mjs` | The names of the acts the art holds, read with the emulator's parser (`emulator/board.mjs`). |
| `sage-mind.mjs` | The protocol adapter: this contract on stdin and stdout. |

## The contract with the bridge (protocol 1)

JSON lines both ways. The bridge writes one object a line; the mind answers each line with exactly one line, in the order they came, carrying the same `id`. It writes nothing else and logs nothing.

The first message says which protocol the bridge speaks and what the art holds, as a file the emulator's parser reads or as the names of its acts:

```
{"id": 0, "signal": "art", "protocol": 1, "path": "/path/to/sage.bin"}
{"id": 0, "signal": "art", "protocol": 1, "acts": ["hello", "tap_hello", ...]}
-> {"id": 0, "protocol": 1, "acts": 31, "why": "the art holds 31 acts; not these of the table: ..."}
```

An answer with another protocol, or with no acts, leaves the bridge without the mind. Until the art is known, nothing is chosen.

Every other message is a signal, with the time and the board's mood as the bridge sets it, and only the context a reaction needs:

```
{"id": 7, "signal": "tests", "now": 1763300000.5, "mood": "working", "ok": false}
-> {"id": 7, "play": "work_tests_fail", "why": "tests failed"}
-> {"id": 8, "why": "done: played 40 s ago"}
```

The answer is the act to play (`play`, the name of an act the art holds; the bridge sends nothing that is not `[a-z0-9_]`) or none, and `why`, a short reason for the bridge's log: what it reacted to and which of the table's acts the art lacks, or why nothing plays.

Never in a message: a command, a prompt, a path or any output of the author's work. The bridge reads those on the machine and tells the mind only the kind of thing that happened.

### The signals

| Signal | Context | Sent when | What Sage does |
|---|---|---|---|
| `tests` | `ok` | a test command Claude ran finished (PostToolUse: worked; PostToolUseFailure: failed) | failed: `work_tests_fail`, `life_tests_fail`, `holo_tests`, `holo_screen_tests` or `glyph_glitch`, a minute apart; passed: the celebration of `done` |
| `build` | `ok` | a build command | worked: `work_build`, `life_build`, `holo_build`; failed: `glyph_glitch`, `work_tests_fail` |
| `push` | `ok` | `git push` | `life_deploy`, `done_glider` |
| `deploy` | `ok` | a deploy command | `work_deploy`, `life_deploy` |
| `conflict` | `ok` | a merge, rebase, pull or cherry-pick that failed with a conflict | `tap_dizzy`, `glyph_glitch` |
| `commit` | `ok` | `git commit` | `nod`, a minute apart |
| `rollback`, `lint`, `big_diff` | `ok` | a revert, reset or restore; a linter; a diff or show over 20 KB | nothing yet |
| `done` | `busy` | Claude stopped; `busy` when other sessions still work or wait | not busy: `done_glider`, `done_hearts`, `glyph_joy`, `holo_screen_self`, ten minutes apart, shared with tests passing |
| `compact` | | the context is compacted (PreCompact) | `glyph_rain`, `glyph_decode` |
| `hello` | | the first session after two quiet hours | `hello`, `glyph_form` |
| `oops` | | a tool call failed while working, and no signal above played an act | `work_oops`, a start it shakes off, twenty seconds apart |
| `waiting` | | a session has waited for the author more than a minute, every 30 s while it waits | `fidget_look`, `fidget_glance`, three minutes apart |
| `idle` | `around`, `late` | about once a minute while idle; `around`: the author was active in the last half hour; `late`: the night window (from midnight to eight) | mostly fidgets, now and then the camera, a hologram or the rain; late, `holo_clock` once a night and `glyph_doze` now and then; away, only fidgets |
| `usage` | `battery` | the Claude usage left (one minus the busier window's share) changed | `holo_battery` when it falls below a quarter, then not until it has been back above; `go_charge` when it is near empty (3% or less), once, before it runs out |
| `tap` | `battery`, `around` | the board felt a tap | it depends on the moment, the rhythm and your history with it (below) |
| `shake` | `battery` | not sent yet: the board feels no shake | a lift, for its patience |

The mood decides what may break in: while asleep (`night`) or at a meeting's alarm (`meeting`) only what a touch brings plays, and while something needs the author (`alert`) only `waiting` and what a touch brings.

## How it chooses

- Only acts the art holds, and its why names the ones of the table the art lacks.
- A reaction to work preempts one to the author, which preempts late at night, which preempts idling: while an act plays, a less urgent reaction plays nothing. The board does not cut an act short: a more urgent one waits for it to end.
- A cooldown per reaction, from its last act.
- Weights: a lower weight is a rarer act.
- No repeats: none of the last six acts chosen while at least two others are left to weigh; otherwise as the website picks a pastime, each the less likely the sooner it was chosen, and never the one just chosen unless repeating it is the reaction's meaning (a tap, its battery).

## How it takes a touch

On the desk, Sage is given a way of its own to take being touched, deeper than the website's (the author gave it a free hand here). What a tap means depends on three things: the moment, the rhythm of your taps, and your history with it. Its patience is still the website's `newPatience`, `stepPatience` and `outOfPatience`, but only a plain poke spends it.

- **Asleep** (`night`): the first tap stirs it (`sleep_stir`: half an eye open, and back to sleep), the next wakes it (`cam_wake`), and woken again and again in a minute and a half it sulks.
- **A knock**, two quick taps (under 0.95 s apart, the board reports none closer than 0.6 s) after three quiet seconds: it leans to the glass and looks out to see who is there (`tap_knock`).
- **A beat**, four taps evenly spaced 0.6 to 1.6 s apart: it dances to it (`rhythm_dance`). That is play, not a bother. Once it has danced it will not again for twenty seconds, and more of the same is poking again.
- **While it needs you** (`alert`): your tap is "seen it" (the bridge snoozes the alert), and it nods (`nod`).
- **While it reads** (`working`): it looks up at you (`fidget_look`, `fidget_glance`), and back to its book.
- **The first tap of a new day**, with you around: a greeting (`hello`, `glyph_eyes`, `glyph_form`).
- **Otherwise a tap is a poke**: `tap_hello` while its patience lasts. A poke in the middle of an act is being gone to and costs more; on its charger (battery at 3% or less) it costs more too.
- **Running out**: picked up (a shake, which the board does not feel yet), it is dizzy (`tap_dizzy`); gone to in the middle of an act, it glitches (`glyph_glitch`); on its charger, do not disturb (`dnd`: its shutter comes down); otherwise it minds it and sulks (`sulk`: it turns away, glances back to see if you are watching, and turns away again). Then it is cross for 30 to 50 seconds, as on the website, and taps are answered with the website's own words for it.
- **A grudge, and making up**: after running out it holds a grudge; once the crossness has passed, a gentle tap (2.5 s or more after the one before) makes up, with hearts (`done_hearts`).
- **Fondness**: gentle taps warm it a little, the first of the day more, making up more still, and running out cools it; it fades by half every eight hours. Fond of you (above 0.6), about one tap in three is answered with hearts instead of a hello.

When the art lacks the act for a moment, or the moment has just played, the tap is a plain poke instead.

## The contract with the art

Only the names of the acts it holds. Their lengths, when the parser gives them, only tell the mind how long Sage is busy; an art given by name alone is taken as four seconds an act.

## Running it

The bridge starts it with the art the board or the emulator plays, and starts it again if it stops (after 2 seconds, doubling up to 5 minutes). In `~/.desk-buddy/config.json`, `"mind": false` turns it off, `"mind": "<path>"` runs another `sage-mind.mjs`, and `"node": "<path>"` names Node when the login item's PATH has none. Without it, or when it is slow (no answer in 300 ms) or stops, the bridge does what it did before the mind and logs the trouble once.

```sh
cd mind && node --test            # the engine, the protocol and the contract
node mind/checks/e2e.mjs          # the real bridge and mind, the page in headless Chromium (about two minutes)
```
