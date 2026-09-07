import Foundation

/**
 The iOS transliteration of the metric definition of record
 (SCANNER-UPGRADE-PLAN.md Step 3.1, D-SCAN1..5, D-SCAN8, D-SCAN9).

 ══════════════════════════════════════════════════════════════════════════════════════════════
 WHAT THIS FILE IS, AND WHAT IT IS NOT
 ══════════════════════════════════════════════════════════════════════════════════════════════
 `packages/capture-engine/src/metrics.ts` is the implementation OF RECORD. The server imports and
 calls it, so client/server parity there is structural. iOS cannot call it, so iOS reimplements it —
 and "reimplemented correctly" is not something anybody can establish by reading two files side by
 side. `packages/capture-engine/fixtures/expected.json` is how this file is held to the reference:
 the same 24 PNGs, the same numbers, within the tolerances that file records.

 So this is a TRANSLITERATION, deliberately, line for line. Every constant has the same name and the
 same value as in `metrics.ts`; every loop has the same bounds in the same order; the comments that
 explain WHY a step is the way it is live in `metrics.ts` and are not copied here, because a comment
 duplicated is a comment that will disagree with itself. What IS recorded here is anything Swift
 does differently from TypeScript and had to be handled — there are three, and they are marked ⚠.

 Plain Swift, no Accelerate, no vImage (plan Step 3.1). The point is a loop a reviewer can line up
 against the TypeScript. vImage is an optimisation for later, and only if measured slow.

 ══════════════════════════════════════════════════════════════════════════════════════════════
 WHY IT IMPORTS ONLY `Foundation`
 ══════════════════════════════════════════════════════════════════════════════════════════════
 No UIKit, no VisionKit, no ExpoModulesCore. That is what lets `tests/ios/run-metrics-parity.sh`
 compile this exact file for macOS with `swiftc` and run it against the corpus on a laptop, with no
 simulator, no Xcode project and no device. iOS is compiled nowhere in CI (macOS runners bill at
 ~10× Linux and that trade has not been made), so a harness that needs a phone is a harness that
 gets run once. Decoding lives in `CaptureImageDecode.swift` for the same reason: it needs
 CoreGraphics, and separating it keeps the arithmetic testable in the plainest possible way.
 */

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Definitional constants — same names, same values as `metrics.ts`. These are NOT tunable gate
// thresholds: changing one changes what every recorded number MEANS. The tunable floors live in the
// signed `CaptureConfigGates` and arrive from JavaScript.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/// Rec.709 luma on gamma-encoded sRGB, in 16-bit fixed point (×65536). Integer on purpose: three
/// languages must agree to the last count.
private let LUMA_R = 13933 // 0.2126 × 65536
private let LUMA_G = 46871 // 0.7152 × 65536
private let LUMA_B = 4732 //  0.0722 × 65536

/// A pixel at or above this is "near-white" for the glare metric.
private let NEAR_WHITE: UInt8 = 250

/// The illumination grid for the shadow metric.
private let SHADOW_GRID = 8

/// Which percentile of a tile stands for "how brightly is this part of the page lit".
private let SHADOW_PERCENTILE = 0.9

/// A luminance plane and its dimensions. One byte per pixel, row-major, no padding.
struct LuminancePlane {
  var data: [UInt8]
  var width: Int
  var height: Int
}

/// Everything `CaptureMetrics.compute` measured, before the gate turns it into a verdict.
struct MeasuredMetrics {
  /// Long edge of the ORIGINAL image, before the analysis downscale — the resolution floor's input.
  var longEdgePx: Int
  var blurVariance: Double
  var glareFraction: Double
  var brightnessMean: Double
  var contrastRms: Double
  var shadowRange: Double
  /// The scale everything above was computed at, so a recorded number can be interpreted later.
  var analysisLongEdgePx: Int

  /// The shape `measure()` resolves with. Keys match `MeasuredMetrics` in `metrics.ts` exactly —
  /// the TypeScript bridge in `modules/capture-native/index.ts` reads them by name.
  var asDictionary: [String: Any] {
    [
      "longEdgePx": longEdgePx,
      "blurVariance": blurVariance,
      "glareFraction": glareFraction,
      "brightnessMean": brightnessMean,
      "contrastRms": contrastRms,
      "shadowRange": shadowRange,
      "analysisLongEdgePx": analysisLongEdgePx,
    ]
  }
}

enum CaptureMetrics {
  /// Rec.709 luma from interleaved 8-bit RGB or RGBA (`width * height * channels` bytes).
  static func toLuminance(_ rgb: [UInt8], width: Int, height: Int, channels: Int = 3) -> LuminancePlane? {
    let expected = width * height * channels
    guard width > 0, height > 0, channels >= 3, rgb.count >= expected else { return nil }
    var data = [UInt8](repeating: 0, count: width * height)
    var p = 0
    for i in 0..<data.count {
      // >> 16 rather than / 65536 so the result is an integer by construction, as in the reference.
      //
      // ⚠ `UInt8(...)` TRAPS on an out-of-range value, where the reference's write into a
      // `Uint8Array` would wrap silently. That is the safer failure of the two, but it is only safe
      // at all because the coefficients sum to exactly 65536 (13933 + 46871 + 4732), so the largest
      // possible numerator is 65536×255 + 32768 = 16744448 and 16744448 >> 16 = 255. A future edit
      // that rounds the coefficients independently would break that identity and crash the app
      // rather than drift, which is why they are written here as integers and not as products.
      data[i] = UInt8((LUMA_R * Int(rgb[p]) + LUMA_G * Int(rgb[p + 1]) + LUMA_B * Int(rgb[p + 2]) + 32768) >> 16)
      p += channels
    }
    return LuminancePlane(data: data, width: width, height: height)
  }

  /// Area-average downscale to a fixed long edge (D-SCAN1, D-SCAN5). Never upscales.
  static func boxDownscale(_ plane: LuminancePlane, targetLongEdge: Int) -> LuminancePlane {
    let longEdge = max(plane.width, plane.height)
    if longEdge <= targetLongEdge || targetLongEdge <= 0 { return plane }

    let outWidth = max(1, Int((Double(plane.width * targetLongEdge) / Double(longEdge)).rounded()))
    let outHeight = max(1, Int((Double(plane.height * targetLongEdge) / Double(longEdge)).rounded()))
    var out = [UInt8](repeating: 0, count: outWidth * outHeight)

    for oy in 0..<outHeight {
      let y0 = (oy * plane.height) / outHeight
      let y1 = max(y0 + 1, ((oy + 1) * plane.height) / outHeight)
      for ox in 0..<outWidth {
        let x0 = (ox * plane.width) / outWidth
        let x1 = max(x0 + 1, ((ox + 1) * plane.width) / outWidth)
        var sum = 0
        for y in y0..<y1 {
          let row = y * plane.width
          for x in x0..<x1 { sum += Int(plane.data[row + x]) }
        }
        let count = (y1 - y0) * (x1 - x0)
        // ⚠ `Math.round` in JS rounds a .5 tie toward +∞; Swift's `.rounded()` rounds it away from
        // zero. `sum / count` is a mean of unsigned bytes and therefore never negative, so the two
        // rules coincide over this domain. They would NOT coincide on a signed quantity, which is
        // why the Laplacian below never rounds.
        out[oy * outWidth + ox] = UInt8((Double(sum) / Double(count)).rounded())
      }
    }
    return LuminancePlane(data: out, width: outWidth, height: outHeight)
  }

  /// Variance of the SIGNED, unclamped 4-neighbour Laplacian over the interior (D-SCAN3).
  static func laplacianVariance(_ plane: LuminancePlane) -> Double {
    let width = plane.width
    let height = plane.height
    if width < 3 || height < 3 { return 0 }

    // ⚠ These accumulate in Int, not Double, where the reference has no choice but to use doubles.
    // The response is bounded by ±1020 over ≤ ~1M pixels, so `sumSquares` peaks near 10^12 — exact
    // in an Int64 and also exactly representable in a Double, so the two agree bit for bit rather
    // than merely closely. Int is used because in Swift it is the type that cannot silently lose the
    // last count if the plane ever grows.
    var sum = 0
    var sumSquares = 0
    var count = 0
    for y in 1..<(height - 1) {
      let row = y * width
      for x in 1..<(width - 1) {
        let i = row + x
        let value = Int(plane.data[i - 1]) + Int(plane.data[i + 1]) + Int(plane.data[i - width])
          + Int(plane.data[i + width]) - 4 * Int(plane.data[i])
        sum += value
        sumSquares += value * value
        count += 1
      }
    }
    let mean = Double(sum) / Double(count)
    return Double(sumSquares) / Double(count) - mean * mean
  }

  /// How unevenly the page is lit, 0..1 — the spread between the brightest and dimmest tile's 90th
  /// percentile (D-SCAN4's shadow metric).
  static func illuminationRange(_ plane: LuminancePlane) -> Double {
    let width = plane.width
    let height = plane.height
    if width == 0 || height == 0 { return 0 }

    var brightest = 0
    var dimmest = 255
    for ty in 0..<SHADOW_GRID {
      let y0 = (ty * height) / SHADOW_GRID
      let y1 = max(y0 + 1, ((ty + 1) * height) / SHADOW_GRID)
      for tx in 0..<SHADOW_GRID {
        let x0 = (tx * width) / SHADOW_GRID
        let x1 = max(x0 + 1, ((tx + 1) * width) / SHADOW_GRID)

        // A 256-bin histogram rather than a sort: exact for 8-bit data, fixed allocation, and it
        // transliterates without a comparator.
        var histogram = [Int](repeating: 0, count: 256)
        var total = 0
        for y in y0..<y1 {
          let row = y * width
          for x in x0..<x1 {
            histogram[Int(plane.data[row + x])] += 1
            total += 1
          }
        }
        if total == 0 { continue }
        let target = Int(Double(total) * SHADOW_PERCENTILE)
        var seen = 0
        var value = 0
        for v in 0..<256 {
          seen += histogram[v]
          if seen > target {
            value = v
            break
          }
        }
        if value > brightest { brightest = value }
        if value < dimmest { dimmest = value }
      }
    }
    return brightest <= dimmest ? 0 : Double(brightest - dimmest) / 255.0
  }

  /**
   Measure a decoded image. `rgb` is interleaved 8-bit, `channels` is 3 or 4.

   `analysisLongEdgePx` is a REQUIRED argument and has no default on this side on purpose. It is
   part of what the metric means (D-SCAN1) and it lives in the signed capture config, which is
   JavaScript's to hold; a Swift default would be a second copy of it, silently in force whenever the
   caller forgot — the exact shape of divergence this whole phase exists to prevent.
   */
  static func compute(
    rgb: [UInt8],
    width: Int,
    height: Int,
    analysisLongEdgePx: Int,
    channels: Int = 3
  ) -> MeasuredMetrics? {
    guard let full = toLuminance(rgb, width: width, height: height, channels: channels) else { return nil }
    let plane = boxDownscale(full, targetLongEdge: analysisLongEdgePx)

    var sum = 0
    var sumSquares = 0
    var nearWhite = 0
    for v in plane.data {
      sum += Int(v)
      sumSquares += Int(v) * Int(v)
      if v >= NEAR_WHITE { nearWhite += 1 }
    }
    let n = plane.data.isEmpty ? 1 : plane.data.count
    let mean = Double(sum) / Double(n)
    let variance = max(0, Double(sumSquares) / Double(n) - mean * mean)

    return MeasuredMetrics(
      longEdgePx: max(width, height),
      blurVariance: laplacianVariance(plane),
      glareFraction: Double(nearWhite) / Double(n),
      brightnessMean: mean / 255.0,
      contrastRms: variance.squareRoot() / 255.0,
      shadowRange: illuminationRange(plane),
      analysisLongEdgePx: max(plane.width, plane.height)
    )
  }
}
