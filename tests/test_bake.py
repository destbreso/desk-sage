"""The antenna's mark through the bake (tools/export_frames.py): recorded from the page, stored as instruction 28, and
version 8's flags read by the bridge as the board reads them.

    python3 -m unittest discover -s tests
"""
import importlib.util, os, struct, tempfile, unittest

_spec = importlib.util.spec_from_file_location("export_frames", os.path.join(os.path.dirname(__file__), "..", "tools", "export_frames.py"))
bake = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bake)
_spec = importlib.util.spec_from_file_location("buddy_bridge_bake", os.path.join(os.path.dirname(__file__), "..", "tools", "buddy_bridge.py"))
os.environ.setdefault("DESKBUDDY_HOME", tempfile.mkdtemp(prefix="deskbuddy-test-"))
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)


class TheMark(unittest.TestCase):
    def test_the_recorder_takes_it_and_the_page_does_not(self):
        js = bake.EXPORT_JS
        self.assertIn("if (p === 'anchor') return (...a) => { ops.push(['anchor', ...a]); };", js)

    def test_stored_as_instruction_28_in_screen_sixteenths(self):
        calls = [["beginPath"], ["anchor", 151.25, 19.8125, 3.9375], ["arc", 151.25, 19.8125, 3.9375, 0, 6.283185307179586], ["fill"]]
        out = bake.encode(calls)
        at = out.index(bake.ANCHOR)
        self.assertEqual(bake.ANCHOR, 28)
        self.assertEqual(struct.unpack_from("<hhh", out, at + 1), (2420, 317, 63))
        self.assertEqual(out[at + 7], bake.OP["arc"])
        # the same six bytes as the ball's arc right after it, so deflate finds them again
        self.assertEqual(out[at + 1:at + 7], out[at + 8:at + 14])

    def test_a_frame_with_a_mark_is_not_text(self):
        self.assertIsNone(bake.glyph_list([["=fillStyle", "#000000"], ["fillRect", 0, 0, 240, 240], ["anchor", 1, 2, 3]]))


class VersionEight(unittest.TestCase):
    def art(self, version, flags=1):
        moods = b"".join(bytes([0, len(n)]) + n for n in (b"idle",))
        seqs = struct.pack("<H", 2) + bytes([0, 0, 0, 4]) + b"idle" + struct.pack("<HH", 1, 0) + bytes([2, 0, 0, 5]) + b"hello" + struct.pack("<HH", 1, 0)
        head = b"SAGE" + struct.pack("<HHBB", version, 1, 1, 24) + (bytes([flags]) if version >= 8 else b"")
        return head + moods + seqs

    def test_the_bridge_reads_its_acts_past_the_flags(self):
        with tempfile.TemporaryDirectory() as d:
            for version in (7, 8):
                p = os.path.join(d, f"v{version}.bin")
                with open(p, "wb") as f:
                    f.write(self.art(version))
                self.assertEqual(bridge.art_acts(p), ["hello"], version)
            p = os.path.join(d, "v9.bin")
            with open(p, "wb") as f:
                f.write(self.art(9))
            self.assertIsNone(bridge.art_acts(p))

    def test_the_bake_writes_version_8_and_documents_it(self):
        self.assertIn('"SAGE" u16 version=8', bake.__doc__)
        self.assertIn("u8 flags (version 8)", bake.__doc__)


if __name__ == "__main__":
    unittest.main()
