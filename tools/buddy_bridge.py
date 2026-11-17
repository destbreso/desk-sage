"""Desk Buddy bridge: Claude Code hooks -> Sage on the ESP32 (or on the web emulator).

Claude Code hooks POST their JSON to http://127.0.0.1:47823/hook. The bridge keeps
a little state per session, merges all sessions into one mood, and tells the board
over USB serial only when that mood changes:

  any session waiting on you (permission prompt, question, plan approval) -> alert
  otherwise any session working                                            -> working
  otherwise, something finished that you haven't looked at yet             -> awake
  otherwise                                                                -> idle (night from midnight to 8)
A session finishing always gets a celebration ("done"): 3.5 s if other things are still going
on (then back to alert/working), 8 s if not. Corner extras on the display ("o" command) show
how many sessions are working / waiting on you / finished but not looked at yet.

Sage's mind (class Mind; mind/ in the repository) chooses the acts: a small Node process beside the bridge, told only
the kind of thing that happened (tests failed, a build, a commit, a push, a Stop, a compaction, a hello, a tap, idling,
waiting for you, its battery) and never a command or a prompt. It answers from its table of reactions and the
website's own patience, and the bridge plays its choice with "e <act>" (acts are in the art: nothing goes over Wi-Fi).
The moods stay the bridge's. Without it (no Node, "mind": false in config.json, or it stops or is slow) the bridge
plays the plain events the art holds ("hello", "oops") and leaves the board to choose an act for a tap and a fidget
when idle ("e tap", "e fidget"). The board itself handles escalation (alert -> waiting after 45 s, working ->
longhaul after 10 min), and with no bridge it fidgets and answers taps on its own.

Chat and Cowork have no hooks, so a small helper (tools/appwatch, its own login
item) reads the Claude app's accessibility tree and posts page states to /app.

Two Claude accounts (personal and work) can run side by side: Claude Switcher starts each as its own
copy of the app, the work one with its own data folder (Claude-Work) and Claude Code settings
(~/.claude-work, which has the same hooks and status line). Both feed the same mood, and the usage
colour follows whichever account is closer to a limit. See account_of_config.

Slack (class SlackWatch, with your own read-only user token in config.json): an unread DM from one
of your VIPs is the letter mood until Slack says you've read it (or half an hour passes); any other
DM, or a message that @-mentions you, is noticed and logged, at most once a minute (Sage has no act
for it yet). Channel traffic that doesn't tag you is never looked at, and "needs you" from Claude
always wins.

Sounds play on the Mac's speakers (class Sounds), and which moments make one lives in
~/.desk-buddy/sounds.json ("enabled" is the master switch). Sage's voice is not made yet
(docs/ROADMAP.md, Phase 3), so nothing installs that file and the bridge is silent.

It sends a heartbeat ("h", which also carries the time of day) every 15 s; without it the board
goes its own way after a minute and shows it is not connected. Session state is kept in
~/.desk-buddy/state.json across restarts.

Extras for debugging:  GET /status   POST /cmd  (body: a raw command such as "s done")
                       GET /play     POST /play (body: an act the art holds, played as the mind's acts are;
                       "tap" or "fidget", for the board to choose one; or a clip: a file in ~/.desk-buddy/clips
                       made by tools/export_frames.py --clip, sent to the board over Wi-Fi first)
                       GET /sound    POST /sound (body: on | off | toggle | play <moment>)
Install as a login item with tools/install_bridge.sh.

Without a board: python3 tools/buddy_bridge.py --emulator (or "emulator": true in config.json) drives the
web emulator instead (emulator/, see its README): the bridge serves the page at /emulator/ and talks to it
in the board's own line protocol. Everything else behaves as with a board.
"""
import base64, glob, http.server, json, logging, logging.handlers, os, queue, random, re, shutil, struct, subprocess, sys, threading, time
from urllib.parse import parse_qs, urlparse
try:
    import serial
except ImportError:                     # the emulator link needs only the standard library; a board needs pyserial
    serial = None

HTTP_PORT = 47823
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMULATOR_DIR = os.path.join(ROOT, "emulator")        # the emulator's page, served from a checkout of the repository
HARDWARE_FILES = {"model.js"}                         # what the emulator's Realistic mode takes from hardware/: the device's model
HOME = os.environ.get("DESKBUDDY_HOME") or os.path.expanduser("~/.desk-buddy")   # tests point this elsewhere
NIGHT_START, NIGHT_END = 0, 8           # local hours: night (deep sleep under the blanket) is midnight to 8am
NIGHT_SETTLE = 5 * 60                   # after it was last up to something (or you were), regular sleep this long first


def night_hour(h):
    """Is local hour h in the night window? (Works whether or not the window wraps past midnight.)"""
    return NIGHT_START <= h < NIGHT_END if NIGHT_START < NIGHT_END else (h >= NIGHT_START or h < NIGHT_END)
DONE_SECS = 8                           # celebration when nothing else is going on
CELEBRATE_SECS = 3.5                    # quick celebration when other things are still going on
UNSEEN_SECS = 15 * 60                   # "check me" sparkle lasts until you reply, or this long
HELLO_AFTER = 2 * 3600                  # say hello if nothing happened for this long
# Give up on a state with no news. Pressing Esc fires no hook at all, so an interrupted
# session would otherwise look busy forever; a working session normally sends tool events
# every few seconds, so 8 quiet minutes means it's almost certainly stopped.
STALE = {"working": 8 * 60, "alert": 15 * 60}
NEEDS_YOU = {"permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"}
FORGET = 6 * 3600                       # drop sessions silent for this long
OOPS_GAP = 20                           # at most one oops per this many seconds
DEFAULT_COLOUR = "FF7A45"               # Tangerine
TAP_SNOOZE = 120                        # tapping "needs you" holds off the nagging this long
# Names POST /play takes besides the art's acts: the board chooses one of its own (firmware/src/main.cpp, pickAct).
# A tap asked for this way has none of a tap's meaning: nothing is snoozed and its patience is not touched.
BOARD_PICKS = ("tap", "fidget")
# Usage gauge: the body colour warms from Tangerine to red as the busier of your 5-hour / weekly
# Claude limits fills up (fed by the Claude Code status line, see tools/statusline.sh).
USAGE_STOPS = [(0.0, "FF7A45"), (0.5, "FF7A45"), (0.8, "FF4B2B"), (0.97, "C8102E"), (1.0, "8F7C78")]
# Meetings (read from ~/.desk-buddy/meetings.json, written by a calendar source): colour slides
# to MEETING_COLOUR over the 10 minutes before a meeting, the meeting mood plays when it starts,
# and the colour stays for the first few minutes.
MEETING_COLOUR = "3D8BFF"               # electric blue (reached via pink and purple, see meeting_blend)
MEETING_LEAD = 10 * 60
MEETING_ALERT_SECS = 45
MEETING_HOLD = 5 * 60
MEETINGS_FILE = os.path.join(HOME, "meetings.json")
CONFIG_FILE = os.path.join(HOME, "config.json")    # {"calendar_ics": "<private iCal link>", "my_email": "..."}
CALENDAR_EVERY = 5 * 60
# Sounds: see class Sounds. At night (NIGHT_START..NIGHT_END) it only makes noise if you've been
# active in the last NIGHT_AWAKE seconds, so a background job finishing at 2am stays silent.
SOUNDS_FILE = os.path.join(HOME, "sounds.json")
SOUNDS_DIR = os.path.join(HOME, "sounds")
SOUND_GAP = 2.0                         # at least this long between any two sounds...
SOUND_REPEAT = 5.0                      # ...and between two of the same moment
URGENT_SOUNDS = {"needs_you"}           # may cut in on the general gap
STILL_WAITING_AFTER = 45                # matches the board's alert -> waiting escalation
LONG_JOB_AFTER = 10 * 60                # matches the board's working -> longhaul
NIGHT_AWAKE = 15 * 60
FIDGET_EVERY = (5 * 60, 15 * 60)
# Heartbeat: "h <seconds since local midnight>" every HEARTBEAT_EVERY. If the board hears nothing
# for a minute (bridge crashed, Mac asleep, USB power only) it goes its own way: idle and fidgeting,
# asleep at night, with a little unplugged-cable mark. The heartbeat also tells it the time.
HEARTBEAT_EVERY = 15
NET_PORT = 4210                                    # the board's command port on Wi-Fi (tools/wifi_setup.py)
STATE_FILE = os.path.join(HOME, "state.json")     # sessions etc. survive a bridge restart
CLIPS_DIR = os.path.join(HOME, "clips")           # extra animations sent to the board over Wi-Fi when asked for (<name>.clip)
IDLE_EVERY = (50, 70)                   # while idle, Sage does one thing about this often (the mind's idle signal)
COMMANDS = [                            # a Bash command Claude ran: (pattern, what it is if it worked, if it failed)
    # first: a commit's message may name anything (a test, a build, a deploy)
    (r"\bgit commit\b", "commit", None),
    (r"\b(pytest|unittest|jest|vitest|mocha|rspec|phpunit|go test|cargo test|swift test|ctest|(npm|pnpm|yarn|bun)( run)? test|make (test|check))\b", "tests", "tests"),
    (r"\bgit push\b", "push", None),
    (r"\bgit (merge|rebase|pull|cherry-pick)\b", None, "conflict"),
    (r"\bgit (revert|reset|restore)\b", "rollback", None),
    (r"\b(eslint|ruff|flake8|pylint|clippy|rubocop|shellcheck|prettier|(npm|pnpm|yarn|bun) run lint)\b", "lint", None),
    (r"\b(deploy|kubectl apply|terraform apply|ota\.py)\b", "deploy", None),
    (r"\b((npm|pnpm|yarn|bun) run build|cargo build|go build|pio run|xcodebuild|docker build|tsc)\b", "build", "build"),
]
# Sage's mind (mind/, a Node process; see class Mind): it chooses the acts, the bridge keeps the moods. The contract
# between the two is mind/README.md: its protocol, and the signals the bridge sends (these, and no others).
MIND_SCRIPT = os.path.join(ROOT, "mind", "sage-mind.mjs")
MIND_PROTOCOL = 1
MIND_SIGNALS = ("tests", "build", "commit", "push", "deploy", "conflict", "rollback", "lint", "big_diff", "done", "compact", "hello",
                "oops", "waiting", "idle", "usage", "tap")
MIND_ANSWER = 0.3                       # seconds it has to answer before the bridge goes on without it
MIND_RETRY = (2, 300)                   # once it stops: the first wait before starting it again, and the longest
WAIT_ASK = 30                           # while you're kept waiting, it is told so this often (it keeps its own cooldown)
# Slack, polled with your user token (see class SlackWatch). config.json: "slack_token" (xoxp-..., never
# logged), "slack_vips" (names as Slack shows them), optional "slack_vip_minutes" (how long a letter lasts).
SLACK_EVERY = 20                        # seconds between polls
SLACK_VIP_HOLD = 30 * 60                # a VIP's letter goes away by itself after this, read or not
MESSAGE_GAP = 60                        # at most one message noticed a minute, however many land
MESSAGE_FRESH = 10 * 60                 # older messages (the bridge was down, the Mac asleep) are not noticed

os.makedirs(HOME, exist_ok=True)
log = logging.getLogger("bridge")
log.setLevel(logging.INFO)
_h = logging.handlers.RotatingFileHandler(os.path.join(HOME, "bridge.log"), maxBytes=500_000, backupCount=2)
_h.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
log.addHandler(_h)
if sys.stderr.isatty():          # under launchd stderr is bridge.out, which only needs crashes
    log.addHandler(logging.StreamHandler())


def command_kind(cmd, worked, payload):
    """What a Bash command Claude just ran was (tests, a commit, a push, a build...), if it is one Sage reacts to. Only
    this goes on to Sage's mind, never the command."""
    if re.search(r"\b(pip3?|brew|npm|pnpm|yarn|bun|cargo|apt(-get)?) (install|add|i)\b", cmd):
        return None
    if worked and re.search(r"\bgit (diff|show)\b", cmd) and len(json.dumps(payload.get("tool_response") or "")) > 20000:
        return "big_diff"
    for pattern, good, bad in COMMANDS:
        if re.search(pattern, cmd):
            kind = good if worked else bad
            return None if kind == "conflict" and "conflict" not in json.dumps(payload).lower() else kind
    return None


def art_acts(path):
    """The names of the acts (event sequences) in an art file, read from its header as the board reads it
    (tools/export_frames.py documents the layout); None when the file cannot be read as one."""
    try:
        with open(path, "rb") as f:
            d = f.read()
        if d[:4] not in (b"SAGE", b"LUMP") or not 3 <= struct.unpack_from("<H", d, 4)[0] <= 8:
            return None
        p = 11 if d[4] >= 8 else 10                    # version 8: a byte of flags
        for _ in range(d[8]):                          # moods: u8 base, u8 length, the name
            p += 2 + d[p + 1]
        if d[4] >= 5:
            n, = struct.unpack_from("<H", d, p); p += 2
        else:
            n = d[p]; p += 1
        acts = []
        for _ in range(n):                             # u8 kind, from, to, u8 length, the name, u16 ticks, a u16 a tick
            kind, size = d[p], d[p + 3]
            name = d[p + 4:p + 4 + size].decode("latin-1")
            ticks, = struct.unpack_from("<H", d, p + 4 + size)
            p += 6 + size + 2 * ticks
            if kind == 2:
                acts.append(name)
        return acts
    except (OSError, TypeError, IndexError, struct.error):
        return None


def clip_names():
    return sorted(f[:-5] for f in (os.listdir(CLIPS_DIR) if os.path.isdir(CLIPS_DIR) else []) if re.fullmatch(r"[a-z0-9_]{1,40}\.clip", f))


def read_config():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


class Emulator:
    """The board in a web page (emulator/), a third link beside USB and Wi-Fi. The page is served by the
    bridge's own HTTP server; it gets the board's line protocol as Server-Sent Events (GET /emulator/events),
    answers as the board does by POST (/emulator/board), and takes a clip as the board's POST /clip would
    (post_clip). As on the board's TCP port, the newest connection wins: an older page is told it was replaced."""

    WAIT_FOR_PAGE = 30                 # Device waits this long for a page before trying again

    def __init__(self, art=None):
        self.art = art                                  # the .bin the page plays (GET /emulator/art.bin)
        self.cond = threading.Condition()
        self.page, self.queue, self.inbox, self.pages = 0, None, b"", 0
        self.clips, self.clip_n = {}, 0                 # clip id -> [Event, the page's answer]

    def attach(self):
        """A page opened the event stream: it is the board now."""
        q = queue.Queue()
        with self.cond:
            if self.queue:
                self.queue.put(None)                    # the older page: replaced
            self.pages += 1
            self.page, self.queue, self.inbox = self.pages, q, b""
            self.cond.notify_all()
            return self.pages, q

    def detach(self, page):
        with self.cond:
            if self.page == page:
                self.page, self.queue = 0, None
                self.cond.notify_all()

    def heard(self, page, data):
        """What the page's board said (lines), as if read from the serial port."""
        with self.cond:
            if page != self.page:
                return False
            self.inbox += data
            self.cond.notify_all()
            return True

    def link(self, wait=None):
        """The serial-port-shaped link to the page now connected, waiting a while for one."""
        with self.cond:
            if not self.cond.wait_for(lambda: self.page, self.WAIT_FOR_PAGE if wait is None else wait):
                raise OSError("no emulator page open")
            return _EmulatorLink(self, self.page)

    def post_clip(self, name, data, tap):
        """Hand the page a clip as the board's POST /clip takes one; raises with the board's "err ..." if refused."""
        with self.cond:
            if not self.queue:
                raise OSError("no emulator page open")
            self.clip_n += 1
            cid, done = self.clip_n, [threading.Event(), None]
            self.clips[cid] = done
            self.queue.put(("clip", json.dumps({"id": cid, "name": name, "tap": bool(tap), "data": base64.b64encode(data).decode()})))
        try:
            if not done[0].wait(20):
                raise TimeoutError("the emulator page did not answer")
        finally:
            with self.cond:
                self.clips.pop(cid, None)
        if (done[1] or "").strip() != "ok":
            raise OSError((done[1] or "").strip() or "the emulator page refused the clip")

    def clip_answer(self, page, cid, text):
        with self.cond:
            done = self.clips.get(cid) if page == self.page else None
        if done:
            done[1] = text
            done[0].set()
        return bool(done)


class _EmulatorLink:
    """What Device reads and writes when the board is the emulator's page: shaped like a serial port."""

    def __init__(self, hub, page):
        self.hub, self.page = hub, page

    def read(self, n):
        h = self.hub
        with h.cond:
            if h.page == self.page and not h.inbox:
                h.cond.wait(0.3)                        # a serial read's timeout
            if h.page != self.page:
                raise OSError("the emulator page closed or was replaced")
            data, h.inbox = h.inbox[:n], h.inbox[n:]
            return data

    def write(self, data):
        with self.hub.cond:
            if self.hub.page != self.page:
                raise OSError("the emulator page closed or was replaced")
            q = self.hub.queue
        for line in data.decode(errors="replace").splitlines():
            q.put(("line", line))

    def flush(self):
        pass

    def close(self):
        pass


class Device:
    """Owns the link to the board: USB serial when it's plugged in, otherwise Wi-Fi (TCP to
    sage.local:4210, set up with tools/wifi_setup.py, which stores "board_token" in config.json).
    Reconnects when the board is unplugged, reboots or drops off the network, and moves back to
    USB as soon as a cable appears."""

    USB_CHECK = 5                      # while on Wi-Fi, look for a USB cable this often (seconds)
    emulator = None                    # an Emulator: the page is the only board

    def __init__(self, on_ready, on_line=None, emulator=None):
        self.ser, self.lock, self.on_ready, self.on_line = None, threading.Lock(), on_ready, on_line
        self.emulator = emulator
        self.link, self._last_err = None, {}
        threading.Thread(target=self._run, daemon=True).start()

    @property
    def connected(self):
        return self.ser is not None

    @staticmethod
    def usb_ports():
        return sorted(glob.glob("/dev/cu.usbmodem*"))

    def _targets(self):
        if self.emulator:
            return ["emulator://"]
        if os.environ.get("DESKBUDDY_PORT"):
            return [os.environ["DESKBUDDY_PORT"]]
        cfg = read_config()
        net = [f"socket://{cfg.get('board_host') or 'sage.local'}:{NET_PORT}"] if cfg.get("board_token") else []
        return self.usb_ports() + net

    def _fail(self, p, e):
        msg = str(e)
        if self._last_err.get(p) != msg:   # a missing board is retried every few seconds: say it once
            self._last_err[p] = msg
            log.info("can't open %s: %s", p, msg)

    def _open(self):
        for p in self._targets():
            try:
                if p == "emulator://":
                    s = self.emulator.link()
                    self.link = "emulator"
                elif p.startswith("socket://"):
                    import socket as so
                    # look up sage.local as IPv4 only: a general lookup waits 5 s for an IPv6
                    # answer the board never gives
                    host, port = p[len("socket://"):].rsplit(":", 1)
                    ip = so.getaddrinfo(host, int(port), so.AF_INET, so.SOCK_STREAM)[0][4][0]
                    s = serial.serial_for_url(f"socket://{ip}:{port}", timeout=0.3)
                    sock = getattr(s, "_socket", None)
                    if sock:                   # notice a board that vanished from the network
                        sock.setsockopt(so.SOL_SOCKET, so.SO_KEEPALIVE, 1)
                        for opt, v in (("TCP_KEEPALIVE", 10), ("TCP_KEEPIDLE", 10), ("TCP_KEEPINTVL", 5), ("TCP_KEEPCNT", 3)):
                            if hasattr(so, opt):
                                try: sock.setsockopt(so.IPPROTO_TCP, getattr(so, opt), v)
                                except OSError: pass
                    s.write(f"k {read_config().get('board_token', '')}\n".encode())
                    self.link = "wifi"
                else:
                    s = serial.Serial(); s.port, s.baudrate, s.timeout = p, 115200, 0.3
                    s.dtr = False; s.rts = False      # don't reset the board when opening
                    s.open()
                    self.link = "usb"
                self._last_err.pop(p, None)
                log.info("connected to %s", p)
                return s
            except Exception as e:
                self._fail(p, e)
        return None

    def _drop(self, why):
        log.info("%s", why)
        with self.lock:
            try: self.ser.close()
            except Exception: pass
            self.ser, self.link = None, None

    def _run(self):
        buf, usb_checked = b"", 0.0
        while True:
            if not self.ser:
                buf = b""
                self.ser = self._open()
                if not self.ser:
                    time.sleep(3); continue
                time.sleep(0.3); self._call(self.on_ready)
            if self.link == "wifi" and time.time() - usb_checked > self.USB_CHECK:
                usb_checked = time.time()
                if self.usb_ports() and not os.environ.get("DESKBUDDY_PORT"):
                    self._drop("USB cable found: switching from Wi-Fi"); continue
            try:
                buf += self.ser.read(256)
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    text = line.decode(errors="replace").strip()
                    if text:
                        log.info("board: %s", text)
                    # board rebooted, or it had given up on us (no heartbeat) and gone its own way
                    if "sage ready" in text or text == "resync":
                        self._call(self.on_ready)
                    elif (text == "tap" or text.startswith("clip gone ")) and self.on_line:
                        self._call(self.on_line, text)
                    elif text == "err pairing":
                        log.info("the board refused our pairing token: run tools/wifi_setup.py again")
            except Exception as e:
                self._drop(f"{self.link or 'link'} lost: {e}")

    @staticmethod
    def _call(fn, *a):
        """Run a bridge callback; a bug in one must not take down the serial reader."""
        try: fn(*a)
        except Exception: log.exception("serial callback failed")

    def send(self, cmd, quiet=False):
        with self.lock:
            if not self.ser:
                return False
            try:
                self.ser.write((cmd + "\n").encode()); self.ser.flush()
                if not quiet: log.info("-> %s", cmd)
                return True
            except Exception as e:
                log.info("write failed: %s", e); return False


def node_path(configured=None):
    """Node for Sage's mind: config.json "node", else the PATH, else where Homebrew and nvm put it (a login item's
    PATH has none of them)."""
    if configured:
        return configured if os.access(configured, os.X_OK) else None
    nvm = sorted(glob.glob(os.path.expanduser("~/.nvm/versions/node/v*/bin/node")),
                 key=lambda p: [int(x) for x in re.findall(r"\d+", p.split("/versions/node/")[1])], reverse=True)
    return shutil.which("node") or next((p for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", *nvm] if os.access(p, os.X_OK)), None)


class Mind:
    """Sage's mind (mind/sage-mind.mjs), a Node process beside the bridge. Told what happened (a signal, and only the
    context a reaction needs: never a command or a prompt), it answers with the act Sage plays, from its table of
    reactions and the website's own patience; one line of JSON each way, the contract in mind/README.md.
    If Node or the mind is missing, too slow or stops, ask() returns None and the bridge does what it did before the
    mind. Each trouble is logged once, and a stopped mind is started again, waiting longer each time."""

    def __init__(self, art=None, script=MIND_SCRIPT, node=None, answer=MIND_ANSWER, start=True):
        self.art, self.script, self.node, self.answer = art, script, node, answer
        self.lock, self.writing = threading.Lock(), threading.Lock()
        self.proc, self.ready, self.acts, self.n, self.pending = None, False, 0, 0, {}
        self.retry_at, self.wait, self.slow = 0.0, MIND_RETRY[0], 0
        self.said, self.error = None, ""                   # the trouble last logged (each is said once), its stderr
        if start:
            self.start()

    def _trouble(self, what):
        if what != self.said:
            self.said = what
            log.info("mind: %s: carrying on without it", what)

    def _later(self):
        self.retry_at = time.time() + self.wait
        self.wait = min(self.wait * 2, MIND_RETRY[1])

    def start(self):
        node = node_path(self.node)
        if not node or not os.path.exists(self.script):
            self._trouble("no node to run it" if not node else f"{self.script} is missing")
            return self._later()
        try:
            proc = subprocess.Popen([node, self.script], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, bufsize=1)
        except OSError as e:
            self._trouble(f"can't start it ({e})")
            return self._later()
        with self.lock:
            self.proc, self.ready, self.acts, self.slow, self.error = proc, False, 0, 0, ""
        threading.Thread(target=self._read, args=(proc,), daemon=True).start()
        threading.Thread(target=self._errors, args=(proc,), daemon=True).start()
        self._send(proc, {"id": 0, "signal": "art", "protocol": MIND_PROTOCOL, **({"path": self.art} if self.art else {"acts": []})})

    def keep_alive(self):
        """Start it again once its wait is over, if it stopped."""
        if self.proc is None and time.time() >= self.retry_at:
            self.start()

    def stop(self):
        with self.lock:
            proc, self.proc, self.ready = self.proc, None, False
        if proc:
            proc.kill()
            proc.wait()
            try: proc.stdin.close()
            except Exception: pass

    def _send(self, proc, msg):
        try:
            with self.writing:
                proc.stdin.write(json.dumps(msg) + "\n"); proc.stdin.flush()
            return True
        except (OSError, ValueError):
            return False                              # it stopped: _read says so

    def _errors(self, proc):
        for line in proc.stderr:                      # only its own failures: it is never told anything of yours
            if re.match(r"\s*\w*Error\b", line):
                self.error = line.strip()[:200]
        proc.stderr.close()

    def _read(self, proc):
        for line in proc.stdout:
            try:
                a = json.loads(line)
            except ValueError:
                continue
            i = a.pop("id", None)
            if i == 0:                                # the answer to the art, in the protocol both speak
                with self.lock:
                    ours = a.get("protocol") == MIND_PROTOCOL
                    ready = self.proc is proc and ours and (a.get("acts") or 0) > 0
                    if ready:
                        self.ready, self.acts, self.wait = True, a["acts"], MIND_RETRY[0]
                if ready:
                    self.said = None
                    log.info("mind: ready, %s", a.get("why"))
                else:
                    self._trouble(f"it does not know the art ({a.get('why')})" if ours else
                                  f"it speaks protocol {a.get('protocol')}, the bridge {MIND_PROTOCOL}")
                continue
            with self.lock:
                waiter = self.pending.pop(i, None)
            if waiter:
                waiter[1] = a
                waiter[0].set()
        proc.stdout.close()
        code = proc.wait()
        try: proc.stdin.close()
        except Exception: pass
        with self.lock:
            if self.proc is not proc:
                return                                # stopped on purpose
            self.proc, self.ready = None, False
            waiting, self.pending = list(self.pending.values()), {}
        for w in waiting:
            w[0].set()
        self._trouble(f"it stopped (exit {code}{': ' + self.error if self.error else ''})")
        self._later()

    def ask(self, signal, **context):
        """The mind's answer to a signal ({"play": act, "why": ...} or {"why": ...}), or None without one in time."""
        with self.lock:
            proc = self.proc
            if not proc or not self.ready:
                return None
            self.n += 1
            i, waiter = self.n, [threading.Event(), None]
            self.pending[i] = waiter
        if not self._send(proc, {"id": i, "signal": signal, "now": round(time.time(), 3), **context}):
            with self.lock:
                self.pending.pop(i, None)
            return None
        if not waiter[0].wait(self.answer):
            with self.lock:
                self.pending.pop(i, None)
                self.slow += 1
                slow = self.slow
            self._trouble(f"no answer within {self.answer * 1000:.0f} ms")
            if slow >= 3:                             # stuck: start it again later
                self.stop()
                self._later()
            return None
        self.slow = 0
        return waiter[1]


class Calendar:
    """Polls your Google Calendar's private iCal link (config.json "calendar_ics") every 5 minutes
    and writes the next day and a half of timed meetings to meetings.json, which drives the
    teal countdown and the "meeting time" animation. Recurring meetings are expanded properly;
    all-day events, cancelled events, events marked "free", and (if "my_email" is set)
    meetings you've declined are skipped. Nothing leaves your Mac except the fetch itself."""

    def __init__(self):
        self.wake = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def refresh_now(self):
        self.wake.set()

    def _run(self):
        while True:
            try:
                self.refresh()
            except Exception as e:
                log.info("calendar refresh failed: %s", e)
            self.wake.wait(CALENDAR_EVERY)        # or sooner if someone asks (POST /calendar)
            self.wake.clear()

    def refresh(self):
        try:
            cfg = json.load(open(CONFIG_FILE))
        except Exception:
            return
        url = (cfg.get("calendar_ics") or "").strip()
        if not url:
            return
        import datetime, urllib.request
        import icalendar, recurring_ical_events
        data = urllib.request.urlopen(url, timeout=20).read()
        cal = icalendar.Calendar.from_ical(data)
        now = datetime.datetime.now(datetime.timezone.utc)
        me = (cfg.get("my_email") or "").strip().lower()
        out = []
        for e in recurring_ical_events.of(cal).between(now - datetime.timedelta(hours=1), now + datetime.timedelta(hours=36)):
            st = e.get("DTSTART").dt
            if not isinstance(st, datetime.datetime):
                continue                                   # all-day
            if str(e.get("STATUS", "")).upper() == "CANCELLED" or str(e.get("TRANSP", "")).upper() == "TRANSPARENT":
                continue
            if me:
                atts = e.get("ATTENDEE") or []
                atts = atts if isinstance(atts, list) else [atts]
                if any(me in str(a).lower() and str(a.params.get("PARTSTAT", "")).upper() == "DECLINED" for a in atts):
                    continue
            en = e.get("DTEND").dt if e.get("DTEND") else st + datetime.timedelta(minutes=30)
            if st.tzinfo is None: st = st.astimezone()
            if en.tzinfo is None: en = en.astimezone()
            out.append({"start": st.timestamp(), "end": en.timestamp(), "title": str(e.get("SUMMARY", ""))[:80]})
        out.sort(key=lambda m: m["start"])
        tmp = MEETINGS_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(out, f)
        os.replace(tmp, MEETINGS_FILE)
        log.info("calendar: %d upcoming meetings", len(out))


# ---- Claude accounts ----
# Claude Switcher runs each account as its own copy of the Claude app: personal with the default
# folders, any other with --user-data-dir=~/Library/Application Support/Claude-<Name> and
# CLAUDE_CONFIG_DIR=~/.claude-<name>. Personal is the plain default everywhere in the bridge; another
# account's Chat/Cowork sessions are "app:<account>:<name>" and its usage keys "<account>:five_hour".
PERSONAL = "personal"
APP_SUPPORT = os.path.expanduser("~/Library/Application Support")


def account_of_config(path):
    """The account behind a Claude Code path, e.g. a hook's transcript_path (~/.claude-work/... -> work)."""
    m = re.search(r"/\.claude-([^/]+)/", path or "")
    return m.group(1).lower() if m else PERSONAL


def account_of_data_dir(path):
    """The account behind a Claude app data folder (.../Application Support/Claude-Work -> work)."""
    name = os.path.basename((path or "").rstrip("/"))
    return name[len("Claude-"):].lower() if name.startswith("Claude-") else PERSONAL


def account_of_pid(pid):
    """Which account a running copy of the Claude app belongs to (from its --user-data-dir)."""
    try:
        cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True, timeout=2).stdout
    except Exception:
        return None
    m = re.search(r"--user-data-dir=(.+?)(?= --|$)", cmd.strip())
    return account_of_data_dir(m.group(1)) if m else PERSONAL


class Focus:
    """What you're looking at: whether the Claude app is in front, and which Code session it shows.

    The desktop app logs "LocalSessions.setFocusedSession: sessionId=local_…" whenever you switch
    Code sessions, and keeps a small file per session (claude-code-sessions/…/local_….json) whose
    cliSessionId is the session_id the hooks report. Chat/Cowork pages on screen come from the
    app watcher instead (AppPages.visible).

    With two accounts running, both copies of the app write to the same log. A session id says
    which copy it came from (its file is in that copy's data folder); "null" (no Code session
    showing) doesn't, so it's put down to the copy in front, or the one that was in front last."""

    LOGS = os.path.expanduser("~/Library/Logs/Claude")
    SUPPORT = APP_SUPPORT                 # Claude/ (personal), Claude-Work/ ... each with claude-code-sessions/
    FOCUS_RE = re.compile(r"setFocusedSession: sessionId=(local_[0-9a-f-]+|null)")

    def __init__(self, start=True):
        self.front, self._log, self._pos, self._map = False, None, 0, {}
        self.account, self.last_account = None, PERSONAL   # the Claude copy in front (None: none is), and the last one that was
        self.focused = {}                                 # account -> cli session id showing in that copy's Code tab
        self._pids = {}
        if start:
            threading.Thread(target=self._run, daemon=True).start()

    @property
    def code_session(self):
        """The Code session showing in the Claude copy in front (or the one in front last)."""
        return self.focused.get(self.account or self.last_account)

    def _cli_id(self, local):
        """(account, cliSessionId) for a desktop Code session; misses aren't cached (the file may come later)."""
        if local not in self._map:
            files = glob.glob(os.path.join(glob.escape(self.SUPPORT), "Claude*", "claude-code-sessions", "*", "*", local + ".json"))
            if not files:
                return None, None
            path = files[0]
            acct = account_of_data_dir(path[:path.index(os.sep + "claude-code-sessions" + os.sep)])
            try:
                with open(path) as f: self._map[local] = (acct, json.load(f).get("cliSessionId"))
            except Exception: return acct, None
        return self._map[local]

    def _apply(self, local):
        if local == "null":
            self.focused[self.account or self.last_account] = None
            return
        acct, cli = self._cli_id(local)
        self.focused[acct or self.account or self.last_account] = cli

    def set_front(self, account):
        """account: the Claude copy now in front, or None when another app is."""
        self.front, self.account = account is not None, account
        if account:
            self.last_account = account

    def _front_account(self, info):
        """From `lsappinfo info -only bundleid -only pid` output: the Claude copy in front, or None."""
        if "com.anthropic.claudefordesktop" not in info:
            return None
        m = re.search(r'"pid"=(\d+)', info)
        if not m:
            return PERSONAL
        pid = int(m.group(1))
        if pid not in self._pids:
            if len(self._pids) > 50: self._pids.clear()
            self._pids[pid] = account_of_pid(pid)
        return self._pids[pid] or PERSONAL

    def _poll_log(self):
        logs = sorted(glob.glob(os.path.join(self.LOGS, "main*.log")), key=os.path.getmtime)
        if not logs: return
        if logs[-1] != self._log:                    # first run or the app rotated its log
            self._log = logs[-1]
            size = os.path.getsize(self._log)
            with open(self._log, "rb") as f:          # catch up from the recent past
                f.seek(max(0, size - 4_000_000)); hits = self.FOCUS_RE.findall(f.read().decode(errors="replace"))
            if hits: self._apply(hits[-1])
            self._pos = size
            return
        size = os.path.getsize(self._log)
        if size < self._pos: self._pos = 0
        if size > self._pos:
            with open(self._log, "rb") as f:
                f.seek(self._pos); hits = self.FOCUS_RE.findall(f.read().decode(errors="replace"))
            self._pos = size
            if hits: self._apply(hits[-1])

    def _run(self):
        import subprocess
        if not shutil.which("lsappinfo"):            # not a Mac: nothing to watch
            log.info("focus: no lsappinfo here, so the app in front is not watched")
            return
        while True:
            try:
                info = subprocess.run(["lsappinfo", "info", "-only", "bundleid", "-only", "pid", subprocess.run(["lsappinfo", "front"], capture_output=True, text=True).stdout.strip()],
                                      capture_output=True, text=True, timeout=2).stdout
                self.set_front(self._front_account(info))
                self._poll_log()
            except Exception as e:
                log.info("focus check failed: %s", e)
            time.sleep(1.5)


class Sounds:
    """Plays a moment's sound (sounds/<moment>_<pick>.wav) through afplay. Sage's voice is not made yet, so nothing
    installs sounds.json and without it every moment is silent. Settings are re-read whenever sounds.json changes,
    so flipping "enabled" (POST /sound, or by hand) takes effect immediately.
      {"enabled": true, "volume": 1.0, "quiet_at_night": true,
       "moments": {"needs_you": {"on": true, "pick": ["a", "c"]}, ...}}
    Several picks: a random one each time, never the same one twice in a row."""

    def __init__(self):
        self.lock, self.cfg, self.mtime = threading.Lock(), {}, None
        self.last_any, self.last_at, self.last_pick, self.proc = 0.0, {}, {}, None

    def settings(self):
        try:
            m = os.path.getmtime(SOUNDS_FILE)
            if m != self.mtime:
                with open(SOUNDS_FILE) as f:
                    self.cfg = json.load(f)
                self.mtime = m
        except FileNotFoundError:
            self.cfg, self.mtime = {}, None
        except Exception as e:
            log.info("can't read %s: %s", SOUNDS_FILE, e)     # keep the last good settings
        return self.cfg

    def set_enabled(self, value):
        with self.lock:
            cfg = dict(self.settings())
            cfg["enabled"] = (not cfg.get("enabled", False)) if value == "toggle" else bool(value)
            tmp = SOUNDS_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(cfg, f, indent=2)
            os.replace(tmp, SOUNDS_FILE)
            log.info("sounds %s", "on" if cfg["enabled"] else "off")
            return cfg["enabled"]

    def play(self, moment, force=False):
        """Play one of the picked versions of a moment. force skips every check (for testing)."""
        with self.lock:
            cfg, now = self.settings(), time.time()
            m = (cfg.get("moments") or {}).get(moment, {})
            picks = m.get("pick") or []
            if not force:
                if not cfg.get("enabled") or not m.get("on") or not picks:
                    return False                              # switched off: nothing worth logging
                why = ("same sound %.0fs ago" % (now - self.last_at[moment]) if now - self.last_at.get(moment, 0) < SOUND_REPEAT else
                       "another sound %.1fs ago" % (now - self.last_any) if now - self.last_any < SOUND_GAP and moment not in URGENT_SOUNDS else None)
                if why:
                    log.info("sound %s skipped: %s", moment, why); return False
            if not picks:
                picks = sorted(os.path.basename(p)[len(moment) + 1:-4] for p in glob.glob(os.path.join(SOUNDS_DIR, moment + "_?.wav")))
            pool = [k for k in picks if k != self.last_pick.get(moment)] or picks
            if not pool:
                return False
            k = random.choice(pool)
            path = os.path.join(SOUNDS_DIR, f"{moment}_{k}.wav")
            if not os.path.exists(path):
                log.info("sound %s missing", path)
                return False
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()                         # one voice at a time
            try:
                self.proc = subprocess.Popen(["afplay", "-v", str(cfg.get("volume", 1.0)), path],
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception as e:
                log.info("afplay failed: %s", e); return False
            self.last_any = self.last_at[moment] = now
            self.last_pick[moment] = k
            log.info("sound %s %s", moment, k)
            return True


def _hex(c): return [int(c[i:i + 2], 16) for i in (0, 2, 4)]
def _mix(a, b, k): A, B = _hex(a), _hex(b); return "".join(f"{round(x + (y - x) * k):02X}" for x, y in zip(A, B))


# --- vivid blending: OKLCH, around the colour wheel (a straight RGB blend from orange toward
# blue/teal passes through grey).
def _s2l(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _l2s(c): return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_oklch(h):
    import math
    r, g, b = (_s2l(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, math.hypot(A, B), (math.degrees(math.atan2(B, A)) + 360) % 360


def oklch_to_hex(L, C, H):
    import math
    for _ in range(40):                       # pull chroma in until it fits sRGB
        A, B = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
        l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
        m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
        s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
        rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
               -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
               -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
        if all(-0.002 <= v <= 1.002 for v in rgb):
            return "".join(f"{round(_l2s(min(1, max(0, v))) * 255):02X}" for v in rgb)
        C *= 0.93
    return "888888"


def meeting_blend(base, t):
    """Countdown colour: from the current colour, hue going down (through pink and purple) to blue."""
    L1, C1, H1 = hex_to_oklch(base)
    L2, C2, H2 = hex_to_oklch(MEETING_COLOUR)
    dh = H2 - H1
    if dh > 0: dh -= 360
    return oklch_to_hex(L1 + (L2 - L1) * t, max(0.13, C1 + (C2 - C1) * t), (H1 + dh * t + 360) % 360)


def usage_colour(frac):
    frac = max(0.0, min(1.0, frac))
    for (f0, c0), (f1, c1) in zip(USAGE_STOPS, USAGE_STOPS[1:]):
        if frac <= f1:
            return _mix(c0, c1, 0 if f1 == f0 else (frac - f0) / (f1 - f0))
    return USAGE_STOPS[-1][1]


class Buddy:
    def __init__(self, dev=None, focus=None, sounds=None, start=True, emulator=None, mind=None, art=None):
        self.lock = threading.Lock()
        self.mind = mind               # Sage's mind (class Mind): it chooses the acts; without it, the plain events and the board's own picks
        self.acts = art_acts(art) if art else None     # the acts the art holds (None: not known, so not checked)
        self.mind_said = {}            # signal -> the mind's last "nothing" and why, so it is logged once
        self.next_wait_ask = 0.0
        self.told_battery = None       # the battery (usage left) the mind was last told
        self.sessions = {}            # session_id -> {"state", "t", "cwd"}
        self.last_event = 0.0
        self.sent_mood = None
        self.sent_overlay = None
        self.celebrate_until = 0.0
        self.usage = {}                # from the status line: five_hour / seven_day pct + resets
        self.sent_colour = None
        self.meeting_alerted = set()   # meeting start times we've already announced
        self.last_oops = 0.0
        self.resync_at = 0.0
        self.sounds = sounds or Sounds()
        self.last_active = 0.0         # last time you did something (prompt, answer, new session)
        self.last_up = time.time()     # last time it was showing anything but sleep (night waits NIGHT_SETTLE after it)
        self.goodnight_night = None    # which night we've already said goodnight for
        self.woke_at = 0.0
        self.working_since, self.long_played = None, False
        self.next_fidget = time.time() + random.uniform(*FIDGET_EVERY)
        self.focus = focus or Focus()
        self.meeting_dismissed = set()            # meeting starts you've tapped to silence
        self.last_beat = 0.0
        self.saved = None                         # last state.json we wrote
        self.letters = {}                         # Slack: VIP DMs you haven't read, channel -> {"from", "ts", "since"}
        self.last_message = 0.0                   # Slack: the last DM or mention noticed
        self.clips_sent = {}                      # clip name -> file time of the copy the board has
        self.next_idle = time.time() + random.uniform(*IDLE_EVERY)
        self.load_state()
        self.dev = dev or Device(self.resend, self.board_line, emulator)
        if start:
            threading.Thread(target=self._tick, daemon=True).start()

    # ---- surviving restarts ----
    # Code sessions, usage readings and a few "already done that" markers are kept in state.json so
    # reinstalling or restarting the bridge doesn't forget a pending "needs you" or unread result.
    # Chat/Cowork ("app:") sessions aren't kept: the app watcher re-reports them within seconds.
    def state_locked(self):
        return {"sessions": {k: v for k, v in self.sessions.items() if not k.startswith("app:")},
                "usage": self.usage, "last_event": self.last_event, "last_active": self.last_active,
                "goodnight_night": self.goodnight_night,
                "meeting_dismissed": sorted(self.meeting_dismissed), "meeting_alerted": sorted(self.meeting_alerted),
                "letters": self.letters}

    def save_state(self):
        with self.lock:
            data = json.dumps(self.state_locked(), sort_keys=True)
        if data == self.saved:
            return
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w") as f:
            f.write(data)
        os.replace(tmp, STATE_FILE)
        self.saved = data

    def load_state(self):
        try:
            with open(STATE_FILE) as f:
                st = json.load(f)
        except FileNotFoundError:
            return
        except Exception as e:
            log.info("ignoring unreadable %s: %s", STATE_FILE, e); return
        now = time.time()
        self.sessions = {k: v for k, v in (st.get("sessions") or {}).items()
                         if isinstance(v, dict) and now - v.get("t", 0) < FORGET}
        self.usage = st.get("usage") or {}
        self.last_event = st.get("last_event", 0.0)
        self.last_active = st.get("last_active", 0.0)
        self.goodnight_night = st.get("goodnight_night")
        self.meeting_dismissed = set(st.get("meeting_dismissed") or [])
        self.meeting_alerted = set(st.get("meeting_alerted") or [])
        self.letters = {k: v for k, v in (st.get("letters") or {}).items() if isinstance(v, dict) and v.get("since")}
        log.info("restored %d session(s) from %s", len(self.sessions), STATE_FILE)

    # ---- session bookkeeping ----
    def hook(self, p):
        ev, sid, now = p.get("hook_event_name", ""), p.get("session_id", "?"), time.time()
        event = None
        with self.lock:
            fresh = now - self.last_event > HELLO_AFTER
            self.last_event = now
            s = self.sessions.setdefault(sid, {"state": "idle", "t": now, "cwd": p.get("cwd", "")})
            if p.get("transcript_path"):
                s["account"] = account_of_config(p["transcript_path"])
            state = None
            if ev == "SessionStart":
                state = "idle"
                if p.get("source") in (None, "startup", "resume"):
                    self.last_active = now
                if fresh and self.mood_locked(now) in ("idle", "night"):
                    event = "hello"
            elif ev == "UserPromptSubmit":
                state = "working"
                s.pop("unseen", None)           # you're back in this session: result seen
                self.last_active = now
                self.sound("on_it")
            elif ev == "PreToolUse":
                state = "alert" if p.get("tool_name") in ("AskUserQuestion", "ExitPlanMode") else "working"
            elif ev in ("PermissionRequest", "Elicitation"):
                state = "alert"
            elif ev in ("PostToolUse", "PermissionDenied", "ElicitationResult"):
                state = "working"
            elif ev == "PostToolUseFailure":
                state = "working"
                if now - self.last_oops > OOPS_GAP and not p.get("is_interrupt"):
                    event = "oops"                # only played if he's showing "working" (see below)
            elif ev == "Notification":
                kind = (p.get("notification_type") or "").lower()
                if kind in NEEDS_YOU:
                    state = "alert"
                # idle_prompt ("still waiting for your input") and the rest aren't new requests: ignore
            elif ev in ("Stop", "StopFailure"):
                state = "done"
            elif ev == "SessionEnd":
                self.sessions.pop(sid, None)
            if state:
                self._set(s, state, now)
            busy = self.base_locked(now, skip=s) in ("alert", "working")     # other work still going on
            if event == "oops":
                # a failure never interrupts "needs you": only show it while he's working
                if self.base_locked(now) == "working":
                    self.last_oops = now
                else:
                    event = None
            log.info("hook %s %s%s -> %s", ev, sid[:8], "" if s.get("account", PERSONAL) == PERSONAL else " (%s)" % s["account"], state or "-")
        self.update()                                   # the mood first: an act sent before it is lost on the way there
        act = self.hook_act(ev, p, event, busy)
        if act is None and event and self.holds(event):  # no mind: the plain event, if the art has it
            self.event(event)
        if event and not (act and event == "oops"):     # an act for the failure stands in for the plain "oops"
            self.sound({"hello": "hello", "oops": "uh_oh"}[event])

    def hook_act(self, ev, p, event, busy):
        """A hook told to Sage's mind, a signal at a time until one plays an act: what kind of command it was (never the
        command), a finish, a compaction, a hello, a failure. The act played, "" for none, None without a mind."""
        asks = []
        if ev in ("PostToolUse", "PostToolUseFailure") and p.get("tool_name") == "Bash":
            kind = command_kind((p.get("tool_input") or {}).get("command") or "", ev == "PostToolUse", p)
            if kind:
                asks.append((kind, {"ok": ev == "PostToolUse"}))
        elif ev == "Stop":
            asks.append(("done", {"busy": busy}))
        elif ev == "PreCompact":
            asks.append(("compact", {}))
        if event:
            asks.append((event, {}))
        if not asks:
            return None if not self.mind_up() else ""
        for signal, context in asks:
            act = self.react(signal, **context)
            if act != "":
                return act
        return ""

    def external(self, sid, state, stale=None, account=PERSONAL):
        """State from a non-hook source (the app watcher for Chat and Cowork)."""
        now = time.time()
        with self.lock:
            fresh = now - self.last_event > HELLO_AFTER
            self.last_event = now
            s = self.sessions.setdefault(sid, {"state": "idle", "t": now, "cwd": ""})
            s["account"] = account
            if state in ("working", "alert") and s.get("state") == "done":
                s.pop("unseen", None)           # a new message in that conversation: result seen
            if state == "working" and s.get("state") in ("idle", "done"):
                self.last_active = now          # you just sent a message there
            self._set(s, state, now)
            s["stale"] = stale
            log.info("app %s -> %s", sid[:40], state)
        self.update()

    def forget(self, sid):
        with self.lock:
            if self.sessions.pop(sid, None) is not None:
                log.info("app %s -> gone", sid[:40])
        self.update()

    # ---- Slack ----
    def letter_hold(self):
        try: return float(read_config().get("slack_vip_minutes") or 0) * 60 or SLACK_VIP_HOLD
        except (TypeError, ValueError): return SLACK_VIP_HOLD

    def letters_locked(self, now):
        """VIP letters still worth holding up (each lasts until read, or letter_hold() at most). A timed-out
        one is kept, marked expired, so the same unread message doesn't bring it straight back."""
        hold = self.letter_hold()
        for l in self.letters.values():
            if not l.get("expired") and now - l["since"] > hold:
                log.info("slack: letter from %s timed out", l.get("from"))
                l["expired"] = True
        return {ch: l for ch, l in self.letters.items() if not l.get("expired")}

    def slack_letter(self, ch, sender, ts):
        """An unread DM from a VIP (ts: Slack's id for the newest one): the letter mood."""
        with self.lock:
            if (self.letters.get(ch) or {}).get("ts") == ts:
                return False
            new = ch not in self.letters_locked(time.time())
            self.letters[ch] = {"from": sender, "ts": ts, "since": time.time()}
        log.info("slack: letter from %s", sender)
        if new:
            self.sound("slack_vip")
        self.update()
        return True

    def slack_read(self, ch):
        """Slack no longer counts that VIP's DM as unread: put the letter away."""
        with self.lock:
            l = self.letters.pop(ch, None)
        if l:
            log.info("slack: letter from %s read", l.get("from"))
            self.update()

    def slack_message(self, sender, kind):
        """A DM or @-mention from anyone else, noticed: True when it is a moment for one (not while something needs you,
        at the meeting alarm, mid-celebration, at night, or within MESSAGE_GAP of the last). Sage has no act for it yet
        (the paper plane the bridge sent for one was Lump's, and left with his art)."""
        now = time.time()
        with self.lock:
            mood = self.mood_locked(now)
            if mood in ("alert", "meeting", "done", "night") or now - self.last_message < MESSAGE_GAP:
                log.info("slack: %s from %s, not now (%s)", kind, sender, mood if mood in ("alert", "meeting", "done", "night") else "one just came")
                return False
            self.last_message = now
        log.info("slack: %s from %s (no act for it yet)", kind, sender)
        return True

    def _set(self, s, state, now):
        """Record a session's new state; a finish starts a celebration and a "check me" mark."""
        was = s.get("state")
        s["state"], s["t"] = state, now
        if state == "alert" and was != "alert":
            s.pop("nagged", None)
            s.pop("snooze", None)                   # a new request: no longer snoozed
            self.sound("needs_you")
        elif was == "alert" and state == "working":
            self.last_active = now                  # you answered: he's back to work
            self.sound("thanks")
        if state == "done" and was != "done":
            watching = self.on_screen_locked(s)
            if not watching:
                s["unseen"] = now                   # finished while you weren't looking at it
            # celebrate briefly if other things are still going on, longer if it's all quiet
            busy = self.base_locked(now, skip=s) in ("alert", "working")
            self.celebrate_until = max(self.celebrate_until, now + (CELEBRATE_SECS if busy else DONE_SECS))
            if not watching:                        # you can already see that reply: no need to call out
                self.sound("finished_while_busy" if busy else "finished")
            else:
                log.info("sound finished skipped: you're looking at it")

    def board_line(self, text):
        if text == "tap":
            self.tapped()
        elif text.startswith("clip gone "):          # it made room for a newer clip: send this one again when it's next asked for
            self.clips_sent.pop(text[10:].strip(), None)

    def tapped(self):
        """You tapped the glass (the board only says so while the bridge is there). What it means depends on what Sage
        is showing: meeting alarm -> silence it; needs you -> "seen it", snooze 2 min (amber dots stay); awake with
        unread results -> mark them read so it can sleep. Then the mind chooses its answer, its patience counting the
        poke; with no mind the board picks one of the art's taps itself."""
        now = time.time()
        with self.lock:
            mood, base = self.mood_locked(now), self.base_locked(now)
            m = self.next_meeting(now)
            if mood == "meeting" and m:
                self.meeting_dismissed.add(m["start"]); what = "meeting alarm silenced"
            elif base == "alert":
                for st in self.sessions.values():
                    if self._effective(st, now) == "alert":
                        st["snooze"] = now + TAP_SNOOZE
                what = "needs-you snoozed"
            elif base == "awake":
                for st in self.sessions.values():
                    st.pop("unseen", None)
                what = "marked as read"
            else:
                what = "a poke"
            self.last_active = now
            frac = self.usage_frac(now)
        log.info("tap: %s", what)
        self.update()
        if self.react("tap", battery=None if frac is None else round(1 - frac, 2)) is None:   # a poke: its patience
            self.event("tap")

    def sound(self, moment):
        """Play a moment's sound, unless it's night and you've not been around for a while
        (goodnight is the exception: it's the last thing it says)."""
        now = time.time()
        h = time.localtime(now).tm_hour
        night = night_hour(h)
        if (night and moment != "goodnight" and now - self.last_active > NIGHT_AWAKE
                and self.sounds.settings().get("quiet_at_night", True)):
            log.info("sound %s skipped: night and you've been away", moment); return False
        return self.sounds.play(moment)

    def on_screen_locked(self, s):
        """Is this session's conversation showing in the Claude app, with the app in front?"""
        if not self.focus.front:
            return False
        sid = next((k for k, v in self.sessions.items() if v is s), None)
        if sid is None: return False
        if sid.startswith("app:"):
            app = getattr(self, "app", None)
            return bool(app) and app.showing(sid[4:], getattr(self.focus, "account", None))
        return sid == self.focus.code_session

    def clear_seen_locked(self):
        for s in self.sessions.values():
            if s.get("unseen") and self.on_screen_locked(s):
                s.pop("unseen", None)

    def _effective(self, s, now):
        st, age = s["state"], now - s["t"]
        limit = s.get("stale") or STALE.get(st)
        if st in STALE and limit and age > limit:
            return "idle"
        if st == "alert" and s.get("snooze", 0) > now:
            return "snoozed"                        # you tapped to say "seen it": hold off nagging
        return "idle" if st == "done" else st

    def counts_locked(self, now):
        for sid, s in list(self.sessions.items()):
            if now - s["t"] > FORGET:
                del self.sessions[sid]
        self.clear_seen_locked()                    # looking at it counts as reading it
        eff = [self._effective(s, now) for s in self.sessions.values()]
        unseen = sum(1 for s in self.sessions.values() if s.get("unseen") and now - s["unseen"] < UNSEEN_SECS)
        return {"alert": eff.count("alert") + eff.count("snoozed"), "working": eff.count("working"), "unseen": unseen}

    def base_locked(self, now, skip=None):
        """Most urgent ongoing state across sessions: alert > working > awake (something finished
        that you haven't looked at yet) > asleep (idle, or night)."""
        eff = {self._effective(s, now) for s in self.sessions.values() if s is not skip}
        if "alert" in eff: return "alert"
        if "working" in eff: return "working"
        if "snoozed" in eff or any(s.get("unseen") and now - s["unseen"] < UNSEEN_SECS for s in self.sessions.values() if s is not skip):
            return "awake"
        if not night_hour(time.localtime(now).tm_hour):
            return "idle"
        # just been up to something (or you have): plain sleep for a few minutes, then the blanket comes up
        return "idle" if now - max(self.last_up, self.last_active) < NIGHT_SETTLE else "night"

    def meetings(self):
        try:
            with open(MEETINGS_FILE) as f:
                return json.load(f)
        except Exception:
            return []

    def next_meeting(self, now):
        live = [m for m in self.meetings() if m.get("start") and now < m["start"] + MEETING_HOLD]
        return min(live, key=lambda m: m["start"]) if live else None

    def mood_locked(self, now):
        mood = self._pick_mood_locked(now)
        if mood not in ("idle", "night"):
            self.last_up = now                  # night waits NIGHT_SETTLE after this
        return mood

    def _pick_mood_locked(self, now):
        self.counts_locked(now)                 # also drops forgotten sessions
        m = self.next_meeting(now)
        if m and 0 <= now - m["start"] < MEETING_ALERT_SECS and m["start"] not in self.meeting_dismissed:
            return "meeting"                    # it's time: this beats everything, briefly
        if now < self.celebrate_until:
            return "done"                       # a finish just happened: celebrate, then back to base
        base = self.base_locked(now)
        if base != "alert" and self.letters_locked(now):
            return "letter"                     # a VIP wrote: beats everything but "needs you"
        return base

    def mood(self):
        with self.lock:
            return self.mood_locked(time.time())

    # ---- talking to the board ----
    def update(self, force=False):
        with self.lock:
            now = time.time()
            m, c = self.mood_locked(now), self.counts_locked(now)
        if force or m != self.sent_mood:
            if m == "night" and self.sent_mood not in (None, "night"):
                night = time.strftime("%Y-%m-%d", time.localtime(now - NIGHT_END * 3600))
                if self.goodnight_night != night:        # once a night, however often it dozes off
                    self.goodnight_night = night
                    self.sound("goodnight")
            if self.dev.send("s " + m):
                self.sent_mood = m
        colour = self.colour(now)
        if force or colour != self.sent_colour:
            if self.dev.send("c " + colour):
                self.sent_colour = colour
        # corner extras on the display: things working / waiting / finished-but-unseen
        overlay = f"o {c['working']} {c['alert']} {c['unseen']}"
        if force or overlay != self.sent_overlay:
            if self.dev.send(overlay):
                self.sent_overlay = overlay

    def usage_frac(self, now):
        fr = [w["pct"] / 100 for w in self.usage.values() if w.get("pct") is not None
              and ((w.get("resets") and now < w["resets"]) or (not w.get("resets") and now - w["t"] < 12 * 3600))]
        return max(fr) if fr else None

    def colour(self, now):
        """Meeting countdown beats the usage gauge, which beats plain Tangerine."""
        base = DEFAULT_COLOUR
        frac = self.usage_frac(now)
        if frac is not None:
            base = usage_colour(round(frac * 50) / 50)      # 2% steps: no flicker
        m = self.next_meeting(now)
        if m:
            until = m["start"] - now
            if until <= 0:
                return MEETING_COLOUR
            if until < MEETING_LEAD:
                return meeting_blend(base, round((1 - until / MEETING_LEAD) * 40) / 40)
        return base

    def set_usage(self, rl, source="statusline", account=PERSONAL):
        """Usage readings from the Claude Code status line, or the Claude app's usage ring. Each account
        has its own limits (keys "five_hour", "work:five_hour", ...); the colour follows the busiest."""
        changed = False
        with self.lock:
            for window in ("five_hour", "seven_day"):
                key = window if account == PERSONAL else f"{account}:{window}"
                w = (rl or {}).get(window)
                if isinstance(w, dict) and w.get("used_percentage") is not None:
                    old = self.usage.get(key, {})
                    resets = w.get("resets_at") or (old.get("resets") if source == "app" else None)
                    new = {"pct": float(w["used_percentage"]), "resets": resets, "t": time.time(), "source": source}
                    changed |= old.get("pct") != new["pct"]
                    self.usage[key] = new
        if changed:
            log.info("usage %s", {k: round(v["pct"]) for k, v in self.usage.items()})
        self.update()
        with self.lock:
            frac = self.usage_frac(time.time())
        battery = None if frac is None else round(1 - frac, 2)     # its battery is the usage left
        if battery is not None and battery != self.told_battery and self.react("usage", battery=battery) is not None:
            self.told_battery = battery

    def resend(self):
        self.sent_mood = self.sent_overlay = self.sent_colour = None
        self.clips_sent = {}                            # it may have restarted, and clips don't survive that
        self.last_beat = 0.0                            # and tell it the time straight away
        if time.time() - self.woke_at > 60:            # board plugged in or restarted
            self.woke_at = time.time()
            self.sound("waking_up")
        self.update()

    def sound_tick(self, now):
        """Sounds that come from time passing rather than from a hook."""
        play = []
        with self.lock:
            for s in self.sessions.values():                 # one nudge per unanswered request
                if s["state"] == "alert" and not s.get("nagged") and now - s["t"] >= STILL_WAITING_AFTER \
                        and self._effective(s, now) == "alert":
                    s["nagged"] = True
                    play.append("still_waiting")
            base = self.base_locked(now)
            if base == "working":
                self.working_since = self.working_since or now
                if now - self.working_since >= LONG_JOB_AFTER and not self.long_played:
                    self.long_played = True
                    play.append("long_job")
            else:
                self.working_since, self.long_played = None, False
            if now >= self.next_fidget:
                self.next_fidget = now + random.uniform(*FIDGET_EVERY)
                if base == "idle" and now - self.last_active < 30 * 60:   # only if you're around
                    play.append("fidget")
        for moment in dict.fromkeys(play):
            self.sound(moment)

    def event(self, name):
        # an event plays in its home mood (Sage's all start from idle); the board walks
        # there by itself, so re-assert our mood once it has finished
        self.next_idle = time.time() + random.uniform(*IDLE_EVERY)      # whatever it is, it counts as its thing for this minute
        if self.dev.send("e " + name):
            self.resync_at = time.time() + 8
            return True
        return False

    def mind_up(self):
        return bool(self.mind and self.mind.ready)

    def holds(self, act):
        """Does the art hold this act? Yes when the art is not known: the board then answers for it."""
        return self.acts is None or act in self.acts

    def react(self, signal, **context):
        """Tell Sage's mind what happened and play the act it chooses (an act in the art, so nothing goes over Wi-Fi).
        The act, "" when it chose none, or None when there is no mind to ask: the caller then does what it did before."""
        if not self.mind_up():
            return None
        if signal not in MIND_SIGNALS:                  # not in the contract (mind/README.md): a bug here
            log.info("mind: %s is not a signal of mind/README.md", signal)
            return None
        d = self.mind.ask(signal, mood=self.mood(), **context)
        if d is None:
            return None
        act, why = d.get("play") or "", d.get("why") or ""
        if act and not re.fullmatch(r"[a-z0-9_]{1,40}", act):
            act, why = "", "not an act's name"
        if act:
            log.info("mind: %s -> %s (%s)", signal, act, why)
            self.event(act)
        elif self.mind_said.get(signal) != why:
            log.info("mind: %s -> nothing (%s)", signal, why)
        self.mind_said[signal] = "" if act else why
        return act

    def play(self, name):
        """An act asked for from the computer (POST /play), played as the mind's are: one the art holds, "tap" or
        "fidget" for the board to choose one, or a clip in CLIPS_DIR, sent to the board first if it does not have it.
        None if there is no such act, otherwise whether the board got it."""
        name = name.strip().lower()
        if name not in BOARD_PICKS and name not in (self.acts or ()):
            if name not in clip_names():
                return None
            if not self.send_clip(name):
                return False
        log.info("play: %s", name)
        return self.event(name)

    def playable(self):
        return [*BOARD_PICKS, *(self.acts or ()), *clip_names()]

    def idle_tick(self, now):
        """What comes from time passing: you've kept it waiting, or it is idle (about once a minute)."""
        with self.lock:
            waiting = any(s["state"] == "alert" and now - s["t"] >= 60 and self._effective(s, now) == "alert" for s in self.sessions.values())
            around = now - self.last_active < 30 * 60
        if waiting:
            if self.mind_up() and now >= self.next_wait_ask:
                self.next_wait_ask = now + WAIT_ASK
                self.react("waiting")
            return
        # idle: one act about every minute, counted from the last one
        with self.lock:
            idle = self.mood_locked(now) == "idle"
            if not idle:
                self.next_idle = now + random.uniform(*IDLE_EVERY)
            if not idle or now < self.next_idle:
                return
            self.next_idle = now + random.uniform(*IDLE_EVERY)
        if self.react("idle", around=around, late=night_hour(time.localtime(now).tm_hour)) is None:
            log.info("idle: a fidget of the board's choice")      # no mind: one of the art's fidgets
            self.event("fidget")

    def send_clip(self, name, tap=False):
        """Give the board a clip over Wi-Fi (it keeps clips in RAM, so again after it restarts or the file changes)."""
        path = os.path.join(CLIPS_DIR, name + ".clip")
        stamp = os.path.getmtime(path)
        if self.clips_sent.get(name) == stamp:
            return True
        cfg = read_config()
        try:
            if getattr(self.dev, "emulator", None):    # the emulator's page takes it as the board's POST /clip would
                with open(path, "rb") as f:
                    data = f.read()
                t0 = time.time()
                self.dev.emulator.post_clip(name, data, tap)
            else:
                import socket, urllib.request
                ip = socket.getaddrinfo(cfg.get("board_host") or "sage.local", 80, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
                with open(path, "rb") as f:
                    data = f.read()
                req = urllib.request.Request(f"http://{ip}/clip", data=data, method="POST", headers={
                    "X-Sage-Token": cfg.get("board_token", ""), "X-Sage-Size": str(len(data)), "X-Sage-Name": name,
                    "X-Sage-Tap": "1" if tap else "0", "Content-Type": "application/octet-stream"})
                t0 = time.time()
                urllib.request.urlopen(req, timeout=20).read()
        except Exception as e:
            detail = e.read().decode(errors="replace").strip() if hasattr(e, "read") else str(e)
            log.info("clip %s not sent: %s", name, detail)
            return False
        self.clips_sent[name] = stamp
        log.info("clip %s sent: %d bytes in %.1f s", name, len(data), time.time() - t0)
        return True

    def _tick(self):
        # Nothing in here may kill this loop: it drives the board, the heartbeat and saving. (If it
        # did die anyway, the heartbeat would stop and the board would show it is on its own.)
        while True:
            time.sleep(1)
            try: self.tick(time.time())
            except Exception: log.exception("tick failed")

    def tick(self, now):
        if self.mind:
            self.mind.keep_alive()
        if self.resync_at and now > self.resync_at:
            self.resync_at = 0; self.update(force=True)
        else:
            self.update()
        if now - self.last_beat >= HEARTBEAT_EVERY:
            lt = time.localtime(now)
            if self.dev.send(f"h {lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec}", quiet=True):
                self.last_beat = now
        try: self.sound_tick(now)
        except Exception: log.exception("sound tick failed")
        try: self.idle_tick(now)
        except Exception: log.exception("idle tick failed")
        try: self.save_state()
        except Exception: log.exception("saving %s failed", STATE_FILE)

    def status(self):
        with self.lock:
            now = time.time()
            app = getattr(self, "app", None)
            return {"mood": self.mood_locked(now), "sent": self.sent_mood, "counts": self.counts_locked(now), "device": self.dev.connected, "link": getattr(self.dev, "link", None),
                    "mind": None if not self.mind else {"ready": self.mind.ready, "acts": self.mind.acts},
                    "colour": self.colour(now), "usage": self.usage,
                    "sound": bool(self.sounds.settings().get("enabled")),
                    "next_meeting": self.next_meeting(now),
                    "focus": {"claude_in_front": self.focus.front, "account": getattr(self.focus, "account", None), "code_session": (self.focus.code_session or "")[:8],
                              "app_pages": sorted(getattr(getattr(self, "app", None), "visible", []))},
                    "app_watcher": None if not app or not app.seen else {"trusted": app.trusted, "last_report_s": int(now - app.seen)},
                    "slack": {"letters": {v.get("from"): int(now - v["since"]) for v in self.letters_locked(now).values()},
                              "watch": getattr(getattr(self, "slack", None), "status", None)},
                    "sessions": {(k if k.startswith("app:") else k[:8]): {"state": v["state"], "age_s": int(now - v["t"]), "cwd": v["cwd"],
                                                                          "account": v.get("account", PERSONAL)} for k, v in self.sessions.items()}}


class AppPages:
    """Chat and Cowork state from the deskbuddy-appwatch helper (tools/appwatch), which reports raw
    labels read from the Claude app's accessibility tree. The rules for turning those labels into
    moods live here, so they can be tuned without rebuilding (and re-permitting) the helper.

    Each conversation becomes a session "app:<name>" ("app:work:<name>" in the work account's copy).
    Sidebar status badges cover conversations that aren't on screen; a page that leaves the screen
    while working gets a short expiry.

    The helper reports {"trusted", "copies": [{"account", "pages", "sidebar", "tabs", "labels"}, ...]},
    one entry per running copy of the app. (An older helper sent one copy's fields at the top level:
    that's read as the personal copy.) A copy that stops being reported (quit) counts as empty."""

    APP_STALE = 3 * 60
    # Claude's own "Stop response" button. Not a bare "Stop": web pages open in the app (a page with its
    # own Stop button for audio, say) would otherwise look like a chat responding.
    STOP_BTN = re.compile(r"^stop (response|generating)$", re.I)
    NEEDS_BTN = re.compile(r"\b(allow|approve|deny|don.?t allow|reject|decline)\b", re.I)
    WORK_STATUS = re.compile(r"^(claude is (responding|thinking)|running a command.*|working…?|running|thinking|responding)$", re.I)
    USAGE_LABEL = re.compile(r"^usage:\s*(.+?):\s*(\d+(?:\.\d+)?)\s*%", re.I)
    TAB_NEEDS = re.compile(r"awaiting|needs you|needs your", re.I)
    TAB_WORK = re.compile(r"working|running|responding|thinking", re.I)
    NEEDS_TEXT = re.compile(r"asking a question|awaiting (answer|approval|permission|response)|needs (approval|permission|an answer)|approval needed|waiting for (your )?(approval|answer|permission)", re.I)

    def __init__(self, buddy):
        self.buddy, self.trusted, self.seen = buddy, None, 0.0
        self.last, self.tabs, self.on_screen = {}, {}, {}   # per account: page states, mode tabs, names on screen

    @property
    def visible(self):
        """Conversations on screen in any copy, as their session names without "app:"."""
        return {n for names in self.on_screen.values() for n in names}

    def showing(self, key, front_account=None):
        """Is conversation `key` (a session id without "app:") on screen in the copy that's in front?
        With front_account None (not known) any copy counts."""
        return any(key in names and front_account in (None, acct) for acct, names in self.on_screen.items())

    @staticmethod
    def name(title):
        return (title[:-len(" - Claude")] if title.endswith(" - Claude") else title) or "Claude"

    def snapshot(self, snap):
        self.seen = time.time()
        if snap.get("trusted") != self.trusted:
            self.trusted = snap.get("trusted")
            log.info("app watcher %s", "has Accessibility permission" if self.trusted else "is waiting for Accessibility permission")
        copies = snap.get("copies")
        if copies is None:                          # an older helper: one copy, at the top level
            copies = [dict(snap, account=PERSONAL)]
        by = {}
        for c in copies:
            if isinstance(c, dict):
                by[(c.get("account") or PERSONAL).lower()] = c
        for acct in sorted(set(by) | set(self.last)):
            self.copy(acct, by.get(acct, {}))

    def copy(self, acct, snap):
        """One copy of the app (one account)."""
        prefix = "" if acct == PERSONAL else acct + ":"
        last = self.last.setdefault(acct, {})
        tabs = snap.get("tabs") or []
        if tabs != self.tabs.get(acct, []):        # logged to learn what the mode tabs announce
            self.tabs[acct] = tabs
            log.info("app tabs%s: %s", "" if acct == PERSONAL else " (%s)" % acct, " | ".join(tabs))
        self.on_screen[acct] = {prefix + self.name(t) for t in (snap.get("pages") or {})}
        # usage ring in the app, e.g. "Usage: Weekly · all models: 25%, Resets Mon 8:00 AM"
        for lab in snap.get("labels") or []:
            m = self.USAGE_LABEL.match(lab)
            if m:
                key = "seven_day" if re.search(r"week", m.group(1), re.I) else "five_hour"
                self.buddy.set_usage({key: {"used_percentage": float(m.group(2)), "resets_at": None}}, source="app", account=acct)
        states = {}
        def bump(name, st):
            rank = {"working": 1, "alert": 2}
            if rank[st] > rank.get(states.get(name), 0):
                states[name] = st
        for title, pg in (snap.get("pages") or {}).items():
            n = self.name(title)
            states.setdefault(n, None)
            if any(self.NEEDS_BTN.search(b) for b in pg.get("buttons", [])) or any(self.NEEDS_TEXT.search(m) for m in pg.get("markers", [])):
                bump(n, "alert")
            if any(self.STOP_BTN.match(b) for b in pg.get("buttons", [])) or any(self.WORK_STATUS.match(x) for x in pg.get("statuses", [])):
                bump(n, "working")
        # Section tabs announce sections you're not looking at, e.g. "Claude, awaiting your input"
        # while you're in Code: that's what covers Chat and Cowork in the background. (The Code tab
        # is ignored: hooks already cover Code, with more detail.)
        for t in snap.get("tabs") or []:
            sec, sep, st = t.partition(",")
            if not sep or sec.strip().lower() in ("code", ""): continue
            n = "section " + sec.strip()
            if self.NEEDS_TEXT.search(st) or self.TAB_NEEDS.search(st): bump(n, "alert")
            elif self.WORK_STATUS.match(st.strip()) or self.TAB_WORK.search(st): bump(n, "working")
        for r in snap.get("sidebar") or []:
            n = r.get("row") or "Claude"
            st = r.get("status", "")
            states.setdefault(n, None)
            if self.NEEDS_TEXT.search(st): bump(n, "alert")
            elif self.WORK_STATUS.match(st): bump(n, "working")
        for n, state in states.items():
            prev = last.get(n)
            if state != prev:
                if state:
                    self.buddy.external("app:" + prefix + n, state, account=acct)
                elif prev in ("working", "alert"):
                    self.buddy.external("app:" + prefix + n, "done", account=acct)
                last[n] = state
        for n in [x for x in last if x not in states]:    # no longer on screen or in the sidebar
            # A conversation that still needs you keeps its sidebar badge, so if it vanished
            # entirely it was answered elsewhere, closed or deleted: drop it. Work in progress
            # we simply can't see any more gets a short grace period instead.
            if last[n] == "working":
                self.buddy.external("app:" + prefix + n, "working", stale=self.APP_STALE, account=acct)
            else:
                self.buddy.forget("app:" + prefix + n)
            del last[n]


class SlackError(Exception):
    pass


class SlackWatch:
    """Slack, read with your own user token (a private "Desk status" app with read-only user scopes:
    im:read im:history mpim:read mpim:history users:read search:read). Every SLACK_EVERY seconds:

      VIPs ("slack_vips" in config.json, names as Slack shows them): their 1:1 DMs are checked for
      unread messages. One you haven't read -> the letter mood until Slack no longer counts it
      unread (read it anywhere, phone included) or the hold time passes. A newer message re-arms it.
      Everyone else: a search for messages sent to you (DMs and group DMs) and messages that @-mention
      you by name. New ones, unless yours or a bot's, are noticed once a poll (Buddy.slack_message).

    Channel traffic that doesn't tag you never comes back from those searches, so it's never seen.
    The token is only ever sent to slack.com in a header; it and message text are never logged.
    The config is re-read every poll: add a token or VIP and it's picked up within SLACK_EVERY."""

    USERS_EVERY, IMS_EVERY = 3600, 600
    DM_QUERY, MENTION_QUERY = "to:me", "<@{me}>"

    def __init__(self, buddy, api=None, start=True):
        self.buddy, self.call = buddy, api or self._api
        self.token, self.me, self.users, self.users_at, self.ims, self.ims_at = None, None, {}, 0.0, {}, 0.0
        self.seen = time.time()                        # newest message (Slack ts) already reacted to
        self.unread_once = {}                          # VIP DM -> ts seen unread once while Slack was in front
        self.status, self.backoff, self.last_err = "off", 0.0, None
        if start:
            threading.Thread(target=self._run, daemon=True).start()

    def _api(self, method, **params):
        import urllib.error, urllib.parse, urllib.request
        req = urllib.request.Request("https://slack.com/api/" + method + "?" + urllib.parse.urlencode(params),
                                     headers={"Authorization": "Bearer " + self.token})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                body = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise SlackError("ratelimited, retry after %s" % e.headers.get("Retry-After", "?"))
            raise SlackError("HTTP %d" % e.code)
        if not body.get("ok"):
            raise SlackError(body.get("error", "unknown") + (" (needs %s)" % body["needed"] if body.get("needed") else ""))
        return body

    def _run(self):
        while True:
            time.sleep(SLACK_EVERY)
            if time.time() < self.backoff:
                continue
            try:
                self.poll(time.time())
            except SlackError as e:
                self._fail(str(e))
            except Exception as e:                      # never kill the loop (and never log the token)
                self._fail(type(e).__name__ + ": " + str(e).replace(self.token or "\0", "<token>"))

    def _fail(self, why):
        self.status = "error: " + why
        if why != self.last_err:
            log.info("slack: %s", why)
            self.last_err = why
        # a bad token or a missing scope won't fix itself: wait for the config to change
        fatal = any(k in why for k in ("invalid_auth", "token_revoked", "account_inactive", "not_authed", "missing_scope", "not_allowed_token_type"))
        self.backoff = time.time() + (600 if fatal else 120 if "ratelimited" in why else 60)
        if fatal:
            self.me = None

    @staticmethod
    def slack_in_front():
        """Is Slack the app you're using right now? (Then a notice is just noise, and a VIP message you're
        reading as it lands shouldn't get the whole letter routine.)"""
        try:
            asn = subprocess.run(["lsappinfo", "front"], capture_output=True, text=True, timeout=2).stdout.strip()
            out = subprocess.run(["lsappinfo", "info", "-only", "bundleID", asn], capture_output=True, text=True, timeout=2).stdout
            return "com.tinyspeck.slackmacgap" in out
        except Exception:
            return False

    def name(self, uid):
        u = self.users.get(uid) or {}
        return u.get("name") or uid or "?"

    def poll(self, now):
        cfg = read_config()
        token = cfg.get("slack_token")
        if not token:
            self.status = "off (no slack_token in config.json)"
            return
        if token != self.token:
            self.token, self.me, self.users_at, self.ims_at, self.backoff = token, None, 0.0, 0.0, 0.0
        if not self.me:
            self.me = self.call("auth.test")["user_id"]
            log.info("slack: connected")
        vip_names = {str(n).strip().lower() for n in cfg.get("slack_vips") or [] if str(n).strip()}
        if now - self.users_at > self.USERS_EVERY:
            self.load_users()
            self.users_at = now
        vips = {uid for uid, u in self.users.items() if vip_names & u["names"]}
        if now - self.ims_at > self.IMS_EVERY:
            self.load_ims()
            self.ims_at = now
        front = self.slack_in_front()
        self.check_vips(vips, front)
        self.check_new(vips, now, front)
        self.status = "ok, %d VIP(s) found of %d named" % (len(vips), len(vip_names))
        self.last_err = None

    def load_users(self):
        users, cursor = {}, None
        for _ in range(50):                             # 200 a page; a big workspace still fits
            r = self.call("users.list", limit=200, **({"cursor": cursor} if cursor else {}))
            for m in r.get("members") or []:
                p = m.get("profile") or {}
                names = {x.strip().lower() for x in (m.get("real_name"), p.get("real_name"), p.get("display_name"), m.get("name")) if x and x.strip()}
                users[m["id"]] = {"names": names, "bot": bool(m.get("is_bot")) or m["id"] == "USLACKBOT",
                                  "name": p.get("display_name") or m.get("real_name") or m.get("name")}
            cursor = (r.get("response_metadata") or {}).get("next_cursor")
            if not cursor:
                break
        self.users = users

    def load_ims(self):
        ims, cursor = {}, None
        for _ in range(20):
            r = self.call("users.conversations", types="im", exclude_archived="true", limit=200, **({"cursor": cursor} if cursor else {}))
            for c in r.get("channels") or []:
                if c.get("user"):
                    ims[c["user"]] = c["id"]
            cursor = (r.get("response_metadata") or {}).get("next_cursor")
            if not cursor:
                break
        self.ims = ims

    def check_vips(self, vips, front=False):
        """A letter for each VIP DM with something unread; put away the ones you've read. With Slack in
        front it has to still be unread one poll later (you may be reading it as it arrives)."""
        watched = {self.ims[u]: u for u in vips if u in self.ims}
        for ch, uid in watched.items():
            info = self.call("conversations.info", channel=ch)["channel"]
            unread = info.get("unread_count_display")
            latest = (info.get("latest") or {}).get("ts")
            last_read = info.get("last_read") or "0"
            if unread is None:                          # no count given: is there a message after your read marker?
                msgs = self.call("conversations.history", channel=ch, oldest=last_read, limit=5).get("messages") or []
                mine = [m for m in msgs if m.get("user") == uid]
                unread, latest = len(mine), (mine[0]["ts"] if mine else latest)
            ts = latest or last_read
            if unread and front and ch not in self.buddy.letters and self.unread_once.get(ch) != ts:
                self.unread_once[ch] = ts               # give you a poll to read it
            elif unread:
                self.unread_once.pop(ch, None)
                self.buddy.slack_letter(ch, self.name(uid), ts)
            else:
                self.unread_once.pop(ch, None)
                if ch in self.buddy.letters:
                    self.buddy.slack_read(ch)
        for ch in [c for c in self.buddy.letters if c not in watched]:
            self.buddy.slack_read(ch)                   # no longer a VIP (or the DM's gone)

    def check_new(self, vips, now, front=False):
        """New DMs and @-mentions since the last poll: one notice for the lot (VIP DMs have their letter)."""
        hits = []
        for kind, q in (("DM", self.DM_QUERY), ("mention", self.MENTION_QUERY.format(me=self.me))):
            r = self.call("search.messages", query=q, sort="timestamp", sort_dir="desc", count=20)
            for m in (r.get("messages") or {}).get("matches") or []:
                hits.append((kind, m))
        newest, message = self.seen, None
        for kind, m in hits:
            try: ts = float(m.get("ts") or 0)
            except ValueError: continue
            if ts <= self.seen:
                continue
            newest = max(newest, ts)
            uid, ch = m.get("user"), m.get("channel") or {}
            if not uid or uid == self.me or (self.users.get(uid) or {}).get("bot") or m.get("bot_id") or now - ts > MESSAGE_FRESH:
                continue
            if uid in vips and ch.get("is_im"):
                continue                                # a VIP's DM: that's the letter's job
            if ch.get("is_im") or ch.get("is_mpim"):
                kind = "DM"
            message = message or (kind, self.name(uid))
        self.seen = newest
        if message and front:
            log.info("slack: %s from %s, not noticed (you're in Slack)", message[0], message[1])
        elif message:
            self.buddy.slack_message(message[1], message[0])


buddy = None
EMULATOR_TYPES = {".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _reply(self, code, body=b"", ctype="text/plain"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    # ---- the emulator's page, its event stream and its answers (only when the bridge drives the emulator) ----
    def _emulator(self):
        """The Emulator, None when there is none (the request then goes on as before), or False when this
        request was refused: only the page the bridge serves may use it, never another site's page."""
        hub = getattr(getattr(buddy, "dev", None), "emulator", None)
        if not hub:
            return None
        port = self.server.server_address[1]
        here = {f"127.0.0.1:{port}", f"localhost:{port}"}
        origin = self.headers.get("Origin")
        if self.headers.get("Host") not in here or (origin and origin.split("://", 1)[-1] not in here):
            self._reply(403, b"the emulator answers only its own page")
            return False
        return hub

    def _event(self, kind, data, retry=None):
        msg = (f"retry: {retry}\n" if retry else "") + ("" if kind == "line" else f"event: {kind}\n") + f"data: {data}\n\n"
        self.wfile.write(msg.encode()); self.wfile.flush()

    def _events(self, hub):
        """The board's line protocol to the page, one Server-Sent Event per line, until the page goes or is replaced."""
        page, q = hub.attach()
        log.info("emulator page %d connected", page)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-cache"); self.end_headers()
        try:
            self._event("hello", json.dumps({"page": page}), retry=1000)
            while True:
                try:
                    item = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": still here\n\n"); self.wfile.flush()     # finds out when the page has gone
                    continue
                if item is None:
                    self._event("replaced", "{}")
                    break
                self._event(*item)
        except OSError:
            pass
        finally:
            hub.detach(page)
            log.info("emulator page %d gone", page)

    def _emulator_get(self):
        hub = self._emulator()
        if hub is None:
            return False
        if hub:
            path = urlparse(self.path).path
            name = path[len("/emulator/"):] or "index.html"
            if path == "/emulator":
                self.send_response(301); self.send_header("Location", "/emulator/"); self.end_headers()
            elif path == "/emulator/events":
                self._events(hub)
            elif path == "/emulator/art.bin":
                try:
                    with open(hub.art, "rb") as f:
                        self._reply(200, f.read(), "application/octet-stream")
                except (OSError, TypeError):
                    self._reply(404, b"no art: start the bridge with --art")
            elif re.fullmatch(r"[a-z0-9_-]+\.(html|mjs|css)", name) and os.path.isfile(os.path.join(EMULATOR_DIR, name)):
                with open(os.path.join(EMULATOR_DIR, name), "rb") as f:
                    self._reply(200, f.read(), EMULATOR_TYPES[os.path.splitext(name)[1]])
            else:
                self._reply(404)
        return True

    def _hardware_get(self):
        """hardware/model.js for the emulator's Realistic mode, under the same rule as the emulator's own files."""
        hub = self._emulator()
        if hub is None:
            return False
        if hub:
            name = urlparse(self.path).path[len("/hardware/"):]
            if name in HARDWARE_FILES:
                with open(os.path.join(ROOT, "hardware", name), "rb") as f:
                    self._reply(200, f.read(), "text/javascript; charset=utf-8")
            else:
                self._reply(404)
        return True

    def _emulator_post(self, body):
        hub = self._emulator()
        if hub is None:
            return False
        if hub:
            u = urlparse(self.path); q = parse_qs(u.query)
            try:
                page, cid = int(q.get("page", ["0"])[0]), int(q.get("id", ["0"])[0])
            except ValueError:
                page = cid = 0
            if u.path == "/emulator/board":           # what the board said: as if read from its serial port
                self._reply(204 if hub.heard(page, body) else 409)
            elif u.path == "/emulator/clip":          # the board's answer to a clip
                self._reply(204 if hub.clip_answer(page, cid, body.decode(errors="replace")) else 409)
            else:
                self._reply(404)
        return True

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path.startswith("/emulator/") and self._emulator_post(body):
            return
        if self.path == "/hook":
            self._reply(204)                      # answer first so the hook never waits on us
            try: buddy.hook(json.loads(body or b"{}"))
            except Exception as e: log.info("bad hook payload: %s", e)
        elif self.path == "/app":
            self._reply(204)
            try: buddy.app.snapshot(json.loads(body or b"{}"))
            except Exception as e: log.info("bad app snapshot: %s", e)
        elif self.path == "/usage":               # from tools/statusline.sh (status line JSON)
            self._reply(204)
            try:
                p = json.loads(body or b"{}") or {}
                buddy.set_usage(p.get("rate_limits"), account=account_of_config(p.get("transcript_path")))
            except Exception as e: log.info("bad usage payload: %s", e)
        elif self.path == "/calendar":            # re-read the calendar now
            buddy.calendar.refresh_now(); self._reply(200, b"refreshing")
        elif self.path == "/cmd":
            ok = buddy.dev.send(body.decode().strip()); self._reply(200 if ok else 503, b"ok" if ok else b"board not connected")
        elif self.path == "/play":                # an act by name (GET /play lists them)
            ok = buddy.play(body.decode())
            if ok is None: self._reply(404, b"no such act (GET /play lists them)")
            else: self._reply(200 if ok else 503, b"ok" if ok else b"couldn't reach the board (see bridge.log)")
        elif self.path == "/sound":               # on | off | toggle | play <moment>
            cmd = body.decode().strip().split()
            if cmd and cmd[0] in ("on", "off", "toggle"):
                on = buddy.sounds.set_enabled({"on": True, "off": False}.get(cmd[0], "toggle"))
                self._reply(200, b"on" if on else b"off")
            elif len(cmd) == 2 and cmd[0] == "play":            # a moment
                ok = buddy.sounds.play(cmd[1], force=True)
                self._reply(200 if ok else 404, b"ok" if ok else b"no such sound")
            else:
                self._reply(400, b"use: on | off | toggle | play <moment>")
        else:
            self._reply(404)

    def do_GET(self):
        if self.path.startswith("/emulator") and self._emulator_get():
            return
        if self.path.startswith("/hardware/") and self._hardware_get():
            return
        if self.path == "/status":
            self._reply(200, json.dumps(buddy.status(), indent=2).encode(), "application/json")
        elif self.path == "/sound":
            self._reply(200, json.dumps(buddy.sounds.settings(), indent=2).encode(), "application/json")
        elif self.path == "/play":
            self._reply(200, json.dumps(buddy.playable()).encode(), "application/json")
        else:
            self._reply(404)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Desk Buddy bridge: Claude Code hooks to the board (see the top of this file).")
    ap.add_argument("--emulator", action="store_true", help='drive the web emulator (emulator/) instead of a board; also "emulator": true in config.json')
    ap.add_argument("--art", help='the art the board or the emulator plays, which Sage\'s mind and POST /play read its acts from (default: "art" in config.json, else firmware/data/sage.bin, else for the emulator the test card)')
    ap.add_argument("--port", type=int, default=HTTP_PORT, help="the HTTP port (default %(default)s, where the hooks post)")
    args = ap.parse_args()
    cfg, hub = read_config(), None
    emulating = args.emulator or cfg.get("emulator")
    if not emulating and serial is None:
        sys.exit("pyserial is missing (tools/install_bridge.sh installs it); without a board, run with --emulator")
    # the art the board plays (the installed config names the repository's), which the mind and POST /play read
    defaults = [os.path.join(ROOT, "firmware", "data", "sage.bin")] + ([os.path.join(EMULATOR_DIR, "testcard", "testcard.bin")] if emulating else [])
    art = args.art or cfg.get("art") or next((p for p in defaults if os.path.exists(p)), None)
    hub = Emulator(art) if emulating else None
    mind = None if cfg.get("mind") is False else Mind(art=art, script=cfg["mind"] if isinstance(cfg.get("mind"), str) else MIND_SCRIPT, node=cfg.get("node"))
    buddy = Buddy(emulator=hub, mind=mind, art=art)
    buddy.app = AppPages(buddy)
    buddy.calendar = Calendar()
    buddy.slack = SlackWatch(buddy)
    log.info("desk-buddy bridge listening on 127.0.0.1:%d", args.port)
    if hub:
        log.info("emulator: http://127.0.0.1:%d/emulator/ plays %s", args.port, hub.art)
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
