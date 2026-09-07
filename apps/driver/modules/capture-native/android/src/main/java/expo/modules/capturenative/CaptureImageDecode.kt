package expo.modules.capturenative

import android.graphics.Bitmap
import android.graphics.BitmapFactory

/**
 * Decoding, separated from arithmetic (SCANNER-UPGRADE-PLAN.md Step 3.2).
 *
 * `CaptureMetrics.kt` must stay importable by a plain JVM unit test — no Robolectric, no device — so
 * everything that needs `android.graphics` is here instead. That is the whole reason Android's parity
 * check can run in CI on every PR while the iOS one is manual.
 *
 * ── ⚠ DEVIATION FROM THE STEP TEXT: NO `inSampleSize` ─────────────────────────────────────────
 * Step 3.2 says "`inSampleSize` for the initial decode", and `processPage` below does exactly that,
 * correctly, because its job is to produce a bounded derivative. `measure()`'s job is the opposite,
 * and subsampling would break it two ways:
 *
 *   1. `longEdgePx` is the resolution floor's input — a question about what the CAMERA captured.
 *      Answered from a subsampled decode it would be a question about our own decoder, which is the
 *      circularity D-SCAN1 and `webFileProvider`'s comment both warn about.
 *   2. Box averaging (D-SCAN5) from a half-size plane is NOT the same arithmetic as box averaging
 *      from the full one — the output footprints no longer line up with the input grid — so the
 *      metric would stop being the metric, by a small amount, on Android only. `expected.json` would
 *      then be failed by a correct implementation, and the natural response to that is to widen a
 *      tolerance, which is the one move the plan forbids.
 *
 * So `measure()` decodes at full resolution and pays for it, bounded by MAX_PIXELS and recycled
 * immediately. In practice it is measuring a page the scanner already produced at 1568 px, which is
 * about 13 MB in ARGB_8888 — the same order as what `processPage` already allocates once per page,
 * and one image at a time rather than ten.
 *
 * ── ⚠ EXIF ───────────────────────────────────────────────────────────────────────────────────
 * `BitmapFactory` applies no EXIF rotation, and iOS's `CGImage` is likewise the unrotated buffer
 * (`UIImage` carries orientation separately). So the two platforms agree. Every metric here is in
 * any case invariant under a quarter turn — the shadow grid permutes its tiles and reports the same
 * spread, and a box downscale of a transposed plane is the transpose of the downscale — but the two
 * agreeing by construction is worth more than the two agreeing by argument.
 */
object CaptureImageDecode {
  /**
   * A hard cap so a corrupt or hostile header cannot ask for a multi-gigabyte allocation on a phone.
   * 100 MP is roughly four times the largest sensor in any fleet handset, and the OS scanner's own
   * output is far below it, so this refuses only images that should be refused. Same number as iOS.
   */
  private const val MAX_PIXELS = 100_000_000

  /** One decoded image as packed ARGB — the layout `CaptureMetrics.compute` expects. */
  data class Decoded(val argb: IntArray, val width: Int, val height: Int) {
    override fun equals(other: Any?): Boolean = this === other
    override fun hashCode(): Int = System.identityHashCode(this)
  }

  fun decodeFile(path: String): Decoded? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    if (bounds.outWidth.toLong() * bounds.outHeight.toLong() > MAX_PIXELS) return null

    val bitmap = BitmapFactory.decodeFile(
      path,
      // ARGB_8888 explicitly rather than by default: RGB_565 halves the memory and quantises the
      // green channel to 6 bits, which would move every metric by a visible amount and only on
      // Android. A device or a future platform default that preferred 565 would otherwise change the
      // numbers with nobody editing a line.
      BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 },
    ) ?: return null

    return try {
      val argb = IntArray(bitmap.width * bitmap.height)
      bitmap.getPixels(argb, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
      Decoded(argb, bitmap.width, bitmap.height)
    } finally {
      // Freed here rather than left to the collector, for the reason Step 1.4 closed two OOM paths
      // in this module: the IntArray is already a full copy, so holding the Bitmap as well doubles
      // the peak for no benefit.
      bitmap.recycle()
    }
  }
}
