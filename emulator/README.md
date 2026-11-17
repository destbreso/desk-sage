# The emulator

A web page that behaves like the board. It plays a `.bin` the way the firmware does (the same parser, the same moods and transitions, the same things the board does on its own, the same pixels), and it plugs into the real bridge as if it were the board, so a Claude Code hook changes the mood on the page and a click on the page reaches the bridge as a tap. It is the test bed while there is no hardware, and afterwards the place to try anything before flashing it. It shows the board two ways: Simple, the bare board seen from the front, and Realistic, the device in 3D at its real size with the board's picture live in its prism.

## Running it

```sh
python3 tools/buddy_bridge.py --emulator
```

Then open http://127.0.0.1:47823/emulator/. The bridge serves the page itself, so the page and the bridge are the same origin. Run it from a checkout of this repository (the copy `tools/install_bridge.sh` installs has no `emulator/` beside it), and stop a bridge already running as a login item first: both want port 47823, which is where the Claude Code hooks post (`tools/install_hooks.py`). With the hooks installed, real Claude Code sessions drive the page.

- With Docker, `docker compose up` at the repository's root runs the same in a container: the bridge in emulator mode, Sage's mind, and the page at the same address. Inside it the bridge listens on every address (`--listen 0.0.0.0`), and `compose.yaml` publishes the port to this machine only, since the bridge has no login. Stop a native bridge first, as both want port 47823. `SAGE_PORT` moves the port inside and out together (the page is answered only on the address it was opened from), but the hooks still post to 47823. In the container the bridge has none of the Mac's senses: the Claude app, idle and sounds are not watched.
- `--art FILE` chooses the `.bin` the page plays. Without it the bridge takes `"art"` in its `config.json`, else `firmware/data/sage.bin`, else the test card (`emulator/testcard/testcard.bin`).
- `--port N` serves on another port (the hooks still post to 47823).
- `"emulator": true` in `~/.desk-buddy/config.json` does the same as `--emulator`.
- The emulator link needs only the standard library: no pyserial, nothing to install.

The page also works without the bridge, from any static server: it then runs offline, as a board on a charger does, and the Serial box sends it commands as the bridge would. Serve the repository's root (`python3 -m http.server`, then http://127.0.0.1:8000/emulator/): with no `art.bin` beside the page it plays `firmware/data/sage.bin`, and Realistic finds `hardware/model.js`. Served from `emulator/` alone it has no art until you load one, and only Simple works. `?art=URL` chooses the file in either case. Looking for the bridge and its `art.bin`, a page on a static server gets two 404s, which the console lists.

## On the page

- **Simple or Realistic.** One switch over the board chooses how it is shown. Both views show the same board, driven by the same link, so switching changes nothing the board does. Simple is the default, being the lighter. The choice is remembered in the browser (`localStorage`; where that is blocked the page opens in Simple and still switches), and `?mode=simple` or `?mode=realistic` opens one view without remembering it.
- **Simple: the board.** The bare board square from the front, at its real proportions, drawn from `hardware/model.js`'s measurements: its black mask, the display with the black tape over the panel's bonded edge below it, and the pads that show past the display's edges. The board's 240 by 240 picture fills the display's active area as it is, with no glow and no blending. The firmware draws mirrored (`setRotation(4)`) for the prism's reflection; the page shows the picture the right way round, as the eye sees it through the prism. The backlight is a brightness filter driven by the firmware's own `backlight()`.
- **Realistic: the device.** The stand, the case, the display and the prism cube of `hardware/index.html`, at their real size in millimetres, drawn with three.js. Each time the board pushes a frame, its canvas is copied onto the model's display, mirrored as the firmware draws it, and the cube's diagonal reflects it the right way round; the backlight dims the display and its reflection as the brightness filter dims Simple. The view never draws Sage: it only shows the board's canvas, the antenna and the corner marks included. Drag to turn it, scroll or pinch to zoom, and Reset view to come back. It draws only while it is shown, at the screen's rate (a slow GPU draws fewer pixels rather than fewer frames), and its frame rate is in the readouts beside the board's. three.js comes from jsdelivr, loaded the first time Realistic is shown; without it, or without WebGL, the view says so and Simple still works.
- **A click is a tap.** It is one accelerometer jolt of 1 g fed to the firmware's `imuTask` logic. In Realistic, a click on any part of the device is the tap; a click on the desk around it is not, and neither is a drag. Enter or Space on the focused view taps it too. The board has no double tap: a second knock within 600 ms is the same tap, so a double click is one tap. The firmware has no shake gesture either, so there is no shake key.
- **The link switch.** Beside the views, a button cuts the page's link to the bridge and restores it, so you can watch the board lose the bridge and find it again without stopping the bridge. Cut, nothing reaches the board and nothing it says goes back, and the board goes offline exactly as it would: once it has heard nothing for its own `HOST_TIMEOUT_MS` (60 s), into the rain and then its antenna dark. The page counts down to that moment, and Skip the wait moves the board's clock ahead by the time left (the board itself always waits; its logic is untouched, only its clock jumps, with everything the clock times). Restored, the bridge sees a new page, resends the mood, colour and corner marks with its heartbeat, and the board plays its relink ring and its hello. With no bridge at all (a static server), the same button connects a stand-in instead, and says so: it sends the board the bridge's heartbeat (`h` and the time of day, every 15 s) and nothing else, so the relink can be tried without Python running. The board plays its hello only when it had a bridge before and lost it, so the stand-in's first heartbeat brings only the relink ring. The link's state is on the status line in both views and first in the readouts.
- **The board.** Its state as the `?` command reports it (mode, target, what is playing), plus what its antenna shows (offline, its ball dark or a ring going out; back, the relink), the queued event, fps (frames pushed per second, counted as the board counts them), draw time on this machine, backlight, body colour, the corner counts, the clock the bridge gave it, taps and clips. Anything the board would get wrong with this art (a missing transition it would cut, a mood it would index out of bounds) is listed under it.
- **Serial.** Every line in (from the bridge) and out (from the board), a box to type commands, a reboot, and a button to load another `.bin` (or a `.clip`, added as `POST /clip` would add it). Commands opens the list of every command the board understands (`handleLine`), each with its syntax, what it does and an example; an example goes into the box, and Enter sends it. While you type, the box suggests the commands, then after `s ` the art's moods and after `e ` its acts (each with the mood it is drawn from and its length), read from the parsed art, so they follow whatever `.bin` or clip is loaded. Arrows move through them, Tab or Enter takes one, Escape closes them, and a click or a touch takes one too; nothing opens until you type or press the down arrow. Any line but `w` and `W` counts as hearing from the bridge, as it does on the board, so typing a command while the link is cut puts the board back in touch until it times out again.

## How it is built

| File | What it mirrors |
|---|---|
| `board.mjs` | `firmware/src/main.cpp`: `parseArt`, the player (`startSeq`, `nextHop`, `settle`, `setTarget`, `playEvent`, and `pickAct`, the board's own choice of a tap or a fidget), `runDemo`, `autoBehaviour`, `backlight`, `imuTask`'s tap logic, `heardFromHost`, `runOffline` with the rain, what its antenna shows offline and when the bridge comes back (`antennaDark`, `antennaStep`, `drawAntenna`) and the unplugged mark for art that marks no antenna, `overlayVisible` and `drawOverlay`, `handleLine` and `reply`, the clip store (`addClip`, `dropOldestClip`, `dropClip`, `onClipDone`) and `loop`. Each method names the function it ports. |
| `vec.mjs` | `firmware/src/vec.h`, the board's instruction renderer, line for line, into an RGB565 buffer. |
| `glyphs.mjs` | `firmware/src/glyphs.h`, the board's glyph frames (version 6): the atlas's checks and the blend of each glyph's coverage, line for line. |
| `packed.mjs` | `firmware/src/packed.h`, the board's compressed frames (version 7): the checks of a record, the window a frame is inflated into after its base, and when it inflates. The inflating is a hook: `inflate-node.mjs` (Node's zlib) in the tests and checks, and in the page `prepare()`, which inflates a file's compressed frames with the browser's `DecompressionStream` when the file arrives. |
| `antenna.mjs` | `firmware/src/antenna.h`, what the board draws on Sage's antenna about the bridge: the instructions for `vec` it builds at the ball a frame marks (instruction 28), in integer arithmetic so the bytes are the board's. |
| `lgfx.mjs` | The few LovyanGFX fills the corner marks use. |
| `app.mjs`, `index.html` | The page: the two views, input, readouts, the Serial box, and the link to the bridge (its switch, and the stand-in). |
| `front.mjs` | Simple: the board drawn from the front in SVG, from `hardware/model.js`'s measurements, and the board's picture placed on its display's active area. |
| `device.mjs` | Realistic: `hardware/model.js` in a three.js scene, the board's canvas copied onto its display when the board pushes a frame, picking for the tap, and the orbit. |
| `commands.mjs` | The Serial box's list of commands and its completion. Its table is kept in step with `handleLine()` by hand. |

The board's loop runs every 2 ms (its `delay(2)`) on the wall clock, so frames are picked by elapsed time and slow ones are skipped, as on the board. Realistic draws on the same thread, in `requestAnimationFrame`, and copies the board's picture only when the board has pushed a new one; the board pushed the same frames a second in both views when measured side by side (`docs/HISTORY.md`). With `?capture` the board's clock steps only when the page is told (`__emu.advance(ms)`) and the 3D view draws only when asked (`__emu.still(view)`), so a capture gets every frame the board would show at that moment (`tools/live_gif.mjs`). The link is the bridge's third transport (`Emulator` in `tools/buddy_bridge.py`), which also serves the page and, for Realistic, `hardware/model.js` (and nothing else from `hardware/`): the board's commands arrive as Server-Sent Events from `GET /emulator/events`, one event per line; what the board prints goes back by `POST /emulator/board`; a clip arrives as an event carrying the bytes `POST /clip` would carry, and the page answers `ok` or `err ...` as the board's HTTP reply would. As on the board's TCP port, the newest page wins. The emulator routes answer only their own page (same host, no other site's origin).

## What differs from the board, and why

- **No Wi-Fi.** The link behaves like USB: no pairing token, `W` reports `wifi=off`, and `w` answers an error instead of saving and restarting. There is no internet clock, so offline the board knows the time only from the bridge's heartbeat (which is what a board without Wi-Fi set up does).
- **Time and memory are this machine's.** `draw_ms` is the JavaScript renderer on this computer; the board's own is measured only on the board. The page inflates a file's compressed frames when it arrives (the browser inflates only asynchronously), so its `draw_ms` leaves out the inflating the board does as it draws. There is no PSRAM limit, so a clip never fails with "out of memory". A background tab is throttled by the browser: time keeps (it is the wall clock), but the loop runs less often until the tab is shown again.
- **The motion sensor is a click.** One sample of 1 g per click; the board's continuous noise is not modelled, so `i` reports a peak of 0 when nothing was tapped in the last 4 s.
- **The corner marks are close, not exact.** They use the classic midpoint and scanline fills; LovyanGFX's own may differ by a pixel at an edge. Nothing checks them against LovyanGFX.
- **The art is the file.** The board maps the whole art partition and bounds-checks against it; the page checks against the file.
- **A deflate stream with bytes after its end.** The board's tinfl and Node's zlib ignore them; the browser's `DecompressionStream` refuses the frame. The bake never writes one: only a file made by hand has them.
- **Realistic is a model, not a photograph.** The glass, its coating and the share of light the diagonal reflects (90%) are the hardware page's, by eye; nothing about them is measured. Seen from the side, the cube's edge cuts Sage's reflection, as the shader works it out; that the real cube does the same at the same angles is not checked.
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
node emulator/checks/realistic.mjs [--shots DIR] # Realistic with the real bridge and from a static server, with captures
```

- `tests/board.test.mjs`: parsing (either magic, and that every truncated file fails cleanly), the state graph's routes, the timeouts (alert to waiting at 45 s, working to longhaul at 10 minutes, offline at a minute, offline fidgets), taps (only reported with the bridge there, the board's own choice offline), the rain at the board's own moments, the demo, the clip store and its eviction, colour, corner marks, backlight and the replies' format (`tests/antenna.test.mjs` has the antenna). Nothing to install.
- `tests/glyphs.test.mjs`: version 6 (its atlas and glyph frames parsed, every truncation and damage refused cleanly), known pixels, clipping, drawing order, a clip's own atlas, and the emulator against `glyphs.h`.
- `tests/packed.test.mjs`: version 7 (every kind of frame compressed, alone or after a base, drawn as its uncompressed twin; every truncation and damaged head refused when the file is read; every damaged byte of a deflate refused when drawn, or drawn exactly), the window's reuse of a base, a clip with its own bases, the page's way of inflating, and the emulator against `packed.h` with the ROM's tinfl, damaged bytes included.
- `tests/antenna.test.mjs`: the mark a frame carries (instruction 28: read back, absent, cut short), version 8's flags and every truncation of such a file, the overlay over time (after 8 s the ball dark and a ring a second in every four; back, the relink ring at once and the hello), the corner mark kept for art that marks no antenna and never shown with art that does, and the emulator's overlay against `antenna.h` (with clang++).
- `vec_fidelity.mjs` builds `tools/vec_check.cpp` with clang++ (as the bake does) and hands it the emulator's picture of each frame as the reference, with the bake's tolerance (mean 2% of full scale, 300 pixels far off). It and `glyph_fidelity.mjs` inflate compressed frames first, as the emulator does.
- `pack_fidelity.mjs` builds `tools/pack_check.cpp` (the firmware's `packed.h` with `tools/tinfl.h`, the ROM's miniz 1.15) and compares, byte for byte, what it, the emulator and the page's way of inflating make of every compressed frame; `--time` adds this machine's inflate times.
- `antenna_fidelity.mjs` builds `tools/antenna_check.cpp` (the firmware's `vec.h` and `antenna.h`) and hands it, for every instruction frame, the emulator's picture of the frame with the antenna's overlay at one of its steps (taken in turn: the ball dark, five steps of the faint ring, three of the relink): the overlay's bytes must be the same, whether a frame marks its ball must agree, and the pictures must be within the bake's tolerance.
- `e2e.mjs` starts the bridge in emulator mode on a free port with a temporary home, opens the page in Chromium (`$CHROME`, else Playwright's cached headless shell) over the DevTools protocol, posts hooks with the same curl command the installed hooks use, clicks the prism, sends a clip, and removes its temporary folders.
- `realistic.mjs` (helpers in `checks/browser.mjs`; Chromium on the Mac's GPU through Metal) does the same in Realistic with Sage's art and mind: no console errors; the display's picture equal to the board's canvas pixel for pixel after each frame drawn, and changing; the view's frame rate; a push hook's act on the device; a click on the prism reaching the bridge as a tap, and a click on the desk or a drag not; the link cut, its countdown, the wait skipped, the rain and the dark antenna, then the relink and the hello; the bridge stopped and the antenna dark after the board's own minute. Then from a static server: the committed art, the stand-in's relink (with no hello the first time), the command list and the completion from the art, the view remembered between visits and Simple when storage is blocked, and a phone's width with no sideways scroll. It takes about two and a half minutes.

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
