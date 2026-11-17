"""Bake Sage's browser animation into a binary the firmware plays back.

    python3 tools/export_frames.py --bake                 # headless Chrome: writes firmware/data/sage.bin
    python3 tools/export_frames.py --clip encore          # just the sequences named encore / encore_*,
                                                          # as ~/.desk-buddy/clips/encore.clip (sent over Wi-Fi).
                                                          # design/clips/encore.js, if there is one, is loaded
                                                          # first: it adds the clip's drawings and its sequence
    python3 tools/export_frames.py --clip all             # every design/clips/*.js
    python3 tools/export_frames.py --clip encore --sheet encore.png
                                                          # don't bake: save its drawings side by side to look at,
                                                          # 24 to a picture (encore.png, encore_2.png, ...)
    python3 tools/export_frames.py --clip encore --define my_clips.json
                                                          # ...where the JSON adds sequences built from his
                                                          # existing drawings: {"encore": {"home": "idle", "seq": [["S1", 4], ...]}}
    python3 tools/export_frames.py 8767                   # serve design/ for editing; run EXPORT_JS in the
                                                          # page's console to bake from your own browser
    python3 tools/export_frames.py --bake --page emulator/testcard/index.html --out emulator/testcard/testcard.bin
                                                          # bake another page with the same interface (served
                                                          # from its own folder)
    python3 tools/export_frames.py --bake --page design/sage.html --out firmware/data/sage.bin --refs refs.bin
                                                          # also save the browser's picture of every glyph frame,
                                                          # for emulator/checks/glyph_fidelity.mjs

The page posts its mood/sequence list to /meta, then every 24 fps frame of every sequence: the
picture (raw RGBA) and the canvas calls that drew it, then the glyph atlas: every text it drew,
rendered alone in the state it was drawn in. Identical frames are stored once. Each frame is kept
as drawing instructions (about a kilobyte, drawn on the board by firmware/src/vec.h) when that
renderer reproduces the browser's picture closely enough; a frame that is only a background fill
and text (fillText with fillStyle and globalAlpha) as a glyph frame (about 2 KB, drawn by
firmware/src/glyphs.h) when that reproduces it; and as pixels otherwise. Then each frame is stored compressed
(raw deflate, inflated on the board by the tinfl in the ESP32-S3's ROM, through firmware/src/packed.h) when that is
smaller, most of them right after a keyframe whose bytes they reach back into; tools/pack_check.cpp inflates every
compressed frame back with that same code, and one that does not come back byte for byte is stored as it is.

sage.bin layout (little-endian), version 7 (the board also reads 3 to 6: 6 has no compressed frames, 3 to 5 no atlas):
  "SAGE" u16 version=7  u16 nFrames  u8 nMoods  u8 fps   (the board also reads "LUMP", what the bake wrote before)
  per mood:      u8 base mood index, u8 nameLen, name
  u16 nSeqs (at most 750 in sage.bin: the board keeps room for that many; a u8 before version 5)
  per sequence:  u8 kind (0 loop, 1 transition, 2 event), u8 from, u8 to,
                 u8 nameLen, name, u16 length, u16 frame index per tick
  glyph atlas:   u16 nGlyphs (at most 256), u32 size (bytes of the records), u32 at[nGlyphs] (where each
                 record starts, from the first), then the records: s8 left, s8 top (the bitmap's corner
                 from the pixel the glyph is drawn at), u8 width, u8 height, then height rows of
                 ceil(width / 2) bytes, 4 bits of coverage a pixel (0..15), the left one in the high nibble
  u32 offset[nFrames]  (from start of frame data; the top two bits are the kind: 00 pixels,
                 01 compressed (version 7), 10 instructions, 11 glyphs)
  frame data: a pixel frame is runs of [u8 count (1..255)][u16 rgb565 big-endian] until 57600 px;
              an instruction frame is u16 length, then the instructions (see encode());
              a glyph frame is u16 length, then u16 background rgb565, then per glyph in drawing order
              s16 x, s16 y (the whole pixel the browser drew its anchor at), u8 atlas index, u16 rgb565
              (its colour with its alpha folded in against black);
              a compressed frame is u8 the kind it inflates to (0, 2 or 3), u16 base (the frame whose bytes it
              inflates after, 0xFFFF for none), u32 size (the bytes it inflates to: the frame exactly as that kind
              stores it, its u16 length included), u32 length of the deflate, u32 adler-32 of the size bytes, then
              raw deflate (RFC 1951) with the base's bytes as its preset dictionary. A base is a compressed frame with
              no base of its own, and a frame and its base come to at most 172800 bytes (WINDOW: the longest a pixel
              frame can be), so a frame needs at most two inflates and the board one fixed window.
A clip is the same layout holding only its own sequences, frames and glyphs (a base is always in the same file).
"""
import argparse, bisect, glob, hashlib, http.server, json, math, os, re, shutil, socket, struct, subprocess, sys, tempfile, threading, zlib
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESIGN = os.path.join(ROOT, "design")
PAGE = os.path.join(DESIGN, "sage.html")          # the page baked from (--page names another)
OUT = os.path.join(ROOT, "firmware", "data", "sage.bin")
KIT = os.path.join(DESIGN, "clip_kit.js")          # props and helpers every clip script may use
CLIPS = os.path.expanduser("~/.desk-buddy/clips")
CHROME = os.environ.get("CHROME") or next((p for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", shutil.which("google-chrome"),
                                                        shutil.which("chromium")) if p and os.path.exists(p)), "google-chrome")
PIXELS = 240 * 240 * 4
MAX_SEQS = 750                    # sequences the board has room for in sage.bin (MAX_SEQ in firmware/src/main.cpp)
MAX_MEAN, MAX_FAR = 2.0, 300      # an instruction frame may differ from the browser's by this much: mean % of full
                                  # scale, and pixels more than a quarter of full scale apart (thin edge fringes)

units = {}    # frame id -> (rgba bytes, canvas calls)
where = {}    # (sequence key, tick) -> frame id
named = {}    # (sequence key, tick) -> the named drawing shown there
meta = {}
texts = {}    # (font, textAlign, textBaseline) -> {"yUp": fraction or None, "glyphs": {text: (left, top, w, h, alphas)}}
done = threading.Event()
result = {}
out_path = OUT
refs_path = None   # where to save the browser's picture of each glyph frame (--refs)
clip_name = None   # the clip being baked, if it is one

EXPORT_JS = r"""
(async () => {
  // Body colour is exported as pure magenta, a marker the firmware swaps for the real colour
  // at runtime (so the body colour can change on the fly).
  const cfg = window.__lumpExport || {};
  const TINT = cfg.tint || '#FF00FF';
  const L = window.__lump, cv = document.createElement('canvas'); cv.width = cv.height = 240;
  const c = cv.getContext('2d', { willReadFrequently: true });
  L.setLine('glow'); L.setTint(TINT);
  for (const [name, def] of Object.entries(cfg.define || {})) L.CLIPS[name] = def;
  // draw through a recorder, so each frame is also kept as the canvas calls that made it, and every text
  // drawn is noted by the state it was drawn in (the glyph atlas is rendered from them at the end)
  let ops = [];
  const texts = new Map();
  const rec = new Proxy(c, {
    get(t, p) { const v = t[p]; if (typeof v !== 'function') return v;
      return (...a) => {
        if (p === 'fillText') { const k = JSON.stringify([t.font, t.textAlign, t.textBaseline]); if (!texts.has(k)) texts.set(k, new Set()); texts.get(k).add(String(a[0])); }
        ops.push([p, ...a.map(x => (typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean' || Array.isArray(x)) ? x : null)]); return v.apply(t, a); }; },
    set(t, p, v) { t[p] = v; ops.push(['=' + p, (p === 'fillStyle' || p === 'strokeStyle') ? t[p] : v]); return true; }
  });
  const meta = L.meta();
  if (cfg.only) meta.seqs = meta.seqs.filter(s => cfg.only.some(n => s.name === n || s.name.startsWith(n + '_')));
  await fetch('/meta', { method: 'POST', body: JSON.stringify(meta) });
  const seen = new Map(); let n = 0;
  L.render(c, 'idle', L.at('idle', 0).id, 0, { dim: false });     // one frame first, as the page has always drawn one before
  for (const s of meta.seqs) {
    for (let t = 0; t < L.seqLen(s.key); t++) {
      const a = s.kind === 0 ? L.at(s.key, t) : L.atSeq(s.key, t);
      // the page doesn't reset the canvas between frames, so a frame starts with whatever the last one left set
      ops = [['=lineCap', c.lineCap], ['=lineJoin', c.lineJoin], ['=lineWidth', c.lineWidth], ['=fillStyle', c.fillStyle], ['=strokeStyle', c.strokeStyle],
             ['=globalAlpha', c.globalAlpha], ['setLineDash', c.getLineDash()], ['=lineDashOffset', c.lineDashOffset],
             ['=font', c.font], ['=textAlign', c.textAlign], ['=textBaseline', c.textBaseline]];
      L.render(rec, s.kind === 0 ? s.key : L.fxFor(a.id), a.id, t, { dim: false });
      const calls = JSON.stringify(ops), q = `seq=${encodeURIComponent(s.key)}&tick=${t}`, was = seen.get(calls);
      const q2 = q + '&d=' + encodeURIComponent(a.id);
      if (was !== undefined && !calls.includes('"drawImage"')) await fetch(`/same?${q2}&as=${was}`, { method: 'POST' });   // same calls, same picture
      else { seen.set(calls, n); await fetch(`/frame?${q2}&id=${n}`, { method: 'POST', body: new Blob([c.getImageData(0, 0, 240, 240).data, calls]) }); }
      n++;
    }
  }
  // The glyph atlas: each text drawn alone in white on a clear canvas of the same kind, at a whole pixel, so its
  // alpha is the browser's own coverage. Per text state, also the fraction of a pixel past which a y moves the
  // glyph one pixel down (the browser snaps text to whole pixels vertically; null if it does not).
  const T = 256, O = 128, tc = document.createElement('canvas'); tc.width = tc.height = T;
  const g = tc.getContext('2d', { willReadFrequently: true });
  const alone = (st, text, x, y) => {
    g.clearRect(0, 0, T, T); g.font = st[0]; g.textAlign = st[1]; g.textBaseline = st[2]; g.fillStyle = '#ffffff'; g.globalAlpha = 1;
    g.fillText(text, x, y);
    const d = g.getImageData(0, 0, T, T).data, a = new Uint8Array(T * T);
    for (let i = 0; i < T * T; i++) a[i] = d[i * 4 + 3];
    return a;
  };
  const moved = (a, b, dy) => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const Y = y - dy; if ((Y >= 0 && Y < T ? a[Y * T + x] : 0) !== b[y * T + x]) return false; } return true; };
  const atlas = [];
  for (const [k, set] of texts) {
    const st = JSON.parse(k), list = [...set], ref = alone(st, list[0], O, O);
    let yUp = null;
    if (moved(ref, alone(st, list[0], O, O + 0.999), 1)) {
      let lo = 0, hi = 0.999;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (moved(ref, alone(st, list[0], O, O + m), 0)) lo = m; else hi = m; }
      yUp = hi;
    }
    const glyphs = list.map(text => {
      const a = alone(st, text, O, O);
      let x0 = T, y0 = T, x1 = -1, y1 = -1;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (a[y * T + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 < 0) return { text, left: 0, top: 0, w: 0, h: 0, a: [] };
      const cov = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cov.push(a[y * T + x]);
      return { text, left: x0 - O, top: y0 - O, w: x1 - x0 + 1, h: y1 - y0 + 1, a: cov };
    });
    atlas.push({ font: st[0], align: st[1], base: st[2], yUp, glyphs });
  }
  await fetch('/atlas', { method: 'POST', body: JSON.stringify(atlas) });
  return n + ' frames; ' + await (await fetch('/finish', { method: 'POST' })).text();
})().catch(e => fetch('/error', { method: 'POST', body: String(e && e.stack || e) }))
"""


def rgb565(r, g, b):
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def rle(rgba):
    px = [rgb565(rgba[i], rgba[i + 1], rgba[i + 2]) for i in range(0, len(rgba), 4)]
    out = bytearray(); i = 0; n = len(px)
    while i < n:
        v = px[i]; j = i + 1
        while j < n and px[j] == v and j - i < 255:
            j += 1
        out += bytes([j - i]) + struct.pack(">H", v)
        i = j
    return bytes(out)


# ---- instructions: one byte saying which canvas call, then its numbers. Lengths are in 1/16 px,
# angles in 1/4096 radian, scales in 1/256, colours RGBA. firmware/src/vec.h reads exactly this. ----
OP = {"beginPath": 1, "closePath": 2, "moveTo": 3, "lineTo": 4, "quadraticCurveTo": 5, "bezierCurveTo": 6, "arc": 7,
      "ellipse": 8, "rect": 9, "fillRect": 10, "fill": 11, "stroke": 12, "clip": 13, "save": 14, "restore": 15,
      "translate": 16, "rotate": 17, "scale": 18, "setTransform": 19, "=fillStyle": 20, "=strokeStyle": 21,
      "=lineWidth": 22, "=globalAlpha": 23, "setLineDash": 24, "roundRect": 25, "=lineDashOffset": 26}
CLIP_OUT = 27     # keep what is outside the path. The canvas has no such call: see hole()
# every stroke is drawn with round ends and corners, which is all his drawings use bar a few pointed corners
SAME = {"=lineCap": ("round",), "=lineJoin": ("round", "miter"), "=globalCompositeOperation": ("source-over",)}
TEXT = ("=font", "=textAlign", "=textBaseline")   # text state: no instruction depends on it


def q(v, scale=16):
    return struct.pack("<h", max(-32768, min(32767, round(v * scale))))


def colour(s):
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", s)
    if m: return bytes.fromhex(m.group(1)) + b"\xff"
    p = [float(x) for x in re.fullmatch(r"rgba?\(([^)]+)\)", s).group(1).split(",")]
    return bytes([int(p[0]), int(p[1]), int(p[2]), round((p[3] if len(p) > 3 else 1) * 255)])


def turn(a):
    """An angle brought within half a turn of zero, so any amount of spinning fits in 16 bits."""
    return (a + math.pi) % math.tau - math.pi


def arc_angles(a0, a1, anticlockwise):
    """The same arc as the canvas would draw, with both angles within one turn of zero."""
    d = a1 - a0
    if anticlockwise: d = -math.tau if d <= -math.tau else d % math.tau - math.tau if d > 0 else d
    else: d = math.tau if d >= math.tau else d % -math.tau + math.tau if d < 0 else d
    a0 %= math.tau
    if d > 0: a0 -= math.tau
    return q(a0, 4096) + q(a0 + d, 4096) + bytes([1 if anticlockwise else 0])


def hole(calls, i):
    """The page cuts a round hole in what follows with beginPath, rect(whole screen), arc(anticlockwise), clip.
    If that is what starts at calls[i], the arc."""
    c = calls[i:i + 4]
    if [o[0] for o in c] == ["beginPath", "rect", "arc", "clip"] and c[1][1:] == [0, 0, 240, 240] and len(c[2]) > 6 and c[2][6] and len(c[3]) == 1:
        return c[2]


def encode(calls):
    """The instructions for one frame's canvas calls, or None if it uses something vec.h can't draw."""
    out = bytearray(); i = 0; calls = list(calls)
    try:
        while i < len(calls):
            if hole(calls, i):                           # a run of holes becomes a path and a cut (a few, if there are many)
                out.append(OP["beginPath"]); room = 800  # points a path may hold, with some to spare
                while hole(calls, i) and room > 0:
                    a = hole(calls, i)[1:]; i += 4; room -= 8 + 12 * abs(a[2]) ** 0.5
                    out.append(OP["moveTo"]); out += q(a[0] + a[2]) + q(a[1])
                    out.append(OP["arc"]); out += q(a[0]) + q(a[1]) + q(a[2]) + arc_angles(a[3], a[4], True)
                out.append(CLIP_OUT); continue
            o = calls[i]; i += 1
            n, a = o[0], o[1:]
            if n in SAME:
                if a[0] not in SAME[n]: return None
                continue
            if n in TEXT: continue
            if n not in OP or (n in ("fill", "clip") and a): return None
            out.append(OP[n])
            if n in ("moveTo", "lineTo", "translate"): out += q(a[0]) + q(a[1])
            elif n == "quadraticCurveTo": out += b"".join(q(v) for v in a[:4])
            elif n == "bezierCurveTo": out += b"".join(q(v) for v in a[:6])
            elif n == "arc": out += q(a[0]) + q(a[1]) + q(a[2]) + arc_angles(a[3], a[4], len(a) > 5 and a[5])
            elif n == "ellipse": out += b"".join(q(v) for v in a[:4]) + q(turn(a[4]), 4096) + arc_angles(a[5], a[6], len(a) > 7 and a[7])
            elif n in ("rect", "fillRect"): out += b"".join(q(v) for v in a[:4])
            elif n == "roundRect": out += b"".join(q(v) for v in a[:4]) + q(a[4][0] if isinstance(a[4], list) else a[4])
            elif n == "rotate": out += q(turn(a[0]), 4096)
            elif n == "scale": out += q(a[0], 256) + q(a[1], 256)
            elif n == "setTransform": out += b"".join(q(v, 256) for v in a[:4]) + q(a[4]) + q(a[5])
            elif n in ("=fillStyle", "=strokeStyle"): out += colour(a[0])
            elif n == "=lineWidth": out += struct.pack("<H", min(65535, round(a[0] * 16)))
            elif n == "=globalAlpha": out.append(max(0, min(255, round(a[0] * 255))))
            elif n == "setLineDash":
                if len(a[0]) > 8: return None
                out.append(len(a[0])); out += b"".join(struct.pack("<H", min(65535, round(v * 16))) for v in a[0])
            elif n == "=lineDashOffset": out += q(a[0])
    except (TypeError, AttributeError, IndexError):      # a gradient, an image, an argument that isn't a number
        return None
    return bytes(out) if len(out) < 65536 else None


def native(name, header, *more):
    """tools/<name>.cpp built with the firmware's own firmware/src/<header> (and tools/ for what only the Mac needs,
    such as tinfl.h), rebuilt when any of them changes."""
    exe = os.path.join(tempfile.gettempdir(), "desk_" + name)
    src = os.path.join(ROOT, "tools", name + ".cpp"); hdr = os.path.join(ROOT, "firmware", "src", header)
    deps = [src, hdr] + [os.path.join(ROOT, "tools", m) for m in more]
    if not os.path.exists(exe) or os.path.getmtime(exe) < max(map(os.path.getmtime, deps)):
        subprocess.run(["clang++", "-O2", "-std=c++17", "-I", os.path.dirname(hdr), "-I", os.path.join(ROOT, "tools"), src, "-o", exe], check=True)
    return exe


def check(frames):
    """How well vec.h redraws each (instructions, rgba): a list of (mean % difference, far pixels, overflowed)."""
    feed = b"".join(struct.pack("<I", len(v)) + v + rgba for v, rgba in frames)
    res = subprocess.run([native("vec_check", "vec.h")], input=feed, capture_output=True, check=True).stdout.decode().split("\n")
    return [(float(a), int(b), c == "1") for a, b, c in (line.split() for line in res if line)]


# ---- glyph frames: a background fill and text, drawn from the atlas by firmware/src/glyphs.h ----
QUIET = ("=lineCap", "=lineJoin", "=lineWidth", "=strokeStyle", "setLineDash", "=lineDashOffset")   # nothing a fill or text uses


def glyph_list(calls):
    """A frame that is only a background fill and text, as (background rgb565, [(x, y, atlas key, rgb565)]) in drawing
    order, or None. Glyphs that draw nothing on the screen are left out."""
    fill, alpha, state, bg, out = None, 1.0, [None, None, None], None, []
    try:
        for o in calls:
            n, a = o[0], o[1:]
            if n in QUIET: continue
            if n == "=fillStyle": fill = a[0]
            elif n == "=globalAlpha": alpha = float(a[0])
            elif n in TEXT: state[TEXT.index(n)] = a[0]
            elif n == "=globalCompositeOperation":
                if a[0] != "source-over": return None
            elif n == "fillRect":                         # only a wipe of the whole screen, opaque
                r, g, b, k = colour(fill); x, y, w, h = a[:4]
                if k < 255 or alpha < 1 or x > 0 or y > 0 or x + w < 240 or y + h < 240: return None
                bg, out = rgb565(r, g, b), []
            elif n == "fillText":
                if bg is None or len(a) != 3: return None   # on whatever the last frame left, or squeezed to a width
                st = texts.get(tuple(state)); text, x, y = a
                if not st or text not in st["glyphs"]: return None
                left, top, w, h, _ = st["glyphs"][text]
                ix = math.floor(x + 0.5)
                iy = math.floor(y) + (y - math.floor(y) >= st["yUp"]) if st["yUp"] is not None else math.floor(y + 0.5)
                r, g, b, k = colour(fill); f = k / 255 * alpha
                col = rgb565(int(r * f + 0.5), int(g * f + 0.5), int(b * f + 0.5))
                if not w or ix + left >= 240 or iy + top >= 240 or ix + left + w <= 0 or iy + top + h <= 0: continue
                if col == bg and f < 1: continue          # invisible: drawn, it would only cut into what is under it
                if not (-32768 <= ix < 32768 and -32768 <= iy < 32768): return None
                out.append((ix, iy, (*state, text), col))
            else:
                return None
    except (TypeError, AttributeError, IndexError, ValueError, KeyError):   # a gradient, a NaN, a call with odd arguments
        return None
    return None if bg is None else (bg, out)


def glyph_frame(bg, glyphs, index):
    """The bytes of a glyph frame (after its u16 length), or None if it is too long or needs a glyph past the atlas."""
    if any(index.get(k, 256) > 255 for _, _, k, _ in glyphs) or 2 + 7 * len(glyphs) > 65535: return None
    return struct.pack("<H", bg) + b"".join(struct.pack("<hhBH", x, y, index[k], col) for x, y, k, col in glyphs)


def atlas_block(keys):
    """The atlas as the .bin stores it, its glyphs in this order: coverage rounded to 4 bits."""
    at, rec = [], bytearray()
    for k in keys:
        left, top, w, h, cov = texts[k[:3]]["glyphs"][k[3]]
        at.append(len(rec)); rec += struct.pack("<bbBB", left, top, w, h)
        for y in range(h):
            row = [(v * 15 + 127) // 255 for v in cov[y * w:(y + 1) * w]] + [0]
            rec += bytes(row[x] << 4 | row[x + 1] for x in range(0, w, 2))
    return struct.pack("<HI", len(keys), len(rec)) + b"".join(struct.pack("<I", o) for o in at) + bytes(rec)


def check_glyphs(atlas, frames):
    """How well glyphs.h redraws each (glyph frame, rgba) from the atlas: a list of (mean % difference, far pixels)."""
    if not frames: return []
    feed = struct.pack("<I", len(atlas)) + atlas + b"".join(struct.pack("<I", len(g)) + g + rgba for g, rgba in frames)
    res = subprocess.run([native("glyph_check", "glyphs.h")], input=feed, capture_output=True, check=True).stdout.decode().split("\n")
    return [(float(a), int(b)) for a, b in (line.split() for line in res if line)]


# ---- compressed frames (version 7): firmware/src/packed.h inflates them, after their base's bytes ----
HEAD, NONE = 15, 0xFFFF           # the record's head (kind, base, size, deflate length, adler-32); no base
WINDOW = 3 * 240 * 240            # a frame and its base together (packed::WINDOW)
RUN, REACH = 16, 64               # one keyframe to a run of at most 16 frames in file order; then each frame takes the
                                  # best keyframe this many frames either side of it


def deflate(data, base=b""):
    c = zlib.compressobj(9, zlib.DEFLATED, -15, 9, zlib.Z_DEFAULT_STRATEGY, *([base] if base else []))
    return c.compress(data) + c.flush()


def record(kind, data, base=NONE, base_data=b""):
    z = deflate(data, base_data)
    return struct.pack("<BHIII", kind, base, len(data), len(z), zlib.adler32(data)) + z


def keyframes(raw, alone):
    """For each frame, the keyframe it is compressed after, or None. A keyframe compresses on its own, and each run of
    up to RUN frames in file order (consecutive frames are alike) shares the one that makes the run smallest, chosen by
    a dynamic programme over the runs; then each frame takes the best keyframe within REACH of it."""
    n = len(raw)
    own = [min(len(alone[i]), len(raw[i])) for i in range(n)]
    can = [len(alone[i]) < len(raw[i]) for i in range(n)]
    pair = {}

    def cost(i, k):
        if i == k or not can[k] or len(raw[i]) + len(raw[k]) > WINDOW: return own[i]
        if (i, k) not in pair: pair[(i, k)] = HEAD + len(deflate(raw[i], raw[k]))
        return min(pair[(i, k)], own[i])
    best, choice = [0] + [None] * n, [None] * (n + 1)
    for b in range(1, n + 1):
        for a in range(max(0, b - RUN), b):
            for k in range(a, b):
                v = best[a] + sum(cost(i, k) for i in range(a, b))
                if best[b] is None or v < best[b]: best[b], choice[b] = v, (a, k)
    base, b = [None] * n, n
    while b:
        a, k = choice[b]
        for i in range(a, b): base[i] = k if i != k and cost(i, k) < own[i] else None
        b = a
    keys = sorted({k for k in base if k is not None})
    for i in range(n):
        if base[i] is None: continue
        near = [k for k in keys[max(0, bisect.bisect_left(keys, i - REACH)):bisect.bisect_right(keys, i + REACH)] if k != i]
        base[i] = min(near, key=lambda k: (cost(i, k), abs(k - i), k))
    return base


def inflate_back(stored):
    """Every compressed frame of a frame table [(kind, bytes)] inflated by firmware/src/packed.h with the ROM's tinfl,
    each cold (its base too): {frame index: its bytes, or None if refused}."""
    table = bytearray(); off = 0
    for kind, blob in stored:
        table += struct.pack("<I", off | (kind << 30)); off += len(blob)
    body = bytes(table) + b"".join(b for _, b in stored)
    feed = struct.pack("<IIII", len(stored), 0, len(table), len(body)) + body
    out = subprocess.run([native("pack_check", "packed.h", "tinfl.h")], input=feed, capture_output=True, check=True).stdout
    got, p = {}, 0
    while p < len(out):
        f, size = struct.unpack_from("<II", out, p); p += 8
        if size >= 0xFFFFFFFE: got[f] = None; continue
        got[f] = out[p:p + size]; p += size
    return got


def pack(blobs):
    """The frames as the file stores them: compressed where that is smaller, after a keyframe where that is smaller
    still, and each compressed one kept only if packed.h inflates it back to its frame byte for byte (a keyframe that
    does not takes its frames' compression with it: they are tried again on their own). (stored, what it came to)."""
    raw = [b for _, b in blobs]
    alone = [record(k, b) for k, b in blobs]
    base = keyframes(raw, alone)
    rec = [alone[i] if base[i] is None else record(k, raw[i], base[i], raw[base[i]]) for i, (k, _) in enumerate(blobs)]
    use = [len(rec[i]) < len(raw[i]) for i in range(len(raw))]
    refused = 0
    for _ in range(2):
        stored = [(1, rec[i]) if use[i] else blobs[i] for i in range(len(raw))]
        back = inflate_back(stored)
        bad = {i for i, b in back.items() if b != raw[i]}
        if not bad: break
        refused += len(bad)
        for i in bad: use[i] = False
        for i in range(len(raw)):                     # a frame whose keyframe is now stored as it is: on its own
            if use[i] and base[i] is not None and not use[base[i]]:
                base[i] = None; rec[i] = alone[i]; use[i] = len(alone[i]) < len(raw[i])
    else:
        stored = [(1, rec[i]) if use[i] else blobs[i] for i in range(len(raw))]
        if any(b != raw[i] for i, b in inflate_back(stored).items()): sys.exit("packed.h does not inflate the frames it was given back")
    names = {0: "pixels", 2: "instructions", 3: "glyphs"}
    by = {names[k]: {"frames": 0, "compressed": 0, "bytes": 0, "stored": 0} for k in (0, 2, 3)}
    for i, (k, b) in enumerate(blobs):
        s = by[names[k]]; s["frames"] += 1; s["compressed"] += use[i]; s["bytes"] += len(b); s["stored"] += len(stored[i][1])
    keys = {base[i] for i in range(len(raw)) if use[i] and base[i] is not None}
    windows = [len(raw[i]) + (len(raw[base[i]]) if base[i] is not None else 0) for i in range(len(raw)) if use[i]]
    return stored, {"by_kind": {k: v for k, v in by.items() if v["frames"]}, "keyframes": len(keys),
                    "after_a_keyframe": sum(1 for i in range(len(raw)) if use[i] and base[i] is not None),
                    "on_their_own": sum(1 for i in range(len(raw)) if use[i] and base[i] is None and i not in keys),
                    "as_they_are": sum(1 for u in use if not u), "largest_window": max(windows, default=0),
                    "refused_by_pack_check": refused}


def lint(name, pics, calls, stuck, shows, size):
    """What bakes but wastes space or will look wrong on him, for a clip: a list of plain sentences."""
    notes = []
    for s in meta["seqs"]:
        ticks = sorted(t for (k, t) in where if k == s["key"]); d = [named[(s["key"], t)] for t in ticks]
        odd = [d[i] for i in range(1, len(d)) if d[i] != d[i - 1] and i % 2 and d[i].startswith(name + "_")][1:]
        if odd: notes.append(f"{len(odd)} drawings start on an odd tick, so they straddle two of his wobbles and are stored twice (first: {odd[0]}). "
                             "Hold the first drawing after WAKE for 3 ticks and every other for an even number.")
    pinks = set()
    for frame in calls:
        for c in frame:
            if c[0] in ("=fillStyle", "=strokeStyle") and isinstance(c[1], str):
                r, g, b, _ = colour(c[1]); beta = g / 241; alpha = r / 255 - beta
                if max(r, g, b) >= 8 and alpha > 0.02 and b >= alpha * 255 + beta * 220 - 48 and abs(r - b) > 24: pinks.add(c[1])
    if pinks: notes.append(f"The board will repaint {', '.join(sorted(pinks))} in his body colour: it takes pinks and purples for him.")
    lit = lambda rgba, x, y: max(rgba[(y * 240 + x) * 4:(y * 240 + x) * 4 + 3]) > 110     # brighter than a wall or a sky
    for side, cells in (("left", [(0, y) for y in range(186)]), ("right", [(239, y) for y in range(186)]), ("top", [(x, 0) for x in range(240)])):
        framed = lambda f: any(c[0] == "scale" for c in calls[f][:17])      # seen through kit.view: the edges are meant to be crossed
        cut = sorted(d for d, frames in shows.items() if d.startswith(name + "_") and any(not framed(f) and sum(lit(pics[f], x, y) for x, y in cells) > 10 for f in frames))
        if cut: notes.append(f"Something bright touches the {side} edge in {', '.join(cut[:10])}{' and more' if len(cut) > 10 else ''}. "
                             "Fine for a setting or a slide in or out; anywhere else a prop or the character is cut off.")
    if stuck: notes.append(f"Stored as pixels: {', '.join(stuck[:8])}. Look for a NaN or undefined coordinate, a call the board can't draw, "
                           "a translucent full-screen fill, or a scale that isn't a whole number of 256ths.")
    if size > 150000: notes.append(f"{size} bytes: over 150000 it takes longer to send and crowds the board's memory. Reuse drawings or simplify props.")
    return notes


def staging(name, pics, shows):
    """Where he was and how big, across a clip's own drawings: to see at a glance whether a batch all looks alike."""
    xs, hs = [], []
    for d, frames in shows.items():
        if not d.startswith(name + "_"): continue
        rgba = pics[min(frames)]; hit = [(i % 80 * 3, i // 80 * 3) for i in range(6400) if rgba[(i // 80 * 720 + i % 80 * 3) * 4:(i // 80 * 720 + i % 80 * 3) * 4 + 3] == b"\xff\x00\xff"]
        if hit: xs.append(sum(x for x, _ in hit) / len(hit)); hs.append(max(y for _, y in hit) - min(y for _, y in hit))
    if not xs: return {}
    side = lambda x: "left" if x < 100 else "right" if x > 156 else "centre"
    return {"seconds": round(len(where) / 24, 1), "he_stands": sorted({side(x) for x in xs}), "his_size": [round(min(hs) / 128, 2), round(max(hs) / 128, 2)],
            "drawings_without_him": sum(1 for d in shows if d.startswith(name + "_")) - len(xs)}


def pstr(s):
    b = s.encode(); return bytes([len(b)]) + b


def build():
    moods = [m["name"] for m in meta["moments"]]
    if len(meta["seqs"]) > MAX_SEQS: sys.exit(f"{len(meta['seqs'])} sequences is more than the board's {MAX_SEQS}")
    uniq, pics, calls, body, shows = {}, [], [], bytearray(), {}
    for s in meta["seqs"]:
        ticks = sorted(t for (k, t) in where if k == s["key"])
        seq = []
        for t in ticks:
            rgba, ops = units[where[(s["key"], t)]]; h = hashlib.sha1(rgba).digest()
            if h not in uniq:
                uniq[h] = len(pics); pics.append(rgba); calls.append(ops)
            seq.append(uniq[h]); shows.setdefault(named[(s["key"], t)], set()).add(uniq[h])
        body += struct.pack("<BBB", s["kind"], moods.index(s["from"]), moods.index(s["to"])) + pstr(s["name"])
        body += struct.pack("<H", len(seq)) + struct.pack(f"<{len(seq)}H", *seq)
    vec = [encode(c) for c in calls]
    scores = iter(check([(v, pics[i]) for i, v in enumerate(vec) if v is not None]))
    # what the instructions cannot draw may be glyphs: checked against the browser with every glyph the page drew,
    # then stored with only the glyphs the kept frames use
    lists = {i: g for i, g in ((i, glyph_list(calls[i])) for i, v in enumerate(vec) if v is None) if g}
    keys = list(dict.fromkeys(k for i in sorted(lists) for _, _, k, _ in lists[i][1]))
    tried = {i: glyph_frame(*lists[i], {k: n for n, k in enumerate(keys)}) for i in lists}
    tried = {i: g for i, g in tried.items() if g is not None}
    gscores = dict(zip(tried, check_glyphs(atlas_block(keys[:256]), [(g, pics[i]) for i, g in tried.items()])))
    kept = sorted(i for i, (mean, far) in gscores.items() if mean <= MAX_MEAN and far <= MAX_FAR)
    keys = list(dict.fromkeys(k for i in kept for _, _, k, _ in lists[i][1]))
    index = {k: n for n, k in enumerate(keys)}
    glyphed = {i: glyph_frame(*lists[i], index) for i in kept}
    atlas = atlas_block(keys)
    blobs, why = [], {"instructions": 0, "glyphs": 0, "pixels: uses something the renderer can't draw": 0,
                      "pixels: didn't match closely enough": 0, "pixels: glyphs didn't match closely enough": 0}
    worst, gworst = (0.0, 0), (0.0, 0)
    for i, v in enumerate(vec):
        if i in glyphed:
            g = glyphed[i]; gworst = (max(gworst[0], gscores[i][0]), max(gworst[1], gscores[i][1]))
            why["glyphs"] += 1; blobs.append((3, struct.pack("<H", len(g)) + g)); continue
        if v is None:
            why["pixels: glyphs didn't match closely enough" if i in gscores else "pixels: uses something the renderer can't draw"] += 1
            blobs.append((0, rle(pics[i]))); continue
        mean, far, overflowed = next(scores)
        if overflowed or mean > MAX_MEAN or far > MAX_FAR:
            why["pixels: didn't match closely enough"] += 1; blobs.append((0, rle(pics[i]))); continue
        worst = (max(worst[0], mean), max(worst[1], far))
        why["instructions"] += 1; blobs.append((2, struct.pack("<H", len(v)) + v))
    stored, packing = pack(blobs)
    out = bytearray(b"SAGE") + struct.pack("<HHBB", 7, len(stored), len(moods), 24)
    for m in meta["moments"]:
        out += bytes([m["base"]]) + pstr(m["name"])
    out += struct.pack("<H", len(meta["seqs"])) + body + atlas
    off = 0
    for kind, blob in stored:
        out += struct.pack("<I", off | (kind << 30)); off += len(blob)
    if off >= 1 << 30: sys.exit("more than a gigabyte of frames")
    for _, blob in stored:
        out += blob
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(out)
    if refs_path:                                    # [u32 frame index][u32 length][zlib of its RGBA], per glyph frame
        with open(refs_path, "wb") as f:
            for i in glyphed:
                z = zlib.compress(pics[i], 6); f.write(struct.pack("<II", i, len(z)) + z)
    as_pixels = sorted(d for d, frames in shows.items() if any(not blobs[f][0] for f in frames))
    gsizes = sorted(len(b) for k, b in blobs if k == 3)
    return {**({"lint": lint(clip_name, pics, calls, [d for d in as_pixels if d.startswith(clip_name + "_")], shows, len(out)), "staging": staging(clip_name, pics, shows)} if clip_name else {}),
            "frames_rendered": len(where), "unique_frames": len(blobs), "bytes": len(out), "moods": len(moods),
            "sequences": len(meta["seqs"]), "kept_as": why,
            "named_drawings": {"total": len(shows), "without_pixel_frames": len(shows) - len(as_pixels), "with_pixel_frames": as_pixels},
            "instruction_bytes": sum(len(b) for k, b in blobs if k == 2),
            "glyph_bytes": sum(gsizes), "atlas_bytes": len(atlas), "atlas_glyphs": len(keys),
            "pixel_bytes": sum(len(b) for k, b in blobs if not k), "compressed": packing,
            "glyph_frame_bytes": {"smallest": gsizes[0], "median": gsizes[len(gsizes) // 2], "largest": gsizes[-1]} if gsizes else None,
            "glyphs_in_a_frame": max((len(lists[i][1]) for i in glyphed), default=0),
            "text_states": [{"font": k[0], "align": k[1], "baseline": k[2], "texts": len(v["glyphs"]), "y_moves_down_past": v["yUp"]} for k, v in texts.items()],
            "worst_instruction_frame": {"mean_difference_pct": worst[0], "pixels_far_off": worst[1]},
            "worst_glyph_frame": {"mean_difference_pct": gworst[0], "pixels_far_off": gworst[1]},
            "glyph_frames_refused": {i: {"mean_difference_pct": m, "pixels_far_off": f} for i, (m, f) in gscores.items() if i not in glyphed},
            "out": out_path}


def sheet():
    """Instead of baking: every distinct drawing, in the order they first appear, side by side, 24 to a PNG
    (name.png, then name_2.png, name_3.png ...)."""
    order, seen = [], set()
    for s in meta["seqs"]:
        for t in sorted(t for (k, t) in where if k == s["key"]):
            i = where[(s["key"], t)]
            if i not in seen: seen.add(i); order.append(i)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    root, ext = os.path.splitext(out_path); outs = []
    for page in range(0, len(order), 24):
        ids = order[page:page + 24]; cols = min(6, len(ids)); rows = -(-len(ids) // cols)
        px = bytearray(cols * 240 * rows * 240 * 3)
        for n, i in enumerate(ids):
            rgba = units[i][0]; x0, y0 = (n % cols) * 240, (n // cols) * 240
            for y in range(240):
                row = rgba[y * 960:(y + 1) * 960]; at = ((y0 + y) * cols * 240 + x0) * 3
                px[at:at + 720] = bytes(b for k in range(0, 960, 4) for b in row[k:k + 3])
        raw = b"".join(b"\x00" + bytes(px[y * cols * 720:(y + 1) * cols * 720]) for y in range(rows * 240))
        outs.append(out_path if not page else f"{root}_{page // 24 + 1}{ext}")
        with open(outs[-1], "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", cols * 240, rows * 240, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    return {"drawings": len(order), "ticks": len(where), "seconds": round(len(where) / 24, 1), "out": outs}


def gif():
    """Instead of baking: the sequences played through once as an animated GIF (needs ffmpeg)."""
    raw = b"".join(units[where[(s["key"], t)]][0] for s in meta["seqs"] for t in sorted(t for (k, t) in where if k == s["key"]))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "240x240", "-r", "24", "-i", "-",
                    "-vf", "split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=none", out_path], input=raw, check=True)
    return {"ticks": len(where), "seconds": round(len(where) / 24, 1), "bytes": os.path.getsize(out_path), "out": out_path}


finish = build


class H(http.server.SimpleHTTPRequestHandler):
    page = None                                    # headless: the page to serve at /, with the export script added

    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.dirname(PAGE), **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.page is not None and urlparse(self.path).path == "/":
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
            self.wfile.write(self.page); return
        super().do_GET()

    def do_POST(self):
        u = urlparse(self.path); n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n)
        q = parse_qs(u.query)
        if u.path == "/meta":
            meta.clear(); meta.update(json.loads(body)); units.clear(); where.clear(); named.clear(); texts.clear(); res = b"ok"
        elif u.path == "/frame":
            at = (q["seq"][0], int(q["tick"][0])); named[at] = q["d"][0]
            units[int(q["id"][0])] = (body[:PIXELS], json.loads(body[PIXELS:])); where[at] = int(q["id"][0]); res = b"ok"
        elif u.path == "/same":
            at = (q["seq"][0], int(q["tick"][0])); named[at] = q["d"][0]; where[at] = int(q["as"][0]); res = b"ok"
        elif u.path == "/atlas":                    # every text the page drew, alone (EXPORT_JS); what the format can't hold is left out
            texts.clear()
            for st in json.loads(body):
                texts[(st["font"], st["align"], st["base"])] = {"yUp": st["yUp"], "glyphs": {
                    g["text"]: (g["left"], g["top"], g["w"], g["h"], g["a"]) for g in st["glyphs"]
                    if -128 <= g["left"] < 128 and -128 <= g["top"] < 128 and g["w"] < 256 and g["h"] < 256}}
            res = b"ok"
        elif u.path == "/error":                    # the page hit a script error (headless: say so and stop)
            result["error"] = body.decode(errors="replace"); done.set(); res = b"ok"
        elif u.path == "/finish":
            info = finish(); print(json.dumps(info, indent=1), flush=True); res = json.dumps(info).encode()
            result.update(info); done.set()
        else:
            self.send_error(404); return
        self.send_response(200); self.send_header("Content-Type", "text/plain"); self.end_headers(); self.wfile.write(res)


def headless(config, scripts=()):
    """Run the export in headless Chrome (after any clip scripts) and wait for it to finish."""
    report = "<script>addEventListener('error', e => fetch('/error', { method: 'POST', body: e.message + ' (line ' + e.lineno + ')' }));</script>"
    page = open(PAGE).read() + report + "".join(f"<script>{open(p).read()}</script>" for p in scripts)
    H.page = (page + f"<script>window.__lumpExport = {json.dumps(config)};{EXPORT_JS}</script>").encode()
    done.clear(); result.clear()
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="sage-export-")
    chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", *(["--no-sandbox"] if sys.platform == "linux" else []), "--no-first-run", "--no-default-browser-check",
                               f"--user-data-dir={profile}", f"http://127.0.0.1:{port}/"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not done.wait(900): sys.exit("Chrome didn't finish the export")
    finally:
        chrome.terminate(); chrome.wait(10); srv.shutdown(); shutil.rmtree(profile, ignore_errors=True)
    if "error" in result: sys.exit("the page stopped with an error: " + result["error"])


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("port", nargs="?", type=int, default=8765, help="serve design/ here (when not baking headless)")
    ap.add_argument("--bake", action="store_true", help="bake everything into firmware/data/sage.bin with headless Chrome")
    ap.add_argument("--clip", metavar="NAME", help="bake only the sequences called NAME or NAME_*, as a clip ('all': every design/clips/*.js)")
    ap.add_argument("--sheet", metavar="PNG", help="with --clip: save its drawings as one picture instead of baking")
    ap.add_argument("--gif", metavar="GIF", help="with --clip: save it as an animated GIF instead of baking")
    ap.add_argument("--define", metavar="JSON", help="a file of extra sequences made from existing drawings")
    ap.add_argument("--out", help="where to write (default: sage.bin, or ~/.desk-buddy/clips/NAME.clip)")
    ap.add_argument("--page", help="the page to bake from, with the same interface (default: design/sage.html)")
    ap.add_argument("--refs", metavar="FILE", help="also save the browser's picture of every glyph frame (for emulator/checks/glyph_fidelity.mjs)")
    args = ap.parse_args()
    if args.page: PAGE = os.path.abspath(args.page)
    if args.refs: refs_path = os.path.abspath(args.refs)
    if args.clip:
        source = lambda n: os.path.join(DESIGN, "clips", n + ".js")
        names = sorted(os.path.basename(p)[:-3] for p in glob.glob(source("*"))) if args.clip == "all" else [args.clip]
        for name in names:
            config = {"define": json.load(open(args.define)) if args.define else {}, "only": [name]}
            out_path = args.out or os.path.join(CLIPS, name + ".clip")
            if args.sheet or args.gif: config["tint"] = "#FF7A45"; out_path = args.sheet or args.gif; finish = sheet if args.sheet else gif
            clip_name = name
            headless(config, [KIT, source(name)] if os.path.exists(source(name)) else [])
    elif args.bake:
        if args.out: out_path = args.out
        headless({})
    else:
        print(f"serving {os.path.dirname(PAGE)} on http://localhost:{args.port}", flush=True)
        http.server.ThreadingHTTPServer(("127.0.0.1", args.port), H).serve_forever()
