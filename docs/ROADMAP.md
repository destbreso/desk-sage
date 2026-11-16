# Sage on the desk: the roadmap

What is left, phase by phase. Once something is done, its record goes to `docs/HISTORY.md` and any loose end it leaves comes back here.

## Decided

- **One Sage.** Its face, mood and patience are destbreso.com's own code, brought by `tools/sync-site.sh` into `design/site/sage-site.js` and never edited here. Its body is drawn from the 3D model's measurements.
- **Who it is.** Its personality is the website's, respected and given more depth on the desk (CLAUDE.md, Who Sage is).
- **Its look.** Illustrated for everyday: flat fills shaded in steps, a specular spot, the prism's light on its edges, contact shadows, the visor's glass and bezel, seams, screws and treads, all drawn as the board's instructions (about 2 to 5 KB a frame). Made of the rain's glyphs for its special moments. No 3D render for now; the room's 3D Sage stored as JPEG (about 7 KB a frame) stays a possibility once the board's decoding speed is measured.
- **Public, with Sage licensed.** The repository is public; Sage's art is all rights reserved, and the engine is MIT. It names no other project of the author's.
- **The prism.** Black vanishes in the glass, so Sage's visor disappears and its shell and eyes float; its graphite is lifted from the room's colour so it does not vanish too.

## Phase 2: Sage drawn as code

- The first drawing is flat (`design/sage-draw.js`): it becomes the illustrated one, its shading and details as in the approved sheet, for every pose and prop.
- Glyph moments: the acts are drawn and stored as glyph frames, but nothing plays them at their moments yet: forming out of the rain on waking and after a reboot, dissolving into it when the bridge is gone, and now and then by itself.
- The hand-over from glyphs to the illustrated Sage is still pixels: its 66 frames lay the illustrated Sage over its glyphs with `drawImage`, 2.2 MB, a quarter of `sage.bin`. A glyph frame with instructions drawn over it, or a fade the board draws itself, would make it small.
- The art no longer fits as it grows: baked with the 3D engine and the things made for Sage that came while glyph frames were built, the file is 13,647,844 bytes, 1.2 MB over the partition (1,652 frames as instructions, 404 as glyphs, 79 as pixels: the hand-over's 66, 2.3 MB, and 13 instruction frames that no longer match closely enough). The committed `sage.bin` is from before them.
- What glyph frames do not reproduce, for new glyph art: a translucent glyph over another cuts into it, since its alpha is folded against black (within the tolerance in Sage's art, at most 52 pixels far off); the atlas is rendered in white, and Chrome draws text slightly heavier or lighter by its colour, so dark glyphs drift (up to 21 of 255 for a dark grey glyph in a probe; Sage's are bright); and text at a fractional x is rounded to a pixel, where Chrome places it on quarter pixels.
- Expressions that read on a 25 mm cube: worried and cross barely differ from calm with the website's face as it is. An emphasis the website's face could take as an option, leaving the website as it is, is the author's decision (below).
- The bake reads `window.__sage` rather than the name it was written with. The bridge, `tools/ota.py` and `tools/flash.sh` still look for `firmware/data/lump.bin`, so `sage.bin` reaches the emulator only through `--art`, and the board not at all yet.
- More acts, towards about 50 in a first version and about 175 in a complete one: idle fidgets so it never looks like a loop, reactions to the author's work, interaction, daily life, rare surprises.
- A skill for writing Sage's clips: a staging brief so they do not all look alike (change at least three of where, from where, how close, how long, the rhythm and the ending), a contact sheet checked before a clip is kept, the punchline held, no words or brands.

## Phase 3: Sage's mind in the bridge

- One table of reactions (signal, how Sage reads it, what it does), with priorities, cooldowns and no repeats, in place of the bridge's fixed hook-to-mood rules and its list of gags.
- Its battery is the author's Claude usage (the bridge already reads it): below a quarter it droops, near the limit it goes to charge.
- Its patience from the website's code: a tap is a poke, being bothered while charging makes it cross, and running out gives dizzy, a glitch or do not disturb.
- Its voice: the room's chirps, at their exact frequencies, rendered to sound files for the Mac to play (the board has no speaker).
- Where the mind runs: the website's mind is TypeScript, so the reactions run in a small Node process beside the Python bridge, or replace its decision part.

## Phase 4: the author's workflow as Sage's senses

Everything stays on the machine: what the hooks see is read there and never sent anywhere. Reactions are described by the kind of work; what is particular to one of the author's projects (a mark Sage shows for it) is in the bridge's local config.

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

- Every animation of Sage (moods, transitions, acts and reactions), each with what triggers it, replayed from the baked frames, with the emulator beside it to try them. The page there now (`gallery/index.html`, Lump's) replays only instruction frames: glyph and pixel frames show black.

## Phase 6: the board

- Lump's names out of the firmware and the bridge (the file's magic, the hostname, the art partition, the `X-Lump-*` headers, the hard-coded mood names), and its gags and fidgets chosen from whatever the art holds (`tap_*`, `fidget_*`) instead of Lump's list. Recolouring (`recolour8`) assumed Lump's magenta body and goes or is rewritten; glyph frames already keep their own colours.
- A shake felt by the motion sensor (it feels only taps today, and no double tap): Sage gets dizzy, as when it is lifted in the room.
- Clips over Wi-Fi made safe: a hash checked on arrival, an eviction that cannot empty the store when a clip fails to parse (the emulator reproduces it), and room checked before memory runs out. The bridge's `/hook` and `/cmd` routes checked for their origin.
- Found by the emulator, to fix or keep knowingly: `vec.h` ignores a negative `lineDashOffset` and only approximates strokes under a non-uniform scale; `autoBehaviour` asks for "waiting" and "longhaul" without checking the art has them; a pixel frame whose first run is pure white draws that run black; taps in the first 600 ms after boot are ignored.
- The firmware compiles (PlatformIO in `tools/.venv`, `pio run` in `firmware/`), but by hand, and its platform is not pinned: `espressif32` resolved to 8.0.0 on its first compile. Pinning it, and compiling whenever `main.cpp`, `vec.h` or `glyphs.h` change, keeps it from drifting from the emulator. It builds with six warnings that were there before (misleading indentation in `vec.h` and `main.cpp`, a `volatile` increment, one in the Arduino core).
- With the board: flashed, its real frame rate and draw times measured (a glyph frame's too: Sage's largest has 352 glyphs, 22,696 bitmap pixels), every frame checked with `vec_check` and `glyph_check`, the corner marks checked against LovyanGFX's, and the prism's visible area measured.
- An enclosure shaped as Sage, the prism its face, from the 3D model's measurements (optional).

## Open questions for the author

- **The face's emphasis.** On a 25 mm cube worried and cross need slants stronger than the website's face draws. An option on the website's face code, used only by the desk, would keep one face and leave the website as it is.
