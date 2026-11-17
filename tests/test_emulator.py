"""Tests for the bridge's emulator link: the page as a third board beside USB and Wi-Fi.

Run with any Python 3 (the emulator link needs no pyserial):
    python3 -m unittest discover -s tests -v
The bridge is pointed at a temp folder; the page is played by the test, over the same queue, POSTs and
HTTP server the real page uses.
"""
import base64, http.client, http.server, importlib.util, json, os, tempfile, threading, time, unittest
from unittest import mock

HOME = os.environ.setdefault("DESKBUDDY_HOME", tempfile.mkdtemp(prefix="deskbuddy-test-"))
_spec = importlib.util.spec_from_file_location(
    "buddy_bridge_emulator", os.path.join(os.path.dirname(__file__), "..", "tools", "buddy_bridge.py"))
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)

TESTCARD = os.path.join(bridge.EMULATOR_DIR, "testcard", "testcard.bin")
PING = os.path.join(bridge.EMULATOR_DIR, "testcard", "ping.clip")


class FakeFocus:
    front, code_session = False, None


class FakeSounds:
    def settings(self): return {}
    def play(self, moment, force=False): return True


class FakeDevice:
    connected, emulator = True, None
    def __init__(self): self.sent = []
    def send(self, cmd, quiet=False): self.sent.append(cmd); return True


def until(cond, secs=3):
    end = time.time() + secs
    while time.time() < end:
        if cond(): return True
        time.sleep(0.01)
    return False


class TheLink(unittest.TestCase):
    """The serial-port-shaped link Device reads and writes."""
    def setUp(self):
        self.hub = bridge.Emulator(art=TESTCARD)

    def test_no_page_no_board(self):
        with self.assertRaises(OSError):
            self.hub.link(wait=0.05)

    def test_each_command_reaches_the_page_as_one_line(self):
        page, q = self.hub.attach()
        self.hub.link(0).write(b"s working\n")
        self.assertEqual(q.get_nowait(), ("line", "s working"))

    def test_what_the_page_says_is_read_as_the_board_s_output(self):
        page, q = self.hub.attach()
        link = self.hub.link(0)
        self.assertTrue(self.hub.heard(page, b"tap\n"))
        self.assertEqual(link.read(256), b"tap\n")
        t = time.time()
        self.assertEqual(link.read(256), b"")                  # nothing more: a serial read's timeout
        self.assertGreater(time.time() - t, 0.2)

    def test_the_newest_page_wins(self):
        p1, q1 = self.hub.attach()
        link = self.hub.link(0)
        p2, q2 = self.hub.attach()
        self.assertIsNone(q1.get_nowait())                     # the older page is told it was replaced
        self.assertFalse(self.hub.heard(p1, b"tap\n"))         # and is no longer heard
        with self.assertRaises(OSError): link.read(256)
        with self.assertRaises(OSError): link.write(b"s idle\n")
        self.hub.link(0).write(b"s idle\n")
        self.assertEqual(q2.get_nowait(), ("line", "s idle"))

    def test_a_page_that_goes_breaks_the_link(self):
        page, q = self.hub.attach()
        link = self.hub.link(0)
        self.hub.detach(page)
        with self.assertRaises(OSError): link.read(256)


class TheDevice(unittest.TestCase):
    """Device with the emulator as its only board: the same reconnect, resend and line handling as over USB."""
    def test_the_emulator_is_the_only_target(self):
        d = bridge.Device.__new__(bridge.Device)
        d.emulator = bridge.Emulator()
        with mock.patch.dict(os.environ, {"DESKBUDDY_PORT": "/dev/cu.usbmodem9"}):
            self.assertEqual(d._targets(), ["emulator://"])

    def test_the_device_drives_a_page_and_hears_it(self):
        hub, ready, lines = bridge.Emulator(), threading.Event(), []
        with mock.patch.object(bridge.Emulator, "WAIT_FOR_PAGE", 0.2):
            dev = bridge.Device(ready.set, lines.append, emulator=hub)
            page, q = hub.attach()
            self.assertTrue(ready.wait(5), "on_ready was never called")
            self.assertEqual(dev.link, "emulator")
            self.assertTrue(dev.send("s working"))
            self.assertEqual(q.get(timeout=2), ("line", "s working"))
            hub.heard(page, b"ok mode=direct\ntap\nclip gone ping\n")
            self.assertTrue(until(lambda: lines == ["tap", "clip gone ping"]), lines)
            ready.clear()
            hub.heard(page, b"resync\n")                       # the board had given up on the bridge: resend
            self.assertTrue(ready.wait(2))
            ready.clear()
            hub.heard(page, b"sage ready: 10 moods, 73 sequences, 3616 frames\n")   # it restarted
            self.assertTrue(ready.wait(2))
            hub.detach(page)
            self.assertTrue(until(lambda: not dev.connected))
            self.assertFalse(dev.send("s idle"))


class Clips(unittest.TestCase):
    """A clip goes to the page as the board's POST /clip would take it, and comes back ok or err."""
    def setUp(self):
        self.hub = bridge.Emulator()
        self.page, self.q = self.hub.attach()

    def answer(self, text):
        got = {}
        def page():
            kind, data = self.q.get(timeout=5)
            got.update(json.loads(data), kind=kind)
            self.hub.clip_answer(self.page, got["id"], text)
        t = threading.Thread(target=page, daemon=True); t.start()
        return got, t

    def test_a_clip_the_page_takes(self):
        got, t = self.answer("ok")
        self.hub.post_clip("ping", b"LUMP...", True)
        t.join(2)
        self.assertEqual((got["kind"], got["name"], got["tap"], base64.b64decode(got["data"])), ("clip", "ping", True, b"LUMP..."))

    def test_a_clip_the_page_refuses_raises_its_answer(self):
        self.answer("err not a clip it can read")
        with self.assertRaisesRegex(OSError, "err not a clip it can read"):
            self.hub.post_clip("junk", b"x", False)

    def test_no_page_no_clip(self):
        self.hub.detach(self.page)
        with self.assertRaises(OSError):
            self.hub.post_clip("ping", b"x", False)

    def buddy_with_clip(self, dev):
        os.makedirs(bridge.CLIPS_DIR, exist_ok=True)
        self.addCleanup(os.rmdir, bridge.CLIPS_DIR)            # test_bridge.py empties HOME of files only
        with open(PING, "rb") as f, open(os.path.join(bridge.CLIPS_DIR, "ping.clip"), "wb") as out:
            out.write(f.read())
        self.addCleanup(os.remove, os.path.join(bridge.CLIPS_DIR, "ping.clip"))
        return bridge.Buddy(dev=dev, focus=FakeFocus(), sounds=FakeSounds(), start=False)

    def test_the_bridge_sends_its_clips_to_the_page(self):
        dev = FakeDevice(); dev.emulator = self.hub
        b = self.buddy_with_clip(dev)
        got, t = self.answer("ok")
        self.assertTrue(b.play("ping"))
        with open(PING, "rb") as f:
            self.assertEqual(base64.b64decode(got["data"]), f.read())
        self.assertIn("ping", b.clips_sent)
        self.assertEqual(dev.sent[-1], "e ping")

    def test_a_refusal_is_logged_and_not_counted_as_sent(self):
        dev = FakeDevice(); dev.emulator = self.hub
        b = self.buddy_with_clip(dev)
        self.answer("err it has no drawings to add it to")
        with self.assertLogs("bridge", "INFO") as logs:
            self.assertFalse(b.send_clip("ping"))
        self.assertIn("clip ping not sent: err it has no drawings to add it to", "\n".join(logs.output))
        self.assertNotIn("ping", b.clips_sent)

    def test_without_the_emulator_a_clip_still_goes_to_the_board_over_wifi(self):
        with open(bridge.CONFIG_FILE, "w") as f:
            json.dump({"board_token": "abcdef123456"}, f)
        self.addCleanup(os.remove, bridge.CONFIG_FILE)
        b = self.buddy_with_clip(FakeDevice())
        with mock.patch("socket.getaddrinfo", return_value=[(0, 0, 0, "", ("10.0.0.7", 80))]), \
             mock.patch("urllib.request.urlopen") as urlopen:
            self.assertTrue(b.send_clip("ping", tap=True))
        req = urlopen.call_args[0][0]
        self.assertEqual(req.full_url, "http://10.0.0.7/clip")
        self.assertEqual((req.get_header("X-sage-name"), req.get_header("X-sage-tap"), req.get_header("X-sage-token")), ("ping", "1", "abcdef123456"))


class TheServer(unittest.TestCase):
    """The bridge's own HTTP server: the page, its art, its event stream, and the page's answers."""
    def serve(self, buddy):
        was = bridge.buddy
        bridge.buddy = buddy
        self.addCleanup(setattr, bridge, "buddy", was)
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), bridge.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close); self.addCleanup(srv.shutdown)
        self.port = srv.server_address[1]

    def request(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        return r.status, r.getheader("Content-Type"), r.read()

    def setUp(self):
        self.hub = bridge.Emulator(art=TESTCARD)
        with mock.patch.object(bridge.Emulator, "WAIT_FOR_PAGE", 0.2):
            self.b = bridge.Buddy(focus=FakeFocus(), sounds=FakeSounds(), start=False, emulator=self.hub)
        self.serve(self.b)

    def events(self):
        """The page's end of the event stream: (event, data) pairs as they come."""
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request("GET", "/emulator/events")
        r = c.getresponse()
        self.addCleanup(c.close)
        self.assertEqual(r.getheader("Content-Type"), "text/event-stream")
        def read():
            kind = "message"
            while True:
                line = r.fp.readline().decode().rstrip("\n")
                if line.startswith("event: "): kind = line[7:]
                elif line.startswith("data: "): return kind, line[6:]
        return read

    def test_the_page_and_its_modules_are_served_and_nothing_else(self):
        status, ctype, body = self.request("GET", "/emulator/")
        self.assertEqual((status, ctype), (200, "text/html; charset=utf-8"))
        self.assertIn(b"app.mjs", body)
        for name in ("app.mjs", "board.mjs", "vec.mjs", "lgfx.mjs"):
            self.assertEqual(self.request("GET", "/emulator/" + name)[:2], (200, "text/javascript; charset=utf-8"), name)
        for path in ("/emulator/../tools/buddy_bridge.py", "/emulator/testcard/index.html", "/emulator/README.md"):
            self.assertEqual(self.request("GET", path)[0], 404, path)
        with open(TESTCARD, "rb") as f:
            self.assertEqual(self.request("GET", "/emulator/art.bin")[2], f.read())

    def test_realistic_takes_only_the_device_s_model_from_hardware(self):
        status, ctype, body = self.request("GET", "/hardware/model.js")
        self.assertEqual((status, ctype), (200, "text/javascript; charset=utf-8"))
        self.assertIn(b"buildModel", body)
        for path in ("/hardware/index.html", "/hardware/app.js", "/hardware/sage-frame.js", "/hardware/../tools/buddy_bridge.py", "/hardware/"):
            self.assertEqual(self.request("GET", path)[0], 404, path)
        self.assertEqual(self.request("GET", "/hardware/model.js", headers={"Host": "rebound.example:%d" % self.port})[0], 403)
        for name in ("device.mjs", "commands.mjs"):
            self.assertEqual(self.request("GET", "/emulator/" + name)[:2], (200, "text/javascript; charset=utf-8"), name)

    def test_the_page_takes_only_its_font_from_fonts(self):
        status, ctype, body = self.request("GET", "/fonts/GeistMono-Variable.woff2")
        self.assertEqual((status, ctype), (200, "font/woff2"))
        self.assertEqual(body[:4], b"wOF2")
        for path in ("/fonts/OFL.txt", "/fonts/", "/fonts/../tools/buddy_bridge.py"):
            self.assertEqual(self.request("GET", path)[0], 404, path)
        self.assertEqual(self.request("GET", "/fonts/GeistMono-Variable.woff2", headers={"Host": "rebound.example:%d" % self.port})[0], 403)

    def test_another_site_s_page_is_refused(self):
        self.assertEqual(self.request("POST", "/emulator/board?page=1", b"tap\n", {"Origin": "https://example.com"})[0], 403)
        self.assertEqual(self.request("GET", "/emulator/events", headers={"Host": "rebound.example:%d" % self.port})[0], 403)
        self.assertEqual(self.request("POST", "/emulator/board?page=1", b"tap\n", {"Origin": "http://127.0.0.1:%d" % self.port})[0], 409)

    def test_a_hook_reaches_the_page_and_a_tap_reaches_the_bridge(self):
        read = self.events()
        kind, data = read()
        self.assertEqual((kind, json.loads(data)), ("hello", {"page": 1}))
        self.assertTrue(until(lambda: self.b.dev.connected))
        self.request("POST", "/hook", json.dumps({"hook_event_name": "UserPromptSubmit", "session_id": "s1", "cwd": "/x"}).encode(),
                     {"Content-Type": "application/json"})
        seen = []
        while not {("message", "s working"), ("message", "o 1 0 0")} <= set(seen):
            seen.append(read())
            self.assertLess(len(seen), 40, seen)
        self.b.hook({"hook_event_name": "PermissionRequest", "session_id": "s1", "cwd": "/x"})
        with self.assertLogs("bridge", "INFO") as logs:
            self.assertEqual(self.request("POST", "/emulator/board?page=1", b"tap\n", {"Content-Type": "text/plain"})[0], 204)
            self.assertTrue(until(lambda: any("tap: needs-you snoozed" in l for l in logs.output)))

    def test_without_the_emulator_its_paths_are_not_there(self):
        b = bridge.Buddy(dev=FakeDevice(), focus=FakeFocus(), sounds=FakeSounds(), start=False)
        bridge.buddy = b
        self.assertEqual(self.request("GET", "/emulator/")[0], 404)
        self.assertEqual(self.request("GET", "/hardware/model.js")[0], 404)
        self.assertEqual(self.request("GET", "/fonts/GeistMono-Variable.woff2")[0], 404)
        self.assertEqual(self.request("POST", "/emulator/board?page=1", b"tap\n")[0], 404)
        self.assertEqual(self.request("GET", "/status")[0], 200)


if __name__ == "__main__":
    unittest.main()
