"""The times flow.model.mjs takes from this machine rather than from the code.

    python3 docs/figures/measure.py

Prints the median and the 95th percentile of: the installed hook command (tools/install_hooks.py) run as a hook runs
it, against a server that answers 204 at once; the bridge's own handling of a hook (Buddy.hook) for a tool call; and
for a failing test, which asks Sage's mind and waits for its answer. The bridge runs against a temporary home with the
real mind and firmware/data/sage.bin, and a device that only records the lines.
"""
import http.server, importlib.util, os, random, shutil, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HOME = tempfile.mkdtemp(prefix="sage-measure-")
os.environ["DESKBUDDY_HOME"] = HOME                   # never ~/.desk-buddy
sys.path.insert(0, os.path.join(ROOT, "tools"))
spec = importlib.util.spec_from_file_location("buddy_bridge", os.path.join(ROOT, "tools", "buddy_bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
import install_hooks


def quantiles(xs):
    xs = sorted(xs)
    return f"median {xs[len(xs) // 2] * 1000:.3f} ms, p95 {xs[int(len(xs) * 0.95)] * 1000:.3f} ms"


class Device:
    connected = True
    def send(self, cmd, quiet=False): return True


class Focus:
    front, code_session = False, None


class Sounds:
    def settings(self): return {}
    def play(self, moment, force=False): return True


class NoContent(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        self.send_response(204)
        self.end_headers()


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), NoContent)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    command = install_hooks.HOOK_CMD.replace(f":{bridge.HTTP_PORT}/", f":{server.server_address[1]}/")
    runs = []
    for i in range(105):
        t0 = time.perf_counter()
        subprocess.run(["sh", "-c", command], input=b'{"hook_event_name": "PreToolUse"}')
        runs.append(time.perf_counter() - t0)
    print("the hook command:", quantiles(runs[5:]))

    art = os.path.join(ROOT, "firmware", "data", "sage.bin")
    mind = bridge.Mind(art=art)
    for _ in range(100):
        if mind.ready:
            break
        time.sleep(0.05)
    buddy = bridge.Buddy(dev=Device(), focus=Focus(), sounds=Sounds(), start=False, mind=mind, art=art)
    buddy.hook({"hook_event_name": "UserPromptSubmit", "session_id": "a", "cwd": "/tmp"})
    tool, failing = [], []
    for i in range(400):
        t0 = time.perf_counter()
        buddy.hook({"hook_event_name": random.choice(["PreToolUse", "PostToolUse"]), "session_id": "a", "tool_name": "Read", "tool_input": {}})
        tool.append(time.perf_counter() - t0)
    for i in range(60):
        t0 = time.perf_counter()
        buddy.hook({"hook_event_name": "PostToolUseFailure", "session_id": "a", "tool_name": "Bash", "tool_input": {"command": "npm test"}})
        failing.append(time.perf_counter() - t0)
    mind.stop()
    print("the bridge, a tool call:", quantiles(tool))
    print("the bridge, a failing test (asks the mind):", quantiles(failing))


if __name__ == "__main__":
    try:
        main()
    finally:
        shutil.rmtree(HOME, ignore_errors=True)
