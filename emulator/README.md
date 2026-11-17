# The emulator

A web page that behaves like the board. It plays a `.bin` the way the firmware does (the same parser, the same moods and transitions, the same things the board does on its own, the same pixels), and it plugs into the real bridge as if it were the board, so a Claude Code hook changes the mood on the page and a click on the page reaches the bridge as a tap. It is the test bed while there is no hardware, and afterwards the place to try anything before flashing it.

## Running it

```sh
python3 tools/buddy_bridge.py --emulator
```

Then open http://127.0.0.1:47823/emulator/. The bridge serves the page itself, so the page and the bridge are the same origin. Run it from a checkout of this repository (the copy `tools/install_bridge.sh` installs has no `emulator/` beside it), and stop a bridge already running as a login item first: both want port 47823, which is where the Claude Code hooks post (`tools/install_hooks.py`). With the hooks installed, real Claude Code sessions drive the page.

- `--art FILE` chooses the `.bin` the page plays. Without it the bridge takes `"art"` in its `config.json`, else `firmware/data/sage.bin`, else the test card (`emulator/testcard/testcard.bin`).
- `--port N` serves on another port (the hooks still post to 47823).
- `"emulator": true` in `~/.desk-buddy/config.json` does the same as `--emulator`.
- The emulator link needs only the standard library: no pyserial, nothing to install.

The page also works without the bridge, from any static server (`python3 -m http.server --directory emulator`): it then runs offline, as a board on a charger does, and the Serial box sends it commands as the bridge would.

## On the page

- **The prism.** The board's 240 by 240 picture inside a dark cube, screen-blended so black reads as glass, with a soft glow. The firmware draws mirrored (`setRotation(4)`) for the prism's reflection; the page shows what the eye sees, the right way round. The backlight is a brightness filter driven by the firmware's own `backlight()`.
- **A click is a tap.** It is one accelerometer jolt of 1 g fed to the firmware's `imuTask` logic. The board has no double tap: a second knock within 600 ms is the same tap, so a double click is one tap. The firmware has no shake gesture either, so there is no shake key.
- **The board.** Its state as the `?` command reports it (mode, target, what is playing), plus what its antenna shows (offline, its ball dark or a ring going out; back, the relink), the queued event, fps (frames pushed per second, counted as the board counts them), draw time on this machine, backlight, body colour, the corner counts, the clock the bridge gave it, taps and clips. Anything the board would get wrong with this art (a missing transition it would cut, a mood it would index out of bounds) is listed under it.
- **Serial.** Every line in (from the bridge) and out (from the board), a box to type commands, a reboot, and a button to load another `.bin` (or a `.clip`, added as `POST /clip` would add it).

## How it is built

| File | What it mirrors |
|---|---|
| `board.mjs` | `firmware/src/main.cpp`: `parseArt`, the player (`startSeq`, `nextHop`, `settle`, `setTarget`, `playEvent`, and `pickAct`, the board's own choice of a tap or a fidget), `runDemo`, `autoBehaviour`, `backlight`, `imuTask`'s tap logic, `heardFromHost`, `runOffline` with the rain, what its antenna shows offline and when the bridge comes back (`antennaDark`, `antennaStep`, `drawAntenna`) and the unplugged mark for art that marks no antenna, `overlayVisible` and `drawOverlay`, `handleLine` and `reply`, the clip store (`addClip`, `dropOldestClip`, `dropClip`, `onClipDone`) and `loop`. Each method names the function it ports. |
| `vec.mjs` | `firmware/src/vec.h`, the board's instruction renderer, line for line, into an RGB565 buffer. |
| `glyphs.mjs` | `firmware/src/glyphs.h`, the board's glyph frames (version 6): the atlas's checks and the blend of each glyph's coverage, line for line. |
| `packed.mjs` | `firmware/src/packed.h`, the board's compressed frames (version 7): the checks of a record, the window a frame is inflated into after its base, and when it inflates. The inflating is a hook: `inflate-node.mjs` (Node's zlib) in the tests and checks, and in the page `prepare()`, which inflates a file's compressed frames with the browser's `DecompressionStream` when the file arrives. |
| `antenna.mjs` | `firmware/src/antenna.h`, what the board draws on Sage's antenna about the bridge: the instructions for `vec` it builds at the ball a frame marks (instruction 28), in integer arithmetic so the bytes are the board's. |
| `lgfx.mjs` | The few LovyanGFX fills the corner marks use. |
| `app.mjs`, `index.html` | The page: the prism, input, readouts, and the link to the bridge. |

The board's loop runs every 2 ms (its `delay(2)`) on the wall clock, so frames are picked by elapsed time and slow ones are skipped, as on the board. The link is the bridge's third transport (`Emulator` in `tools/buddy_bridge.py`): the board's commands arrive as Server-Sent Events from `GET /emulator/events`, one event per line; what the board prints goes back by `POST /emulator/board`; a clip arrives as an event carrying the bytes `POST /clip` would carry, and the page answers `ok` or `err ...` as the board's HTTP reply would. As on the board's TCP port, the newest page wins. The emulator routes answer only their own page (same host, no other site's origin).

## What differs from the board, and why

- **No Wi-Fi.** The link behaves like USB: no pairing token, `W` reports `wifi=off`, and `w` answers an error instead of saving and restarting. There is no internet clock, so offline the board knows the time only from the bridge's heartbeat (which is what a board without Wi-Fi set up does).
- **Time and memory are this machine's.** `draw_ms` is the JavaScript renderer on this computer; the board's own is measured only on the board. The page inflates a file's compressed frames when it arrives (the browser inflates only asynchronously), so its `draw_ms` leaves out the inflating the board does as it draws. There is no PSRAM limit, so a clip never fails with "out of memory". A background tab is throttled by the browser: time keeps (it is the wall clock), but the loop runs less often until the tab is shown again.
- **The motion sensor is a click.** One sample of 1 g per click; the board's continuous noise is not modelled, so `i` reports a peak of 0 when nothing was tapped in the last 4 s.
- **The corner marks are close, not exact.** They use the classic midpoint and scanline fills; LovyanGFX's own may differ by a pixel at an edge. Nothing checks them against LovyanGFX.
- **The art is the file.** The board maps the whole art partition and bounds-checks against it; the page checks against the file.
- **A deflate stream with bytes after its end.** The board's tinfl and Node's zlib ignore them; the browser's `DecompressionStream` refuses the frame. The bake never writes one: only a file made by hand has them.
- **Undefined behaviour is reported, not copied.** Where the firmware would read out of bounds (a mood the art does not have), the page lists it and does nothing.

## Checks

```sh
cd emulator && node --test                       # the board on a fake clock, and the renderer against vec.h
python3 -m unittest discover -s tests            # the bridge, its emulator link included (from the repository root)
node emulator/checks/vec_fidelity.mjs [file]     # every instruction frame through vec.mjs and through tools/vec_check.cpp
node emulator/checks/glyph_fidelity.mjs file [refs]   # every glyph frame through glyphs.mjs and tools/glyph_check.cpp, and against Chrome's pictures (the bake's --refs)
node emulator/checks/pack_fidelity.mjs file [--time]  # every compressed frame inflated by the emulator, the page's way and tools/pack_check.cpp (the ROM's tinfl)
node emulator/checks/antenna_fidelity.mjs [file]  # every instruction frame with the antenna's overlay, by the emulator and by tools/antenna_check.cpp
node emulator/checks/e2e.mjs --sheet out.png     # the real bridge and the page in headless Chromium, with a contact sheet
```

- `tests/board.test.mjs`: parsing (either magic, and that every truncated file fails cleanly), the state graph's routes, the timeouts (alert to waiting at 45 s, working to longhaul at 10 minutes, offline at a minute, offline fidgets), taps (only reported with the bridge there, the board's own choice offline), the rain at the board's own moments, the demo, the clip store and its eviction, colour, corner marks, backlight and the replies' format (`tests/antenna.test.mjs` has the antenna). Nothing to install.
- `tests/glyphs.test.mjs`: version 6 (its atlas and glyph frames parsed, every truncation and damage refused cleanly), known pixels, clipping, drawing order, a clip's own atlas, and the emulator against `glyphs.h`.
- `tests/packed.test.mjs`: version 7 (every kind of frame compressed, alone or after a base, drawn as its uncompressed twin; every truncation and damaged head refused when the file is read; every damaged byte of a deflate refused when drawn, or drawn exactly), the window's reuse of a base, a clip with its own bases, the page's way of inflating, and the emulator against `packed.h` with the ROM's tinfl, damaged bytes included.
- `tests/antenna.test.mjs`: the mark a frame carries (instruction 28: read back, absent, cut short), version 8's flags and every truncation of such a file, the overlay over time (after 8 s the ball dark and a ring a second in every four; back, the relink ring at once and the hello), the corner mark kept for art that marks no antenna and never shown with art that does, and the emulator's overlay against `antenna.h` (with clang++).
- `vec_fidelity.mjs` builds `tools/vec_check.cpp` with clang++ (as the bake does) and hands it the emulator's picture of each frame as the reference, with the bake's tolerance (mean 2% of full scale, 300 pixels far off). It and `glyph_fidelity.mjs` inflate compressed frames first, as the emulator does.
- `pack_fidelity.mjs` builds `tools/pack_check.cpp` (the firmware's `packed.h` with `tools/tinfl.h`, the ROM's miniz 1.15) and compares, byte for byte, what it, the emulator and the page's way of inflating make of every compressed frame; `--time` adds this machine's inflate times.
- `antenna_fidelity.mjs` builds `tools/antenna_check.cpp` (the firmware's `vec.h` and `antenna.h`) and hands it, for every instruction frame, the emulator's picture of the frame with the antenna's overlay at one of its steps (taken in turn: the ball dark, five steps of the faint ring, three of the relink): the overlay's bytes must be the same, whether a frame marks its ball must agree, and the pictures must be within the bake's tolerance.
- `e2e.mjs` starts the bridge in emulator mode on a free port with a temporary home, opens the page in Chromium (`$CHROME`, else Playwright's cached headless shell) over the DevTools protocol, posts hooks with the same curl command the installed hooks use, clicks the prism, sends a clip, and removes its temporary folders.

## The test card

`testcard/` stands in for a character until Sage is drawn: it is not Sage, nothing in it is a character, and it is MIT like the rest of the engine. `testcard/index.html` implements the interface `tools/export_frames.py` bakes from (`window.__lump`: `meta`, `seqLen`, `at`, `atSeq`, `fxFor`, `render`, `setTint`, `CLIPS`) and draws one plain shape per mood:

| Mood | Shape |
|---|---|
| idle | a teal disc, breathing |
| working | an amber square turning inside a dashed ring |
| alert | an orange triangle, pulsing, a ring going out |
| waiting | a red triangle rocking, three dots taking turns |
| done | a green star turning, rays around it |
| longhaul | a darker amber square with a dot on an elliptical orbit |
| night | a pale blue crescent, stars twinkling |
| meeting | a blue ring with a bar across |
| awake | a cream diamond that blinks, a sparkle at its corner |
| letter | an envelope |

The bar under every shape is drawn in the body-colour marker, so the board's `c` command repaints it. Every pair of base moods has a transition (the mood shrinks away, the next grows in), and there are events in the shape of desk-buddy's: `hello`, `oops`, three fidgets, a tap act for each daytime mood eleven times over (one shared ripple each, so the readout names the one the board chose), meeting prep and a night startle. The board's own choice of a tap picks among those drawn for its mood, so the card exercises the choice by mood that Sage's art, whose acts all start from idle, does not. `testcard/ping.clip` is a clip made of the card's own drawings through the tool's `--define`.

Baking them (headless Chrome, or Playwright's headless shell through `CHROME`):

```sh
export CHROME=~/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell
nice -n 19 python3 tools/export_frames.py --bake --page emulator/testcard/index.html --out emulator/testcard/testcard.bin
nice -n 19 python3 tools/export_frames.py --page emulator/testcard/index.html --clip ping --define emulator/testcard/ping.json --out emulator/testcard/ping.clip
```

The card keeps to what `vec.h` draws exactly: a negative `lineDashOffset` is ignored by it, and strokes under a squash are only approximated, so frames using either fall back to pixels. Both files are version 7, every frame compressed (the card is 51,703 bytes, its 787 frames the same as when it was 152,408 bytes uncompressed).
