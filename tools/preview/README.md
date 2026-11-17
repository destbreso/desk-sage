# Seeing and checking Sage's art

Small scripts for looking at the art while it is drawn, before anything is baked. Each opens `design/sage.html?sheet` in a headless Chromium through Playwright, draws what it is asked at the board's 240 by 240, and saves a picture.

They need three environment variables:

```sh
export PLAYWRIGHT=/path/to/node_modules/playwright      # any Playwright install (npx keeps one under ~/.npm/_npx)
export CHROMIUM=/path/to/chrome-headless-shell          # Playwright's headless shell, for example
export PAGE=$PWD/design/sage.html
```

| Script | What it does | How |
|---|---|---|
| `check-art.mjs` | Draws every frame of every sequence (glyph acts aside) and says whether any canvas call is one the board can't draw (round line ends only), how many unique frames there are and roughly how many bytes each sequence takes before compression | `OUT=shot.png node tools/preview/check-art.mjs` |
| `glyph-size.mjs` | The same for the glyph acts: unique frames and their bytes (7 a glyph) | `node tools/preview/glyph-size.mjs` |
| `strip.mjs` | A strip of chosen frames, each a sequence and a tick | `PICKS='[["sulk",58],["nod",14]]' OUT=strip.png node tools/preview/strip.mjs` |
| `poses.mjs` | A strip of poses drawn straight from `SageDraw`, for trying a look at several camera angles | `POSES='[["front",{}],["side",{"orbit":1.5708}]]' SIZE=200 OUT=poses.png node tools/preview/poses.mjs` |
| `sheet.mjs` | A sheet of rows with titles, each tile a pose, a full-screen hologram or a frame of an act: the kind of sheet shown to the author before a look is baked (`design/sheets/`) | `ROWS='[["A title",[["pose",{},10],["act","sulk",58]]]]' OUT=sheet.png node tools/preview/sheet.mjs` |

The bake itself (`tools/export_frames.py`) uses Google Chrome by default, and its frames are what the board shows: Playwright's headless shell draws some frames differently, so these previews are for looking, and the bake is the reference.

`tools/readme_gallery.py` writes the README's gallery (the session, a few moments and the hardware) with each image's fingerprint; run it after drawing any of those GIFs again.
