package expo.modules.capturenative

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

// Live edge detection — the arithmetic, with no camera in it (LIVE-EDGE-DETECTION-PLAN.md, step L4).
//
// A line-for-line port of `ios/LiveEdgeGeometry.swift`, so the outline behaves the same on both phones.
// It imports nothing from Android, so `LiveEdgeGeometryTest` runs it as a plain JVM test in CI's
// `native-android` job — which the Swift half does not get (no iOS job, plan §3.4). The camera view owns
// the I/O (CameraX, sensors, drawing) and calls in here for every number it acts on.
//
// ⚠ The starting values are other people's measured defaults (each names its source, plan §2a), not
// ours — the same constants as the Swift file. A change to either side must be made to both until L3
// holds them to one signed configuration.

/** A point in whatever units the caller chose (normalised, frame pixels or view pixels). */
data class Pt(val x: Double, val y: Double)

/** Four corners, top-left first, clockwise — the order `capture-engine`'s `homography.ts` uses. */
data class LiveQuad(val topLeft: Pt, val topRight: Pt, val bottomRight: Pt, val bottomLeft: Pt) {
  val points: List<Pt> get() = listOf(topLeft, topRight, bottomRight, bottomLeft)

  fun mapped(f: (Pt) -> Pt): LiveQuad = of(points.map(f))

  /** Shoelace area. Positive for the clockwise-on-screen order this type promises (y grows downward). */
  val signedArea: Double
    get() {
      val p = points
      var sum = 0.0
      for (i in 0 until 4) {
        val a = p[i]
        val b = p[(i + 1) % 4]
        sum += a.x * b.y - b.x * a.y
      }
      return sum / 2
    }

  val area: Double get() = abs(signedArea)

  val flattened: DoubleArray get() = points.flatMap { listOf(it.x, it.y) }.toDoubleArray()

  companion object {
    fun of(p: List<Pt>): LiveQuad {
      require(p.size == 4) { "a LiveQuad has four corners" }
      return LiveQuad(p[0], p[1], p[2], p[3])
    }

    fun fromFlattened(v: DoubleArray): LiveQuad {
      require(v.size == 8) { "a flattened LiveQuad has eight values" }
      return of((0 until 4).map { Pt(v[2 * it], v[2 * it + 1]) })
    }
  }
}

object LiveEdgeMapping {
  /**
   * A point in the image (normalised, top-left origin) to the preview's coordinates, for a preview drawn
   * aspect-FILL (`PreviewView.ScaleType.FILL_CENTER`): the image covers the view and the overflow is
   * cropped equally from both sides. A point in the cropped part maps outside the view, which is right —
   * the outline then runs off the screen exactly where the paper does.
   */
  fun aspectFill(p: Pt, imageW: Double, imageH: Double, viewW: Double, viewH: Double): Pt {
    if (imageW <= 0 || imageH <= 0) return Pt(0.0, 0.0)
    val scale = max(viewW / imageW, viewH / imageH)
    val drawnW = imageW * scale
    val drawnH = imageH * scale
    return Pt((viewW - drawnW) / 2 + p.x * drawnW, (viewH - drawnH) / 2 + p.y * drawnH)
  }
}

enum class LiveQuadValidity { OK, TOO_SMALL, NOT_CONVEX, CORNER_SKEWED }

object LiveQuadValidator {
  /** `findDocument.ts`'s MIN_AREA and MAX_CORNER_SKEW, restated as the Swift file restates them. */
  const val MIN_AREA_FRACTION = 0.12
  const val MAX_CORNER_SKEW_DEGREES = 40.0

  /** `quad` in IMAGE pixels (not normalised — angles mean something only at the image's own aspect). */
  fun check(quad: LiveQuad, imageW: Double, imageH: Double): LiveQuadValidity {
    val frameArea = imageW * imageH
    if (frameArea <= 0 || quad.area < MIN_AREA_FRACTION * frameArea) return LiveQuadValidity.TOO_SMALL
    val p = quad.points
    var sign = 0.0
    for (i in 0 until 4) {
      val a = p[(i + 3) % 4]
      val b = p[i]
      val c = p[(i + 1) % 4]
      val cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      if (cross == 0.0) return LiveQuadValidity.NOT_CONVEX
      val s = if (cross > 0) 1.0 else -1.0
      if (sign == 0.0) sign = s else if (s != sign) return LiveQuadValidity.NOT_CONVEX
      if (abs(cornerAngleDegrees(a, b, c) - 90) > MAX_CORNER_SKEW_DEGREES) return LiveQuadValidity.CORNER_SKEWED
    }
    return LiveQuadValidity.OK
  }

  /** The interior angle at `b` between `b→a` and `b→c`. */
  fun cornerAngleDegrees(a: Pt, b: Pt, c: Pt): Double {
    val ux = a.x - b.x
    val uy = a.y - b.y
    val vx = c.x - b.x
    val vy = c.y - b.y
    val lu = hypot(ux, uy)
    val lv = hypot(vx, vy)
    if (lu <= 0 || lv <= 0) return 0.0
    val cosine = max(-1.0, min(1.0, (ux * vx + uy * vy) / (lu * lv)))
    return Math.toDegrees(acos(cosine))
  }
}

object LiveQuadOverlap {
  /**
   * Intersection-over-union of two CONVEX quads (the validator refuses every other kind), by clipping
   * one against the other (Sutherland–Hodgman). Tells "the same sheet, moved" from "a different sheet".
   */
  fun iou(a: LiveQuad, b: LiveQuad): Double {
    val inter = polygonArea(clip(a.points, oriented(b.points)))
    val union = a.area + b.area - inter
    return if (union > 0) inter / union else 0.0
  }

  private fun oriented(p: List<Pt>): List<Pt> = if (LiveQuad.of(p).signedArea >= 0) p else p.reversed()

  private fun clip(subject: List<Pt>, clipper: List<Pt>): List<Pt> {
    var output = subject
    for (i in clipper.indices) {
      if (output.isEmpty()) break
      val a = clipper[i]
      val b = clipper[(i + 1) % clipper.size]
      fun side(p: Pt) = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
      fun cut(p: Pt, q: Pt): Pt {
        val d1 = side(p)
        val t = d1 / (d1 - side(q))
        return Pt(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t)
      }
      val input = output
      val next = ArrayList<Pt>()
      for (j in input.indices) {
        val p = input[j]
        val q = input[(j + 1) % input.size]
        if (side(q) >= 0) {
          if (side(p) < 0) next.add(cut(p, q))
          next.add(q)
        } else if (side(p) >= 0) {
          next.add(cut(p, q))
        }
      }
      output = next
    }
    return output
  }

  private fun polygonArea(p: List<Pt>): Double {
    if (p.size < 3) return 0.0
    var sum = 0.0
    for (i in p.indices) {
      val a = p[i]
      val b = p[(i + 1) % p.size]
      sum += a.x * b.y - b.x * a.y
    }
    return abs(sum) / 2
  }
}

/**
 * The One Euro filter (Casiez, Roussel, Vogel, CHI 2012): a low-pass whose cutoff rises with speed —
 * heavy smoothing while the phone is still (no shiver), light while it moves (no trailing).
 */
class OneEuroFilter(val minCutoff: Double, val beta: Double, val derivativeCutoff: Double = 1.0) {
  private var lastValue: Double? = null
  private var lastDerivative = 0.0
  private var lastTime: Double? = null

  fun filter(value: Double, time: Double): Double {
    val previous = lastValue
    val previousTime = lastTime
    if (previous == null || previousTime == null || time <= previousTime) {
      lastValue = value
      lastTime = time
      return value
    }
    val dt = time - previousTime
    val derivative = (value - previous) / dt
    val aD = alpha(derivativeCutoff, dt)
    lastDerivative = aD * derivative + (1 - aD) * lastDerivative
    val a = alpha(minCutoff + beta * abs(lastDerivative), dt)
    val smoothed = a * value + (1 - a) * previous
    lastValue = smoothed
    lastTime = time
    return smoothed
  }

  fun reset() {
    lastValue = null
    lastTime = null
    lastDerivative = 0.0
  }

  companion object {
    fun alpha(cutoff: Double, dt: Double): Double {
      val tau = 1 / (2 * Math.PI * cutoff)
      return 1 / (1 + tau / dt)
    }
  }
}

/**
 * A One Euro filter per coordinate, in units of the view's DIAGONAL so the settings mean the same on a
 * small phone and a tablet. ⚠ For DISPLAY ONLY — the gate reads RAW corners against an anchor (§3.2).
 */
class LiveQuadSmoother {
  private val filters = List(8) { OneEuroFilter(MIN_CUTOFF, BETA) }
  var current: LiveQuad? = null
    private set

  fun update(raw: LiveQuad, time: Double, diagonal: Double): LiveQuad {
    current?.let { if (LiveQuadOverlap.iou(it, raw) < JUMP_OVERLAP) reset() }
    if (diagonal <= 0) {
      current = raw
      return raw
    }
    val out = raw.points.mapIndexed { i, p ->
      Pt(filters[2 * i].filter(p.x / diagonal, time) * diagonal, filters[2 * i + 1].filter(p.y / diagonal, time) * diagonal)
    }
    return LiveQuad.of(out).also { current = it }
  }

  fun reset() {
    filters.forEach { it.reset() }
    current = null
  }

  companion object {
    /** docap's `tracker.ts` (`new OneEuroFilter(1.5, 4, 1)`, diagonal units). */
    const val MIN_CUTOFF = 1.5
    const val BETA = 4.0
    /** Below this overlap with the last outline, the new one is a different sheet: start again. */
    const val JUMP_OVERLAP = 0.5
  }
}

/** When the outline appears and goes: three valid detections in a row to appear, a 180 ms gap to go. */
class LiveDetectionHysteresis {
  enum class Change { NONE, APPEARED, DISAPPEARED }

  var visible = false
    private set
  private var consecutive = 0
  private var lastValidTime: Double? = null

  fun feed(valid: Boolean, time: Double): Change {
    if (valid) {
      consecutive += 1
      lastValidTime = time
      if (!visible && consecutive >= ACQUIRE_FRAMES) {
        visible = true
        return Change.APPEARED
      }
      return Change.NONE
    }
    consecutive = 0
    val last = lastValidTime
    if (visible && last != null && time - last > LOSE_AFTER_SECONDS) {
      visible = false
      return Change.DISAPPEARED
    }
    return Change.NONE
  }

  fun reset() {
    visible = false
    consecutive = 0
    lastValidTime = null
  }

  companion object {
    /** WeScan's funnel and Dynamsoft's stabiliser both wait for three. */
    const val ACQUIRE_FRAMES = 3
    /** docap's `gapMs: 180`. */
    const val LOSE_AFTER_SECONDS = 0.18
  }
}

/**
 * A critically damped spring per coordinate, stepped on every display frame, so the outline glides
 * between detections instead of stepping. Critically damped: as fast as a spring can arrive without
 * overshooting, because an outline that bounces past the paper's edge reads as wrong.
 */
class CriticalSpring(var omega: Double = DEFAULT_OMEGA) {
  var position = DoubleArray(0)
    private set
  private var velocity = DoubleArray(0)

  fun snap(target: DoubleArray) {
    position = target.copyOf()
    velocity = DoubleArray(target.size)
  }

  /** Semi-implicit Euler, sub-stepped; the 0.1 s cap bounds the WORK of a long stall, not the outcome. */
  fun step(target: DoubleArray, dt: Double): DoubleArray {
    if (position.size != target.size) {
      snap(target)
      return position
    }
    var remaining = min(max(dt, 0.0), 0.1)
    while (remaining > 0) {
      val h = min(remaining, 1.0 / 240)
      for (i in position.indices) {
        val accel = omega * omega * (target[i] - position[i]) - 2 * omega * velocity[i]
        velocity[i] += accel * h
        position[i] += velocity[i] * h
      }
      remaining -= h
    }
    return position
  }

  companion object {
    /** ~120 ms to within 2 % (5.8/ω), the plan's starting value. */
    const val DEFAULT_OMEGA = 48.0
  }
}
