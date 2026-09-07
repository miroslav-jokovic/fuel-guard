package expo.modules.capturenative

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The Android half of F7's parity: `CaptureTextCoverage.kt` against `fixtures/textBoxes.json`
 * (SCANNER-UPGRADE-PLAN.md Step 3.3, audit defect F7, D-SCAN9).
 *
 * A rectangle-union is exactly the kind of small geometric routine two people write two different
 * ways without either looking wrong on review, so it gets a baseline rather than a reading. The
 * twelve cases each name the mistake they exist to catch — overlap counted twice, a nested box
 * counted at all, a shared edge counted, the gap between two boxes filled in, a box hanging off the
 * page not clipped — and the file records what the implementation F7 REPLACED would have answered,
 * so a reviewer can see per case whether it discriminates.
 *
 * Runs in CI on every PR, like `CaptureMetricsParityTest` and for the same reason: nothing in
 * `CaptureTextCoverage.kt` imports anything.
 */
class CaptureTextCoverageParityTest {
  private val baseline: JsonObject by lazy {
    val dir = System.getProperty("scanner.fixturesDir")
      ?: throw IllegalStateException("scanner.fixturesDir is not set; build.gradle computes it from projectDir")
    JsonParser.parseString(File(dir, "textBoxes.json").readText()).asJsonObject
  }

  @Test
  fun `reproduces the F7 reference on every box corpus case`() {
    val width = baseline.get("width").asDouble
    val height = baseline.get("height").asDouble
    val tolerance = baseline.getAsJsonObject("tolerance").get("fractionAbsolute").asDouble
    val cases = baseline.getAsJsonArray("cases")
    assertTrue("the F7 corpus is empty — textBoxes.json was not read", cases.size() > 0)

    val failures = mutableListOf<String>()
    var worst = 0.0

    for (element in cases) {
      val testCase = element.asJsonObject
      val name = testCase.get("name").asString
      val boxes = testCase.getAsJsonArray("boxes").map {
        val b = it.asJsonObject
        TextBox(b.get("x").asDouble, b.get("y").asDouble, b.get("width").asDouble, b.get("height").asDouble)
      }

      // Area is in square pixels and every fixture coordinate is an integer, so the union is an
      // integer too — compared exactly, because there is no rounding here for a tolerance to absorb
      // and a near-miss would be a real disagreement rather than a representation artefact.
      val union = CaptureTextCoverage.unionArea(boxes, width, height)
      val wantUnion = testCase.get("unionAreaPx").asDouble
      if (union != wantUnion) failures.add("$name: unionAreaPx $union, expected $wantUnion")

      for ((metric, actual, want) in listOf(
        Triple(
          "textCoverageFraction",
          CaptureTextCoverage.textCoverageFraction(boxes, width, height),
          testCase.get("textCoverageFraction").asDouble,
        ),
        Triple(
          "smallTextBandCoverage",
          CaptureTextCoverage.smallTextBandCoverage(boxes, width, height),
          testCase.get("smallTextBandCoverage").asDouble,
        ),
      )) {
        val delta = Math.abs(actual - want)
        worst = maxOf(worst, delta)
        // `!(delta <= t)` rather than `delta > t` so a NaN fails instead of passing.
        if (!(delta <= tolerance)) failures.add("$name: $metric $actual, expected $want (Δ$delta)")
      }
    }

    println(
      "F7 text coverage · Android · ${baseline.get("textCoverageVersion").asString} · " +
        "${cases.size()} cases · worst deviation $worst (tolerance $tolerance)",
    )
    assertEquals("Android does not reproduce the F7 reference:\n" + failures.joinToString("\n"), 0, failures.size)
  }

  @Test
  fun `counts overlapping area once, where the summing version counted it twice`() {
    // The defect in one assertion, stated here as well as in the corpus so a reader of this file
    // alone can see what changed. Two 200x200 boxes overlapping in a 100x100 square: 70,000 px of
    // union against 80,000 px of summed area.
    val boxes = listOf(TextBox(100.0, 100.0, 200.0, 200.0), TextBox(200.0, 200.0, 200.0, 200.0))
    assertEquals(70_000.0, CaptureTextCoverage.unionArea(boxes, 1000.0, 1000.0), 1e-9)
    assertEquals(80_000.0, boxes.sumOf { it.width * it.height }, 1e-9)
  }

  @Test
  fun `never exceeds the page, however far a box hangs off it`() {
    // Real OCR emits boxes a pixel or two outside the frame. Without clipping the "fraction" passes
    // 1, which is the same failure the summing version had, by a different route.
    val boxes = listOf(TextBox(-5000.0, -5000.0, 20_000.0, 20_000.0))
    assertEquals(1.0, CaptureTextCoverage.textCoverageFraction(boxes, 1000.0, 1000.0), 1e-12)
  }

  @Test
  fun `breaks height ties by geometry, so the quartile does not depend on the sort`() {
    // Kotlin's sortedWith IS stable and Swift's sorted is NOT, so a comparator that treated equal
    // heights as equal would let the two platforms select different boxes and still both look right
    // on their own. Reversing the input must not move the answer.
    val boxes = (0 until 8).map { TextBox(it * 100.0, 0.0, 50.0, 30.0) }
    assertEquals(
      CaptureTextCoverage.smallTextBandCoverage(boxes, 1000.0, 1000.0),
      CaptureTextCoverage.smallTextBandCoverage(boxes.reversed(), 1000.0, 1000.0),
      1e-12,
    )
  }
}
