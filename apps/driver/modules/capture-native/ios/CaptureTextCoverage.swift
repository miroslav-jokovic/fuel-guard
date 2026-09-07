import Foundation

/**
 The iOS transliteration of the F7 text-coverage definition
 (SCANNER-UPGRADE-PLAN.md Step 3.3, audit defect F7, D-SCAN8/D-SCAN9).

 `packages/capture-engine/src/textCoverage.ts` is the implementation of record and explains WHAT the
 two metrics used to be and why that was wrong; that reasoning is not copied here. This is a
 transliteration of the arithmetic, held to `packages/capture-engine/fixtures/textBoxes.json` by
 `tests/ios/run-metrics-parity.sh` over the same twelve hand-built cases, and written line for line
 against `android/.../CaptureTextCoverage.kt` so the two ports diff against each other too.

 Foundation only, for the same reason as `CaptureMetrics.swift`: the harness compiles this exact file
 for macOS with plain `swiftc`, so the check runs on a laptop rather than only on a phone.
 */

/// One recognised text box in PIXELS, top-left origin. The conversion from whatever shape the OS
/// engine reports happens at the caller, which is the one place it should be visible — Vision's
/// `boundingBox` is normalised with a BOTTOM-left origin, and that flip belongs next to the Vision
/// call rather than inside a geometry routine.
struct TextBox {
  var x: Double
  var y: Double
  var width: Double
  var height: Double
}

enum CaptureTextCoverage {
  /// Area covered by at least one box, in square pixels, clipped to the page.
  static func unionArea(_ boxes: [TextBox], width: Double, height: Double) -> Double {
    if width <= 0 || height <= 0 { return 0 }

    var clipped: [TextBox] = []
    for b in boxes {
      let x0 = max(0, min(width, b.x))
      let y0 = max(0, min(height, b.y))
      let x1 = max(0, min(width, b.x + b.width))
      let y1 = max(0, min(height, b.y + b.height))
      if x1 > x0 && y1 > y0 { clipped.append(TextBox(x: x0, y: y0, width: x1 - x0, height: y1 - y0)) }
    }
    if clipped.isEmpty { return 0 }

    let xs = sortedDistinct(clipped.flatMap { [$0.x, $0.x + $0.width] })
    let ys = sortedDistinct(clipped.flatMap { [$0.y, $0.y + $0.height] })

    var area = 0.0
    var i = 0
    while i + 1 < xs.count {
      let cellX0 = xs[i]
      let cellX1 = xs[i + 1]
      var j = 0
      while j + 1 < ys.count {
        let cellY0 = ys[j]
        let cellY1 = ys[j + 1]
        // Membership by MIDPOINT, not by edge comparison — that is what makes touching boxes and
        // nested boxes both come out right, and it is the step most likely to be "improved" into
        // something subtly different, so it is written the same way in all three languages.
        let midX = (cellX0 + cellX1) / 2
        let midY = (cellY0 + cellY1) / 2
        for b in clipped where midX > b.x && midX < b.x + b.width && midY > b.y && midY < b.y + b.height {
          area += (cellX1 - cellX0) * (cellY1 - cellY0)
          break
        }
        j += 1
      }
      i += 1
    }
    return area
  }

  /// Fraction of the page covered by at least one recognised box, 0..1 (F7).
  static func textCoverageFraction(_ boxes: [TextBox], width: Double, height: Double) -> Double {
    if width <= 0 || height <= 0 { return 0 }
    return unionArea(boxes, width: width, height: height) / (width * height)
  }

  /// Fraction of the page covered by the smallest-height quartile of boxes, 0..1 (F7).
  static func smallTextBandCoverage(_ boxes: [TextBox], width: Double, height: Double) -> Double {
    if boxes.isEmpty || width <= 0 || height <= 0 { return 0 }
    // ⚠ Sorted by height and then by the geometry. Swift's `sort` is NOT guaranteed stable, so a
    // comparator that treated equal heights as equal would let the platform choose which boxes the
    // quartile contains — and TypeScript, Swift and Kotlin would each choose differently. The tie
    // break makes the selection a property of the boxes.
    let byHeight = boxes.sorted { a, b in
      if a.height != b.height { return a.height < b.height }
      if a.y != b.y { return a.y < b.y }
      if a.x != b.x { return a.x < b.x }
      return a.width < b.width
    }
    let count = max(1, byHeight.count / 4)
    let smallest = Array(byHeight.prefix(count))
    return unionArea(smallest, width: width, height: height) / (width * height)
  }

  private static func sortedDistinct(_ values: [Double]) -> [Double] {
    let sorted = values.sorted()
    var out: [Double] = []
    for v in sorted where out.isEmpty || out[out.count - 1] != v { out.append(v) }
    return out
  }
}
