#!/usr/bin/env bash
# The iOS metric-parity run (SCANNER-UPGRADE-PLAN.md Step 3.1, D-SCAN9).
#
# Compiles the SAME CaptureMetrics.swift + CaptureImageDecode.swift the module ships — for macOS,
# with plain swiftc, no Xcode project and no simulator — and holds them to
# packages/capture-engine/fixtures/expected.json over the whole corpus.
#
#   ./run-metrics-parity.sh          check the corpus, print the worst deviation, exit non-zero on a miss
#
# ⚠ macOS ONLY, and therefore NOT a CI gate. iOS is compiled nowhere in CI: macOS runners bill at
# roughly ten times Linux and that trade has not been made (root CLAUDE.md's gate list is the record
# of what CI does run). So this is the author's responsibility on every change to either Swift file,
# exactly like the `xcodebuild` step in the plan's §3.4 — and like that step, forgetting it is
# invisible until a phone is in the room.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE="$(cd "$HERE/../.." && pwd)"
FIXTURES="$(cd "$MODULE/../../../../packages/capture-engine/fixtures" && pwd)"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "✗ swiftc not found — this harness needs a Mac with the Xcode command line tools." >&2
  exit 2
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# -O because the corpus is 24 pages of up to 2 MP and the debug build spends about a minute in
# bounds checks. Optimisation cannot change the arithmetic here: every accumulator is an Int or an
# exactly-representable Double, and Swift does not reassociate floating-point without -Ofast.
swiftc -O \
  -o "$OUT/metrics-parity" \
  "$MODULE/ios/CaptureMetrics.swift" \
  "$MODULE/ios/CaptureImageDecode.swift" \
  "$HERE/MetricsParityMain.swift"

"$OUT/metrics-parity" "$FIXTURES"
