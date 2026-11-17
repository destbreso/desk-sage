#!/bin/bash
# Install (or update) the Desk Buddy bridge and app watcher as macOS login items.
#   com.deskbuddy.bridge    Python bridge: Claude Code hooks + Chat/Cowork state -> Sage over USB or Wi-Fi
#   com.deskbuddy.appwatch  small native helper that reads the Claude app's accessibility tree
#                           (Chat and Cowork have no hooks). Only this helper needs Accessibility.
# Runtime lives in ~/.desk-buddy (outside iCloud, so it's never evicted):
#   venv/  bridge.py  bridge.log  config.json  deskbuddy-appwatch
# Sage's mind runs from this checkout, as it reads the website's code (design/site/) and the emulator's parser here:
# config.json is pointed at its mind/sage-mind.mjs, at the art the board plays (firmware/data/sage.bin) and at
# Node, since a login item's PATH has none. Without them (the checkout moved, no Node) the bridge carries on
# without the mind and says so in bridge.log; run this again from the checkout's new place.
# No sounds are installed: Sage's voice is not made yet (docs/ROADMAP.md, Phase 3), so the bridge is silent.
# Uninstall: tools/install_bridge.sh --uninstall
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RT="$HOME/.desk-buddy"
LABEL="com.deskbuddy.bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WLABEL="com.deskbuddy.appwatch"
WPLIST="$HOME/Library/LaunchAgents/$WLABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/$WLABEL" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$PLIST" "$WPLIST"
  echo "Bridge and app watcher removed (runtime left in $RT)."
  exit 0
fi

mkdir -p "$RT" "$HOME/Library/LaunchAgents"
[ -x "$RT/venv/bin/python" ] || python3 -m venv "$RT/venv"
"$RT/venv/bin/pip" -q install --disable-pip-version-check --upgrade pip
"$RT/venv/bin/pip" -q install --disable-pip-version-check pyserial icalendar recurring-ical-events
cp "$ROOT/tools/buddy_bridge.py" "$RT/bridge.py"
# Sage's mind, its art and Node, in config.json (merged: nothing else in it is touched, and "mind": false stays)
NODE="$(command -v node || true)"
"$RT/venv/bin/python" -I - "$RT/config.json" "$ROOT" "$NODE" <<'PY'
import json, os, sys
path, root, node = sys.argv[1:4]
try:
    with open(path) as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {}
except ValueError as e:
    sys.exit(f"{path} is not JSON ({e}): fix it, then run this again")
if cfg.get("mind") is not False:
    cfg["mind"] = os.path.join(root, "mind", "sage-mind.mjs")
cfg["art"] = os.path.join(root, "firmware", "data", "sage.bin")
if node:
    cfg["node"] = node
mode = os.stat(path).st_mode & 0o777 if os.path.exists(path) else 0o600     # it may hold tokens
fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
with os.fdopen(fd, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
os.replace(path + ".tmp", path)
mind = cfg["mind"] if cfg.get("mind") is not False else 'off ("mind": false in config.json)'
print("Sage's mind:", mind)
print("The art:", cfg["art"] + ("" if os.path.exists(cfg["art"]) else " (not there yet: the mind starts without it)"))
print("Node:", cfg["node"] if cfg.get("node") else 'none on this PATH: the bridge looks where Homebrew and nvm put it, else name it as "node" in config.json')
PY
echo "No sounds: Sage's voice is not made yet, so the bridge is silent."

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$RT/venv/bin/python</string><string>-u</string><string>$RT/bridge.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$RT/bridge.out</string>
  <key>StandardErrorPath</key><string>$RT/bridge.out</string>
</dict></plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# Build the app watcher. macOS ties its Accessibility permission to the signature. If Claude Switcher's
# local signing certificate exists (its build.sh makes one), sign with that: every build then keeps the
# permission. Otherwise it's an ad hoc signature, which changes with every build, so the installed
# binary is only replaced when the program changed (and you re-allow it in Accessibility).
NEW="$RT/deskbuddy-appwatch.new"
swiftc -O -swift-version 5 "$ROOT/tools/appwatch/main.swift" -o "$NEW"
SIGNING="$HOME/Library/Application Support/Claude Switcher Signing"
if [ -f "$SIGNING/signing.keychain-db" ] && [ -f "$SIGNING/password" ]; then
  KC="$SIGNING/signing.keychain-db"
  security unlock-keychain -p "$(cat "$SIGNING/password")" "$KC"
  ID="$(security find-certificate -c "Claude Switcher Local" -Z "$KC" | awk '/SHA-1/ {print $NF}')"
  # codesign only finds an identity in a keychain on the search list: add it just while signing
  OLD_LIST=()
  while IFS= read -r k; do OLD_LIST+=("$k"); done < <(security list-keychains -d user | sed -E 's/^ *"(.*)"$/\1/')
  security list-keychains -d user -s "${OLD_LIST[@]}" "$KC"
  SIGNED=0; codesign --force --sign "$ID" --identifier "$WLABEL" "$NEW" && SIGNED=1
  security list-keychains -d user -s "${OLD_LIST[@]}"
  [ "$SIGNED" = 1 ] || { echo "signing the app watcher failed"; exit 1; }
  mv "$NEW" "$RT/deskbuddy-appwatch"
elif cmp -s "$NEW" "$RT/deskbuddy-appwatch"; then rm -f "$NEW"; else mv "$NEW" "$RT/deskbuddy-appwatch"; fi
cat > "$WPLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$WLABEL</string>
  <key>ProgramArguments</key><array><string>$RT/deskbuddy-appwatch</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$RT/appwatch.out</string>
  <key>StandardErrorPath</key><string>$RT/appwatch.out</string>
</dict></plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$WPLIST"

sleep 3
curl -s -m 2 http://127.0.0.1:47823/status && echo
echo "Bridge and app watcher running. If macOS asks, allow deskbuddy-appwatch under"
echo "System Settings > Privacy & Security > Accessibility."
