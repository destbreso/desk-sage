# Sage on the desk: what is done

What this project has, how each piece came and how it was checked. The roadmap holds only what is left (`docs/ROADMAP.md`).

## The start (2026-11-16)

- The engine is Joe Bentham's desk-buddy (MIT) with Chris Simpkins's fork on top (MIT): the firmware for the Waveshare ESP32-S3-LCD-1.3 prism (240 by 240, RGB565, a QMI8658 motion sensor for taps), the Mac bridge that turns Claude Code's hooks into moods, frames stored as Canvas 2D drawing instructions that the board renders itself (Chris's: a frame of about 1 KB instead of 8), clips over Wi-Fi without flashing, and reactions to what the terminal runs.
- All of Lump's art left with the first commit (his drawings, clips, sounds, the menu bar app with his frames and the clip skill written for him), and Sage's license came in: all rights reserved for Sage, MIT for the rest.

## The emulator (2026-11-16)

The test bed while there is no board (`emulator/`, its README says how to run it).

- `emulator/board.mjs` is the firmware's `main.cpp` in JavaScript, each method naming the function it mirrors: the file's parser, the state graph (`nextHop`, `settle`, `setTarget`), events, taps and their gags, `autoBehaviour`, `runOffline` with its unplugged mark, the corner marks, the backlight, the line protocol, the demo and the clip store (32, the one played longest ago evicted); its loop runs on wall-clock time, so slow frames are dropped as on the board. `emulator/vec.mjs` is `vec.h` line for line, into RGB565, so the page shows the board's own pixels.
- The page (`emulator/index.html`): the prism, a click as a tap, the board's readouts (frame rate, draw time, backlight, colour, counts, clips), its serial log and a command box.
- The bridge's third link (`--emulator`, or `"emulator": true` in its config): it serves the page, sends each line of the protocol as a Server-Sent Event, takes the board's replies by POST and delivers clips as `POST /clip` would, with nothing new to install; serial and TCP behave as before.
- A test card (`emulator/testcard/`): an abstract shape a mood, with transitions and events, baked by the bake tool with its new `--page` option (787 frames, all instructions, 152 KB), so the emulator and its tests have real frames and no character's art.
- Checked: 36 JavaScript tests (parsing, routes, the timeouts, offline, taps, clip eviction, colour and backlight) and 93 Python ones (76 that were there, which now run without pyserial, and 17 new); the test card against `vec_check.cpp`, the firmware's renderer compiled natively: 783 of 787 frames identical and the other 4 within 0.005% (the tolerance is 2%), and every frame of a clip identical; and headless Chromium against the real bridge, hooks sent as the installed ones send them: a hook changed the page's mood in 25 ms and reached its loop in 352 ms, the page ran at 23.9 frames a second, a click reached the bridge as a tap in 20 ms, a clip arrived and played in 354 ms, and night dimmed the backlight.
- Not checked without the board: its real frame rate and draw times, the corner marks' exact pixels, the prism's visible area. The emulator has no Wi-Fi clock (night offline comes from the bridge's heartbeat) and models a click as one clean jolt.

## Sage's first drawing (2026-11-16)

- `design/sage.html` plays Sage's moods, transitions and acts as the board plays them, in a prism, and lays them out to review with `?sheet`; it exposes the interface the bake reads. `design/sage-draw.js` draws Sage from the 3D model's measurements with the website's own face, through a layer that turns `arcTo` into the line and arc it traces and the glow into flat layers, so every frame is the board's instructions. `design/sage-acts.js` holds the board's ten moods as Sage lives them, the transitions in and out of idle, and eight acts.
- Measured in the page: 36 sequences, 395 drawings, 72 seconds of animation, 463 unique frames, every canvas call one the board can draw, about 1.8 KB a frame and 825 KB in all.
- Three looks were set side by side on the prism (a sheet: illustrated, the room's 3D as JPEG, glyphs); the author chose the illustrated one for everyday and the glyphs for its special moments, and no 3D for now.
