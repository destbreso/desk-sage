# Sage on the desk

Sage is the robot that lives on [destbreso.com](https://destbreso.com). This project gives it a body on my desk: a small glass prism display, where black turns to glass, so its cream shell and green eyes seem to float. It keeps me company while I work and reacts to what happens on my computer: Claude Code thinking or waiting for me, tests passing or failing, a push.

What is here:

- **Sage itself** (`design/`): drawn as code, illustrated and shaded, with the same face and mind it has on destbreso.com. Its moods, the transitions between them and its acts can all be played in a browser (`design/sage.html`). Sage is mine and not open source: see [LICENSE-ART.md](LICENSE-ART.md).
- **The firmware** for the Waveshare ESP32-S3-LCD-1.3 prism (240 by 240 pixels, with a motion sensor that feels a tap). It renders each frame from drawing instructions, about a kilobyte or a few a frame, so a lot of animation fits, and it takes new clips over Wi-Fi without being flashed again.
- **The bridge** on the Mac (`tools/buddy_bridge.py`), which hears Claude Code's hooks and what the terminal runs, picks how Sage should react, and tells the board over USB or Wi-Fi.
- **The emulator** (`emulator/`), a web page that plays the frames exactly as the board does and plugs into the bridge as if it were the board, so everything can be built and tried before the hardware is on the desk.
- **The tools** that bake drawings into frames, check each frame against the browser's own drawing (`tools/vec_check.cpp`), update the board over the air, and print the enclosure.

## Gallery

Sage as the board will show it, each animation played through the same bake that writes its frames for the board (`tools/export_frames.py --gif`). On the prism the black around it is glass, so it seems to float. Everything in its world is made for it, never a stock picture: what comes in for what is happening is the site's own (its prompt, the Game of Life's glider, the rain) or Sage's own (its modules, the room's phone), and the camera moves round it in a small 3D world.

### Every day

<table>
<tr><td align="center"><img src="gallery/sage/fidget_turn.gif" width="200" alt="Turning round on the spot"><br><sub>Turning round on the spot</sub></td><td align="center"><img src="gallery/sage/idle.gif" width="200" alt="Waiting for something to happen"><br><sub>Waiting for something to happen</sub></td><td align="center"><img src="gallery/sage/working.gif" width="200" alt="Reading while Claude works"><br><sub>Reading while Claude works</sub></td><td align="center"><img src="gallery/sage/alert.gif" width="200" alt="Something needs you"><br><sub>Something needs you</sub></td></tr>
<tr><td align="center"><img src="gallery/sage/night.gif" width="200" alt="Asleep at night"><br><sub>Asleep at night</sub></td><td align="center"><img src="gallery/sage/done_glider.gif" width="200" alt="A long job done: a glider crosses its visor"><br><sub>A long job done: a glider crosses its visor</sub></td><td align="center"><img src="gallery/sage/fidget_mark.gif" width="200" alt="The site's prompt on its face"><br><sub>The site's prompt on its face</sub></td><td align="center"><img src="gallery/sage/fidget_look.gif" width="200" alt="A look over its shoulder"><br><sub>A look over its shoulder</sub></td></tr>
</table>

### What I am doing

<table>
<tr><td align="center"><img src="gallery/sage/work_tests_fail.gif" width="200" alt="Tests fail: a glitch scuttles in, and it stomps it"><br><sub>Tests fail: a glitch scuttles in, and it stomps it</sub></td><td align="center"><img src="gallery/sage/work_deploy.gif" width="200" alt="A deploy: the site's prompt takes off"><br><sub>A deploy: the site's prompt takes off</sub></td><td align="center"><img src="gallery/sage/work_build.gif" width="200" alt="A build: its own modules land on the pile"><br><sub>A build: its own modules land on the pile</sub></td></tr>
</table>

### The camera

<table>
<tr><td align="center"><img src="gallery/sage/cam_orbit.gif" width="200" alt="All the way round it"><br><sub>All the way round it</sub></td><td align="center"><img src="gallery/sage/cam_crane.gif" width="200" alt="From below to above"><br><sub>From below to above</sub></td><td align="center"><img src="gallery/sage/cam_top.gif" width="200" alt="From straight above"><br><sub>From straight above</sub></td></tr>
</table>

### Made of the rain

<table>
<tr><td align="center"><img src="gallery/sage/glyph_form.gif" width="200" alt="Forming out of the rain, eyes first"><br><sub>Forming out of the rain, eyes first</sub></td><td align="center"><img src="gallery/sage/glyph_mode.gif" width="200" alt="Made of glyphs"><br><sub>Made of glyphs</sub></td></tr>
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
