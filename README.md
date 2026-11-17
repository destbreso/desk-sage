# Sage on the desk

Sage is the robot that lives on [destbreso.com](https://destbreso.com). This project gives it a body on my desk.

It lives in a small glass prism display. On the prism, black turns into glass, so its cream shell and green eyes look like they're floating in the air. It keeps me company while I work, and it reacts to what's happening on my computer, like Claude Code thinking or waiting for me, my tests passing or failing, or a push.

Here's what you'll find in this repository:

- **Sage itself** (`design/`). It's drawn as code, with the same face and mind it has on destbreso.com. Open `design/sage.html` in a browser to play every mood and act it has. Sage is mine and isn't open source (see [LICENSE-ART.md](LICENSE-ART.md)).
- **The firmware** for the Waveshare ESP32-S3-LCD-1.3 prism. The board draws each frame itself from small drawing instructions, and the frames are compressed, so a lot of animation fits. It feels a tap through its motion sensor, and it can get new animations over Wi-Fi without being flashed again.
- **The bridge** (`tools/buddy_bridge.py`) runs on my Mac. It listens to Claude Code and to what the terminal runs, and talks to the board over USB or Wi-Fi. Next to it runs **Sage's mind** (`mind/`), which decides what Sage does. The mind only hears what kind of thing happened, never what I typed or ran.
- **The emulator** (`emulator/`) is a web page that plays the frames exactly like the board does. It plugs into the bridge as if it were the board, so I can build and try everything before the hardware is on my desk.
- **How to build one** ([docs/BUILD.md](docs/BUILD.md)) tells you what to buy, where to get it and what it costs. The device itself is about US$27.
- **The hardware** ([hardware/index.html](hardware/index.html)) shows the board, its display and the prism in 3D at their real size. You can turn it around, take it apart down to the smallest piece and put it back together.
- **The tools** bake the drawings into frames, check every frame against the browser's own drawing, update the board over the air and print the stand.

## Gallery

This is Sage the way the board will show it. Every animation here went through the same bake that writes its frames for the board. On the prism the black around it turns to glass, so it looks like it's floating.

### A day with it

Almost two minutes of a typical day. It forms out of the rain, keeps me company while I work, and falls asleep at night. Then it loses my Mac, carries on by itself with its antenna dark, and lights up again when my Mac comes back.

<p align="center"><img src="gallery/session.gif?v=8bc616ff" width="320" alt="A typical day with Sage, from forming out of the rain to my Mac coming back"></p>

### A few of its moments

<table>
<tr><td align="center"><img src="gallery/sage/idle.gif?v=9c243d65" width="200" alt="Waiting for something to happen"><br><sub>Waiting for something to happen</sub></td><td align="center"><img src="gallery/sage/working.gif?v=67d92276" width="200" alt="Reading while Claude works"><br><sub>Reading while Claude works</sub></td><td align="center"><img src="gallery/sage/holo_tests.gif?v=0c9dbe3d" width="200" alt="The tests as they run, standing on the desk"><br><sub>The tests as they run, standing on the desk</sub></td><td align="center"><img src="gallery/sage/life_deploy.gif?v=98bd330a" width="200" alt="On a deploy, it sends a glider off the board"><br><sub>On a deploy, it sends a glider off the board</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/sulk.gif?v=a6d823fa" width="200" alt="Push its patience too far and it sulks"><br><sub>Push its patience too far and it sulks</sub></td><td align="center"><img src="gallery/sage/tap_knock.gif?v=37d4d50d" width="200" alt="Knock, and it looks out to see who's there"><br><sub>Knock, and it looks out to see who's there</sub></td><td align="center"><img src="gallery/sage/cam_orbit.gif?v=74c3a0c3" width="200" alt="All the way round, and it keeps you in sight"><br><sub>All the way round, and it keeps you in sight</sub></td><td align="center"><img src="gallery/sage/glyph_eyes.gif?v=8ec498fb" width="200" alt="Just its eyes in the dark, then the rest of it"><br><sub>Just its eyes in the dark, then the rest of it</sub></td></tr>
</table>

It has many more. Every one of them is in [gallery/sage/](gallery/sage/).

### The hardware

<p align="center"><img src="gallery/hardware/taken-apart.gif?v=c4363db4" width="320" alt="The device taken apart level by level and put back together"></p>

This comes from [hardware/index.html](hardware/index.html). Open it in any browser from a clone of this repository. You can drag it around, step through the levels or play the whole assembly, and tap any part to see what it is and where its facts come from.

## Roadmap

- [x] Start from Joe Bentham's desk-buddy and Chris Simpkins's fork, keeping their engine and none of their character's art
- [x] A web emulator of the board, plugged into the real bridge, so I can build everything before the hardware arrives
- [x] Sage drawn as code in a small 3D world, with its moments made of the site's rain and its holograms
- [x] Compressed frames, so all of it fits on the board
- [x] Sage's mind next to the bridge, so it picks what to do, never repeats itself and has its own way of taking a tap
- [x] What to buy and what it costs, and the hardware in 3D, taken apart
- [x] Its antenna going dark when it can't hear my Mac
- [x] The real firmware running in a simulated ESP32-S3, so it's tested before the board arrives
- [ ] Its own voice, played on the Mac
- [ ] More of my day as its senses: subagents, renders, permissions waiting on me, the site going live, me stepping away
- [ ] Holograms that show the real numbers, like the time, my tests and its battery
- [ ] A gallery page with every animation and what sets it off
- [ ] The board itself, flashed and measured, sitting on my desk

The phases and the open questions are in [docs/ROADMAP.md](docs/ROADMAP.md). What's already done, and how it was checked, is in [docs/HISTORY.md](docs/HISTORY.md).

## Credits

This started as [desk-buddy](https://github.com/joebentham/desk-buddy) by Joe Bentham, a desk companion called Lump on the same display. The firmware, the bridge, the bake and the stand are his. Chris Simpkins's [fork](https://github.com/csimpkins22/desk-buddy) added frames made of drawing instructions, clips over Wi-Fi, and reactions to what the terminal runs. Both are MIT, and so is everything here except Sage (see [LICENSE](LICENSE)).

The board unpacks the compressed frames with the tinfl from Rich Geldreich's [miniz](https://github.com/richgel999/miniz) 1.15, which the ESP32-S3 already has in its ROM. The checks on the Mac build the same tinfl from `tools/tinfl.h`, which is public domain.
