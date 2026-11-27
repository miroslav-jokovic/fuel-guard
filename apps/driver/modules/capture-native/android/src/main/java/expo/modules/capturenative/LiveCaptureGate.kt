package expo.modules.capturenative

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

// The capture gate — when the live edge camera may take its photo (D-LED6, owner 2026-11-23):
//
//   "The app must not take a scan until the camera and the document are in a position that makes our
//    normalisation decent; the edge animation must not start until those conditions are met; and when
//    the animation ends, it takes the scan."
//
// A line-for-line port of `ios/LiveCaptureGate.swift` (see that file for the reasoning behind every
// rule), pure Kotlin so `LiveCaptureGateTest` runs it on the JVM in CI. The wire values of the blocker
// are the Swift raw values, because JavaScript reads one vocabulary for both phones
// (`LiveEdgeCameraView.tsx`'s `LiveEdgeBlocker`).
//
// ⚠ Every threshold is a STARTING value with its source named, not a measurement of ours — identical to
// the Swift constants, and L3 moves both to signed configuration.

enum class LiveCaptureBlocker(val wire: String) {
  NO_PAGE("noPage"),
  OFF_EDGE("offEdge"),
  TOO_FAR("tooFar"),
  TILTED("tilted"),
  LOW_RESOLUTION("lowResolution"),
  FOCUSING("focusing"),
  MOVING("moving"),
}

object LiveFramingCheck {
  const val MIN_AREA_FRACTION = 0.25
  const val EDGE_MARGIN_FRACTION = 0.015
  const val MAX_CORNER_SKEW_DEGREES = 20.0
  const val MIN_OPPOSITE_EDGE_RATIO = 0.8

  /**
   * @param normalized the RAW outline normalised to the upright frame (top-left origin), or null.
   * @param photoScale photo pixels per frame pixel (one field of view, D-LED7).
   * @param minPageLongEdgePx the quality gate's `resolutionMinLongEdgePx`, from the signed config via JS.
   */
  fun blocker(normalized: LiveQuad?, imageW: Double, imageH: Double, photoScale: Double, minPageLongEdgePx: Double): LiveCaptureBlocker? {
    if (normalized == null || imageW <= 0 || imageH <= 0) return LiveCaptureBlocker.NO_PAGE
    val m = EDGE_MARGIN_FRACTION
    if (normalized.points.any { it.x < m || it.y < m || it.x > 1 - m || it.y > 1 - m }) return LiveCaptureBlocker.OFF_EDGE
    val px = normalized.mapped { Pt(it.x * imageW, it.y * imageH) }
    when (LiveQuadValidator.check(px, imageW, imageH)) {
      LiveQuadValidity.OK -> {}
      LiveQuadValidity.TOO_SMALL -> return LiveCaptureBlocker.TOO_FAR
      LiveQuadValidity.CORNER_SKEWED -> return LiveCaptureBlocker.TILTED
      LiveQuadValidity.NOT_CONVEX -> return LiveCaptureBlocker.NO_PAGE
    }
    if (px.area < MIN_AREA_FRACTION * imageW * imageH) return LiveCaptureBlocker.TOO_FAR

    val p = px.points
    for (i in 0 until 4) {
      if (abs(LiveQuadValidator.cornerAngleDegrees(p[(i + 3) % 4], p[i], p[(i + 1) % 4]) - 90) > MAX_CORNER_SKEW_DEGREES) {
        return LiveCaptureBlocker.TILTED
      }
    }
    // side[0] top, side[1] right, side[2] bottom, side[3] left.
    val side = (0 until 4).map { hypot(p[(it + 1) % 4].x - p[it].x, p[(it + 1) % 4].y - p[it].y) }
    for ((a, b) in listOf(side[0] to side[2], side[1] to side[3])) {
      if (max(a, b) > 0 && min(a, b) / max(a, b) < MIN_OPPOSITE_EDGE_RATIO) return LiveCaptureBlocker.TILTED
    }
    // The straightened long edge, conservatively: the SHORTER of each opposite pair, the longer of those.
    val longEdgePx = max(min(side[0], side[2]), min(side[1], side[3])) * photoScale
    if (longEdgePx < minPageLongEdgePx) return LiveCaptureBlocker.LOW_RESOLUTION
    return null
  }
}

/** Is the phone still? ScanFromCam's acceleration thresholds plus ours for rotation, with hysteresis. */
class LiveMotionGate {
  var still = false
    private set
  private var calmSince: Double? = null

  /** acceleration in m/s² with gravity removed, rotation in rad/s, both magnitudes. */
  fun feed(acceleration: Double, rotation: Double, time: Double): Boolean {
    if (acceleration > MOVING_ACCELERATION || rotation > MOVING_ROTATION) {
      still = false
      calmSince = null
    } else if (acceleration < CALM_ACCELERATION && rotation < CALM_ROTATION) {
      val since = calmSince ?: time.also { calmSince = it }
      if (time - since >= CALM_FOR_SECONDS) still = true
    } else {
      calmSince = null
    }
    return still
  }

  fun reset() {
    still = false
    calmSince = null
  }

  companion object {
    const val CALM_ACCELERATION = 0.18
    const val MOVING_ACCELERATION = 0.28
    const val CALM_ROTATION = 0.3
    const val MOVING_ROTATION = 0.5
    const val CALM_FOR_SECONDS = 0.25
  }
}

class LiveCaptureGate {
  sealed class Phase {
    /** Not ready; the blocker is the reason, null while the page is settling before the trace. */
    data class Waiting(val blocker: LiveCaptureBlocker?) : Phase()
    data class Tracing(val startedAt: Double) : Phase()
    data object Capturing : Phase()
    data object Captured : Phase()
  }

  enum class Action { NONE, START_TRACE, CANCEL_TRACE, FIRE }

  /** `quad` is the raw outline in frame PIXELS; `diagonal` the frame's diagonal in pixels. */
  data class Frame(
    val quad: LiveQuad?,
    val framing: LiveCaptureBlocker?,
    val phoneStill: Boolean,
    val cameraSettled: Boolean,
    val time: Double,
    val diagonal: Double,
  )

  var phase: Phase = Phase.Waiting(LiveCaptureBlocker.NO_PAGE)
    private set
  var anchor: LiveQuad? = null
    private set
  var capturedQuad: LiveQuad? = null
    private set
  private var anchorTime = 0.0
  private var goodFrames = 0
  private var lastSeen = 0.0
  private var newPageFrames = 0

  /** How far through the trace, 0–1: the drawn stroke's length, so the animation IS the gate's clock. */
  fun traceProgress(time: Double): Double = when (val p = phase) {
    is Phase.Tracing -> min(1.0, max(0.0, (time - p.startedAt) / TRACE_SECONDS))
    Phase.Capturing, Phase.Captured -> 1.0
    is Phase.Waiting -> 0.0
  }

  fun feed(f: Frame): Action {
    val blocker = f.framing ?: (if (f.cameraSettled) null else LiveCaptureBlocker.FOCUSING)
      ?: (if (f.phoneStill) null else LiveCaptureBlocker.MOVING)

    when (val current = phase) {
      Phase.Capturing -> return Action.NONE

      Phase.Captured -> {
        val quad = f.quad
        if (quad == null || f.framing == LiveCaptureBlocker.NO_PAGE) {
          if (f.time - lastSeen >= REARM_GONE_SECONDS) rearm()
          return Action.NONE
        }
        lastSeen = f.time
        val captured = capturedQuad
        if (captured != null && LiveQuadOverlap.iou(captured, quad) < REARM_NEW_PAGE_OVERLAP) {
          newPageFrames += 1
          if (newPageFrames >= ACQUIRE_FRAMES) rearm()
        } else {
          newPageFrames = 0
        }
        return Action.NONE
      }

      is Phase.Waiting -> {
        val quad = f.quad
        if (blocker != null || quad == null) {
          goodFrames = 0
          anchor = null
          phase = Phase.Waiting(blocker ?: LiveCaptureBlocker.NO_PAGE)
          return Action.NONE
        }
        goodFrames += 1
        val a = anchor
        if (a == null || drift(a, quad, f.diagonal) > ANCHOR_TOLERANCE) {
          anchor = quad
          anchorTime = f.time
        }
        if (goodFrames >= ACQUIRE_FRAMES && f.time - anchorTime >= SETTLE_SECONDS) {
          phase = Phase.Tracing(f.time)
          return Action.START_TRACE
        }
        phase = Phase.Waiting(null)
        return Action.NONE
      }

      is Phase.Tracing -> {
        val a = anchor
        val moved = f.quad?.let { q -> a?.let { drift(it, q, f.diagonal) > ANCHOR_TOLERANCE } ?: true } ?: true
        val reason = blocker ?: if (moved) LiveCaptureBlocker.MOVING else null
        if (reason != null) {
          goodFrames = 0
          anchor = null
          phase = Phase.Waiting(reason)
          return Action.CANCEL_TRACE
        }
        if (f.time - current.startedAt >= TRACE_SECONDS) {
          capturedQuad = f.quad
          phase = Phase.Capturing
          return Action.FIRE
        }
        return Action.NONE
      }
    }
  }

  /** The view reports the photo's outcome. A failed photo starts again rather than stranding the gate. */
  fun captureFinished(ok: Boolean, time: Double) {
    if (phase != Phase.Capturing) return
    if (ok) {
      phase = Phase.Captured
      lastSeen = time
      newPageFrames = 0
    } else {
      rearm()
    }
  }

  fun reset() = rearm()

  private fun rearm() {
    phase = Phase.Waiting(LiveCaptureBlocker.NO_PAGE)
    anchor = null
    capturedQuad = null
    goodFrames = 0
    newPageFrames = 0
  }

  companion object {
    const val ACQUIRE_FRAMES = 3
    const val SETTLE_SECONDS = 0.2
    const val TRACE_SECONDS = 0.8
    const val ANCHOR_TOLERANCE = 0.015
    const val REARM_GONE_SECONDS = 0.5
    const val REARM_NEW_PAGE_OVERLAP = 0.5

    /** The largest distance any corner has moved, as a fraction of `diagonal`. */
    fun drift(a: LiveQuad, b: LiveQuad, diagonal: Double): Double {
      if (diagonal <= 0) return Double.POSITIVE_INFINITY
      return a.points.zip(b.points).maxOf { (p, q) -> hypot(p.x - q.x, p.y - q.y) } / diagonal
    }
  }
}
