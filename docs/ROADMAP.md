# Sage on the desk: the roadmap

What is left, phase by phase. Once something is done, its record goes to `docs/HISTORY.md` and any loose end it leaves comes back here.

## Decided

- **One Sage.** Its face, mood and patience are destbreso.com's own code, brought by `tools/sync-site.sh` into `design/site/sage-site.js` and never edited here. Its body is drawn from the 3D model's measurements.
- **Who it is.** Its personality is the website's, respected and given more depth on the desk (CLAUDE.md, Who Sage is).
- **Its look.** Illustrated for everyday: each part lit as a soft cube (a tone a face, a band where faces meet, a soft light and a specular spot), the prism's light on its edges, the visor's glass and bezel, seams, screws and treads, all drawn as the board's instructions (about 6 KB a frame). Made of the rain's glyphs for its special moments. No 3D render for now; the room's 3D Sage stored as JPEG (about 7 KB a frame) stays a possibility once the board's decoding speed is measured.
- **Public, with Sage licensed.** The repository is public; Sage's art is all rights reserved, and the engine is MIT. It names no other project of the author's.
- **Its worlds are several.** What comes for the author's work is made for Sage (a glitch, the prompt, its modules), its desk is also a board of the Game of Life, it projects holograms as its mind shows on the website, and it is made of the rain for its special moments; no one theme takes over. An act redone keeps the old one as a variant.
- **Holograms are light, from its lens.** Thrown from a lens on the top edge of its head, with no panel: glowing strokes cut into scan lines, a band running down them, a flicker; on the desk on a shape that suits what they show, in the air, or over the whole screen.
- **The prism.** Black vanishes in the glass, so Sage's visor disappears and its shell and eyes float; its graphite is lifted from the room's colour so it does not vanish too.
- **Sage's mind beside the bridge** (the author, 2026-11-16). Sage's mind runs as a small Node process beside the Python bridge (`mind/`): it holds the table of reactions and runs the website's own patience and mood code, the same bundle the art uses (one Sage, never copied). The bridge keeps the link to the board, Claude Code's hooks, the commands it reads, the calendar, Slack, the usage and the sounds, and asks the mind what to do; the mind chooses acts, and the moods stay the bridge's.
- **How it takes a touch is its own on the desk** (the author, 2026-11-16: a free hand to give its personality depth, without copying the website). A tap's meaning depends on the moment, the rhythm of the taps and its history with you: asleep it stirs, then wakes, then sulks; a knock makes it look out; a beat makes it dance; a tap while it needs you is seen; the first of the day is a greeting; out of patience it is dizzy, glitches, will not be disturbed or sulks, holds a grudge, and makes up with hearts after a gentle tap; it grows fond of you. Its patience is still the website's code (`mind/README.md`, How it takes a touch).
- **Modular by its contracts, and no further.** Asked how to keep the bridge, the render and the mind easy to maintain: the table of reactions is plain data (a new reaction is one entry), the chooser is a small engine, the website's code is loaded as it is, and the protocol adapter stands on its own. The contract between the bridge and the mind is `mind/README.md` (a protocol version in the first message, the signals, the answers), tested from both sides; the contract with the art is the names of the acts it holds. No plugin system, hot loading, separate services or abstract interfaces: this is one person's desk companion.

## Phase 2: Sage drawn as code

- Glyph moments: the mind plays the rain's acts now and then while Sage idles, for a compaction and for a failure, and `glyph_form` for a hello; nothing plays them yet at the board's own moments: forming out of the rain on waking and after a reboot, dissolving into it when the bridge is gone.
- Room for more: `sage.bin` holds all 53 acts in 3,849,687 bytes with its frames compressed (version 7), 30.9% of the partition, 8.6 MB left; at about 970 bytes a stored frame, room for about 8,800 more frames.
- The holograms show fixed numbers (02:14, 23%, ten passed and two failed). Real ones (the time, the battery, the test counts) need the board to draw the digits itself over a frame: a small overlay of seven-segment strokes, fed by the bridge, in the hologram's place.
- The bake depends on the browser: Chrome for Testing 148 bakes 361 of Sage's frames differently from Google Chrome 157, which baked the committed art. Saying which browser bakes, or pinning it, keeps a rebake comparable with the file before it.
- Why `vec.h` drew the reading light's faint cone differently from Chrome (13 frames, stored as pixels until the cone was left out below a third of its light) was not looked into: a faint wash over a wide area may still miss elsewhere.
- What glyph frames do not reproduce, for new glyph art: a translucent glyph over another cuts into it, since its alpha is folded against black (within the tolerance in Sage's art, at most 52 pixels far off); the atlas is rendered in white, and Chrome draws text slightly heavier or lighter by its colour, so dark glyphs drift (up to 21 of 255 for a dark grey glyph in a probe; Sage's are bright); and text at a fractional x is rounded to a pixel, where Chrome places it on quarter pixels.
- Expressions that read on a 25 mm cube: worried and cross barely differ from calm with the website's face as it is. An emphasis the website's face could take as an option, leaving the website as it is, is the author's decision (below).
- The bake reads `window.__sage` rather than the name it was written with. The bridge, `tools/ota.py` and `tools/flash.sh` still look for `firmware/data/lump.bin`, so `sage.bin` reaches the emulator only through `--art`, and the board not at all yet.
- More acts (45 now), towards about 50 in a first version and about 175 in a complete one: idle fidgets so it never looks like a loop, reactions to the author's work, interaction, daily life, rare surprises.
- A skill for writing Sage's clips: a staging brief so they do not all look alike (change at least three of where, from where, how close, how long, the rhythm and the ending), a contact sheet checked before a clip is kept, the punchline held, no words or brands.

## Phase 3: Sage's mind in the bridge

The mind is built (`mind/`, its contract in `mind/README.md`, its record in `docs/HISTORY.md`). What is left:

- Its voice: the room's chirps, at their exact frequencies, rendered to sound files for the Mac to play (the board has no speaker). Until then the bridge's sounds are Lump's moments (`sounds.json`, class `Sounds`), and the scripts that made his WAVs (`tools/make_sounds.py`, `tools/make_gag_sounds.py`) left with his art, so there are none to play and `tools/install_bridge.sh` stops at them.
- Acts its reactions still lack: a rollback, a linter and a big diff answer nothing yet; going to charge plays its act, but nothing yet keeps it on its charger afterwards.
- The board's own tap: the firmware still reacts to a tap by itself with Lump's gag names (`pickTap` in `firmware/src/main.cpp`); with Sage's art it finds none, so only the mind's act plays, but the board's reaction should go through the mind or pick the art's `tap_*` acts (Phase 6). Its `gag <name>` line for a `tap_*` act also reaches the bridge's gag sounds, which look for Lump's `tap_<gag>.wav`.
- Lump's names still in the bridge: `GAGS`, `ANIMATIONS`, `FIDGETS`, `CLIP_SETS`, `CLIP_HOURS`, `COMMAND_CLIPS` and the limit, meeting and Slack clips. They play only when the mind is not there, except the meeting clips and Slack's paper plane and letter, which are still the bridge's and Lump's. `POST /play` knows Lump's names and clips, not Sage's acts (`/cmd` with `e <act>` plays any).
- The installed bridge: `tools/install_bridge.sh` copies only `buddy_bridge.py` into `~/.desk-buddy`, so the login item has no `mind/` beside it and carries on without it, until the installer runs it from a checkout or `"mind"` in `config.json` names one.
- A shake: the mind takes one (being picked up, so running out there is dizzy), but the board feels none yet (Phase 6).
- Cross on its face: the mind keeps whether Sage is cross (it then answers taps with nothing), but the board's moods are the bridge's, so its face does not show it.
- The committed art predates 13 of the table's acts (the holograms, the Life acts, `done_hearts`, `glyph_form`); they play once the art is baked again (Phase 2, room). Until then a failing test has two of its five acts, and the rule against repeats makes them alternate more than their weights say (measured 62% and 38% against 3 to 1).

## Phase 4: the author's workflow as Sage's senses

Everything stays on the machine: what the hooks see is read there and never sent anywhere. Reactions are described by the kind of work; what is particular to one of the author's projects (a mark Sage shows for it) is in the bridge's local config.

Some of these reach the mind already as one act each (a new session, tests, builds, pushes, deploys, a merge conflict, a compaction, a Stop, waiting, late at night: the signals in `mind/README.md`); what is left of those rows is the rest of what Sage does there (watching then proud, a project's mark, suggesting sleep), and the other rows.

| What happens | Where it is read | What Sage does |
|---|---|---|
| A Claude Code session starts | SessionStart, its working directory | hello, and that project's mark on its face for a moment, if the local config gives one |
| The author answers or approves | UserPromptSubmit | pleased to be looked at, then back to work |
| Claude edits and reads files | PreToolUse | reads, turns pages |
| Tests run and pass, or fail | PostToolUse on the test commands | watches, then proud, or worried and looking for the bug |
| Type errors | the type checker's output | squints |
| A production or release build | the build commands | waits, then content |
| A heavy job at low priority | `nice -n 19` | settles in to wait, patient |
| A render, a gate saying it is ready | the render and gate commands | watches the film, happy when it is ready |
| A commit, a push | `git commit`, `git push` | a nod; a push to the website's main branch means a deploy |
| The website is live | the commit's deploy status on GitHub | proud, hearts |
| A merge conflict | git's output | whoa |
| A subagent or a workflow starts | the Agent and Workflow tools | calls for help, keeps watch until they report |
| The context is compacted | PreCompact | dizzy, forgets, reboots |
| A permission is asked and nobody answers | PermissionRequest, then time | turns to you, then taps its foot, then sulks |
| Claude stops and waits for the author | Stop | looks at you, content |
| Late at night | the clock | yawns, then suggests sleep |
| The author is away, then back | macOS idle time, the screen locked | dozes; hello on return |

## Phase 5: the gallery

- Every animation of Sage (moods, transitions, acts and reactions), each with what triggers it, replayed from the baked frames, with the emulator beside it to try them. The page there now (`gallery/index.html`, Lump's) replays only uncompressed instruction frames: glyph, pixel and compressed frames (all of Sage's since version 7) show black.

## Phase 6: the board

- Lump's names out of the firmware and the bridge (the file's magic, the hostname, the art partition, the `X-Lump-*` headers, the hard-coded mood names), and its gags and fidgets chosen from whatever the art holds (`tap_*`, `fidget_*`) instead of Lump's list. Recolouring (`recolour8`) assumed Lump's magenta body and goes or is rewritten; glyph frames already keep their own colours.
- A shake felt by the motion sensor (it feels only taps today, and no double tap): Sage gets dizzy, as when it is lifted in the room. The mind already takes it as a `shake` signal; the board and the bridge have to send it.
- Clips over Wi-Fi made safe: a hash checked on arrival, an eviction that cannot empty the store when a clip fails to parse (the emulator reproduces it), and room checked before memory runs out. The bridge's `/hook` and `/cmd` routes checked for their origin.
- Found by the emulator, to fix or keep knowingly: `vec.h` ignores a negative `lineDashOffset` and only approximates strokes under a non-uniform scale; `autoBehaviour` asks for "waiting" and "longhaul" without checking the art has them; a pixel frame whose first run is pure white draws that run black; taps in the first 600 ms after boot are ignored.
- The firmware compiles (PlatformIO in `tools/.venv`, `pio run` in `firmware/`), but by hand, and its platform is not pinned: `espressif32` resolved to 8.0.0 on its first compile. Pinning it, and compiling whenever `main.cpp`, `vec.h` or `glyphs.h` change, keeps it from drifting from the emulator. It builds with six warnings that were there before (misleading indentation in `vec.h` and `main.cpp`, a `volatile` increment, one in the Arduino core).
- Compressed frames on the board: how long tinfl takes to inflate a frame from the art partition into the window in PSRAM is not measured, nor whether the worst (two inflates, 15,348 bytes, for a frame after a keyframe not yet in the window; 26 to 44 µs on an M4) leaves room in a frame's 41 ms for drawing it. If it does not, the window could move to internal RAM (Sage's largest needs 15,348 bytes of the 172,800 allocated), or the bake trade size for speed: each frame deflated on its own takes one inflate, at about 5.2 MB.
- With the board: flashed, its real frame rate and draw times measured (a glyph frame's too: Sage's largest has 352 glyphs, 22,696 bitmap pixels), every frame checked with `vec_check` and `glyph_check`, the corner marks checked against LovyanGFX's, and the prism's visible area measured.
- An enclosure shaped as Sage, the prism its face, from the 3D model's measurements (optional).

## Open questions for the author

- **The face's emphasis.** On a 25 mm cube worried and cross need slants stronger than the website's face draws. An option on the website's face code, used only by the desk, would keep one face and leave the website as it is.
