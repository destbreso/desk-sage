"""Writes the README's gallery: a typical session, a few of its moments and the hardware, each image carrying a
fingerprint of its content (CLAUDE.md). Run it after drawing any of those GIFs again: python3 tools/readme_gallery.py"""
import hashlib, pathlib

root = pathlib.Path(__file__).resolve().parents[1]

MOMENTS = [
    ("idle", "Waiting for something to happen"), ("working", "Reading while Claude works"),
    ("holo_tests", "The tests as they run, standing on the desk"), ("life_deploy", "On a deploy, it sends a glider off the board"),
    ("sulk", "Push its patience too far and it sulks"), ("tap_knock", "Knock, and it looks out to see who's there"),
    ("cam_orbit", "All the way round, and it keeps you in sight"), ("glyph_eyes", "Just its eyes in the dark, then the rest of it"),
]


def src(path):
    return f"{path}?v={hashlib.sha1((root / path).read_bytes()).hexdigest()[:8]}"


def cell(name, caption):
    return f'<td align="center"><img src="{src(f"gallery/sage/{name}.gif")}" width="200" alt="{caption}"><br><sub>{caption}</sub></td>'


rows = [MOMENTS[:4], MOMENTS[4:]]
out = [
    "## Gallery",
    "",
    "This is Sage the way the board will show it. Every animation here went through the same bake that writes its frames for the board. On the prism the black around it turns to glass, so it looks like it's floating.",
    "",
    "### A day with it",
    "",
    "Almost two minutes of a typical session, from the moment it forms out of the rain to the moment it loses my Mac and carries on by itself.",
    "",
    f'<p align="center"><img src="{src("gallery/session.gif")}" width="320" alt="A typical session with Sage, from forming out of the rain to carrying on by itself"></p>',
    "",
    "### A few of its moments",
    "",
    "<table>",
    *["<tr>" + "".join(cell(*m) for m in row) + "</tr>" for row in rows],
    "</table>",
    "",
    "It has many more. Every one of them is in [gallery/sage/](gallery/sage/).",
    "",
    "### The hardware",
    "",
    f'<p align="center"><img src="{src("gallery/hardware/taken-apart.gif")}" width="320" alt="The device taken apart level by level and put back together"></p>',
    "",
    "This comes from [hardware/index.html](hardware/index.html). Open it in any browser from a clone of this repository. You can drag it around, step through the levels or play the whole assembly, and tap any part to see what it is and where its facts come from.",
    "",
]
text = (root / "README.md").read_text()
start, end = text.index("## Gallery"), text.index("## Roadmap")
(root / "README.md").write_text(text[:start] + "\n".join(out) + "\n" + text[end:])
print("gallery written:", len(MOMENTS), "moments, the session and the hardware")
