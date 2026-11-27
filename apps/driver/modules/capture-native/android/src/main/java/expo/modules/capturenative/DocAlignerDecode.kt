package expo.modules.capturenative

import kotlin.math.atan2
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * DocAligner's pre- and post-processing on the phone (LIVE-EDGE-DETECTION-PLAN.md L4): the Kotlin
 * transliteration of `packages/capture-engine/src/edges/docalignerDecode.ts`, which is the reference.
 * `DocAlignerDecodeParityTest` holds this file to it over `fixtures/edges/docaligner-decode.json` — real
 * model heatmaps and edge cases, answers compared exactly. Pure Kotlin, so the test is a JVM test in CI.
 *
 * Two things differ from the reference in HOW, never in WHAT, and the parity test is what says so:
 *   - `input` reads a camera buffer in sensor orientation and rotates while it samples, so the model sees
 *     the page upright (as the reference's caller hands it an upright image) without a rotated copy;
 *   - `corner` only visits the pixels that sample a heatmap cell at or above the threshold. Every other
 *     pixel is a blend of four cells below it, so it is below it too and quantises to 0 — it is counted
 *     into the histogram's zero bin, exactly as the reference counts it, without being computed.
 */
object DocAlignerDecode {
  const val SIZE = 256
  const val HEAT = 128
  const val THRESHOLD = 0.3

  /**
   * The model input: the UPRIGHT frame stretched to 256 × 256 (bilinear, pixel centres), B G R per pixel,
   * ÷ 255, written NHWC into `out` (256 × 256 × 3).
   *
   * @param rgba the camera buffer as CameraX hands it (`OUTPUT_IMAGE_FORMAT_RGBA_8888`), sensor orientation.
   * @param rotation the clockwise degrees that make the buffer upright (`ImageInfo.rotationDegrees`).
   */
  fun input(rgba: ByteArray, srcW: Int, srcH: Int, rowStride: Int, rotation: Int, out: FloatArray) {
    require(out.size >= SIZE * SIZE * 3) { "input needs a 256 × 256 × 3 buffer" }
    val turned = rotation == 90 || rotation == 270
    val w = if (turned) srcH else srcW
    val h = if (turned) srcW else srcH
    val sx = w.toDouble() / SIZE
    val sy = h.toDouble() / SIZE
    // Upright (ux, uy) to the buffer's byte offset, for a clockwise turn of `rotation`.
    fun at(ux: Int, uy: Int): Int = when (rotation) {
      90 -> (srcH - 1 - ux) * rowStride + uy * 4
      180 -> (srcH - 1 - uy) * rowStride + (srcW - 1 - ux) * 4
      270 -> ux * rowStride + (srcW - 1 - uy) * 4
      else -> uy * rowStride + ux * 4
    }
    for (y in 0 until SIZE) {
      val fy = min((h - 1).toDouble(), max(0.0, (y + 0.5) * sy - 0.5))
      val y0 = floor(fy).toInt()
      val y1 = min(h - 1, y0 + 1)
      val dy = fy - y0
      for (x in 0 until SIZE) {
        val fx = min((w - 1).toDouble(), max(0.0, (x + 0.5) * sx - 0.5))
        val x0 = floor(fx).toInt()
        val x1 = min(w - 1, x0 + 1)
        val dx = fx - x0
        val a = at(x0, y0)
        val b = at(x1, y0)
        val c = at(x0, y1)
        val d = at(x1, y1)
        for (ch in 0 until 3) {
          val top = (rgba[a + ch].toInt() and 0xFF) * (1 - dx) + (rgba[b + ch].toInt() and 0xFF) * dx
          val bottom = (rgba[c + ch].toInt() and 0xFF) * (1 - dx) + (rgba[d + ch].toInt() and 0xFF) * dx
          // RGB in, BGR out: the pixel's first value is blue.
          out[(y * SIZE + x) * 3 + (2 - ch)] = ((top * (1 - dy) + bottom * dy) / 255).toFloat()
        }
      }
    }
  }

  /** One heatmap channel read at (x, y) of its w × h grid. */
  fun interface Plane {
    fun at(x: Int, y: Int): Float
  }

  /** One corner from one channel, in the W × H upright frame's pixels; null when the channel has none. */
  fun corner(plane: Plane, w: Int, h: Int, W: Int, H: Int): Pt? {
    // The cells at or above the threshold, as a box. None means every pixel quantises to 0.
    var cx0 = w
    var cx1 = -1
    var cy0 = h
    var cy1 = -1
    for (cy in 0 until h) for (cx in 0 until w) {
      if (plane.at(cx, cy) >= THRESHOLD) {
        cx0 = min(cx0, cx); cx1 = max(cx1, cx); cy0 = min(cy0, cy); cy1 = max(cy1, cy)
      }
    }
    if (cx1 < 0) return null // every value under the threshold: an all-zero histogram, as the reference finds

    // The pixel columns and rows whose sampled cells can touch that box (x1 = x0 + 1, so x0 ≥ cx0 − 1).
    fun span(n: Int, cells: Int, lo: Int, hi: Int): IntArray? {
      var first = -1
      var last = -1
      for (p in 0 until n) {
        val f = min((cells - 1).toDouble(), max(0.0, ((p + 0.5) * cells) / n - 0.5))
        val c0 = floor(f).toInt()
        if (c0 >= lo - 1 && c0 <= hi) {
          if (first < 0) first = p
          last = p
        }
      }
      return if (first < 0) null else intArrayOf(first, last)
    }
    val xs = span(W, w, cx0, cx1) ?: return null
    val ys = span(H, h, cy0, cy1) ?: return null
    val rw = xs[1] - xs[0] + 1
    val rh = ys[1] - ys[0] + 1

    val q = IntArray(rw * rh)
    val hist = DoubleArray(256)
    hist[0] = (W.toLong() * H - rw.toLong() * rh).toDouble()
    for (ry in 0 until rh) {
      val y = ys[0] + ry
      val fy = min((h - 1).toDouble(), max(0.0, ((y + 0.5) * h) / H - 0.5))
      val y0 = floor(fy).toInt()
      val y1 = min(h - 1, y0 + 1)
      val dy = fy - y0
      for (rx in 0 until rw) {
        val x = xs[0] + rx
        val fx = min((w - 1).toDouble(), max(0.0, ((x + 0.5) * w) / W - 0.5))
        val x0 = floor(fx).toInt()
        val x1 = min(w - 1, x0 + 1)
        val dx = fx - x0
        val v = (plane.at(x0, y0) * (1 - dx) + plane.at(x1, y0) * dx) * (1 - dy) +
          (plane.at(x0, y1) * (1 - dx) + plane.at(x1, y1) * dx) * dy
        val b = if (v < THRESHOLD) 0 else max(0, min(255, (v * 255).toInt()))
        q[ry * rw + rx] = b
        hist[b] += 1.0
      }
    }
    val split = otsuThreshold(hist, W.toDouble() * H) ?: return null

    // Largest 8-connected blob above the split, and its centroid (raster order kept, so ties resolve as
    // the reference resolves them: the first blob found wins).
    val seen = BooleanArray(rw * rh)
    val stack = IntArray(rw * rh)
    var bestN = 0L
    var bestSx = 0L
    var bestSy = 0L
    for (i in 0 until rw * rh) {
      if (seen[i] || q[i] <= split) continue
      var n = 0L
      var sx = 0L
      var sy = 0L
      var top = 0
      seen[i] = true
      stack[top++] = i
      while (top > 0) {
        val j = stack[--top]
        val rx = j % rw
        val ry = j / rw
        n++; sx += xs[0] + rx; sy += ys[0] + ry
        for (ny in max(0, ry - 1)..min(rh - 1, ry + 1)) for (nx in max(0, rx - 1)..min(rw - 1, rx + 1)) {
          val k = ny * rw + nx
          if (!seen[k] && q[k] > split) {
            seen[k] = true
            stack[top++] = k
          }
        }
      }
      if (n > bestN) { bestN = n; bestSx = sx; bestSy = sy }
    }
    return if (bestN > 0) Pt(bestSx.toDouble() / bestN + 0.5, bestSy.toDouble() / bestN + 0.5) else null
  }

  /** All four corners in reading order (TL, TR, BR, BL), or null unless every channel has one. */
  fun quad(planes: List<Plane>, w: Int, h: Int, W: Int, H: Int): LiveQuad? {
    val corners = planes.take(4).map { corner(it, w, h, W, H) ?: return null }
    return if (corners.size == 4) readingOrder(corners) else null
  }

  /** `findDocument.ts`'s `otsuThreshold`, returning only the threshold (the separation is unused here). */
  fun otsuThreshold(hist: DoubleArray, total: Double): Int? {
    var sum = 0.0
    var sumSq = 0.0
    for (v in hist.indices) {
      sum += v * hist[v]
      sumSq += v.toDouble() * v * hist[v]
    }
    val mean = sum / total
    if (sumSq / total - mean * mean <= 0) return null
    var best = -1.0
    var threshold = 0
    var weightB = 0.0
    var sumB = 0.0
    for (t in 0 until hist.size - 1) {
      weightB += hist[t]
      if (weightB == 0.0) continue
      val weightF = total - weightB
      if (weightF == 0.0) break
      sumB += t * hist[t]
      val meanB = sumB / weightB
      val meanF = (sum - sumB) / weightF
      val d = meanB - meanF
      val between = (weightB / total) * (weightF / total) * (d * d)
      if (between > best) {
        best = between
        threshold = t
      }
    }
    return threshold
  }

  /** `findDocument.ts`'s `readingOrder`: top-left first, then clockwise on screen (y grows downward). */
  fun readingOrder(p: List<Pt>): LiveQuad {
    val cx = p.sumOf { it.x } / 4
    val cy = p.sumOf { it.y } / 4
    val clockwise = p.sortedBy { atan2(it.y - cy, it.x - cx) }
    var first = 0
    for (i in 1 until 4) if (clockwise[i].x + clockwise[i].y < clockwise[first].x + clockwise[first].y) first = i
    return LiveQuad.of((0 until 4).map { clockwise[(first + it) % 4] })
  }
}
