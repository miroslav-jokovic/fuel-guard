package expo.modules.capturenative

/**
 * The Android transliteration of the F7 text-coverage definition
 * (SCANNER-UPGRADE-PLAN.md Step 3.3, audit defect F7, D-SCAN8/D-SCAN9).
 *
 * `packages/capture-engine/src/textCoverage.ts` is the implementation of record and explains WHAT
 * the two metrics used to be and why that was wrong; that reasoning is not copied here. This is a
 * transliteration of the arithmetic, held to `packages/capture-engine/fixtures/textBoxes.json` by
 * `CaptureTextCoverageParityTest` — in CI, on every PR — and written line for line against
 * `ios/CaptureTextCoverage.swift` so the two ports diff against each other too.
 *
 * Imports nothing, like `CaptureMetrics.kt` and for the same reason: that is what makes the parity
 * test a plain JVM one with no emulator.
 */

/**
 * One recognised text box in PIXELS, top-left origin. ML Kit's `Rect` is already in pixels with this
 * origin, so Android's conversion is the identity — but the type is stated in the shared units
 * anyway, because "the platform already agrees" is a fact about today's ML Kit and not a definition.
 */
data class TextBox(val x: Double, val y: Double, val width: Double, val height: Double)

object CaptureTextCoverage {
  /** Area covered by at least one box, in square pixels, clipped to the page. */
  fun unionArea(boxes: List<TextBox>, width: Double, height: Double): Double {
    if (width <= 0 || height <= 0) return 0.0

    val clipped = ArrayList<TextBox>(boxes.size)
    for (b in boxes) {
      val x0 = maxOf(0.0, minOf(width, b.x))
      val y0 = maxOf(0.0, minOf(height, b.y))
      val x1 = maxOf(0.0, minOf(width, b.x + b.width))
      val y1 = maxOf(0.0, minOf(height, b.y + b.height))
      if (x1 > x0 && y1 > y0) clipped.add(TextBox(x0, y0, x1 - x0, y1 - y0))
    }
    if (clipped.isEmpty()) return 0.0

    val xs = sortedDistinct(clipped.flatMap { listOf(it.x, it.x + it.width) })
    val ys = sortedDistinct(clipped.flatMap { listOf(it.y, it.y + it.height) })

    var area = 0.0
    var i = 0
    while (i + 1 < xs.size) {
      val cellX0 = xs[i]
      val cellX1 = xs[i + 1]
      var j = 0
      while (j + 1 < ys.size) {
        val cellY0 = ys[j]
        val cellY1 = ys[j + 1]
        // Membership by MIDPOINT, not by edge comparison — that is what makes touching boxes and
        // nested boxes both come out right, written identically in all three languages.
        val midX = (cellX0 + cellX1) / 2
        val midY = (cellY0 + cellY1) / 2
        for (b in clipped) {
          if (midX > b.x && midX < b.x + b.width && midY > b.y && midY < b.y + b.height) {
            area += (cellX1 - cellX0) * (cellY1 - cellY0)
            break
          }
        }
        j++
      }
      i++
    }
    return area
  }

  /** Fraction of the page covered by at least one recognised box, 0..1 (F7). */
  fun textCoverageFraction(boxes: List<TextBox>, width: Double, height: Double): Double {
    if (width <= 0 || height <= 0) return 0.0
    return unionArea(boxes, width, height) / (width * height)
  }

  /** Fraction of the page covered by the smallest-height quartile of boxes, 0..1 (F7). */
  fun smallTextBandCoverage(boxes: List<TextBox>, width: Double, height: Double): Double {
    if (boxes.isEmpty() || width <= 0 || height <= 0) return 0.0
    // Sorted by height and then by the geometry. Kotlin's `sortedWith` IS stable, unlike Swift's
    // `sorted`, so the tie break is not strictly required here — it is written anyway, because the
    // three implementations agreeing must not depend on a reader knowing which of them got stability
    // for free.
    val byHeight = boxes.sortedWith(
      compareBy({ it.height }, { it.y }, { it.x }, { it.width }),
    )
    val count = maxOf(1, byHeight.size / 4)
    val smallest = byHeight.take(count)
    return unionArea(smallest, width, height) / (width * height)
  }

  private fun sortedDistinct(values: List<Double>): List<Double> {
    val sorted = values.sorted()
    val out = ArrayList<Double>(sorted.size)
    for (v in sorted) {
      if (out.isEmpty() || out[out.size - 1] != v) out.add(v)
    }
    return out
  }
}
