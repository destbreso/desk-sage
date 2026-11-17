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

Everything in its world is made for it, never a stock picture. Some things show up for what I'm doing, like a glitch it stomps on or the site's prompt taking off. Its desk is also a Game of Life board that it projects. It throws holograms from a lens on its head, and sometimes it's made of the site's rain. The camera can move around it too, and Sage keeps an eye on it.

### Every day

<table>
<tr><td align="center"><img src="gallery/sage/fidget_turn.gif?v=a78aa4e4" width="200" alt="Turning round on the spot"><br><sub>Turning round on the spot</sub></td><td align="center"><img src="gallery/sage/idle.gif?v=9c243d65" width="200" alt="Waiting for something to happen"><br><sub>Waiting for something to happen</sub></td><td align="center"><img src="gallery/sage/working.gif?v=67d92276" width="200" alt="Reading while Claude works"><br><sub>Reading while Claude works</sub></td><td align="center"><img src="gallery/sage/alert.gif?v=9473d506" width="200" alt="Something needs you"><br><sub>Something needs you</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/night.gif?v=a38bfdbc" width="200" alt="Asleep at night"><br><sub>Asleep at night</sub></td><td align="center"><img src="gallery/sage/done_glider.gif?v=e16b68dd" width="200" alt="A long job's done, so a glider crosses its visor"><br><sub>A long job's done, so a glider crosses its visor</sub></td><td align="center"><img src="gallery/sage/done_hearts.gif?v=6f190c42" width="200" alt="When it loves what it sees, its eyes turn to hearts"><br><sub>When it loves what it sees, its eyes turn to hearts</sub></td><td align="center"><img src="gallery/sage/fidget_mark.gif?v=93a56245" width="200" alt="The site's prompt on its face"><br><sub>The site's prompt on its face</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/fidget_look.gif?v=c07e7ba9" width="200" alt="A look over its shoulder"><br><sub>A look over its shoulder</sub></td><td align="center"><img src="gallery/sage/go_charge.gif?v=d827c6cf" width="200" alt="When its battery's nearly empty, it goes to charge"><br><sub>When its battery's nearly empty, it goes to charge</sub></td></tr>
</table>

### How it takes a touch

<table>
<tr><td align="center"><img src="gallery/sage/tap_knock.gif?v=37d4d50d" width="200" alt="Knock, and it looks out to see who's there"><br><sub>Knock, and it looks out to see who's there</sub></td><td align="center"><img src="gallery/sage/rhythm_dance.gif?v=382005f8" width="200" alt="Tap a beat and it dances"><br><sub>Tap a beat and it dances</sub></td><td align="center"><img src="gallery/sage/sleep_stir.gif?v=264c7e16" width="200" alt="Tap it while it sleeps and it stirs"><br><sub>Tap it while it sleeps and it stirs</sub></td><td align="center"><img src="gallery/sage/sulk.gif?v=a6d823fa" width="200" alt="Push its patience too far and it sulks"><br><sub>Push its patience too far and it sulks</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/dnd.gif?v=3f71b293" width="200" alt="Bother it on its charger and the shutter comes down"><br><sub>Bother it on its charger and the shutter comes down</sub></td><td align="center"><img src="gallery/sage/nod.gif?v=1d0906ca" width="200" alt="Tap it when it needs you, and it nods"><br><sub>Tap it when it needs you, and it nods</sub></td></tr>
</table>

### What I am doing

<table>
<tr><td align="center"><img src="gallery/sage/work_tests_fail.gif?v=6df82dfd" width="200" alt="When tests fail, a glitch scuttles in and it stomps it"><br><sub>When tests fail, a glitch scuttles in and it stomps it</sub></td><td align="center"><img src="gallery/sage/work_deploy.gif?v=eeaac056" width="200" alt="On a deploy, the site's prompt takes off"><br><sub>On a deploy, the site's prompt takes off</sub></td><td align="center"><img src="gallery/sage/work_build.gif?v=7705a514" width="200" alt="On a build, its own modules land on the pile"><br><sub>On a build, its own modules land on the pile</sub></td><td align="center"><img src="gallery/sage/work_oops.gif?v=ff7ae232" width="200" alt="A tool call fails, it jumps, then shakes it off"><br><sub>A tool call fails, it jumps, then shakes it off</sub></td></tr>
</table>

### On its Life board

<table>
<tr><td align="center"><img src="gallery/sage/life_tests_fail.gif?v=854f9660" width="200" alt="It projects the test run, and one cell won't settle"><br><sub>It projects the test run, and one cell won't settle</sub></td><td align="center"><img src="gallery/sage/life_deploy.gif?v=98bd330a" width="200" alt="On a deploy, it sends a glider off the board"><br><sub>On a deploy, it sends a glider off the board</sub></td><td align="center"><img src="gallery/sage/life_build.gif?v=02d5c95c" width="200" alt="On a build, Life works the cells out until they settle"><br><sub>On a build, Life works the cells out until they settle</sub></td></tr>
</table>

### What it projects

<table>
<tr><td align="center"><img src="gallery/sage/holo_tests.gif?v=0c9dbe3d" width="200" alt="The tests as they run, standing on the desk"><br><sub>The tests as they run, standing on the desk</sub></td><td align="center"><img src="gallery/sage/holo_self.gif?v=a6a11e66" width="200" alt="A hologram of itself on the desk"><br><sub>A hologram of itself on the desk</sub></td><td align="center"><img src="gallery/sage/holo_build.gif?v=b0848830" width="200" alt="A build's progress, in the air"><br><sub>A build's progress, in the air</sub></td><td align="center"><img src="gallery/sage/holo_clock.gif?v=ada5203f" width="200" alt="Late at night, it shows you the time"><br><sub>Late at night, it shows you the time</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/holo_battery.gif?v=2dcb3375" width="200" alt="When its battery runs low, it droops"><br><sub>When its battery runs low, it droops</sub></td><td align="center"><img src="gallery/sage/holo_life.gif?v=e6d6d918" width="200" alt="A glider going round a board in the air"><br><sub>A glider going round a board in the air</sub></td><td align="center"><img src="gallery/sage/holo_screen_tests.gif?v=19a13bda" width="200" alt="The tests, taking over the whole screen"><br><sub>The tests, taking over the whole screen</sub></td><td align="center"><img src="gallery/sage/holo_screen_self.gif?v=9392f971" width="200" alt="Itself, taking over the whole screen"><br><sub>Itself, taking over the whole screen</sub></td></tr>
</table>

### The camera

<table>
<tr><td align="center"><img src="gallery/sage/cam_orbit.gif?v=74c3a0c3" width="200" alt="All the way round, and it keeps you in sight"><br><sub>All the way round, and it keeps you in sight</sub></td><td align="center"><img src="gallery/sage/cam_crane.gif?v=51733ee9" width="200" alt="From below to above, and it looks up to follow"><br><sub>From below to above, and it looks up to follow</sub></td><td align="center"><img src="gallery/sage/cam_top.gif?v=06fc7e44" width="200" alt="From straight above, while a glider crawls by"><br><sub>From straight above, while a glider crawls by</sub></td><td align="center"><img src="gallery/sage/cam_peek.gif?v=2798b112" width="200" alt="Over its shoulder while it reads, until it notices you"><br><sub>Over its shoulder while it reads, until it notices you</sub></td></tr>
</table>

### Made of the rain

<table>
<tr><td align="center"><img src="gallery/sage/glyph_form.gif?v=d70851c6" width="200" alt="Forming out of the rain, eyes first"><br><sub>Forming out of the rain, eyes first</sub></td><td align="center"><img src="gallery/sage/glyph_dissolve.gif?v=944f6ac7" width="200" alt="Dissolving into the rain"><br><sub>Dissolving into the rain</sub></td><td align="center"><img src="gallery/sage/glyph_eyes.gif?v=8ec498fb" width="200" alt="Just its eyes in the dark, then the rest of it"><br><sub>Just its eyes in the dark, then the rest of it</sub></td><td align="center"><img src="gallery/sage/glyph_mode.gif?v=82a7ac3b" width="200" alt="Made of the rain"><br><sub>Made of the rain</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/glyph_rain.gif?v=92de1633" width="200" alt="Falling apart into the rain, and back"><br><sub>Falling apart into the rain, and back</sub></td><td align="center"><img src="gallery/sage/glyph_wind.gif?v=948bca7b" width="200" alt="Blown away, and blown back in"><br><sub>Blown away, and blown back in</sub></td><td align="center"><img src="gallery/sage/glyph_ascii.gif?v=979a011c" width="200" alt="As ASCII art"><br><sub>As ASCII art</sub></td><td align="center"><img src="gallery/sage/glyph_turn.gif?v=a3410fe3" width="200" alt="Turning round, made of glyphs"><br><sub>Turning round, made of glyphs</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/glyph_decode.gif?v=07fdc65b" width="200" alt="Scrambled, then decoded row by row"><br><sub>Scrambled, then decoded row by row</sub></td><td align="center"><img src="gallery/sage/glyph_scan.gif?v=632928e7" width="200" alt="Following a scan line with its eyes"><br><sub>Following a scan line with its eyes</sub></td><td align="center"><img src="gallery/sage/glyph_glitch.gif?v=91a8883d" width="200" alt="Tests failing, in glyphs"><br><sub>Tests failing, in glyphs</sub></td><td align="center"><img src="gallery/sage/glyph_joy.gif?v=16dfeca7" width="200" alt="So happy it flies apart"><br><sub>So happy it flies apart</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/glyph_catch.gif?v=b90b57b0" width="200" alt="Rained back in from the top"><br><sub>Rained back in from the top</sub></td><td align="center"><img src="gallery/sage/glyph_think.gif?v=6ca3dafd" width="200" alt="Thinking, the rain pouring into its head"><br><sub>Thinking, the rain pouring into its head</sub></td><td align="center"><img src="gallery/sage/glyph_doze.gif?v=9fb27353" width="200" alt="Dozing in a slow rain"><br><sub>Dozing in a slow rain</sub></td></tr>
</table>

### The hardware

<table>
<tr><td align="center"><img src="gallery/hardware/taken-apart.gif?v=c4363db4" width="266" alt="The device taken apart level by level and put back together"><br><sub>Taken apart level by level, then put back together</sub></td><td align="center"><img src="gallery/hardware/prism-and-display.gif?v=a4ba227e" width="266" alt="The prism splitting into its two halves and the display coming apart into its layers"><br><sub>The prism in its two halves, the display in its layers</sub></td><td align="center"><img src="gallery/hardware/board.gif?v=775dce35" width="266" alt="The board turning while its parts lift off their pads and settle back"><br><sub>The board's parts lifting off their pads</sub></td></tr>
<tr><td align="center" colspan="3"><img src="gallery/hardware/whole.png?v=be42127b" width="800" alt="The whole device, with each part named"><br><sub>The whole thing, and why Sage stands upright in the glass</sub></td></tr>
</table>

All of these come from [hardware/index.html](hardware/index.html). Open it in any browser from a clone of this repository. You can drag it around, step through the levels or play the whole assembly, and tap any part to see what it is and where its facts come from.

## Roadmap

- [x] Start from Joe Bentham's desk-buddy and Chris Simpkins's fork, keeping their engine and none of their character's art
- [x] A web emulator of the board, plugged into the real bridge, so I can build everything before the hardware arrives
- [x] Sage drawn as code in a small 3D world, with its moments made of the site's rain and its holograms
- [x] Compressed frames, so all of it fits on the board
- [x] Sage's mind next to the bridge, so it picks what to do, never repeats itself and has its own way of taking a tap
- [x] What to buy and what it costs, and the hardware in 3D, taken apart
- [ ] Its antenna going dark when it can't hear my Mac
- [ ] Its own voice, played on the Mac
- [ ] More of my day as its senses: subagents, renders, permissions waiting on me, the site going live, me stepping away
- [ ] Holograms that show the real numbers, like the time, my tests and its battery
- [ ] A gallery page with every animation and what sets it off
- [ ] The board itself, flashed and measured, sitting on my desk

The phases and the open questions are in [docs/ROADMAP.md](docs/ROADMAP.md). What's already done, and how it was checked, is in [docs/HISTORY.md](docs/HISTORY.md).

## Credits

This started as [desk-buddy](https://github.com/joebentham/desk-buddy) by Joe Bentham, a desk companion called Lump on the same display. The firmware, the bridge, the bake and the stand are his. Chris Simpkins's [fork](https://github.com/csimpkins22/desk-buddy) added frames made of drawing instructions, clips over Wi-Fi, and reactions to what the terminal runs. Both are MIT, and so is everything here except Sage (see [LICENSE](LICENSE)).

The board unpacks the compressed frames with the tinfl from Rich Geldreich's [miniz](https://github.com/richgel999/miniz) 1.15, which the ESP32-S3 already has in its ROM. The checks on the Mac build the same tinfl from `tools/tinfl.h`, which is public domain.
