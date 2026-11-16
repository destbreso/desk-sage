# Sage on the desk

Sage is the robot that lives on [destbreso.com](https://destbreso.com). This project gives it a body on my desk: a small glass prism display, where black turns to glass, so its cream shell and green eyes seem to float. It keeps me company while I work and reacts to what happens on my computer: Claude Code thinking or waiting for me, tests passing or failing, a push.

What is here:

- **Sage itself** (`design/`): drawn as code, illustrated and shaded, with the same face and mind it has on destbreso.com. Its moods, the transitions between them and its acts can all be played in a browser (`design/sage.html`). Sage is mine and not open source: see [LICENSE-ART.md](LICENSE-ART.md).
- **The firmware** for the Waveshare ESP32-S3-LCD-1.3 prism (240 by 240 pixels, with a motion sensor that feels a tap). It renders each frame from drawing instructions, about a kilobyte or a few a frame, and the frames made of glyphs from an atlas of them, about 2 KB a frame, so a lot of animation fits, and it takes new clips over Wi-Fi without being flashed again.
- **The bridge** on the Mac (`tools/buddy_bridge.py`), which hears Claude Code's hooks and what the terminal runs, picks how Sage should react, and tells the board over USB or Wi-Fi.
- **The emulator** (`emulator/`), a web page that plays the frames exactly as the board does and plugs into the bridge as if it were the board, so everything can be built and tried before the hardware is on the desk.
- **The tools** that bake drawings into frames, check each frame against the browser's own drawing (`tools/vec_check.cpp`), update the board over the air, and print the enclosure.

## Gallery

Sage as the board will show it, each animation played through the same bake that writes its frames for the board (`tools/export_frames.py --gif`). On the prism the black around it is glass, so it seems to float. Everything in its world is made for it, never a stock picture. Its desk is a board of the Game of Life, the site's own world, so when I run tests, deploy or build, it shows up as cells on the desk, worked out by Life's own rule. The camera moves round it in a small 3D world, and Sage keeps an eye on it.

### Every day

<table>
<tr><td align="center"><img src="gallery/sage/fidget_turn.gif?v=6b336d05" width="200" alt="Turning round on the spot"><br><sub>Turning round on the spot</sub></td><td align="center"><img src="gallery/sage/idle.gif?v=b5ccff74" width="200" alt="Waiting for something to happen"><br><sub>Waiting for something to happen</sub></td><td align="center"><img src="gallery/sage/working.gif?v=f22faac7" width="200" alt="Reading while Claude works"><br><sub>Reading while Claude works</sub></td><td align="center"><img src="gallery/sage/alert.gif?v=88adf605" width="200" alt="Something needs you"><br><sub>Something needs you</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/night.gif?v=c4369788" width="200" alt="Asleep at night"><br><sub>Asleep at night</sub></td><td align="center"><img src="gallery/sage/done_glider.gif?v=54f8b076" width="200" alt="A long job done: a glider crosses its visor"><br><sub>A long job done: a glider crosses its visor</sub></td><td align="center"><img src="gallery/sage/fidget_mark.gif?v=46c1a567" width="200" alt="The site's prompt on its face"><br><sub>The site's prompt on its face</sub></td><td align="center"><img src="gallery/sage/fidget_look.gif?v=b23cb067" width="200" alt="A look over its shoulder"><br><sub>A look over its shoulder</sub></td></tr>
</table>

### What I am doing

<table>
<tr><td align="center"><img src="gallery/sage/work_tests_fail.gif?v=66d1a5f5" width="200" alt="Tests fail: one cell comes up amber and won't settle"><br><sub>Tests fail: one cell comes up amber and won't settle</sub></td><td align="center"><img src="gallery/sage/work_deploy.gif?v=512c9097" width="200" alt="A deploy: it sends a glider off across the desk"><br><sub>A deploy: it sends a glider off across the desk</sub></td><td align="center"><img src="gallery/sage/work_build.gif?v=6ac6ebab" width="200" alt="A build: Life works the cells out until they settle"><br><sub>A build: Life works the cells out until they settle</sub></td></tr>
</table>

### The camera

<table>
<tr><td align="center"><img src="gallery/sage/cam_orbit.gif?v=be468c11" width="200" alt="All the way round, and it keeps you in sight"><br><sub>All the way round, and it keeps you in sight</sub></td><td align="center"><img src="gallery/sage/cam_crane.gif?v=ea149439" width="200" alt="From below to above, and it looks up to follow"><br><sub>From below to above, and it looks up to follow</sub></td><td align="center"><img src="gallery/sage/cam_top.gif?v=53b7b37c" width="200" alt="From straight above, while a glider crawls by"><br><sub>From straight above, while a glider crawls by</sub></td><td align="center"><img src="gallery/sage/cam_peek.gif?v=5a089fa9" width="200" alt="Over its shoulder while it reads, until it notices you"><br><sub>Over its shoulder while it reads, until it notices you</sub></td></tr>
</table>

### Made of the rain

<table>
<tr><td align="center"><img src="gallery/sage/glyph_eyes.gif?v=483f11d2" width="200" alt="Just its eyes in the dark, then the rest of it"><br><sub>Just its eyes in the dark, then the rest of it</sub></td><td align="center"><img src="gallery/sage/glyph_mode.gif?v=80ab397e" width="200" alt="Made of the rain"><br><sub>Made of the rain</sub></td><td align="center"><img src="gallery/sage/glyph_rain.gif?v=66491fbb" width="200" alt="Falling apart into the rain, and back"><br><sub>Falling apart into the rain, and back</sub></td><td align="center"><img src="gallery/sage/glyph_wind.gif?v=2539bff6" width="200" alt="Blown away, and blown back in"><br><sub>Blown away, and blown back in</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/glyph_ascii.gif?v=1d9dff9d" width="200" alt="As ASCII art"><br><sub>As ASCII art</sub></td><td align="center"><img src="gallery/sage/glyph_turn.gif?v=2d61ae38" width="200" alt="Turning round, made of glyphs"><br><sub>Turning round, made of glyphs</sub></td><td align="center"><img src="gallery/sage/glyph_decode.gif?v=3eb2763d" width="200" alt="Scrambled, then decoded row by row"><br><sub>Scrambled, then decoded row by row</sub></td><td align="center"><img src="gallery/sage/glyph_scan.gif?v=9543be0f" width="200" alt="Following a scan line with its eyes"><br><sub>Following a scan line with its eyes</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/glyph_glitch.gif?v=fbee053b" width="200" alt="Tests failing, in glyphs"><br><sub>Tests failing, in glyphs</sub></td><td align="center"><img src="gallery/sage/glyph_joy.gif?v=a67a47ca" width="200" alt="So happy it flies apart"><br><sub>So happy it flies apart</sub></td><td align="center"><img src="gallery/sage/glyph_catch.gif?v=dd33ce2b" width="200" alt="Rained back in from the top"><br><sub>Rained back in from the top</sub></td><td align="center"><img src="gallery/sage/glyph_think.gif?v=6ca3dafd" width="200" alt="Thinking, the rain pouring into its head"><br><sub>Thinking, the rain pouring into its head</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/glyph_doze.gif?v=93fef171" width="200" alt="Dozing in a slow rain"><br><sub>Dozing in a slow rain</sub></td></tr>
</table>

## Roadmap

- [x] The engine from Joe Bentham's desk-buddy and Chris Simpkins's fork, with none of their character's art
- [x] A web emulator of the board, connected to the real bridge
- [ ] Sage drawn as code, illustrated, with its glyph moments from the rain of destbreso.com, and baked for the prism
- [ ] Sage's mind in the bridge: reactions that never repeat, its patience, its battery, its voice
- [ ] My workflow as Sage's senses: sessions, tests, builds, renders, pushes and deploys
- [ ] A gallery of every animation, with what triggers it
- [ ] The board: flashed, measured, and in an enclosure shaped like Sage

The phases and what each one involves are in [docs/ROADMAP.md](docs/ROADMAP.md); what is done, and how it was checked, is in [docs/HISTORY.md](docs/HISTORY.md).

## Credits

This started as [desk-buddy](https://github.com/joebentham/desk-buddy) by Joe Bentham, a companion called Lump on the same display: the firmware, the bridge, the bake and the enclosure are his. Chris Simpkins's [fork](https://github.com/csimpkins22/desk-buddy) added frames as drawing instructions rendered on the board, clips over Wi-Fi, and reactions to what the terminal runs. Both are MIT, and so is everything here except Sage: see [LICENSE](LICENSE).
