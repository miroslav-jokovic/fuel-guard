package expo.modules.capturenative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * `LiveEdgeGeometry.kt`, case for case with `tests/ios/LiveEdgeGeometryMain.swift`, so the two phones
 * are held to the same outline. Plain JVM: CI's `native-android` job runs it on every PR.
 */
class LiveEdgeGeometryTest {
  private fun rect(x: Double, y: Double, w: Double, h: Double) =
    LiveQuad(Pt(x, y), Pt(x + w, y), Pt(x + w, y + h), Pt(x, y + h))

  private fun near(a: Pt, b: Pt, tol: Double = 1e-6) = abs(a.x - b.x) <= tol && abs(a.y - b.y) <= tol

  @Test
  fun `aspect fill keeps the centre and crops the overflow equally`() {
    // A 1080×1920 frame on a 390×844 view: height-bound, 474.75 drawn wide, 42.375 cropped each side.
    val centre = LiveEdgeMapping.aspectFill(Pt(0.5, 0.5), 1080.0, 1920.0, 390.0, 844.0)
    assertTrue("$centre", near(centre, Pt(195.0, 422.0)))
    val corner = LiveEdgeMapping.aspectFill(Pt(0.0, 0.0), 1080.0, 1920.0, 390.0, 844.0)
    assertTrue("$corner", near(corner, Pt(-42.375, 0.0), 1e-3))
    val far = LiveEdgeMapping.aspectFill(Pt(1.0, 1.0), 1080.0, 1920.0, 390.0, 844.0)
    assertTrue("$far", near(far, Pt(432.375, 844.0), 1e-3))
  }

  @Test
  fun `the validator refuses what cannot be a page and accepts ordinary perspective`() {
    assertEquals(LiveQuadValidity.OK, LiveQuadValidator.check(rect(200.0, 200.0, 600.0, 700.0), 1000.0, 1000.0))
    assertEquals(LiveQuadValidity.TOO_SMALL, LiveQuadValidator.check(rect(0.0, 0.0, 340.0, 340.0), 1000.0, 1000.0))
    assertEquals(LiveQuadValidity.OK, LiveQuadValidator.check(rect(0.0, 0.0, 350.0, 350.0), 1000.0, 1000.0))
    val bowtie = LiveQuad(Pt(100.0, 100.0), Pt(900.0, 900.0), Pt(900.0, 100.0), Pt(100.0, 900.0))
    assertNotEquals(LiveQuadValidity.OK, LiveQuadValidator.check(bowtie, 1000.0, 1000.0))
    val lean = LiveQuad(Pt(400.0, 100.0), Pt(900.0, 100.0), Pt(600.0, 400.0), Pt(100.0, 400.0))
    assertEquals(LiveQuadValidity.CORNER_SKEWED, LiveQuadValidator.check(lean, 1000.0, 1000.0))
    val tilt = LiveQuad(Pt(300.0, 100.0), Pt(700.0, 100.0), Pt(900.0, 900.0), Pt(100.0, 900.0))
    assertEquals(LiveQuadValidity.OK, LiveQuadValidator.check(tilt, 1000.0, 1000.0))
    assertEquals(90.0, LiveQuadValidator.cornerAngleDegrees(Pt(0.0, 1.0), Pt(0.0, 0.0), Pt(1.0, 0.0)), 1e-9)
  }

  @Test
  fun `overlap is a third for half-shifted squares and does not depend on winding`() {
    assertEquals(1.0, LiveQuadOverlap.iou(rect(0.0, 0.0, 10.0, 10.0), rect(0.0, 0.0, 10.0, 10.0)), 1e-6)
    assertEquals(0.0, LiveQuadOverlap.iou(rect(0.0, 0.0, 10.0, 10.0), rect(20.0, 0.0, 10.0, 10.0)), 1e-6)
    assertEquals(1.0 / 3, LiveQuadOverlap.iou(rect(0.0, 0.0, 10.0, 10.0), rect(5.0, 0.0, 10.0, 10.0)), 1e-9)
    val a = rect(0.0, 0.0, 10.0, 10.0)
    val reversed = LiveQuad(Pt(0.0, 0.0), Pt(0.0, 10.0), Pt(10.0, 10.0), Pt(10.0, 0.0))
    assertEquals(1.0, LiveQuadOverlap.iou(a, reversed), 1e-9)
    assertEquals(1.0, LiveQuadOverlap.iou(reversed, a), 1e-9)
  }

  @Test
  fun `one euro damps a still phone's shiver and lets a fast move through`() {
    val f = OneEuroFilter(1.5, 4.0)
    assertEquals(0.3, f.filter(0.3, 0.0), 0.0)
    val outputs = (1..90).map { f.filter(0.3 + if (it % 2 == 0) 0.002 else -0.002, it / 30.0) }
    val tail = outputs.takeLast(30)
    assertTrue("wobble ${tail.max() - tail.min()}", tail.max() - tail.min() < 0.004 / 3)

    val slow = OneEuroFilter(1.5, 0.0)
    val fast = OneEuroFilter(1.5, 4.0)
    slow.filter(0.0, 0.0)
    fast.filter(0.0, 0.0)
    var s = 0.0
    var q = 0.0
    for (i in 1..6) {
      s = slow.filter(0.05 * i, i / 30.0)
      q = fast.filter(0.05 * i, i / 30.0)
    }
    assertTrue("lag fast ${0.3 - q} fixed ${0.3 - s}", 0.3 - q < 0.3 - s)
    f.reset()
    assertEquals(0.9, f.filter(0.9, 10.0), 0.0)
  }

  @Test
  fun `a different sheet resets the smoother and a small move is smoothed`() {
    val smoother = LiveQuadSmoother()
    smoother.update(rect(100.0, 100.0, 200.0, 300.0), 0.0, 900.0)
    val far = rect(600.0, 500.0, 200.0, 300.0)
    assertEquals(far, smoother.update(far, 1.0 / 30, 900.0))
    smoother.update(rect(600.0, 500.0, 200.0, 300.0), 2.0 / 30, 900.0)
    val moved = smoother.update(rect(602.0, 500.0, 200.0, 300.0), 3.0 / 30, 900.0)
    assertTrue("${moved.topLeft}", moved.topLeft.x > 600 && moved.topLeft.x < 602)
  }

  @Test
  fun `the outline appears after three valid frames and goes only after a 180 ms gap`() {
    val h = LiveDetectionHysteresis()
    assertEquals(LiveDetectionHysteresis.Change.NONE, h.feed(true, 0.00))
    assertEquals(LiveDetectionHysteresis.Change.NONE, h.feed(true, 0.03))
    assertEquals(LiveDetectionHysteresis.Change.APPEARED, h.feed(true, 0.06))
    assertEquals(LiveDetectionHysteresis.Change.NONE, h.feed(false, 0.10))
    assertTrue(h.visible)
    assertEquals(LiveDetectionHysteresis.Change.NONE, h.feed(false, 0.24))
    assertEquals(LiveDetectionHysteresis.Change.DISAPPEARED, h.feed(false, 0.25))
    assertFalse(h.visible)

    val broken = LiveDetectionHysteresis()
    broken.feed(true, 0.0)
    broken.feed(false, 0.03)
    broken.feed(true, 0.06)
    broken.feed(true, 0.09)
    assertFalse("valid frames must be consecutive", broken.visible)
  }

  @Test
  fun `the spring never overshoots, settles in about 120 ms and survives a hitch`() {
    val spring = CriticalSpring()
    spring.snap(doubleArrayOf(0.0))
    var maxSeen = 0.0
    var t = 0.0
    var settledAt: Double? = null
    while (t < 0.5) {
      val p = spring.step(doubleArrayOf(1.0), 1.0 / 120)[0]
      t += 1.0 / 120
      maxSeen = maxOf(maxSeen, p)
      if (settledAt == null && abs(1 - p) < 0.02) settledAt = t
    }
    assertTrue("max $maxSeen", maxSeen <= 1 + 1e-9)
    assertTrue("settled at $settledAt", (settledAt ?: 1.0) > 0.09 && (settledAt ?: 1.0) < 0.15)
    val hitch = CriticalSpring()
    hitch.snap(doubleArrayOf(0.0))
    val after = hitch.step(doubleArrayOf(1.0), 2.0)[0]
    assertTrue("$after", after.isFinite() && after <= 1 + 1e-9)
  }

  @Test
  fun `a quad survives flattening`() {
    val q = rect(1.0, 2.0, 3.0, 4.0)
    assertEquals(q, LiveQuad.fromFlattened(q.flattened))
  }
}
