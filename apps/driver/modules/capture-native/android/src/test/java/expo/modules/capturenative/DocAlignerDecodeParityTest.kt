package expo.modules.capturenative

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Base64
import java.util.zip.GZIPInputStream

/**
 * `DocAlignerDecode.kt` against the reference (`packages/capture-engine/src/edges/docalignerDecode.ts`),
 * over `packages/capture-engine/fixtures/edges/docaligner-decode.json`: real model heatmaps from five
 * SmartDoc backgrounds, synthetic edge cases, and the model input. Corners must match to 1e-9 px — the
 * same arithmetic in the same order gives the same doubles; anything looser would hide a real
 * difference in how a pixel is rounded.
 */
class DocAlignerDecodeParityTest {
  private val fixture: JsonObject by lazy {
    val dir = System.getProperty("scanner.fixturesDir") ?: error("scanner.fixturesDir is not set (build.gradle)")
    JsonParser.parseString(File(dir, "edges/docaligner-decode.json").readText()).asJsonObject
  }

  private fun assertQuad(name: String, expected: JsonObject, actual: LiveQuad?) {
    val quad = expected.get("quad")
    if (quad.isJsonNull) {
      assertNull("$name ${expected.get("W")}×${expected.get("H")}", actual)
      return
    }
    requireNotNull(actual) { "$name ${expected.get("W")}×${expected.get("H")}: no quad, the reference found one" }
    quad.asJsonArray.forEachIndexed { i, p ->
      val o = p.asJsonObject
      assertEquals("$name corner $i x", o.get("x").asDouble, actual.points[i].x, 1e-9)
      assertEquals("$name corner $i y", o.get("y").asDouble, actual.points[i].y, 1e-9)
    }
  }

  @Test
  fun `real heatmaps decode to the reference's corners at both frame sizes`() {
    val real = fixture.getAsJsonArray("real")
    assertTrue(real.size() >= 5)
    for (r in real) {
      val o = r.asJsonObject
      val half = GZIPInputStream(Base64.getDecoder().decode(o.get("heatmapF16").asString).inputStream()).readBytes()
      val values = FloatArray(half.size / 2) { i -> halfToFloat((half[2 * i].toInt() and 0xFF) or ((half[2 * i + 1].toInt() and 0xFF) shl 8)) }
      val planes = (0 until 4).map { c -> DocAlignerDecode.Plane { x, y -> values[c * 128 * 128 + y * 128 + x] } }
      for (e in o.getAsJsonArray("expected")) {
        val ex = e.asJsonObject
        assertQuad(o.get("name").asString, ex, DocAlignerDecode.quad(planes, 128, 128, ex.get("W").asInt, ex.get("H").asInt))
      }
    }
  }

  @Test
  fun `synthetic edge cases decode as the reference decodes them`() {
    for (s in fixture.getAsJsonArray("synthetic")) {
      val o = s.asJsonObject
      val blobs = o.getAsJsonArray("blobs").map { it.asJsonObject }
      // `docalignerFixture.ts`'s syntheticHeatmap, with the same + − × ÷ and one rounding to float32.
      val planes = (0 until 4).map { ch ->
        DocAlignerDecode.Plane { x, y ->
          var v = 0.0
          for (b in blobs) {
            if (b.get("channel").asInt != ch) continue
            val dx = x - b.get("cx").asDouble
            val dy = y - b.get("cy").asDouble
            val r = b.get("r").asDouble
            val k = b.get("peak").asDouble * (1 - (dx * dx + dy * dy) / (r * r))
            if (k > v) v = k
          }
          v.toFloat()
        }
      }
      for (e in o.getAsJsonArray("expected")) {
        val ex = e.asJsonObject
        assertQuad(o.get("name").asString, ex, DocAlignerDecode.quad(planes, 128, 128, ex.get("W").asInt, ex.get("H").asInt))
      }
    }
  }

  @Test
  fun `the model input matches the reference at every camera rotation`() {
    val want = fixture.getAsJsonObject("input")
    val wantSum = want.get("sum").asDouble
    val wantHead = want.getAsJsonArray("head").map { it.asDouble }
    // `docalignerFixture.ts`'s decodeFixtureInput: the UPRIGHT image, as RGBA.
    var img = Rgba(37, 23) { x, y, c -> (x * 7 + y * 13 + c * 29 + x * y) % 256 }
    for (rotation in listOf(0, 90, 180, 270)) {
      // The camera's buffer is the upright image turned BACK: turning it clockwise by `rotation` gives
      // the upright one. Built by quarter turns clockwise (4 − rotation/90 of them), independently of
      // the decoder's own index arithmetic. A padded row stride, as real camera buffers have.
      var buffer = img
      repeat((4 - rotation / 90) % 4) { buffer = buffer.turnedClockwise() }
      val out = FloatArray(256 * 256 * 3)
      DocAlignerDecode.input(buffer.bytes(stride = buffer.w * 4 + 12), buffer.w, buffer.h, buffer.w * 4 + 12, rotation, out)
      var sum = 0.0
      for (v in out) sum += v
      assertEquals("sum at $rotation°", wantSum, sum, 0.0)
      wantHead.forEachIndexed { i, v -> assertEquals("value $i at $rotation°", v, out[i].toDouble(), 0.0) }
    }
  }

  /** IEEE 754 binary16 → binary32, exactly (every half is representable as a float). */
  private fun halfToFloat(h: Int): Float {
    val sign = (h ushr 15) and 1
    val exp = (h ushr 10) and 0x1F
    val mant = h and 0x3FF
    val magnitude = when (exp) {
      0 -> mant / 1024.0 * Math.pow(2.0, -14.0)
      0x1F -> if (mant == 0) Double.POSITIVE_INFINITY else Double.NaN
      else -> (1 + mant / 1024.0) * Math.pow(2.0, (exp - 15).toDouble())
    }
    return (if (sign == 1) -magnitude else magnitude).toFloat()
  }

  /** A tiny RGBA image for the rotation check. */
  private class Rgba(val w: Int, val h: Int, val px: (Int, Int, Int) -> Int) {
    fun turnedClockwise(): Rgba = Rgba(h, w) { x, y, c -> px(y, h - 1 - x, c) }
    fun bytes(stride: Int): ByteArray {
      val b = ByteArray(stride * h)
      for (y in 0 until h) for (x in 0 until w) {
        for (c in 0 until 3) b[y * stride + x * 4 + c] = px(x, y, c).toByte()
        b[y * stride + x * 4 + 3] = 0xFF.toByte()
      }
      return b
    }
  }
}
