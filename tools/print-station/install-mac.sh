#!/bin/sh
# Silvicom print station — install (or update) on a Mac (PRINTERS-AND-SCANNERS-PLAN.md PS3).
#
# Run from this folder, as the user who is signed in on the Mac:
#
#     sh install-mac.sh                                    update the program; keep the pairing
#     sh install-mac.sh --code ABCD-EFGH --api https://…   first install: pair with the code from
#                                                          Settings → Devices
#
# Why this script exists (2026-11-20): the office Mac's station had been started by hand from a git
# worktree (~/Projects/FuelGuard-print). When that worktree was deleted during a disk cleanup, the
# LaunchAgent pointed at a file that no longer existed; launchd tried 5,990 times, and no label
# printed from 11/15 to 11/20. So, like install-windows.ps1 does to C:\Program Files, the program is
# COPIED to a folder no project cleanup touches, ~/.silvicom-print-station/app, beside its config
# and log. After that the repository can be deleted, moved or switched to any branch.
#
# What it does — each step says what it found:
#   1. Checks Node.js 20 or newer, and records node's STABLE path (/opt/homebrew/bin/node, the
#      symlink Homebrew keeps across upgrades, never the versioned Cellar path behind it).
#   2. Copies the program (every *.mjs but the tests) to ~/.silvicom-print-station/app.
#   3. Pairs, when --code is given; the token goes to ~/.silvicom-print-station/config.json (0600).
#   4. Writes the LaunchAgent com.silvicom.print-station: starts at login, restarts if it stops.
#   5. (Re)starts it and shows the last lines of its log.
#
# To remove:  launchctl bootout gui/$(id -u)/com.silvicom.print-station
#             rm ~/Library/LaunchAgents/com.silvicom.print-station.plist
# The printer must be a CUPS queue first (System Settings → Printers & Scanners); `node station.mjs
# printers` lists what the station will see.
set -eu

CODE=""
API=""
while [ $# -gt 0 ]; do
  case "$1" in
    --code) CODE="$2"; shift 2 ;;
    --api) API="$2"; shift 2 ;;
    *) echo "Usage: sh install-mac.sh [--code ABCD-EFGH --api https://<your Silvicom address>]" >&2; exit 64 ;;
  esac
done

SRC=$(cd "$(dirname "$0")" && pwd)
DATA="$HOME/.silvicom-print-station"
APP="$DATA/app"
CONFIG="$DATA/config.json"
LOG="$DATA/station.log"
LABEL="com.silvicom.print-station"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# 1. Node — the symlink on PATH, not `realpath` of it: a Homebrew upgrade replaces the Cellar folder.
NODE=$(command -v node || true)
if [ -z "$NODE" ]; then echo "1. Node.js is not installed: brew install node" >&2; exit 69; fi
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 20 ]; then echo "1. Node.js $MAJOR is too old; 20 or newer is needed" >&2; exit 69; fi
echo "1. Node.js $("$NODE" --version) at $NODE"

# 2. The program, to its own folder. Written to a temporary folder first and swapped in, so a
#    failed copy never leaves the running service half old, half new.
mkdir -p "$DATA"
rm -rf "$APP.new"
mkdir "$APP.new"
for f in "$SRC"/*.mjs; do
  case "$f" in *.test.mjs) ;; *) cp "$f" "$APP.new/" ;; esac
done
rm -rf "$APP"
mv "$APP.new" "$APP"
echo "2. Program $("$NODE" -e 'import("'"$APP"'/station.mjs").then((m) => console.log(m.VERSION))') copied to $APP"

# 3. Pairing.
if [ -n "$CODE" ]; then
  if [ -z "$API" ]; then echo "3. --code needs --api https://<your Silvicom address>" >&2; exit 64; fi
  "$NODE" "$APP/station.mjs" pair "$CODE" --api "$API" --config "$CONFIG"
  echo "3. Paired; token saved to $CONFIG"
elif [ -f "$CONFIG" ]; then
  echo "3. Keeping the existing pairing in $CONFIG"
else
  echo "3. Not paired yet: run again with --code <code from Settings → Devices> --api https://…" >&2
  exit 78
fi

# 4. The LaunchAgent. A login item, not a system daemon: CUPS queues and USB printers are the
#    signed-in user's, and the Mac in the office stays signed in.
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APP/station.mjs</string>
    <string>run</string>
    <string>--config</string><string>$CONFIG</string>
    <string>--log</string><string>$LOG</string>
  </array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardErrorPath</key><string>$DATA/launchd.err</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null
echo "4. LaunchAgent written to $PLIST"

# 5. (Re)start.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 5
echo "5. Started. Last lines of $LOG:"
tail -n 3 "$LOG" 2>/dev/null || echo "   (no log yet)"
