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
# L0 and L4 both came up in 3s on 2026-07-28, which rules out the config, the file crawl, NativeWind
# and the network. That leaves the four deltas between this harness and a plain `pnpm start`. L5-L7
# change exactly one each, so whichever one hangs IS the cause:
#
#   L5  port 8081 instead of 8091      → a zombie Metro from an earlier run still holding the port.
#   L6  interactive (no CI=1)          → Expo's terminal UI, which waits on stdin.
#   L7  no --clear                     → the existing Metro cache. Every passing run above cleared it.
#
# L5-L7 all came up in 3s too. Every way of invoking `expo start` directly works, so the remaining
# suspect is the wrapper -- or the bug is already fixed and nothing has re-run the real command since:
#
#   L8  `pnpm run start` verbatim      → the actual failing command, nothing changed.
#   L9  bare `npx expo start` on 8081  → L8 minus the pnpm wrapper. L9 up + L8 stuck = it is pnpm.
#
# Usage:  bash scripts/metro-bisect.sh            (all four)
#         CEILING=600 bash scripts/metro-bisect.sh L8 L9
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
  free_port "$PORT"; free_port 8081
  echo ""
  echo "metro.config.js restored. Logs in $LOGDIR/"
}
trap cleanup EXIT INT TERM

# Kill whatever holds the port, by PORT rather than by process name. `pnpm run start` spawns
# pnpm -> bash -> node, so killing the job leaves the grandchild listening and the next variant hits
# "Port 8081 is running this app in another window" -- which is the very bug this harness found.
free_port() {
  local victims
  victims="$(lsof -ti "tcp:$1" 2>/dev/null)"
  [ -n "$victims" ] && echo "$victims" | xargs kill -9 2>/dev/null
  return 0
}

# Serve /status and you are up; that is the same check the dev client makes.
probe() {
  local label="$1" log="$LOGDIR/$1.log" t=0 pid
  local args="${3:-}"
  local port="${P_PORT:-$PORT}"
  local clear_flag="--clear"; [ "${P_CLEAR:-yes}" = "no" ] && clear_flag=""
  local ci="${P_CI:-1}"
  printf '\n── %-3s %s\n' "$label" "$2"
  free_port "$port"; sleep 1

  # DEBUG output goes to the log, not the terminal -- it names the step Metro is on when it stalls.
  if [ -n "${P_CMD:-}" ]; then
    ( cd "$DRIVER" && eval "$P_CMD" ) > "$log" 2>&1 < /dev/null &
  else
    ( cd "$DRIVER" && CI="$ci" EXPO_NO_TELEMETRY=1 DEBUG='expo:*' \
        npx expo start --dev-client $clear_flag --port "$port" $args ) \
      > "$log" 2>&1 < /dev/null &
  fi
  pid=$!

  while [ "$t" -lt "$CEILING" ]; do
    if curl -s -m 2 "http://127.0.0.1:$port/status" 2>/dev/null | grep -q 'packager-status:running'; then
      printf '      UP after %ss\n' "$t"
      kill "$pid" 2>/dev/null; free_port "$port"
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
  kill "$pid" 2>/dev/null; free_port "$port"
  return 1
}

want() { [ "$#" -eq 0 ] && return 0; for a in "$@"; do [ "$a" = "$WANT" ] && return 0; done; return 1; }

echo "metro-bisect · port $PORT · ceiling ${CEILING}s per variant"
echo "driver: $DRIVER"

for WANT in L0 L1 L2 L3 L4 L5 L6 L7 L8 L9; do
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
    L5) cp "$SAFE" "$CFG"; P_PORT=8081 probe L5 "same, but on port 8081 (the port a plain start uses)" ;;
    L6) cp "$SAFE" "$CFG"; P_CI=0    probe L6 "same, but interactive — Expo's terminal UI, no CI=1" ;;
    L7) cp "$SAFE" "$CFG"; P_CLEAR=no probe L7 "same, but WITHOUT --clear — the existing Metro cache" ;;
    L8) cp "$SAFE" "$CFG"
        P_CMD='pnpm run start' P_PORT=8081 P_KILL='expo start' \
          probe L8 "\`pnpm run start\` verbatim — the actual failing command" ;;
    L9) cp "$SAFE" "$CFG"
        P_CMD='npx expo start --dev-client' P_PORT=8081 P_KILL='expo start' \
          probe L9 "bare npx expo start on 8081 — L8 without the pnpm wrapper" ;;
  esac
done
