#!/usr/bin/env bash
# The live edge geometry checks (LIVE-EDGE-DETECTION-PLAN.md step L0).
#
# Compiles the SAME LiveEdgeGeometry.swift the module ships, for macOS, with plain swiftc, and runs
# LiveEdgeGeometryMain.swift against it: mapping, the validator, overlap, the One Euro filter,
# hysteresis and the spring. No camera, simulator or Xcode project.
#
# ⚠ macOS ONLY, and therefore NOT a CI gate, for the same reason as run-metrics-parity.sh: no iOS job
# exists in CI. Run it on every change to LiveEdgeGeometry.swift.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE="$(cd "$HERE/../.." && pwd)"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "✗ swiftc not found — this harness needs a Mac with the Xcode command line tools." >&2
  exit 2
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# Top-level statements are only allowed in a file called main.swift, so the checks are copied under
# that name rather than wrapped in an @main type that would add nothing.
cp "$HERE/LiveEdgeGeometryMain.swift" "$OUT/main.swift"
swiftc -O -o "$OUT/live-edge-tests" "$MODULE/ios/LiveEdgeGeometry.swift" "$OUT/main.swift"
"$OUT/live-edge-tests"
