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

- Glyph moments: the board forms out of the rain after a boot and dissolves into it when the bridge is gone (`docs/HISTORY.md`); nothing yet forms it out of the rain on waking from the night.
- Room for more: `sage.bin` holds all 53 acts in 3,849,687 bytes with its frames compressed (version 7), 30.9% of the partition, 8.6 MB left; at about 970 bytes a stored frame, room for about 8,800 more frames.
- The holograms show fixed numbers (02:14, 23%, ten passed and two failed). Real ones (the time, the battery, the test counts) need the board to draw the digits itself over a frame: a small overlay of seven-segment strokes, fed by the bridge, in the hologram's place.
- The bake depends on the browser: Chrome for Testing 148 bakes 361 of Sage's frames differently from Google Chrome 157, which baked the committed art. Saying which browser bakes, or pinning it, keeps a rebake comparable with the file before it.
- Why `vec.h` drew the reading light's faint cone differently from Chrome (13 frames, stored as pixels until the cone was left out below a third of its light) was not looked into: a faint wash over a wide area may still miss elsewhere.
- What glyph frames do not reproduce, for new glyph art: a translucent glyph over another cuts into it, since its alpha is folded against black (within the tolerance in Sage's art, at most 52 pixels far off); the atlas is rendered in white, and Chrome draws text slightly heavier or lighter by its colour, so dark glyphs drift (up to 21 of 255 for a dark grey glyph in a probe; Sage's are bright); and text at a fractional x is rounded to a pixel, where Chrome places it on quarter pixels.
- Expressions that read on a 25 mm cube: worried and cross barely differ from calm with the website's face as it is. An emphasis the website's face could take as an option, leaving the website as it is, is the author's decision (below).
- The bake's interface with the page it bakes is still named for Lump: `tools/export_frames.py` reads `window.__lump` and hands the page `window.__lumpExport`, which `design/sage.html` and the test card answer to. Renaming it means changing the bake, `design/sage.html` and `emulator/testcard/index.html` together, and baking both again to show nothing else moved.
- More acts (53 now), towards about 50 in a first version and about 175 in a complete one: idle fidgets so it never looks like a loop, reactions to the author's work, interaction, daily life, rare surprises.
- A skill for writing Sage's clips: a staging brief so they do not all look alike (change at least three of where, from where, how close, how long, the rhythm and the ending), a contact sheet checked before a clip is kept, the punchline held, no words or brands.

## Phase 3: Sage's mind in the bridge

The mind is built (`mind/`, its contract in `mind/README.md`, its record in `docs/HISTORY.md`). What is left:

- Its voice: the room's chirps, at their exact frequencies, rendered to sound files for the Mac to play (the board has no speaker). Until then nothing installs `sounds.json` and the bridge is silent. The moments it would sound (`needs_you`, `thanks`, `on_it`, `finished`, `finished_while_busy`, `hello`, `uh_oh`, `goodnight`, `waking_up`, `still_waiting`, `long_job`, `fidget`, in class `Sounds` and the bridge's calls to it) are Lump's, kept as a place to start; which of them Sage says is decided with the voice. The board no longer says when an act starts (Lump's `gag` line went with his gag sounds), so a sound timed to an act needs a line like it back.
- Acts its reactions still lack: a rollback, a linter and a big diff answer nothing yet; going to charge plays its act, but nothing yet keeps it on its charger afterwards.
- Slack: a DM or a mention is noticed and logged, at most once a minute, and plays nothing (the paper plane was Lump's). An act for it would go through the mind, as a signal of its vocabulary; the VIP letter is a mood and plays as before.
- The installed bridge runs Sage's mind from the checkout it was installed from (`config.json` names its `mind/sage-mind.mjs` and its art): moving that checkout, or leaving it on a branch whose mind is broken, leaves the login item without the mind until the installer runs again. A login item was installed only into a temporary HOME, with `launchctl` stubbed, never on this Mac.
- The mind takes a tap with `battery` only: `around`, which its contract names for a tap, is left out, so it takes the author as there, which a tap means.
- A shake: the mind takes one (being picked up, so running out there is dizzy), but the board feels none yet (Phase 6).
- Cross on its face: the mind keeps whether Sage is cross (it then answers taps with nothing), but the board's moods are the bridge's, so its face does not show it.
- An act queued behind another gives way to a mood sent after it (the player's rule, `settle` in `firmware/src/main.cpp`): the hello the board plays when the bridge comes back is lost if the bridge's mood arrives while the rain still plays, and so is a hello the mind plays during the form after a boot.

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

- **The real firmware without the board.** What runs without hardware today is the emulator (`emulator/`, the firmware rewritten in JavaScript and checked against it) and the firmware's own drawing, glyph and inflating code (`vec.h`, `glyphs.h`, `packed.h`) built natively on the Mac and compared frame by frame. What nothing runs yet is the real firmware as a whole: `main.cpp`'s loop and tasks, reading the art partition, PSRAM, the serial protocol in C++, Wi-Fi. Two simulators could run the real binary:
  - Espressif's QEMU fork runs an ESP32-S3 flash image (bootloader, partition table, program and the art partition) and has a virtual framebuffer, but no ST7789 as the firmware drives it: a build that draws into that framebuffer instead would be needed, and whether its PSRAM is emulated is not documented ([Espressif's QEMU guide](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/tools/qemu.html)). It is the official tool, and the first to try.
  - Wokwi simulates the ESP32-S3 and takes custom chips written in C (a QMI8658 that sends taps), with its serial port reachable over RFC2217 for the bridge, though a reported bug answers it only while VS Code is in the foreground ([Wokwi's ESP32 guide](https://docs.wokwi.com/guides/esp32)). A ready-made ST7789 was not confirmed.
  Either would check that the real binary boots, reads `sage.bin`, plays its moods and acts, speaks the protocol to the real bridge and goes offline and back. Neither measures time (they are not cycle-accurate): whether a frame is drawn within its 41 ms still needs the board.
- Recolouring (`recolour8`, and the body colour the bridge sends with `c`) assumed Lump's magenta body and goes or is rewritten; glyph frames already keep their own colours. The default colour is still his Tangerine.
- Lump's names left on purpose: the mood names, which are the board's interface; the bake's page interface (Phase 2); `tools/build_gallery.py`, which still copies `firmware/data/lump.bin` for Lump's gallery page (Phase 5 rewrites both); the bake's clip path (`design/clip_kit.js`, gone, and its notes on his wobbles and pinks); the enclosure's `lump_monitor_mount.scad`; and desk-buddy's own names (`~/.desk-buddy`, `com.deskbuddy.*`, the `deskbuddy` mDNS service), which are the engine's.
- With two tap acts in the art (`tap_hello`, `tap_knock`), never the same twice running makes the board's offline taps alternate strictly; a third would loosen it.
- A shake felt by the motion sensor (it feels only taps today, and no double tap): Sage gets dizzy, as when it is lifted in the room. The mind already takes it as a `shake` signal; the board and the bridge have to send it.
- Clips over Wi-Fi made safe: a hash checked on arrival, an eviction that cannot empty the store when a clip fails to parse (the emulator reproduces it), and room checked before memory runs out. The bridge's `/hook` and `/cmd` routes checked for their origin.
- Found by the emulator, to fix or keep knowingly: `vec.h` ignores a negative `lineDashOffset` and only approximates strokes under a non-uniform scale; a pixel frame whose first run is pure white draws that run black; taps in the first 600 ms after boot are ignored.
- The firmware compiles (PlatformIO in `tools/.venv`, `pio run` in `firmware/`), but by hand, and its platform is not pinned: `espressif32` resolved to 8.0.0 on its first compile. Pinning it, and compiling whenever `main.cpp`, `vec.h` or `glyphs.h` change, keeps it from drifting from the emulator. It builds with six warnings that were there before (misleading indentation in `vec.h` and `main.cpp`, a `volatile` increment, one in the Arduino core).
- Compressed frames on the board: how long tinfl takes to inflate a frame from the art partition into the window in PSRAM is not measured, nor whether the worst (two inflates, 15,348 bytes, for a frame after a keyframe not yet in the window; 26 to 44 µs on an M4) leaves room in a frame's 41 ms for drawing it. If it does not, the window could move to internal RAM (Sage's largest needs 15,348 bytes of the 172,800 allocated), or the bake trade size for speed: each frame deflated on its own takes one inflate, at about 5.2 MB.
- With the board: flashed, its real frame rate and draw times measured (a glyph frame's too: Sage's largest has 352 glyphs, 22,696 bitmap pixels), every frame checked with `vec_check` and `glyph_check`, the corner marks checked against LovyanGFX's, and the prism's visible area measured.
- The hardware page (`hardware/`) is drawn from Waveshare's published drawings, schematic and photos; the board on the desk will settle what they leave open: where the CH343P, the QMI8658A and the WS2812B sit on the display side, and the WS2812B's package; the USB-C's place along its edge (inferred from its shell's slots); what the 3.4 mm of metal between the display and the board is, and where the flex cable lands; the thicknesses of the display's layers; how the standoffs are held; the inside of the stand and of the case, and whether the -C's stand holds the board in the -B's case or bare; and the three parts on the component side not identified (a SOT-363, a SOT-23, an 8-pin part marked 21357). Each goes into `hardware/model.js` and `hardware/parts.js`, and its mark as not published comes off.
- An enclosure shaped as Sage, the prism its face, from the 3D model's measurements (optional).

## Open questions for the author

- **Offline, in the rain or on its own.** When the bridge goes, the board dissolves into the rain and forms again at once, then lives on its own (idles, fidgets, answers taps, sleeps at night) and says hello when the bridge comes back; asleep, it notices neither. The other reading of "back from it when the bridge returns" keeps it in the rain until then, which would leave a board on a charger with no Sage on it. Chosen here: the first.

- **The face's emphasis.** On a 25 mm cube worried and cross need slants stronger than the website's face draws. An option on the website's face code, used only by the desk, would keep one face and leave the website as it is.
