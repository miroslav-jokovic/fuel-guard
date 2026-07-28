#!/usr/bin/env bash
# metro-bisect — which layer of the driver's Metro setup is stopping it from starting?
#
# "Stuck on Starting Metro Bundler" has no error to read, so the only way to find the cause is to
# remove one layer at a time and see which removal makes it come up. This runs four variants, each
# with a hard ceiling, and prints how long each took to serve /status.
#
#   L0  no metro.config.js at all      → Expo defaults. Comes up = the cause is in OUR config.
#   L1  our config, no NativeWind      → NativeWind forks the Tailwind CLI and awaits a message with
#                                        no error, exit or timeout handler, so anything that kills
#                                        that child hangs Metro silently and forever. Running the
#                                        child by hand produced 14 KB of CSS cleanly, so this is
#                                        probably NOT it -- kept because "probably" is not "isn't".
#   L2  our config as committed        → the current state.
#   L3  the pre-2026-07-28 config      → watchFolders = [workspaceRoot], no blockList. Comes up =
#                                        this morning's change is the regression, revert it.
#   L4  current config, --offline      → Expo makes network calls around server start; on a stalled
#                                        connection they block with no message. --offline skips them.
#
# Usage:  bash scripts/metro-bisect.sh            (all four)
#         CEILING=600 bash scripts/metro-bisect.sh L0 L4
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRIVER="$ROOT/apps/driver"
CFG="$DRIVER/metro.config.js"
SAFE="$ROOT/.metro-bisect-original.js"
PORT="${PORT:-8091}"
CEILING="${CEILING:-300}"
OLD_CONFIG_REF="${OLD_CONFIG_REF:-5c6b588}"
LOGDIR="${TMPDIR:-/tmp}/metro-bisect"
mkdir -p "$LOGDIR"

[ -f "$CFG" ] || { echo "no metro.config.js at $CFG"; exit 1; }
cp "$CFG" "$SAFE"

cleanup() {
  [ -f "$SAFE" ] && mv -f "$SAFE" "$CFG"
  pkill -f "expo start .*--port $PORT" 2>/dev/null
  echo ""
  echo "metro.config.js restored. Logs in $LOGDIR/"
}
trap cleanup EXIT INT TERM

# Serve /status and you are up; that is the same check the dev client makes.
probe() {
  local label="$1" log="$LOGDIR/$1.log" t=0 pid
  local EXTRA_ARGS="${3:-}"
  printf '\n── %-3s %s\n' "$label" "$2"
  pkill -f "expo start .*--port $PORT" 2>/dev/null; sleep 1

  # DEBUG output goes to the log, not the terminal -- it names the step Metro is on when it stalls.
  ( cd "$DRIVER" && CI=1 EXPO_NO_TELEMETRY=1 DEBUG='expo:*' \
      npx expo start --dev-client --clear --port "$PORT" ${EXTRA_ARGS:-} ) \
    > "$log" 2>&1 &
  pid=$!

  while [ "$t" -lt "$CEILING" ]; do
    if curl -s -m 2 "http://127.0.0.1:$PORT/status" 2>/dev/null | grep -q 'packager-status:running'; then
      printf '      UP after %ss\n' "$t"
      kill "$pid" 2>/dev/null; pkill -f "expo start .*--port $PORT" 2>/dev/null
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      printf '      EXITED after %ss — last lines:\n' "$t"
      tail -6 "$log" | sed 's/^/        /'
      return 2
    fi
    [ $((t % 30)) -eq 0 ] && [ "$t" -gt 0 ] && printf '      ... %ss\n' "$t"
    sleep 3; t=$((t + 3))
  done

  printf '      STUCK — no /status after %ss\n' "$CEILING"
  printf '      last lines:\n'; tail -6 "$log" | sed 's/^/        /'
  kill "$pid" 2>/dev/null; pkill -f "expo start .*--port $PORT" 2>/dev/null
  return 1
}

want() { [ "$#" -eq 0 ] && return 0; for a in "$@"; do [ "$a" = "$WANT" ] && return 0; done; return 1; }

echo "metro-bisect · port $PORT · ceiling ${CEILING}s per variant"
echo "driver: $DRIVER"

for WANT in L0 L1 L2 L3 L4; do
  if [ "$#" -gt 0 ]; then want "$@" || continue; fi
  case "$WANT" in
    L0) rm -f "$CFG"; probe L0 "Expo defaults — no metro.config.js" ;;
    L1) sed 's#^module.exports = withNativeWind(config.*#module.exports = config;#' "$SAFE" > "$CFG"
        probe L1 "our config, NativeWind removed" ;;
    L2) cp "$SAFE" "$CFG"; probe L2 "our config as committed" ;;
    L3) if git -C "$ROOT" show "$OLD_CONFIG_REF:apps/driver/metro.config.js" > "$CFG" 2>/dev/null; then
          probe L3 "the pre-2026-07-28 config ($OLD_CONFIG_REF)"
        else
          echo "── L3  skipped — could not read $OLD_CONFIG_REF:apps/driver/metro.config.js"
        fi ;;
    L4) cp "$SAFE" "$CFG"; probe L4 "our config, --offline (skips Expo's network calls)" "--offline" ;;
  esac
done
