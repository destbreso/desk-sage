"""Tests for the bridge's mood rules, heartbeat and saved state.

Run with the bridge's own Python (it has pyserial):
    ~/.desk-buddy/venv/bin/python -m unittest discover -s tests -v
Nothing here touches the real board, speakers or ~/.desk-buddy: the bridge is pointed at a temp
folder and given fake device / focus / sound objects.
"""
import importlib.util, json, os, shutil, subprocess, sys, tempfile, time, unittest
from unittest import mock

HOME = tempfile.mkdtemp(prefix="deskbuddy-test-")
os.environ["DESKBUDDY_HOME"] = HOME
_spec = importlib.util.spec_from_file_location(
    "buddy_bridge", os.path.join(os.path.dirname(__file__), "..", "tools", "buddy_bridge.py"))
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)

# a fixed moment at local noon, so "night" never kicks in by accident
NOON = time.mktime(time.struct_time((2026, 11, 11, 12, 0, 0, 0, 0, -1)))


class FakeDevice:
    connected = True
    def __init__(self): self.sent = []
    def send(self, cmd, quiet=False): self.sent.append(cmd); return True


class FakeFocus:
    front, code_session = False, None


class FakeSounds:
    def __init__(self): self.played = []
    def settings(self): return {}
    def play(self, moment, force=False): self.played.append(moment); return True


class Clock:
    """Stands in for time.time() inside the bridge."""
    def __init__(self, t): self.t = t
    def __call__(self): return self.t
    def advance(self, s): self.t += s


class BridgeTest(unittest.TestCase):
    def setUp(self):
        for f in os.listdir(HOME):
            os.remove(os.path.join(HOME, f))
        self.clock = Clock(NOON)
        p = mock.patch.object(bridge.time, "time", self.clock)
        p.start(); self.addCleanup(p.stop)
        self.b = self.make()

    def make(self):
        return bridge.Buddy(dev=FakeDevice(), focus=FakeFocus(), sounds=FakeSounds(), start=False)

    def hook(self, ev, sid, **extra):
        self.b.hook({"hook_event_name": ev, "session_id": sid, "cwd": "/x", **extra})

    def mood(self):
        return self.b.mood()


class MoodRules(BridgeTest):
    def test_idle_with_nothing_going_on(self):
        self.assertEqual(self.mood(), "idle")

    def test_working_after_a_prompt(self):
        self.hook("UserPromptSubmit", "a")
        self.assertEqual(self.mood(), "working")

    def test_needs_you_beats_working(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("UserPromptSubmit", "b")
        self.hook("PermissionRequest", "b")
        self.assertEqual(self.mood(), "alert")
        c = self.b.counts_locked(self.clock())
        self.assertEqual((c["working"], c["alert"]), (1, 1))

    def test_question_tool_counts_as_needs_you(self):
        self.hook("PreToolUse", "a", tool_name="AskUserQuestion")
        self.assertEqual(self.mood(), "alert")

    def test_answering_goes_back_to_work(self):
        self.hook("PermissionRequest", "a")
        self.hook("PostToolUse", "a")
        self.assertEqual(self.mood(), "working")

    def test_finish_while_others_busy_is_a_short_celebration(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("UserPromptSubmit", "b")
        self.hook("Stop", "b")
        self.assertEqual(self.mood(), "done")
        self.clock.advance(bridge.CELEBRATE_SECS + 0.1)
        self.assertEqual(self.mood(), "working")

    def test_finish_when_quiet_celebrates_longer_then_waits_to_be_seen(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("Stop", "a")
        self.clock.advance(bridge.CELEBRATE_SECS + 0.1)
        self.assertEqual(self.mood(), "done")
        self.clock.advance(bridge.DONE_SECS)
        self.assertEqual(self.mood(), "awake")                 # finished but you haven't looked
        self.assertEqual(self.b.counts_locked(self.clock())["unseen"], 1)

    def test_next_prompt_marks_result_seen(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("Stop", "a")
        self.clock.advance(bridge.DONE_SECS + 1)
        self.hook("UserPromptSubmit", "a")
        self.assertEqual(self.b.counts_locked(self.clock())["unseen"], 0)

    def test_unseen_mark_expires(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("Stop", "a")
        self.clock.advance(bridge.UNSEEN_SECS + 1)
        self.assertEqual(self.mood(), "idle")

    def test_silent_working_session_goes_stale(self):
        self.hook("UserPromptSubmit", "a")
        self.clock.advance(bridge.STALE["working"] + 1)
        self.assertEqual(self.mood(), "idle")

    def test_session_end_forgets_it(self):
        self.hook("PermissionRequest", "a")
        self.hook("SessionEnd", "a")
        self.assertEqual(self.mood(), "idle")

    def test_failure_never_interrupts_needs_you(self):
        self.hook("PermissionRequest", "a")
        self.hook("PostToolUseFailure", "b")
        self.assertFalse(any(c.startswith("e oops") for c in self.b.dev.sent))

    def test_failure_while_working_plays_oops(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("PostToolUseFailure", "a")
        self.assertIn("e oops", self.b.dev.sent)

    def test_tap_snoozes_needs_you_but_keeps_the_count(self):
        self.hook("PermissionRequest", "a")
        self.b.tapped()
        self.assertNotEqual(self.mood(), "alert")
        self.assertEqual(self.b.counts_locked(self.clock())["alert"], 1)
        self.clock.advance(bridge.TAP_SNOOZE + 1)
        self.assertEqual(self.mood(), "alert")

    def test_night(self):
        self.clock.t = NOON + 13 * 3600                         # 01:00
        self.assertEqual(self.mood(), "night")

    def test_night_is_midnight_to_eight(self):
        for hour, want in ((23, "idle"), (0, "night"), (7, "night"), (8, "idle")):
            self.clock.t = NOON + (hour - 12) % 24 * 3600 + 30 * 24 * 3600   # well after anything happened
            self.assertEqual(self.mood(), want, f"{hour}:00")

    def test_regular_sleep_for_a_few_minutes_before_night(self):
        self.clock.t = NOON + 13 * 3600                         # 01:00, busy
        self.hook("PermissionRequest", "a")
        self.assertEqual(self.mood(), "alert")
        self.hook("SessionEnd", "a")
        self.clock.advance(4 * 60)
        self.assertEqual(self.mood(), "idle")                   # just been up: plain sleep first
        self.clock.advance(2 * 60)
        self.assertEqual(self.mood(), "night")                  # then the blanket comes up


class Meetings(BridgeTest):
    """A meeting coming up: the colour slides to blue over its last ten minutes and the meeting mood plays at its start.
    The board is told nothing else (Lump's meeting prep, a flag that made a tap play it, left with his taps)."""
    def meeting_in(self, secs):
        with open(bridge.MEETINGS_FILE, "w") as f:
            json.dump([{"start": self.clock() + secs, "title": "standup"}], f)

    def colours(self):
        return [c[2:] for c in self.b.dev.sent if c.startswith("c ")]

    def test_the_countdown_colour_then_the_meeting_mood(self):
        self.meeting_in(30 * 60)
        self.b.update()
        self.clock.advance(25 * 60); self.b.update()              # 5 minutes to go: half way to blue
        self.clock.advance(5 * 60 + 10); self.b.update()           # it's time
        self.assertEqual(self.colours()[0], bridge.DEFAULT_COLOUR)
        self.assertNotIn(self.colours()[1], (bridge.DEFAULT_COLOUR, bridge.MEETING_COLOUR))
        self.assertEqual(self.colours()[-1], bridge.MEETING_COLOUR)
        self.assertEqual(self.mood(), "meeting")
        self.assertFalse(any(c.startswith("p ") for c in self.b.dev.sent))

    def test_a_tap_at_the_alarm_silences_it(self):
        self.meeting_in(-5)
        self.assertEqual(self.mood(), "meeting")
        self.b.tapped()
        self.assertNotEqual(self.mood(), "meeting")


class PlayOnRequest(BridgeTest):
    """POST /play: an act the art holds, played as the mind's are; "tap" and "fidget" for the board to choose one."""
    def setUp(self):
        super().setUp()
        self.b.acts = ["hello", "tap_hello", "fidget_look"]

    def test_an_act_of_the_art_plays_and_the_mood_is_reasserted_after(self):
        self.assertTrue(self.b.play("Hello\n"))
        self.assertEqual(self.b.dev.sent[-1], "e hello")
        self.assertGreater(self.b.resync_at, 0)

    def test_tap_and_fidget_are_the_boards_choice(self):
        self.b.play("tap"); self.assertEqual(self.b.dev.sent[-1], "e tap")
        self.b.play("fidget"); self.assertEqual(self.b.dev.sent[-1], "e fidget")

    def test_an_act_the_art_lacks_or_anything_else_sends_nothing(self):
        before = list(self.b.dev.sent)
        for name in ("tap_shock", "disco", "e tap; rm -rf", ""):
            self.assertIsNone(self.b.play(name), name)
        self.assertEqual(self.b.dev.sent, before)

    def test_playing_is_not_a_tap(self):
        self.hook("PermissionRequest", "a")
        self.b.play("tap")
        self.assertEqual(self.mood(), "alert")

    def test_no_board_reports_failure(self):
        self.b.dev.send = lambda cmd, quiet=False: False
        self.assertFalse(self.b.play("hello"))

    def test_what_it_lists(self):
        self.assertEqual(self.b.playable(), ["tap", "fidget", "hello", "tap_hello", "fidget_look"])
        self.b.acts = None                                      # the art not known: only the board's own choices
        self.assertEqual(self.b.playable(), ["tap", "fidget"])
        self.assertIsNone(self.b.play("hello"))


class ArtFile(unittest.TestCase):
    """The bridge reads the names of the art's acts from its header, as the board's parser does."""
    ARTS = [os.path.join(bridge.ROOT, "firmware", "data", "sage.bin"), os.path.join(bridge.EMULATOR_DIR, "testcard", "testcard.bin")]

    @unittest.skipUnless(shutil.which("node") or bridge.node_path(), "no node to run the emulator's parser")
    def test_the_same_acts_as_the_boards_parser(self):
        script = ("const { Board, EVENT } = await import(process.argv[1]); const fs = await import('node:fs');"
                  "const buf = new Uint8Array(fs.readFileSync(process.argv[2])), b = new Board({});"
                  "if (!b.parseArt(buf, buf.length, 0)) process.exit(1);"
                  "console.log(JSON.stringify([...Array(b.A.nSeqs).keys()].filter(i => b.A.kind[i] === EVENT).map(i => b.A.name[i])));")
        for art in self.ARTS:
            out = subprocess.run([bridge.node_path(), "--input-type=module", "-e", script, os.path.join(bridge.EMULATOR_DIR, "board.mjs"), art],
                                 capture_output=True, text=True, check=True).stdout
            self.assertEqual(bridge.art_acts(art), json.loads(out), art)

    def test_either_magic_and_nothing_else(self):
        with open(self.ARTS[1], "rb") as f:
            data = f.read()
        d = tempfile.mkdtemp(prefix="deskbuddy-art-")
        self.addCleanup(shutil.rmtree, d)
        for name, body in (("sage.bin", b"SAGE" + data[4:]), ("other.bin", b"XXXX" + data[4:]), ("cut.bin", data[:200])):
            with open(os.path.join(d, name), "wb") as f:
                f.write(body)
        self.assertEqual(bridge.art_acts(os.path.join(d, "sage.bin")), bridge.art_acts(self.ARTS[1]))
        self.assertIn("hello", bridge.art_acts(os.path.join(d, "sage.bin")))
        self.assertIsNone(bridge.art_acts(os.path.join(d, "other.bin")))
        self.assertIsNone(bridge.art_acts(os.path.join(d, "cut.bin")))
        self.assertIsNone(bridge.art_acts(os.path.join(d, "missing.bin")))

    def test_the_bridge_knows_the_art_it_is_given(self):
        b = bridge.Buddy(dev=FakeDevice(), focus=FakeFocus(), sounds=FakeSounds(), start=False, art=self.ARTS[1])
        self.assertEqual(b.acts, bridge.art_acts(self.ARTS[1]))
        self.assertIsNone(bridge.Buddy(dev=FakeDevice(), focus=FakeFocus(), sounds=FakeSounds(), start=False).acts)


class AppWatcher(BridgeTest):
    """Chat/Cowork state read from the Claude app's screen."""
    def snap(self, title, buttons=(), statuses=()):
        self.b_pages.snapshot({"trusted": True, "pages": {title: {"buttons": list(buttons), "statuses": list(statuses), "markers": []}}})

    def setUp(self):
        super().setUp()
        self.b_pages = bridge.AppPages(self.b)

    def test_claudes_stop_button_means_a_chat_is_working(self):
        self.snap("Planning - Claude", buttons=["Stop response"])
        self.assertEqual(self.mood(), "working")

    def test_a_web_page_with_its_own_stop_button_is_not_a_chat(self):
        self.snap("Sound check", buttons=["Play all", "Stop"])
        self.assertEqual(self.mood(), "idle")


class Heartbeat(BridgeTest):
    def beats(self):
        return [c for c in self.b.dev.sent if c.startswith("h ")]

    def test_heartbeat_carries_time_of_day(self):
        self.b.tick(self.clock())
        self.assertEqual(self.beats(), ["h 43200"])             # noon

    def test_heartbeat_is_paced(self):
        self.b.tick(self.clock())
        self.clock.advance(5); self.b.tick(self.clock())
        self.assertEqual(len(self.beats()), 1)
        self.clock.advance(bridge.HEARTBEAT_EVERY); self.b.tick(self.clock())
        self.assertEqual(len(self.beats()), 2)

    def test_resend_beats_straight_away(self):
        self.b.tick(self.clock())
        self.clock.advance(1)
        self.b.resend()
        self.b.tick(self.clock())
        self.assertEqual(len(self.beats()), 2)

    def test_resend_repeats_mood_colour_and_overlay(self):
        self.b.update()
        self.b.dev.sent.clear()
        self.b.resend()
        kinds = {c.split()[0] for c in self.b.dev.sent}
        self.assertTrue({"s", "c", "o"} <= kinds, self.b.dev.sent)

    def test_a_broken_sound_doesnt_stop_heartbeat_or_saving(self):
        with mock.patch.object(self.b, "sound_tick", side_effect=RuntimeError("boom")):
            self.b.tick(self.clock())
        self.assertEqual(len(self.beats()), 1)
        self.assertTrue(os.path.exists(bridge.STATE_FILE))


class SavedState(BridgeTest):
    def test_sessions_survive_a_restart(self):
        self.hook("PermissionRequest", "a")
        self.hook("UserPromptSubmit", "b")
        self.b.save_state()
        again = self.make()
        self.assertEqual(again.mood(), "alert")
        self.assertEqual(set(again.sessions), {"a", "b"})

    def test_app_sessions_and_old_ones_are_not_restored(self):
        self.b.external("app:Some chat", "working")
        self.hook("UserPromptSubmit", "old")
        self.b.save_state()
        self.clock.advance(bridge.FORGET + 1)
        again = self.make()
        self.assertEqual(again.sessions, {})

    def test_no_hello_after_a_quick_restart(self):
        self.hook("UserPromptSubmit", "a")
        self.b.save_state()
        again = self.make()
        again.dev.sent.clear()
        again.hook({"hook_event_name": "SessionStart", "session_id": "b", "source": "startup"})
        self.assertNotIn("e hello", again.dev.sent)

    def test_unreadable_state_is_ignored(self):
        with open(bridge.STATE_FILE, "w") as f:
            f.write("{not json")
        self.assertEqual(self.make().sessions, {})

    def test_only_writes_when_something_changed(self):
        self.b.save_state()
        m = os.path.getmtime(bridge.STATE_FILE)
        os.utime(bridge.STATE_FILE, (m - 100, m - 100))
        self.b.save_state()
        self.assertEqual(os.path.getmtime(bridge.STATE_FILE), m - 100)


class DeviceLinks(unittest.TestCase):
    def device(self):
        d = bridge.Device.__new__(bridge.Device)               # no thread, no real ports
        d._last_err = {}
        return d

    def write_config(self, cfg):
        with open(bridge.CONFIG_FILE, "w") as f:
            json.dump(cfg, f)
        self.addCleanup(lambda: os.path.exists(bridge.CONFIG_FILE) and os.remove(bridge.CONFIG_FILE))

    def test_callback_errors_are_contained(self):
        def bad(): raise RuntimeError("boom")
        bridge.Device._call(bad)                                # must not raise

    def test_usb_first_then_wifi_when_paired(self):
        self.write_config({"board_token": "abcdef123456"})
        with mock.patch.object(bridge.Device, "usb_ports", staticmethod(lambda: ["/dev/cu.usbmodem1"])):
            self.assertEqual(self.device()._targets(), ["/dev/cu.usbmodem1", "socket://sage.local:4210"])

    def test_no_wifi_without_pairing(self):
        self.write_config({"calendar_ics": "x"})
        with mock.patch.object(bridge.Device, "usb_ports", staticmethod(lambda: [])):
            self.assertEqual(self.device()._targets(), [])

    def test_repeated_failures_are_logged_once(self):
        d = self.device()
        with self.assertLogs("bridge", "INFO") as logs:
            for _ in range(5): d._fail("socket://sage.local:4210", OSError("no route"))
            d._fail("socket://sage.local:4210", OSError("refused"))
        self.assertEqual(len(logs.output), 2)


class SoundTest(unittest.TestCase):
    """Sage's voice is not made yet: with no sounds.json it is silent; a moment switched on there plays its sound."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="deskbuddy-sounds-")
        self.addCleanup(shutil.rmtree, self.dir)
        self.cfg = os.path.join(self.dir, "sounds.json")
        for p in (mock.patch.object(bridge, "SOUNDS_DIR", self.dir), mock.patch.object(bridge, "SOUNDS_FILE", self.cfg)):
            p.start(); self.addCleanup(p.stop)
        self.s = bridge.Sounds()

    def write(self, cfg):
        with open(self.cfg, "w") as f: json.dump(cfg, f)
        os.utime(self.cfg, (time.time() + 1, time.time() + 1))

    def test_silent_without_sounds_json(self):
        with mock.patch.object(bridge.subprocess, "Popen") as popen:
            for m in ("needs_you", "thanks", "hello", "uh_oh", "goodnight"):
                self.assertFalse(self.s.play(m))
        popen.assert_not_called()

    def test_a_moment_switched_on_plays_its_sound_at_your_volume(self):
        self.write({"enabled": True, "volume": 0.4, "moments": {"thanks": {"on": True, "pick": ["a"]}}})
        open(os.path.join(self.dir, "thanks_a.wav"), "wb").close()
        with mock.patch.object(bridge.subprocess, "Popen") as popen:
            self.assertTrue(self.s.play("thanks"))
        self.assertEqual(popen.call_args[0][0], ["afplay", "-v", "0.4", os.path.join(self.dir, "thanks_a.wav")])

    def test_other_moments_wait_their_gap_but_needing_you_gets_through(self):
        self.write({"enabled": True, "moments": {m: {"on": True, "pick": ["a"]} for m in ("thanks", "on_it", "needs_you")}})
        for m in ("thanks", "on_it", "needs_you"):
            open(os.path.join(self.dir, f"{m}_a.wav"), "wb").close()
        with mock.patch.object(bridge.subprocess, "Popen"):
            self.assertTrue(self.s.play("thanks"))
            self.assertFalse(self.s.play("on_it"))
            self.assertTrue(self.s.play("needs_you"))

    def test_the_board_lines_the_bridge_reads(self):
        b = bridge.Buddy(dev=FakeDevice(), focus=FakeFocus(), sounds=FakeSounds(), start=False)
        b.clips_sent["ping"] = 1.0
        b.board_line("clip gone ping")
        self.assertNotIn("ping", b.clips_sent)
        b.board_line("gag tap_moon_idle")                         # Lump's gag sounds are gone: nothing to do
        self.assertEqual(b.sounds.played, [])


class FakeSlack:
    """Stands in for slack.com: a few users, DMs with them, unread counts and search results."""
    def __init__(self):
        self.users = [{"id": "UME", "name": "joe", "profile": {"display_name": "Joe"}},
                      {"id": "UBOSS", "name": "sam", "real_name": "Sam Boss", "profile": {"display_name": "Sam"}},
                      {"id": "UPAL", "name": "pat", "real_name": "Pat Pal", "profile": {}},
                      {"id": "UBOT", "name": "jira", "is_bot": True, "profile": {}}]
        self.ims = {"UBOSS": "DBOSS", "UPAL": "DPAL"}
        self.unread = {"DBOSS": 0, "DPAL": 0}
        self.latest = {"DBOSS": "1.0", "DPAL": "1.0"}
        self.found = {"to:me": [], "<@UME>": []}
        self.calls = []

    def __call__(self, method, **p):
        self.calls.append((method, p))
        if method == "auth.test": return {"ok": True, "user_id": "UME"}
        if method == "users.list": return {"ok": True, "members": self.users}
        if method == "users.conversations": return {"ok": True, "channels": [{"id": c, "user": u} for u, c in self.ims.items()]}
        if method == "conversations.info":
            ch = p["channel"]
            return {"ok": True, "channel": {"id": ch, "unread_count_display": self.unread[ch], "latest": {"ts": self.latest[ch]}, "last_read": "0"}}
        if method == "search.messages": return {"ok": True, "messages": {"matches": self.found[p["query"]]}}
        raise AssertionError("unexpected call " + method)

    def message(self, query, user, ts, ch="DPAL", im=True, **extra):
        self.found[query].insert(0, {"user": user, "ts": "%.6f" % ts, "channel": {"id": ch, "is_im": im}, "text": "secret words", **extra})


class SlackTest(BridgeTest):
    def setUp(self):
        super().setUp()
        with open(bridge.CONFIG_FILE, "w") as f:
            json.dump({"slack_token": "xoxp-test-token", "slack_vips": ["Sam Boss"]}, f)
        self.api = FakeSlack()
        self.w = bridge.SlackWatch(self.b, api=self.api, start=False)
        p = mock.patch.object(bridge.SlackWatch, "slack_in_front", staticmethod(lambda: self.in_slack))
        p.start(); self.addCleanup(p.stop)
        self.in_slack = False
        self.noticed = []
        real = self.b.slack_message
        def notice(sender, kind):
            ok = real(sender, kind)
            if ok: self.noticed.append((kind, sender))
            return ok
        self.b.slack_message = notice

    def poll(self):
        self.w.poll(self.clock())

    def notices(self):
        return len(self.noticed)

    def test_vip_dm_holds_a_letter_until_read(self):
        self.poll()
        self.assertEqual(self.mood(), "idle")
        self.api.unread["DBOSS"], self.api.latest["DBOSS"] = 1, "5.0"
        self.poll()
        self.assertEqual(self.mood(), "letter")
        self.b.update()
        self.assertIn("s letter", self.b.dev.sent)
        self.clock.advance(60); self.poll()
        self.assertEqual(self.mood(), "letter")            # still unread: still holding it
        self.api.unread["DBOSS"] = 0
        self.poll()
        self.assertEqual(self.mood(), "idle")              # read in Slack: put away

    def test_letter_beats_working_but_not_needs_you(self):
        self.hook("UserPromptSubmit", "a")
        self.api.unread["DBOSS"] = 1
        self.poll()
        self.assertEqual(self.mood(), "letter")
        self.hook("PermissionRequest", "a")
        self.assertEqual(self.mood(), "alert")
        self.hook("PostToolUse", "a")
        self.assertEqual(self.mood(), "letter")

    def test_letter_times_out_and_a_newer_message_brings_it_back(self):
        self.api.unread["DBOSS"], self.api.latest["DBOSS"] = 1, "5.0"
        self.poll()
        self.clock.advance(bridge.SLACK_VIP_HOLD + 1)
        self.assertEqual(self.mood(), "idle")
        self.poll()                                         # same unread message: stays put away
        self.assertEqual(self.mood(), "idle")
        self.api.latest["DBOSS"] = "9.0"
        self.poll()
        self.assertEqual(self.mood(), "letter")

    def test_hold_time_comes_from_config(self):
        with open(bridge.CONFIG_FILE, "w") as f:
            json.dump({"slack_token": "xoxp-test-token", "slack_vips": ["Sam Boss"], "slack_vip_minutes": 5}, f)
        self.api.unread["DBOSS"] = 1
        self.poll()
        self.clock.advance(5 * 60 + 1)
        self.assertEqual(self.mood(), "idle")

    def test_letters_survive_a_restart(self):
        self.api.unread["DBOSS"] = 1
        self.poll(); self.b.save_state()
        self.b = self.make()
        self.assertEqual(self.mood(), "letter")

    def test_vips_matched_by_display_name_too(self):
        with open(bridge.CONFIG_FILE, "w") as f:
            json.dump({"slack_token": "xoxp-test-token", "slack_vips": ["sam"]}, f)
        self.api.unread["DBOSS"] = 1
        self.poll()
        self.assertEqual(self.mood(), "letter")

    def test_a_dm_or_mention_is_noticed_once_and_nothing_is_played_for_it(self):
        self.poll()
        self.clock.advance(30)
        self.api.message("to:me", "UPAL", self.clock() - 5)
        self.api.message("<@UME>", "UPAL", self.clock() - 3, ch="CGEN", im=False)
        self.poll()
        self.assertEqual(self.notices(), 1)
        self.clock.advance(30); self.poll()
        self.assertEqual(self.notices(), 1)                 # nothing new: no second notice
        self.clock.advance(bridge.MESSAGE_GAP)
        self.api.message("<@UME>", "UPAL", self.clock() - 1, ch="CGEN", im=False)
        self.poll()
        self.assertEqual(self.notices(), 2)
        self.assertFalse(any(c.startswith("e ") for c in self.b.dev.sent))   # Sage has no act for one yet

    def test_notices_are_rationed(self):
        self.api.message("to:me", "UPAL", self.clock() + 1)
        self.clock.advance(5); self.poll()
        self.api.message("to:me", "UPAL", self.clock() + 1)
        self.clock.advance(5); self.poll()
        self.assertEqual(self.notices(), 1)

    def test_none_for_own_bot_old_or_vip_messages(self):
        t = self.clock()
        self.api.message("to:me", "UME", t + 1)
        self.api.message("to:me", "UBOT", t + 2)
        self.api.message("to:me", "UPAL", t + 3, bot_id="B1")
        self.api.message("to:me", "UBOSS", t + 4, ch="DBOSS")
        self.clock.advance(10); self.poll()
        self.assertEqual(self.notices(), 0)
        self.w.seen = 0                                     # Mac asleep for an hour: stale messages
        self.api.found["to:me"] = []
        self.api.message("to:me", "UPAL", t - bridge.MESSAGE_FRESH - 60)
        self.poll()
        self.assertEqual(self.notices(), 0)

    def test_none_while_something_needs_you(self):
        self.hook("PermissionRequest", "a")
        self.api.message("to:me", "UPAL", self.clock() + 1)
        self.clock.advance(5); self.poll()
        self.assertEqual(self.notices(), 0)

    def test_none_while_youre_in_slack_and_letter_waits_a_poll(self):
        self.in_slack = True
        self.api.message("to:me", "UPAL", self.clock() + 1)
        self.api.unread["DBOSS"] = 1
        self.clock.advance(5); self.poll()
        self.assertEqual(self.notices(), 0)
        self.assertEqual(self.mood(), "idle")              # you may be reading it right now
        self.api.unread["DBOSS"] = 0
        self.poll()
        self.assertEqual(self.mood(), "idle")              # you did: no letter at all
        self.api.unread["DBOSS"], self.api.latest["DBOSS"] = 1, "7.0"
        self.poll(); self.poll()
        self.assertEqual(self.mood(), "letter")            # still unread a poll later: letter

    def test_only_searches_for_messages_to_you(self):
        self.poll()
        methods = {m for m, _ in self.api.calls}
        self.assertNotIn("conversations.history", methods)
        self.assertEqual({p["query"] for m, p in self.api.calls if m == "search.messages"}, {"to:me", "<@UME>"})
        self.assertEqual({p["channel"] for m, p in self.api.calls if m == "conversations.info"}, {"DBOSS"})   # only VIP DMs

    def test_without_a_token_nothing_is_called(self):
        with open(bridge.CONFIG_FILE, "w") as f:
            json.dump({}, f)
        self.poll()
        self.assertEqual(self.api.calls, [])

    def test_token_and_message_text_never_reach_the_log(self):
        self.api.message("to:me", "UPAL", self.clock() + 1)
        def boom(method, **p): raise RuntimeError("bad url https://slack.com/api/x token=xoxp-test-token")
        with self.assertLogs("bridge", level="INFO") as logs:
            self.clock.advance(5); self.poll()
            self.w.call = boom
            with mock.patch.object(bridge.time, "time", self.clock):
                try: self.w.poll(self.clock())
                except RuntimeError as e: self.w._fail(type(e).__name__ + ": " + str(e).replace(self.w.token, "<token>"))
        text = "\n".join(logs.output)
        self.assertNotIn("xoxp-test-token", text)
        self.assertNotIn("secret words", text)


WORK_TRANSCRIPT = "/Users/me/.claude-work/projects/-x/abc.jsonl"


class TwoAccounts(BridgeTest):
    """Personal and work Claude accounts running side by side (Claude Switcher)."""
    def copy(self, account, title=None, buttons=(), sidebar=()):
        c = {"account": account, "pages": {}, "sidebar": [{"row": r, "status": st} for r, st in sidebar], "tabs": [], "labels": []}
        if title: c["pages"][title] = {"buttons": list(buttons), "statuses": [], "markers": []}
        return c

    def setUp(self):
        super().setUp()
        self.pages = bridge.AppPages(self.b)
        self.b.app = self.pages

    def test_accounts_from_paths(self):
        self.assertEqual(bridge.account_of_config(WORK_TRANSCRIPT), "work")
        self.assertEqual(bridge.account_of_config("/Users/me/.claude/projects/-x/abc.jsonl"), "personal")
        self.assertEqual(bridge.account_of_config(None), "personal")
        self.assertEqual(bridge.account_of_data_dir("/Users/me/Library/Application Support/Claude-Work"), "work")
        self.assertEqual(bridge.account_of_data_dir("/Users/me/Library/Application Support/Claude"), "personal")

    def test_a_work_code_session_drives_sage(self):
        self.hook("UserPromptSubmit", "work1", transcript_path=WORK_TRANSCRIPT)
        self.assertEqual(self.mood(), "working")
        self.hook("PermissionRequest", "work1", transcript_path=WORK_TRANSCRIPT)
        self.assertEqual(self.mood(), "alert")
        self.hook("PostToolUse", "work1", transcript_path=WORK_TRANSCRIPT)
        self.hook("Stop", "work1", transcript_path=WORK_TRANSCRIPT)
        self.assertEqual(self.mood(), "done")
        self.assertEqual(self.b.status()["sessions"]["work1"]["account"], "work")

    def test_needs_you_in_either_account_wins(self):
        self.hook("UserPromptSubmit", "mine", transcript_path="/Users/me/.claude/projects/-x/m.jsonl")
        self.hook("PermissionRequest", "work1", transcript_path=WORK_TRANSCRIPT)
        self.assertEqual(self.mood(), "alert")
        self.assertEqual(self.b.status()["sessions"]["mine"]["account"], "personal")

    def test_usage_colour_follows_the_busier_account(self):
        self.b.set_usage({"five_hour": {"used_percentage": 30, "resets_at": NOON + 3600}})
        self.b.set_usage({"five_hour": {"used_percentage": 85, "resets_at": NOON + 3600}}, account="work")
        self.assertEqual(self.b.usage["five_hour"]["pct"], 30)
        self.assertEqual(self.b.usage["work:five_hour"]["pct"], 85)
        self.assertAlmostEqual(self.b.usage_frac(NOON), 0.85)

    def test_each_copy_of_the_app_has_its_own_chats(self):
        self.pages.snapshot({"trusted": True, "copies": [self.copy("personal", "Plans - Claude"),
                                                         self.copy("work", "Plans - Claude", buttons=["Stop response"])]})
        self.assertEqual(self.b.sessions["app:work:Plans"]["state"], "working")
        self.assertEqual(self.b.sessions["app:work:Plans"]["account"], "work")
        self.assertNotIn("app:Plans", self.b.sessions)
        self.assertEqual(self.mood(), "working")
        # the work copy quits: its conversation gets the short grace, the personal copy is untouched
        self.pages.snapshot({"trusted": True, "copies": [self.copy("personal", "Plans - Claude")]})
        self.assertEqual(self.b.sessions["app:work:Plans"]["stale"], bridge.AppPages.APP_STALE)

    def test_work_cowork_needing_you_from_the_sidebar(self):
        self.pages.snapshot({"trusted": True, "copies": [self.copy("work", sidebar=[("Quarterly deck", "Awaiting answer")])]})
        self.assertEqual(self.mood(), "alert")

    def test_an_older_helper_is_read_as_the_personal_copy(self):
        self.pages.snapshot({"trusted": True, "pages": {"Plans - Claude": {"buttons": ["Stop response"], "statuses": [], "markers": []}}})
        self.assertEqual(self.b.sessions["app:Plans"]["state"], "working")

    def test_a_chat_only_counts_as_seen_in_the_copy_in_front(self):
        self.pages.snapshot({"trusted": True, "copies": [self.copy("work", "Plans - Claude", buttons=["Stop response"])]})
        self.b.focus.front = True
        self.b.focus.account = "personal"                 # the work window is behind the personal one
        self.pages.snapshot({"trusted": True, "copies": [self.copy("work", "Plans - Claude")]})
        self.assertTrue(self.b.sessions["app:work:Plans"].get("unseen"))
        self.assertTrue(self.pages.showing("work:Plans", "work"))
        self.assertFalse(self.pages.showing("work:Plans", "personal"))

    def test_app_usage_ring_per_account(self):
        c = self.copy("work"); c["labels"] = ["Usage: Weekly · all models: 64%, Resets Mon 8:00 AM"]
        self.pages.snapshot({"trusted": True, "copies": [c]})
        self.assertEqual(self.b.usage["work:seven_day"]["pct"], 64)


class FocusAcrossAccounts(unittest.TestCase):
    """Which Code session is on screen, with both copies writing to the same log."""
    def setUp(self):
        self.support = tempfile.mkdtemp(prefix="deskbuddy-support-")
        for folder, local, cli in (("Claude", "local_aaa", "cli-personal"), ("Claude-Work", "local_bbb", "cli-work")):
            d = os.path.join(self.support, folder, "claude-code-sessions", "acct", "org")
            os.makedirs(d)
            with open(os.path.join(d, local + ".json"), "w") as f:
                json.dump({"cliSessionId": cli}, f)
        p = mock.patch.object(bridge.Focus, "SUPPORT", self.support)
        p.start(); self.addCleanup(p.stop)
        self.f = bridge.Focus(start=False)

    def test_each_copy_remembers_its_own_session(self):
        self.f.set_front("personal"); self.f._apply("local_aaa")
        self.f.set_front("work"); self.f._apply("local_bbb")
        self.assertEqual(self.f.code_session, "cli-work")
        self.f.set_front("personal")
        self.assertEqual(self.f.code_session, "cli-personal")

    def test_a_session_id_is_credited_to_its_own_copy_even_from_behind(self):
        self.f.set_front("personal"); self.f._apply("local_aaa")
        self.f._apply("local_bbb")                           # the work copy logged it in the background
        self.assertEqual(self.f.code_session, "cli-personal")
        self.assertEqual(self.f.focused["work"], "cli-work")

    def test_null_clears_the_copy_in_front(self):
        self.f.set_front("work"); self.f._apply("local_bbb"); self.f._apply("null")
        self.assertIsNone(self.f.code_session)
        self.f.set_front(None)                               # another app in front: remembers the last copy
        self.assertFalse(self.f.front)
        self.assertEqual(self.f.last_account, "work")

    def test_front_account_from_lsappinfo(self):
        with mock.patch.object(bridge, "account_of_pid", lambda pid: "work" if pid == 7 else "personal"):
            self.assertEqual(self.f._front_account('"CFBundleIdentifier"="com.anthropic.claudefordesktop"\n"pid"=7'), "work")
            self.assertEqual(self.f._front_account('"CFBundleIdentifier"="com.anthropic.claudefordesktop"\n"pid"=8'), "personal")
            self.assertIsNone(self.f._front_account('"CFBundleIdentifier"="com.apple.Terminal"\n"pid"=9'))



class FakeMind:
    """Stands in for Sage's mind: records what it is told and answers from a table of signal -> act."""
    acts = 31
    def __init__(self, plays=None, ready=True): self.told, self.plays, self.ready = [], plays or {}, ready
    def ask(self, signal, **context):
        self.told.append((signal, context))
        act = self.plays.get(signal)
        return {"play": act, "why": "the test's"} if act else {"why": "nothing in the test"}
    def keep_alive(self): pass
    def signals(self): return [s for s, _ in self.told]


class MindPath(BridgeTest):
    """With Sage's mind up, the bridge tells it what happened and plays what it chooses; the moods stay the bridge's."""
    plays = {"tests": "work_tests_fail", "done": "done_glider", "hello": "hello", "compact": "glyph_rain", "tap": "tap_hello",
             "idle": "fidget_glance", "waiting": "fidget_look", "usage": "holo_battery"}

    def make(self):
        return bridge.Buddy(dev=FakeDevice(), focus=FakeFocus(), sounds=FakeSounds(), start=False, mind=FakeMind(self.plays))

    def test_a_failing_test_command_plays_the_minds_act_instead_of_oops(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("PostToolUseFailure", "a", tool_name="Bash", tool_input={"command": "npm test"})
        self.assertEqual(self.b.mind.told[-1], ("tests", {"ok": False, "mood": "working"}))
        self.assertIn("e work_tests_fail", self.b.dev.sent)
        self.assertNotIn("e oops", self.b.dev.sent)
        self.assertNotIn("uh_oh", self.b.sounds.played)          # the act stands in for the plain oops, sound and all

    def test_the_mind_is_never_told_a_command_or_a_prompt(self):
        self.hook("UserPromptSubmit", "a", prompt="the secret prompt")
        self.hook("PostToolUse", "a", tool_name="Bash", tool_input={"command": "pytest tests/secret_place"},
                  tool_response={"stdout": "secret output"})
        self.hook("PostToolUse", "a", tool_name="Bash", tool_input={"command": "git push origin secret-branch"})
        self.assertEqual(self.b.mind.signals(), ["tests", "push"])
        self.assertNotIn("secret", json.dumps(self.b.mind.told))

    def test_each_kind_of_command(self):
        for cmd, ok, kind in (("cargo build --release", True, "build"), ("npm run build", False, "build"), ("git push", True, "push"),
                              ("yarn deploy", True, "deploy"), ("ruff check .", True, "lint"), ("git revert HEAD", True, "rollback")):
            self.b.mind.told.clear()
            self.hook("PostToolUse" if ok else "PostToolUseFailure", "a", tool_name="Bash", tool_input={"command": cmd})
            self.assertEqual(self.b.mind.told[0], (kind, {"ok": ok, "mood": self.b.mind.told[0][1]["mood"]}), cmd)
        self.b.mind.told.clear()
        self.hook("PostToolUseFailure", "a", tool_name="Bash", tool_input={"command": "git merge main"}, error="CONFLICT (content)")
        self.assertEqual(self.b.mind.signals()[0], "conflict")
        self.b.mind.told.clear()
        self.hook("PostToolUse", "a", tool_name="Bash", tool_input={"command": "ls -la"})
        self.assertEqual(self.b.mind.told, [])                   # nothing Sage reacts to

    def test_a_quiet_stop_is_a_celebration_played_after_the_mood(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("Stop", "a")
        self.assertEqual(self.b.mind.told[-1], ("done", {"busy": False, "mood": "done"}))
        sent = self.b.dev.sent
        self.assertLess(sent.index("s done"), sent.index("e done_glider"))   # an act sent before the mood would be lost

    def test_a_stop_with_other_work_going_on_says_so(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("UserPromptSubmit", "b")
        self.hook("Stop", "b")
        self.assertEqual(self.b.mind.told[-1][1]["busy"], True)

    def test_hello_after_a_long_quiet_and_compaction(self):
        self.hook("SessionStart", "a", source="startup")
        self.assertEqual(self.b.mind.signals(), ["hello"])
        self.assertIn("e hello", self.b.dev.sent)
        self.assertIn("hello", self.b.sounds.played)
        self.hook("PreCompact", "a", trigger="auto")
        self.assertEqual(self.b.mind.signals()[-1], "compact")
        self.assertIn("e glyph_rain", self.b.dev.sent)

    def test_a_failure_it_has_no_act_for_plays_nothing_but_keeps_the_voice(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("PostToolUseFailure", "a", tool_name="Edit")
        self.assertEqual(self.b.mind.signals()[-1], "oops")
        self.assertNotIn("e oops", self.b.dev.sent)              # Sage has no act for it yet
        self.assertIn("uh_oh", self.b.sounds.played)

    def test_a_tap_is_told_with_its_battery(self):
        self.b.set_usage({"five_hour": {"used_percentage": 80, "resets_at": NOON + 3600}})
        self.b.tapped()
        self.assertEqual(self.b.mind.told[-1], ("tap", {"battery": 0.2, "mood": "idle"}))
        self.assertIn("e tap_hello", self.b.dev.sent)
        self.assertNotIn("e tap", self.b.dev.sent)               # the mind's choice, and the board's none

    def test_a_tap_the_mind_answers_with_nothing_plays_nothing(self):
        self.b.mind.plays = {}                                   # cross, or its patience run out with no act
        self.b.tapped()
        self.assertFalse(any(c.startswith("e ") for c in self.b.dev.sent))

    def test_its_battery_is_told_when_it_changes(self):
        usage = lambda pct: self.b.set_usage({"five_hour": {"used_percentage": pct, "resets_at": NOON + 3600}})
        usage(30); usage(30); usage(80)
        self.assertEqual([c["battery"] for s, c in self.b.mind.told if s == "usage"], [0.7, 0.2])

    def test_idle_asks_the_mind_and_plays_its_choice(self):
        self.b.last_active = self.clock()
        self.clock.advance(bridge.IDLE_EVERY[1] + 1)
        with mock.patch.object(bridge.threading, "Thread") as thread:
            self.b.idle_tick(self.clock())
        thread.assert_not_called()                               # nothing sent over Wi-Fi
        self.assertEqual(self.b.mind.told[-1], ("idle", {"around": True, "late": False, "mood": "idle"}))
        self.assertIn("e fidget_glance", self.b.dev.sent)
        self.assertNotIn("e fidget", self.b.dev.sent)

    def test_late_at_night_and_away(self):
        one_am = time.mktime(time.struct_time((2026, 11, 12, 1, 0, 0, 0, 0, -1)))
        self.clock.t = one_am
        self.b.last_active = one_am - 60                         # still at it
        self.b.next_idle = 0
        self.b.idle_tick(self.clock())
        self.assertEqual(self.b.mind.told[-1][1]["late"], True)
        self.clock.advance(3600)                                 # gone for an hour: asleep, so no idling to tell
        self.b.next_idle = 0
        self.b.idle_tick(self.clock())
        self.assertEqual(len([s for s in self.b.mind.signals() if s == "idle"]), 1)

    def test_waiting_for_you_is_told_twice_a_minute(self):
        self.hook("PermissionRequest", "a")
        self.clock.advance(61)
        for k in range(40):
            self.b.idle_tick(self.clock()); self.clock.advance(1)
        self.assertEqual(self.b.mind.signals().count("waiting"), 2)
        self.assertEqual(self.b.mind.told[-1][1]["mood"], "alert")

    def test_a_nothing_is_logged_once(self):
        self.b.mind.plays = {}
        with mock.patch.object(bridge.log, "info") as info:
            for _ in range(3):
                self.hook("PostToolUseFailure", "a", tool_name="Edit")
        said = [c for c in info.call_args_list if c.args and c.args[0].startswith("mind:")]
        self.assertEqual(len(said), 1)

    def test_nothing_outside_the_contract_is_sent_to_it(self):
        self.assertIsNone(self.b.react("prompt", text="anything"))
        self.assertEqual(self.b.mind.told, [])

    def test_an_answer_that_is_not_an_acts_name_is_not_sent(self):
        self.b.mind.plays = {"tap": "tap_hello\ns night"}
        self.b.tapped()
        self.assertFalse(any("tap_hello" in c for c in self.b.dev.sent))


class MindFallback(BridgeTest):
    """Without a mind, or with one that is not ready or does not answer: the plain events the art holds, and the board's
    own choice of a tap and a fidget."""
    def test_no_mind_plays_oops(self):
        self.hook("UserPromptSubmit", "a")
        self.hook("PostToolUseFailure", "a")
        self.assertIn("e oops", self.b.dev.sent)

    def test_no_mind_and_an_art_without_the_event_plays_nothing(self):
        self.b.acts = ["hello", "tap_hello"]                     # Sage's art has no oops
        self.hook("UserPromptSubmit", "a")
        self.hook("PostToolUseFailure", "a")
        self.assertFalse(any(c.startswith("e ") for c in self.b.dev.sent))
        self.assertIn("uh_oh", self.b.sounds.played)            # its moment is still told to the sounds

    def test_no_mind_the_board_chooses_a_tap_and_a_fidget(self):
        self.b.tapped()
        self.assertEqual(self.b.dev.sent[-1], "e tap")
        self.b.last_active = self.clock()
        self.clock.advance(bridge.IDLE_EVERY[1] + 1)
        self.b.idle_tick(self.clock())
        self.assertEqual(self.b.dev.sent[-1], "e fidget")

    def test_no_mind_waiting_and_commands_play_nothing(self):
        self.hook("PermissionRequest", "a")
        self.clock.advance(61)
        for k in range(40):
            self.b.idle_tick(self.clock()); self.clock.advance(1)
        self.hook("PostToolUse", "a", tool_name="Bash", tool_input={"command": "git push"})
        self.hook("Stop", "a")
        self.assertFalse(any(c.startswith("e ") for c in self.b.dev.sent), self.b.dev.sent)

    def test_a_mind_that_is_not_ready_is_not_asked(self):
        self.b.mind = FakeMind({"oops": "glyph_glitch"}, ready=False)
        self.hook("UserPromptSubmit", "a")
        self.hook("PostToolUseFailure", "a")
        self.assertEqual(self.b.mind.told, [])
        self.assertIn("e oops", self.b.dev.sent)

    def test_a_mind_that_does_not_answer_is_carried_on_without(self):
        class Silent(FakeMind):
            def ask(self, signal, **context): self.told.append((signal, context)); return None
        self.b.mind = Silent()
        self.hook("UserPromptSubmit", "a")
        self.hook("PostToolUseFailure", "a")
        self.assertEqual(self.b.mind.signals(), ["oops"])
        self.assertIn("e oops", self.b.dev.sent)
        self.hook("SessionEnd", "a")
        self.b.last_active = self.clock()
        self.clock.advance(bridge.IDLE_EVERY[1] + 1)
        self.b.idle_tick(self.clock())
        self.assertEqual(self.b.dev.sent[-1], "e fidget")         # the board's own choice


@unittest.skipUnless(bridge.node_path(), "no node to run Sage's mind")
class MindProcess(unittest.TestCase):
    """The real process: the bridge's side of the protocol, and what it does when the mind stops, stalls or is missing."""
    SAGE_BIN = os.path.join(bridge.ROOT, "firmware", "data", "sage.bin")

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="deskbuddy-mind-")
        self.minds = []

    def tearDown(self):
        for m in self.minds:
            m.stop()

    def mind(self, **kw):
        m = bridge.Mind(**kw)
        self.minds.append(m)
        return m

    def script(self, body, protocol=bridge.MIND_PROTOCOL):
        """A stand-in for the mind: answers the art, then does what body says with each signal s."""
        path = os.path.join(self.dir, "mind.mjs")
        with open(path, "w") as f:
            f.write("import { createInterface } from 'node:readline';\n"
                    "const say = (a) => process.stdout.write(JSON.stringify(a) + '\\n');\n"
                    "createInterface({ input: process.stdin }).on('line', (l) => { const s = JSON.parse(l);\n"
                    "  if (s.signal === 'art') return say({ id: s.id, protocol: %d, acts: 1, why: 'a stand-in' });\n" % protocol + body + "\n});\n")
        return path

    def ready(self, m, secs=5):
        end = time.time() + secs
        while time.time() < end and not m.ready:
            time.sleep(0.01)
        return m.ready

    def test_the_real_mind_reads_the_art_and_answers(self):
        m = self.mind(art=self.SAGE_BIN)
        self.assertTrue(self.ready(m))
        self.assertGreater(m.acts, 0)          # (as many as the committed art holds today, never written down here)
        self.assertEqual(m.ask("tap", mood="idle", battery=0.5)["play"], "tap_hello")
        d = m.ask("tests", ok=False, mood="working")
        self.assertIn(d["play"], ("work_tests_fail", "life_tests_fail", "holo_tests", "holo_screen_tests", "glyph_glitch"))
        self.assertIn("played 0 s ago", m.ask("tests", ok=False, mood="working")["why"])     # its cooldown
        self.assertIn("busy with", m.ask("tap", mood="idle")["why"])                        # work comes first

    def test_without_node_it_is_carried_on_without_and_said_once(self):
        with mock.patch.object(bridge.log, "info") as info:
            m = self.mind(art=self.SAGE_BIN, node=os.path.join(self.dir, "no-node"))
            m.retry_at = 0
            m.keep_alive(); m.retry_at = 0; m.keep_alive()
        self.assertFalse(m.ready)
        self.assertIsNone(m.ask("tap"))
        self.assertEqual([c.args[1] for c in info.call_args_list], ["no node to run it"])

    def test_one_that_stops_is_started_again_after_a_wait(self):
        clock = Clock(NOON)
        with mock.patch.object(bridge.time, "time", clock), mock.patch.object(bridge.log, "info") as info:
            m = self.mind(art="x", script=self.script("process.exit(3);"))
            self.assertTrue(self.ready(m))
            self.assertIsNone(m.ask("tap"))                      # it stopped on the way
            end = time.time() + 5
            while m.proc is not None and time.time() < end: time.sleep(0.01)
            self.assertIsNone(m.proc)
            self.assertGreater(m.retry_at, clock())
            m.keep_alive()
            self.assertIsNone(m.proc)                            # not before its wait is over
            clock.advance(bridge.MIND_RETRY[0] + 0.1)
            m.keep_alive()
            self.assertTrue(self.ready(m))
        said = [c.args[1] for c in info.call_args_list if c.args[0].startswith("mind: %s: carrying")]
        self.assertEqual(said, ["it stopped (exit 3)"])
        self.assertEqual(m.wait, bridge.MIND_RETRY[0])              # ready again: the next wait starts short

    def test_one_that_speaks_another_protocol_is_not_trusted(self):
        with mock.patch.object(bridge.log, "info") as info:
            m = self.mind(art="x", script=self.script("say({ id: s.id, play: 'hello', why: 'x' });", protocol=2))
            end = time.time() + 5
            while time.time() < end and not info.call_args_list: time.sleep(0.01)
        self.assertFalse(m.ready)
        self.assertIsNone(m.ask("hello"))
        self.assertIn("it speaks protocol 2, the bridge 1", [c.args[1] for c in info.call_args_list if len(c.args) > 1])

    def test_the_contract_every_signal_the_bridge_sends_is_the_minds_and_documented(self):
        kinds = {k for _, good, bad in bridge.COMMANDS for k in (good, bad) if k} | {"big_diff"}
        self.assertLessEqual(kinds, set(bridge.MIND_SIGNALS))
        with open(os.path.join(bridge.ROOT, "mind", "README.md")) as f:
            readme = f.read()
        self.assertIn(f"protocol {bridge.MIND_PROTOCOL})", readme)
        m = self.mind(art=self.SAGE_BIN)
        self.assertTrue(self.ready(m))
        for signal in bridge.MIND_SIGNALS:
            self.assertIn(f"`{signal}`", readme, signal)
            a = m.ask(signal, mood="idle", ok=True, busy=False, around=True, late=False, battery=0.5)
            self.assertNotEqual(a.get("why"), "not a signal it knows", signal)
            self.assertLessEqual(set(a), {"play", "why"}, signal)

    def test_one_too_slow_is_not_waited_for_and_is_started_again(self):
        m = self.mind(art="x", script=self.script("/* never answers */"), answer=0.05)
        self.assertTrue(self.ready(m))
        t = time.time()
        for _ in range(3):
            self.assertIsNone(m.ask("tap"))
        self.assertLess(time.time() - t, 1)
        self.assertIsNone(m.proc)                                # stuck: stopped, to be started again later
        self.assertGreater(m.retry_at, 0)

    def test_the_bridge_carries_on_when_the_mind_dies_in_a_hook(self):
        m = self.mind(art="x", script=self.script("process.exit(1);"))
        self.assertTrue(self.ready(m))
        clock = Clock(NOON)
        with mock.patch.object(bridge.time, "time", clock):
            b = bridge.Buddy(dev=FakeDevice(), focus=FakeFocus(), sounds=FakeSounds(), start=False, mind=m)
            b.hook({"hook_event_name": "UserPromptSubmit", "session_id": "a"})
            b.hook({"hook_event_name": "PostToolUseFailure", "session_id": "a"})
        self.assertIn("e oops", b.dev.sent)

if __name__ == "__main__":
    unittest.main()
