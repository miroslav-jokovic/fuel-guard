#!/bin/sh
# Install (or re-install) the McLeod roster sweep as a per-user launchd job on this Mac.
#
#   sh tools/mcleod-agent/launchd/install-roster-sweep.sh           # install / refresh
#   sh tools/mcleod-agent/launchd/install-roster-sweep.sh uninstall # stop and remove
#
# The Mac must reach McLeod's SQL Server (10.0.1.171) — i.e. be on the carrier's network — and the
# agent's .env must hold the McLeod login and the FuelGuard ingest token. When the Mac sleeps or
# leaves the network the sweep simply fails each cycle; the Vehicles, Trailers and Drivers pages say
# so within the hour ("McLeod was last read …"), which is the point of E6.
set -eu
LABEL=com.silvicom.mcleod-roster
HERE=$(cd "$(dirname "$0")" && pwd)
AGENT_DIR=$(cd "$HERE/.." && pwd)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/silvicom-mcleod-roster.log"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "uninstall" ]; then
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

NODE=$(command -v node)
[ -f "$AGENT_DIR/.env" ] || { echo "no $AGENT_DIR/.env — configure the agent first" >&2; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s#__NODE__#$NODE#g" -e "s#__AGENT_DIR__#$AGENT_DIR#g" -e "s#__LOG__#$LOG#g" \
  "$HERE/$LABEL.plist.template" > "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "installed $LABEL — node $NODE, every 2 min, log $LOG"
