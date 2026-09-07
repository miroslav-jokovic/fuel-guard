package expo.modules.capturenative

import java.util.zip.CRC32
import java.util.zip.Inflater

/**
 * A minimal 8-bit truecolour PNG reader for the parity test (plan Step 3.2).
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────────────────────────
 * The obvious choice is `javax.imageio.ImageIO`, which is what the iOS harness's equivalent
 * (`CGImageSourceCreateWithURL`) amounts to. It does not compile here: an Android library's unit
 * tests compile against `android.jar`, and Android ships no `javax.imageio`. Robolectric would drag
 * in a full Android runtime to read a PNG, which is a lot of machinery to put underneath a
 * comparison whose entire point is to be boring and deterministic.
 *
 * So the same answer the TypeScript side already reached, for the same reason its
 * `fixtures/png.mjs` header gives: sixty lines of PNG we control removes a whole class of "the
 * numbers moved and nobody touched the code". This is a transliteration of that decoder, including
 * its narrowness — colour type 2, bit depth 8, filter 0 on every scanline, no interlacing, which is
 * exactly what `generate.mjs` writes. Anything else is refused loudly rather than half-read.
 *
 * TEST SOURCE SET ONLY. It is not in the APK, and `measure()` on a device decodes through
 * `CaptureImageDecode` and `BitmapFactory`, never through this.
 */
internal object FixturePng {
  private val SIGNATURE = byteArrayOf(
    0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  )

  /** Pixels as packed opaque ARGB — the representation `Bitmap.getPixels` fills on a device. */
  data class Image(val argb: IntArray, val width: Int, val height: Int) {
    override fun equals(other: Any?): Boolean = this === other
    override fun hashCode(): Int = System.identityHashCode(this)
  }

  fun decode(bytes: ByteArray): Image {
    require(bytes.size > 8 && bytes.copyOfRange(0, 8).contentEquals(SIGNATURE)) { "not a PNG" }

    var offset = 8
    var width = 0
    var height = 0
    var sawHeader = false
    val idat = ArrayList<ByteArray>()

    while (offset + 12 <= bytes.size) {
      val length = readUInt32BE(bytes, offset)
      val type = String(bytes, offset + 4, 4, Charsets.US_ASCII)
      val data = bytes.copyOfRange(offset + 8, offset + 8 + length)

      // ⚠ `and 0xFFFFFFFFL` is load-bearing. `readUInt32BE` returns an Int, and a CRC with its top
      // bit set is a NEGATIVE Int; `CRC32.getValue()` returns the same 32 bits as a non-negative
      // Long. Comparing them without the mask sign-extends one side and fails on roughly half of all
      // chunks — which is how this was first written, and every one of the 24 fixtures was rejected
      // with "CRC mismatch in IHDR" until it was masked.
      val declared = readUInt32BE(bytes, offset + 8 + length).toLong() and 0xFFFFFFFFL
      val crc = CRC32()
      crc.update(bytes, offset + 4, 4 + length)
      require(declared == crc.value) { "CRC mismatch in $type chunk" }

      when (type) {
        "IHDR" -> {
          width = readUInt32BE(data, 0)
          height = readUInt32BE(data, 4)
          val bitDepth = data[8].toInt() and 0xFF
          val colourType = data[9].toInt() and 0xFF
          val interlace = data[12].toInt() and 0xFF
          require(bitDepth == 8) { "bit depth $bitDepth unsupported" }
          require(colourType == 2) { "colour type $colourType unsupported" }
          require(interlace == 0) { "interlaced PNGs unsupported" }
          sawHeader = true
        }
        "IDAT" -> idat.add(data)
        "IEND" -> { offset = bytes.size }
      }
      if (type == "IEND") break
      offset += 12 + length
    }
    require(sawHeader) { "no IHDR chunk" }

    val raw = inflate(idat)
    val stride = 1 + width * 3
    require(raw.size == height * stride) { "expected ${height * stride} raw bytes, received ${raw.size}" }

    val argb = IntArray(width * height)
    for (y in 0 until height) {
      val filter = raw[y * stride].toInt() and 0xFF
      // The corpus writes filter 0 on every scanline. Refusing the other four rather than
      // implementing them is deliberate: an untested Paeth reconstruction that is subtly wrong would
      // fail this comparison as an arithmetic disagreement, which is the one message it must never
      // produce for a reason that has nothing to do with the arithmetic.
      require(filter == 0) { "filter type $filter on row $y unsupported" }
      var p = y * stride + 1
      var i = y * width
      for (x in 0 until width) {
        val r = raw[p].toInt() and 0xFF
        val g = raw[p + 1].toInt() and 0xFF
        val b = raw[p + 2].toInt() and 0xFF
        argb[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        p += 3
        i++
      }
    }
    return Image(argb, width, height)
  }

  private fun inflate(parts: List<ByteArray>): ByteArray {
    val compressed = ByteArray(parts.sumOf { it.size }).also { out ->
      var at = 0
      for (part in parts) {
        part.copyInto(out, at)
        at += part.size
      }
    }
    val inflater = Inflater()
    inflater.setInput(compressed)
    val out = java.io.ByteArrayOutputStream(compressed.size * 4)
    val buffer = ByteArray(64 * 1024)
    try {
      while (!inflater.finished()) {
        val n = inflater.inflate(buffer)
        if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) break
        out.write(buffer, 0, n)
      }
    } finally {
      inflater.end()
    }
    return out.toByteArray()
  }

  private fun readUInt32BE(bytes: ByteArray, at: Int): Int =
    ((bytes[at].toInt() and 0xFF) shl 24) or
      ((bytes[at + 1].toInt() and 0xFF) shl 16) or
      ((bytes[at + 2].toInt() and 0xFF) shl 8) or
      (bytes[at + 3].toInt() and 0xFF)
}
