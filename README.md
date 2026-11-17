# Sage on the desk

Sage is the robot that lives on [destbreso.com](https://destbreso.com). This project gives it a body on my desk. You can [try it live](#try-it-live) in your browser, and the whole story of how I built it is [on my site](https://destbreso.com/projects/desk-sage).

It lives in a small glass prism display. On the prism, black turns into glass, so its cream shell and green eyes look like they're floating in the air. It keeps me company while I work, and it reacts to what's happening on my computer, like Claude Code thinking or waiting for me, my tests passing or failing, or a push.

Here's what you'll find in this repository:

- **Sage itself** (`design/`). It's drawn as code, with the same face and mind it has on destbreso.com. Open `design/sage.html` in a browser to play every mood and act it has. Sage is mine and isn't open source (see [LICENSE-ART.md](LICENSE-ART.md)).
- **The firmware** for the Waveshare ESP32-S3-LCD-1.3 prism. The board draws each frame itself from small drawing instructions, and the frames are compressed, so a lot of animation fits. It feels a tap through its motion sensor, and it can get new animations over Wi-Fi without being flashed again.
- **The bridge** (`tools/buddy_bridge.py`) runs on my Mac. It listens to Claude Code and to what the terminal runs, and talks to the board over USB or Wi-Fi. Next to it runs **Sage's mind** (`mind/`), which decides what Sage does. The mind only hears what kind of thing happened, never what I typed or ran.
- **The emulator** (`emulator/`) is a web page that plays the frames exactly like the board does. It plugs into the bridge as if it were the board, so I can build and try everything before the hardware is on my desk.
- **How a moment reaches the glass** ([docs/figures/flow.html](docs/figures/flow.html)) is an interactive figure. It simulates a quarter of an hour of my work, from a Claude Code hook all the way to the board.
- **How to build one** ([docs/BUILD.md](docs/BUILD.md)) tells you what to buy, where to get it and what it costs. The device itself is about US$27.
- **The hardware** ([hardware/index.html](hardware/index.html)) shows the board, its display and the prism in 3D at their real size. You can turn it around, take it apart down to the smallest piece and put it back together.
- **The tools** bake the drawings into frames, check every frame against the browser's own drawing, update the board over the air and print the stand.

## Try it live

The live demo is the board's emulator, served from this repository on GitHub Pages. It plays the same frames the real board will play, and it shows them on the whole device in 3D. There's nothing to install.

<p align="center"><a href="https://destbreso.github.io/desk-sage/emulator/?mode=realistic"><img src="gallery/live-demo.webp?v=93b3aaa1" width="720" alt="The live demo: the device in 3D, with the board's readouts and the Serial box beside it"></a></p>

- Drag to turn the device. Scroll to zoom.
- Click the glass. That's a tap, and Sage answers it.
- Type a command in the Serial box, like `e holo_tests`. The Commands button lists every one.
- Switch to Simple to see the bare board from the front.

My Mac isn't there, so Sage lives on its own, with its antenna dark. The button at the top connects a stand-in for my Mac, and you can watch Sage find it.

[Open the live demo](https://destbreso.github.io/desk-sage/emulator/?mode=realistic). The [front page](https://destbreso.github.io/desk-sage/) links to everything else you can try in your browser.

## Quick start

You don't need the board to see Sage. The quickest way is the live version at [destbreso.github.io/desk-sage](https://destbreso.github.io/desk-sage/). It's this repository served as it is, so the device in 3D, the bare board, the hardware taken apart and every act all run in your browser.

Or, from a clone of this repository, pick how far you want to go.

### Just look at it

Nothing to install. Open these two files in your browser, straight from a clone of this repository.

- `design/sage.html` plays every mood and act Sage has. Click one to watch it.
- `hardware/index.html` shows the device in 3D at its real size. Drag it around, take it apart level by level, and click any part to see what it is.
- `docs/figures/flow.html` runs a quarter of an hour of my work, from a hook to the board. Put the Mac to sleep and watch what happens.

### Watch it play like the board

You only need Python 3. Run this at the root of the repository:

```sh
python3 -m http.server
```

Then open http://127.0.0.1:8000/emulator/. That's the board in a web page, playing the same frames the real one will play. Here's what you can try:

- Click the board. That's a tap.
- Switch between Simple and Realistic at the top. Simple is the bare board seen from the front. Realistic is the whole device in 3D, and you can turn it with your mouse.
- Type a command in the Serial box, like `e holo_tests` or `s working`. The Commands button lists every one, with an example.

There's no bridge here, so it lives on its own, the way it will when my Mac is asleep.

### Let your own Claude Code drive it

This is the real thing, minus the board. You need Python 3, and Node for Sage's mind. Without Node it still reacts, just more simply.

```sh
python3 tools/install_hooks.py
python3 tools/buddy_bridge.py --emulator
```

The first command adds the hooks to your Claude Code settings. It backs them up first, and running it twice changes nothing. Then open http://127.0.0.1:47823/emulator/ and work as usual. Sage reads while Claude works, looks up when Claude is waiting for you, and reacts to your tests, builds, commits and pushes. A click on it is a tap, and its mind decides what that tap means.

The button at the top cuts the link to the bridge. Use it to watch Sage lose your Mac, carry on alone with its antenna dark, and light up again when the link comes back.

Stop the bridge with Ctrl+C. `python3 tools/install_hooks.py --uninstall` takes the hooks out again.

### Go further

- [emulator/README.md](emulator/README.md) explains everything on the emulator's page, and how it's checked against the firmware.
- [tools/qemu/README.md](tools/qemu/README.md) runs the real compiled firmware in Espressif's QEMU, an emulated ESP32-S3. That one needs PlatformIO and QEMU installed.
- [docs/BUILD.md](docs/BUILD.md) is what to buy when you want the real thing on your desk.

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

<p align="center"><img src="gallery/hardware/taken-apart.gif?v=c4363db4" width="320" alt="The device taken apart level by level and put back together"> <img src="gallery/hardware/live.gif?v=176861f8" width="320" alt="The device turning slowly, with Sage alive inside the prism"></p>

The one on the left comes from [hardware/index.html](hardware/index.html). Open it in any browser from a clone of this repository. You can drag it around, step through the levels or play the whole assembly, and tap any part to see what it is and where its facts come from.

The one on the right is the emulator in its Realistic mode. Sage plays in the prism exactly as the board will draw it, and you can turn it and tap it ([how to run it](emulator/README.md)).

## Roadmap

- [x] Start from Joe Bentham's desk-buddy and Chris Simpkins's fork, keeping their engine and none of their character's art
- [x] A web emulator of the board, plugged into the real bridge, so I can build everything before the hardware arrives
- [x] Sage drawn as code in a small 3D world, with its moments made of the site's rain and its holograms
- [x] Compressed frames, so all of it fits on the board
- [x] Sage's mind next to the bridge, so it picks what to do, never repeats itself and has its own way of taking a tap
- [x] What to buy and what it costs, and the hardware in 3D, taken apart
- [x] Its antenna going dark when it can't hear my Mac
- [x] The real firmware running in a simulated ESP32-S3, so it's tested before the board arrives
- [x] The emulator showing the whole device in 3D, with Sage alive in its prism, and a switch to cut the bridge and bring it back
- [x] All of it live in the browser, with nothing to install
- [ ] Its own voice, played on the Mac
- [ ] More of my day as its senses: subagents, renders, permissions waiting on me, the site going live, me stepping away
- [ ] Holograms that show the real numbers, like the time, my tests and its battery
- [ ] A gallery page with every animation and what sets it off
- [ ] The board itself, flashed and measured, sitting on my desk

The phases and the open questions are in [docs/ROADMAP.md](docs/ROADMAP.md). What's already done, and how it was checked, is in [docs/HISTORY.md](docs/HISTORY.md).

## Credits

This started as [desk-buddy](https://github.com/joebentham/desk-buddy) by Joe Bentham, a desk companion called Lump on the same display. The firmware, the bridge, the bake and the stand are his. Chris Simpkins's [fork](https://github.com/csimpkins22/desk-buddy) added frames made of drawing instructions, clips over Wi-Fi, and reactions to what the terminal runs. Both are MIT, and so is everything here except Sage (see [LICENSE](LICENSE)).

The board unpacks the compressed frames with the tinfl from Rich Geldreich's [miniz](https://github.com/richgel999/miniz) 1.15, which the ESP32-S3 already has in its ROM. The checks on the Mac build the same tinfl from `tools/tinfl.h`, which is public domain.
