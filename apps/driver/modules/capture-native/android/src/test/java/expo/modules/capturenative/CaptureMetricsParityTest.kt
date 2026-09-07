package expo.modules.capturenative

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/**
 * The Android half of D-SCAN9: hold `CaptureMetrics.kt` to `fixtures/expected.json`
 * (SCANNER-UPGRADE-PLAN.md Step 3.2).
 *
 * ── WHY THIS RUNS IN CI AND THE iOS ONE DOES NOT ──────────────────────────────────────────────
 * `CaptureMetrics.kt` imports nothing — not `android.graphics`, not Expo — so this is a plain JVM
 * test: no Robolectric, no emulator, no device. `.github/workflows/ci.yml`'s `native-android` job
 * runs it on every PR alongside `assembleDebug`. iOS gets the same comparison from
 * `modules/capture-native/tests/ios/run-metrics-parity.sh`, but by hand, because macOS runners bill
 * at roughly ten times Linux and that trade has not been made.
 *
 * ── WHAT IT DELIBERATELY DOES NOT COVER ───────────────────────────────────────────────────────
 * `CaptureImageDecode.kt` — the `BitmapFactory` path — is not exercised here, because a JVM unit
 * test has no `Bitmap`. Fixtures are read by `FixturePng`, a transliteration of the corpus's own
 * `png.mjs`, into the SAME packed-ARGB representation `Bitmap.getPixels` fills — so the arithmetic
 * sees exactly what the phone will. (`javax.imageio` is not an option: an Android library's unit
 * tests compile against `android.jar`, which ships no `javax.imageio`. That is the finding that
 * shaped this file.) Whether `BitmapFactory` hands `CaptureImageDecode` the same pixels is on the
 * device-session agenda (D-SCAN13); the digest check below is what keeps that gap narrow and
 * legible rather than assumed.
 *
 * ── THE TWO FAILURES IT KEEPS APART ───────────────────────────────────────────────────────────
 * A tolerance miss can mean "Kotlin computes the metric differently" or "Kotlin is measuring
 * different pixels". Those are unrelated bugs, so every fixture is checked in two stages: first the
 * decoded RGB is digested against the corpus's own `pixelSha256` — which `generate.mjs` computed
 * over the pixels it wrote, before any PNG existed — and only then are the numbers compared.
 *
 * ── TWO TOLERANCES, BECAUSE ONE OF THEM CANNOT SEE A TYPO ─────────────────────────────────────
 * Measured during Step 3.1 (see the plan's §8 log): the declared ±2% / ±0.002 are about four orders
 * of magnitude looser than the real noise floor, and two genuine definition errors passed at them —
 * a Rec.709 coefficient off by one, and a truncating downscale that reached 1.775% on blur. So the
 * declared tolerance is checked as the cross-platform CONTRACT, and then each deviation is checked
 * against what the baseline's own rounding can account for: half a unit in the last committed place,
 * derived from `tolerance.baselineDecimals`. iOS clears that strict bound on all 24 fixtures.
 *
 * ⚠ If Android cannot, the answer is to find out why and record it — `BitmapFactory` is a different
 * decode path from ImageIO and from CGContext, and that is a real candidate — and NEVER to widen a
 * tolerance until a run goes green. A tolerance loosened to make a test pass is a test that has
 * stopped saying anything.
 */
class CaptureMetricsParityTest {
  private val fixturesDir: File by lazy {
    val declared = System.getProperty("scanner.fixturesDir")
      ?: throw IllegalStateException(
        "scanner.fixturesDir is not set. build.gradle computes it from projectDir; running this " +
          "test outside Gradle needs -Dscanner.fixturesDir=<repo>/packages/capture-engine/fixtures",
      )
    File(declared).also {
      assertTrue("fixtures directory does not exist: ${it.absolutePath}", it.isDirectory)
    }
  }

  private val expected: JsonObject by lazy {
    JsonParser.parseString(File(fixturesDir, "expected.json").readText()).asJsonObject
  }

  @Test
  fun `reproduces the reference metric on every fixture in the corpus`() {
    val tolerance = expected.getAsJsonObject("tolerance")
    val blurRelativeTolerance = tolerance.get("blurVarianceRelative").asDouble
    val fractionTolerance = tolerance.get("fractionAbsolute").asDouble
    val baselineDecimals = tolerance.getAsJsonObject("baselineDecimals")
    // Half a unit in the last committed place: the most `expected.mjs`'s own rounding can move a
    // value. Anything beyond it is the implementation, not the file format.
    val blurExactBound = 0.5 * Math.pow(10.0, -baselineDecimals.get("blurVariance").asDouble)
    val fractionExactBound = 0.5 * Math.pow(10.0, -baselineDecimals.get("fraction").asDouble)
    val analysisLongEdgePx = expected.get("analysisLongEdgePx").asInt

    val fixtures = expected.getAsJsonArray("fixtures")
    assertTrue("the corpus is empty — expected.json was not read", fixtures.size() > 0)

    val failures = mutableListOf<String>()
    var worstBlurRelative = 0.0
    var worstBlurAbsolute = 0.0
    var worstFraction = 0.0

    for (element in fixtures) {
      val fixture = element.asJsonObject
      val name = fixture.get("name").asString
      val wantMetrics = fixture.getAsJsonObject("metrics")

      val image = try {
        FixturePng.decode(File(fixturesDir, "$name.png").readBytes())
      } catch (e: Exception) {
        failures.add("$name: DECODE could not read $name.png — ${e.message}")
        continue
      }
      if (image.width != fixture.get("width").asInt || image.height != fixture.get("height").asInt) {
        failures.add("$name: DECODE size ${image.width}x${image.height}")
        continue
      }
      val argb = image.argb

      val digest = rgbDigest(argb)
      if (digest != fixture.get("pixelSha256").asString) {
        failures.add(
          "$name: DECODE pixels differ — sha256 ${digest.take(12)}…, " +
            "expected ${fixture.get("pixelSha256").asString.take(12)}…",
        )
        continue
      }

      val measured = CaptureMetrics.compute(argb, image.width, image.height, analysisLongEdgePx)
      if (measured == null) {
        failures.add("$name: CaptureMetrics.compute returned null")
        continue
      }

      if (measured.longEdgePx != wantMetrics.get("longEdgePx").asInt) {
        failures.add("$name: longEdgePx ${measured.longEdgePx}, expected ${wantMetrics.get("longEdgePx").asInt}")
      }
      if (measured.analysisLongEdgePx != wantMetrics.get("analysisLongEdgePx").asInt) {
        failures.add(
          "$name: analysisLongEdgePx ${measured.analysisLongEdgePx}, " +
            "expected ${wantMetrics.get("analysisLongEdgePx").asInt}",
        )
      }

      val wantBlur = wantMetrics.get("blurVariance").asDouble
      val blurDelta = Math.abs(measured.blurVariance - wantBlur)
      val blurRelative = if (wantBlur == 0.0) blurDelta else blurDelta / Math.abs(wantBlur)
      worstBlurRelative = maxOf(worstBlurRelative, blurRelative)
      worstBlurAbsolute = maxOf(worstBlurAbsolute, blurDelta)
      if (!(blurRelative <= blurRelativeTolerance)) {
        failures.add("$name: blurVariance ${measured.blurVariance}, expected $wantBlur")
      } else if (!(blurDelta <= blurExactBound)) {
        failures.add(
          "$name: EXACT blurVariance ${measured.blurVariance}, expected $wantBlur " +
            "(Δ$blurDelta > $blurExactBound)",
        )
      }

      for ((metric, actual) in listOf(
        "glareFraction" to measured.glareFraction,
        "brightnessMean" to measured.brightnessMean,
        "contrastRms" to measured.contrastRms,
        "shadowRange" to measured.shadowRange,
      )) {
        val want = wantMetrics.get(metric).asDouble
        val delta = Math.abs(actual - want)
        worstFraction = maxOf(worstFraction, delta)
        // Written as `!(delta <= t)` rather than `delta > t` so a NaN — which answers false to every
        // comparison — fails instead of passing.
        if (!(delta <= fractionTolerance)) {
          failures.add("$name: $metric $actual, expected $want (Δ$delta)")
        } else if (!(delta <= fractionExactBound)) {
          failures.add("$name: EXACT $metric $actual, expected $want (Δ$delta > $fractionExactBound)")
        }
      }
    }

    // Printed on a PASS too: §6 Q3 asks whether the tolerances are right, and "everything passed"
    // does not answer it. The headroom is the measurement, and CI's log is where a future session
    // will look for it.
    println(
      "metrics-parity · Android · ${expected.get("metricsVersion").asString} / " +
        "${expected.get("corpusVersion").asString} · ${fixtures.size()} fixtures",
    )
    println("worst blur deviation:     ${worstBlurRelative * 100}% relative · $worstBlurAbsolute absolute")
    println("worst fraction deviation: $worstFraction absolute")

    assertEquals("Android does not reproduce the reference:\n" + failures.joinToString("\n"), 0, failures.size)
  }

  @Test
  fun `masks the sign bit when reading the luminance plane`() {
    // The plane is a ByteArray and Kotlin's Byte is SIGNED. A missed 0xFF mask turns everything above
    // 127 negative, and the metrics would still be numbers — plausible ones — rather than an error.
    // The corpus would catch it, but only as "every fixture is wrong", which is a worse message than
    // this one. A near-white page is the case that discriminates: every sample is above 127.
    val white = IntArray(64 * 64) { 0xFFF4F4F4.toInt() }
    val plane = CaptureMetrics.toLuminanceFromArgb(white, 64, 64)!!
    assertEquals(244, plane.at(0))
    assertEquals(244, plane.at(plane.data.size - 1))

    val measured = CaptureMetrics.compute(white, 64, 64, 1024)!!
    assertEquals(244.0 / 255.0, measured.brightnessMean, 1e-12)
    assertEquals(0.0, measured.contrastRms, 1e-12)
    // 244 is below NEAR_WHITE (250), so a uniform page at this level is not glare — which also pins
    // that the threshold is a >= on the value and not on some scaled quantity.
    assertEquals(0.0, measured.glareFraction, 1e-12)
  }

  @Test
  fun `does not upscale an image below the analysis scale`() {
    // D-SCAN1: upscaling would make the metric a measurement of the interpolator. An image under the
    // target keeps its own dimensions, and `analysisLongEdgePx` reports what was actually used — so a
    // recorded number stays interpretable rather than claiming a scale it never had.
    val small = IntArray(300 * 200) { 0xFF808080.toInt() }
    val measured = CaptureMetrics.compute(small, 300, 200, 1024)!!
    assertEquals(300, measured.longEdgePx)
    assertEquals(300, measured.analysisLongEdgePx)
  }

  /**
   * The corpus digests RAW RGB — three bytes per pixel, tightly packed — because deflate output can
   * differ across zlib versions while every pixel is unchanged. So the alpha channel is dropped
   * before hashing rather than the digest being redefined to suit the decoder.
   */
  private fun rgbDigest(argb: IntArray): String {
    val rgb = ByteArray(argb.size * 3)
    for (i in argb.indices) {
      val p = argb[i]
      rgb[i * 3] = ((p shr 16) and 0xFF).toByte()
      rgb[i * 3 + 1] = ((p shr 8) and 0xFF).toByte()
      rgb[i * 3 + 2] = (p and 0xFF).toByte()
    }
    return MessageDigest.getInstance("SHA-256").digest(rgb).joinToString("") { "%02x".format(it) }
  }
}
