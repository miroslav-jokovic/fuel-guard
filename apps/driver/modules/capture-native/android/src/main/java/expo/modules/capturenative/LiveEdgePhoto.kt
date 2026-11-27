package expo.modules.capturenative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileOutputStream
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The photo the capture gate took (D-LED6) and the page straightened from it — Android's
 * `ios/LiveEdgePhotoCapture.swift`.
 *
 * The ORIGINAL is the camera's JPEG exactly as CameraX wrote it. The PAGE is that photo straightened to
 * the outline the gate approved, by a perspective transform (`Matrix.setPolyToPoly`, the same mapping
 * Core Image's perspective correction makes on iOS). As on iOS, the page is what the scanner screen
 * collects and `processPages` sends through the capture pipeline. L2 refines the corners on the
 * full-resolution photo before this step (plan §4.2); until then the corners are the detector's.
 */
object LiveEdgePhoto {
  class Written(val page: File, val photoW: Int, val photoH: Int, val pageW: Int, val pageH: Int)

  /** The page is decoded at most this long on its long edge: a 12 MP original stays off the OOM path. */
  private const val MAX_DECODE_LONG_EDGE = 4096
  private const val JPEG_QUALITY = 90

  /**
   * @param corners normalised to the UPRIGHT photo (top-left origin) — the analysis frame's own
   *   coordinates, which are the photo's because both are full 4:3 sensor views (D-LED7).
   */
  fun writePage(original: File, corners: LiveQuad, pageFile: File): Written {
    val orientation = ExifInterface(original.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(original.path, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "the photo could not be decoded" }
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_DECODE_LONG_EDGE) sample *= 2
    val raw = BitmapFactory.decodeFile(original.path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: error("the photo could not be decoded")
    try {
      val turned = orientation == ExifInterface.ORIENTATION_ROTATE_90 || orientation == ExifInterface.ORIENTATION_ROTATE_270
      val uprightW = (if (turned) raw.height else raw.width).toDouble()
      val uprightH = (if (turned) raw.width else raw.height).toDouble()
      val upright = corners.mapped { Pt(it.x * uprightW, it.y * uprightH) }.points
      val pageW = max(dist(upright[0], upright[1]), dist(upright[3], upright[2])).roundToInt().coerceAtLeast(1)
      val pageH = max(dist(upright[0], upright[3]), dist(upright[1], upright[2])).roundToInt().coerceAtLeast(1)

      // Corners in the RAW bitmap's pixels: the stored pixels, before EXIF turns them upright.
      val src = corners.points.flatMap { p ->
        val r = rawFromUpright(p, orientation)
        listOf((r.x * raw.width).toFloat(), (r.y * raw.height).toFloat())
      }.toFloatArray()
      val dst = floatArrayOf(0f, 0f, pageW.toFloat(), 0f, pageW.toFloat(), pageH.toFloat(), 0f, pageH.toFloat())
      val matrix = Matrix()
      check(matrix.setPolyToPoly(src, 0, dst, 0, 4)) { "the page could not be straightened" }

      val page = Bitmap.createBitmap(pageW, pageH, Bitmap.Config.ARGB_8888)
      try {
        Canvas(page).drawBitmap(raw, matrix, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        FileOutputStream(pageFile).use { page.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
      } finally {
        page.recycle()
      }
      return Written(pageFile, (uprightW * sample).toInt(), (uprightH * sample).toInt(), pageW, pageH)
    } finally {
      raw.recycle()
    }
  }

  /**
   * A point normalised to the UPRIGHT image, to the same point normalised to the stored pixels, for an
   * EXIF orientation that turns the stored pixels clockwise to make them upright. Mirrored orientations
   * do not come from a back camera and are read as upright.
   */
  fun rawFromUpright(p: Pt, orientation: Int): Pt = when (orientation) {
    ExifInterface.ORIENTATION_ROTATE_90 -> Pt(p.y, 1 - p.x)
    ExifInterface.ORIENTATION_ROTATE_180 -> Pt(1 - p.x, 1 - p.y)
    ExifInterface.ORIENTATION_ROTATE_270 -> Pt(1 - p.y, p.x)
    else -> p
  }

  private fun dist(a: Pt, b: Pt) = hypot(a.x - b.x, a.y - b.y)
}
