package expo.modules.capturenative

import expo.modules.capturenative.LiveCaptureGate.Action
import expo.modules.capturenative.LiveCaptureGate.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot

/**
 * `LiveCaptureGate.kt` (D-LED6: no trace until the page is placed well and still; the trace's end takes
 * the photo), case for case with `tests/ios/LiveCaptureGateChecks.swift`.
 */
class LiveCaptureGateTest {
  private val w = 1080.0
  private val h = 1440.0
  private val diagonal = hypot(w, h)
  private val dt = 1.0 / 15

  /** A well-placed page: 70 % × 70 % of the frame, centred, square-on. */
  private val good = LiveQuad(Pt(0.15, 0.15), Pt(0.85, 0.15), Pt(0.85, 0.85), Pt(0.15, 0.85))
  private val small = LiveQuad(Pt(0.35, 0.35), Pt(0.75, 0.35), Pt(0.75, 0.75), Pt(0.35, 0.75))

  private fun framing(q: LiveQuad?, scale: Double = 3.0, floor: Double = 1200.0) =
    LiveFramingCheck.blocker(q, w, h, scale, floor)

  private fun frame(t: Double, q: LiveQuad? = good, still: Boolean = true, settled: Boolean = true) =
    LiveCaptureGate.Frame(q?.mapped { Pt(it.x * w, it.y * h) }, framing(q), still, settled, t, diagonal)

  private fun run(gate: LiveCaptureGate, from: Double, to: Double, make: (Double) -> LiveCaptureGate.Frame): List<Pair<Double, Action>> {
    val out = ArrayList<Pair<Double, Action>>()
    var t = from
    while (t <= to + 1e-9) {
      val a = gate.feed(make(t))
      if (a != Action.NONE) out.add(t to a)
      t += dt
    }
    return out
  }

  @Test
  fun `framing names the first thing to fix`() {
    assertNull(framing(good))
    assertEquals(LiveCaptureBlocker.NO_PAGE, framing(null))
    assertEquals(LiveCaptureBlocker.OFF_EDGE, framing(good.copy(topLeft = Pt(0.005, 0.15))))
    assertEquals(LiveCaptureBlocker.TOO_FAR, framing(small))
    val keystone = LiveQuad(Pt(0.3, 0.15), Pt(0.7, 0.15), Pt(0.85, 0.85), Pt(0.15, 0.85))
    assertEquals(LiveCaptureBlocker.TILTED, framing(keystone))
    val slight = LiveQuad(Pt(0.19, 0.15), Pt(0.81, 0.15), Pt(0.85, 0.85), Pt(0.15, 0.85))
    assertNull("a slight lean still passes", framing(slight))
    assertEquals(LiveCaptureBlocker.LOW_RESOLUTION, framing(good, scale = 1.0))
    assertNull("the floor is the one passed in", framing(good, scale = 1.0, floor = 1000.0))
  }

  @Test
  fun `motion is still only after calm readings last, with hysteresis`() {
    val m = LiveMotionGate()
    m.feed(0.05, 0.05, 0.0)
    assertFalse(m.still)
    m.feed(0.05, 0.05, 0.3)
    assertTrue(m.still)
    m.feed(0.22, 0.05, 0.35)
    assertTrue("between the thresholds keeps the state", m.still)
    m.feed(0.4, 0.05, 0.4)
    assertFalse("a jolt is moving at once", m.still)
    m.feed(0.05, 0.9, 0.45)
    m.feed(0.05, 0.05, 0.8)
    assertFalse("a turn of the wrist counts as moving", m.still)
  }

  @Test
  fun `a still, well-placed page traces once and fires when the trace ends`() {
    val gate = LiveCaptureGate()
    val actions = run(gate, 0.0, 2.0) { frame(it) }
    val start = actions.first { it.second == Action.START_TRACE }.first
    val fire = actions.first { it.second == Action.FIRE }.first
    assertTrue("started at $start", start >= LiveCaptureGate.SETTLE_SECONDS - 1e-9)
    assertTrue("start $start fire $fire", fire - start >= LiveCaptureGate.TRACE_SECONDS - 1e-9)
    assertEquals(1, actions.count { it.second == Action.FIRE })
    assertEquals(1.0, gate.traceProgress(99.0), 0.0)
  }

  @Test
  fun `a moving phone, a focusing camera or a far page never starts the trace`() {
    LiveCaptureGate().let { g ->
      assertTrue(run(g, 0.0, 2.0) { frame(it, still = false) }.isEmpty())
      assertEquals(Phase.Waiting(LiveCaptureBlocker.MOVING), g.phase)
    }
    LiveCaptureGate().let { g ->
      assertTrue(run(g, 0.0, 2.0) { frame(it, settled = false) }.isEmpty())
      assertEquals(Phase.Waiting(LiveCaptureBlocker.FOCUSING), g.phase)
    }
    LiveCaptureGate().let { g ->
      assertTrue(run(g, 0.0, 2.0) { frame(it, small) }.isEmpty())
      assertEquals(Phase.Waiting(LiveCaptureBlocker.TOO_FAR), g.phase)
    }
  }

  @Test
  fun `a page that moves during the trace rewinds it and takes no photo`() {
    val shift = 0.03 * diagonal / w
    val gate = LiveCaptureGate()
    var started: Double? = null
    val acts = ArrayList<Action>()
    var t = 0.0
    while (t <= 2) {
      val moved = started?.let { t - it > LiveCaptureGate.TRACE_SECONDS / 2 } ?: false
      val a = gate.feed(frame(t, if (moved) good.mapped { Pt(it.x + shift, it.y) } else good))
      if (a == Action.START_TRACE && started == null) started = t
      if (a != Action.NONE) acts.add(a)
      if (a == Action.CANCEL_TRACE) break
      t += dt
    }
    assertTrue("$acts", Action.CANCEL_TRACE in acts)
    assertFalse("$acts", Action.FIRE in acts)
    assertEquals(Phase.Waiting(LiveCaptureBlocker.MOVING), gate.phase)
  }

  @Test
  fun `a slow creep never reaches the photo (anchor, not frame to frame)`() {
    val gate = LiveCaptureGate()
    val step = 0.004 * diagonal / w
    val acts = ArrayList<Action>()
    var t = 0.0
    var i = 0.0
    while (t <= 3) {
      val a = gate.feed(frame(t, good.mapped { Pt(it.x + step * i, it.y) }))
      if (a != Action.NONE) acts.add(a)
      t += dt
      i += 1
      if (0.15 + step * i > 0.3) break
    }
    assertFalse("$acts", Action.FIRE in acts)
  }

  @Test
  fun `the camera refocusing during the trace rewinds it`() {
    val gate = LiveCaptureGate()
    val acts = ArrayList<Action>()
    var started: Double? = null
    var t = 0.0
    while (t <= 2) {
      val hunting = started?.let { t - it > 0.3 } ?: false
      val a = gate.feed(frame(t, settled = !hunting))
      if (a == Action.START_TRACE && started == null) started = t
      if (a != Action.NONE) acts.add(a)
      if (a == Action.CANCEL_TRACE) break
      t += dt
    }
    assertEquals("$acts", Action.CANCEL_TRACE, acts.last())
    assertFalse("$acts", Action.FIRE in acts)
  }

  @Test
  fun `the same page is not shot twice, and taking it away re-arms`() {
    val gate = LiveCaptureGate()
    run(gate, 0.0, 1.5) { frame(it) }
    gate.captureFinished(true, 1.5)
    assertTrue(run(gate, 1.5, 4.0) { frame(it) }.isEmpty())
    assertEquals(Phase.Captured, gate.phase)
    run(gate, 4.0, 4.4) { frame(it, null) }
    assertEquals("gone for less than the re-arm time", Phase.Captured, gate.phase)
    run(gate, 4.4, 4.7) { frame(it, null) }
    assertNotEquals(Phase.Captured, gate.phase)
    assertTrue(run(gate, 4.7, 7.0) { frame(it) }.any { it.second == Action.FIRE })
  }

  @Test
  fun `a different sheet re-arms the gate without the first leaving`() {
    val gate = LiveCaptureGate()
    run(gate, 0.0, 1.5) { frame(it) }
    gate.captureFinished(true, 1.5)
    val other = LiveQuad(Pt(0.02, 0.4), Pt(0.6, 0.4), Pt(0.6, 0.97), Pt(0.02, 0.97))
    run(gate, 1.5, 1.8) { frame(it, other) }
    assertNotEquals(Phase.Captured, gate.phase)
  }

  @Test
  fun `a failed photo re-arms instead of stranding the gate`() {
    val gate = LiveCaptureGate()
    run(gate, 0.0, 1.5) { frame(it) }
    gate.captureFinished(false, 1.5)
    assertEquals(Phase.Waiting(LiveCaptureBlocker.NO_PAGE), gate.phase)
  }

  @Test
  fun `the blockers speak the same wire words as the Swift gate`() {
    assertEquals(
      listOf("noPage", "offEdge", "tooFar", "tilted", "lowResolution", "focusing", "moving"),
      LiveCaptureBlocker.entries.map { it.wire },
    )
  }
}
