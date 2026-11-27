import CoreGraphics
import Foundation

// Checks for LiveEdgeGeometry.swift (LIVE-EDGE-DETECTION-PLAN.md step L0), compiled with the shipped
// file by run-live-edge-tests.sh. No XCTest: plain swiftc, the way MetricsParityMain.swift runs, so it
// needs a Mac's command line tools and nothing else. Each check names what it guards; a failing check
// prints its name and the run exits non-zero.

var failures: [String] = []
var passed = 0

func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
  if condition { passed += 1 } else { failures.append(detail().isEmpty ? name : "\(name) — \(detail())") }
}

func near(_ a: CGFloat, _ b: CGFloat, _ tol: CGFloat = 1e-6) -> Bool { abs(a - b) <= tol }
func near(_ a: CGPoint, _ b: CGPoint, _ tol: CGFloat = 1e-6) -> Bool { near(a.x, b.x, tol) && near(a.y, b.y, tol) }

func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> LiveQuad {
  LiveQuad(topLeft: CGPoint(x: x, y: y), topRight: CGPoint(x: x + w, y: y),
           bottomRight: CGPoint(x: x + w, y: y + h), bottomLeft: CGPoint(x: x, y: y + h))
}

// MARK: mapping

check("Vision's bottom-left origin becomes the screen's top-left",
      near(LiveEdgeMapping.fromVision(CGPoint(x: 0.25, y: 0.9)), CGPoint(x: 0.25, y: 0.1)))

do {
  // A 1080×1920 portrait frame on a 390×844 screen: height-bound (844/1920 > 390/1080), so the image is
  // 474.75 wide and 42.375 px are cropped from each side.
  let image = CGSize(width: 1080, height: 1920), view = CGSize(width: 390, height: 844)
  let centre = LiveEdgeMapping.aspectFill(CGPoint(x: 0.5, y: 0.5), imageSize: image, viewSize: view)
  check("aspect fill keeps the centre at the centre", near(centre, CGPoint(x: 195, y: 422)), "\(centre)")
  let corner = LiveEdgeMapping.aspectFill(CGPoint(x: 0, y: 0), imageSize: image, viewSize: view)
  check("aspect fill crops the overflow equally from both sides",
        near(corner, CGPoint(x: -42.375, y: 0), 1e-3), "\(corner)")
  let far = LiveEdgeMapping.aspectFill(CGPoint(x: 1, y: 1), imageSize: image, viewSize: view)
  check("aspect fill's far corner mirrors the near one", near(far, CGPoint(x: 432.375, y: 844), 1e-3), "\(far)")
}

// MARK: validator

do {
  let image = CGSize(width: 1000, height: 1000)
  check("a page filling half the frame is a document",
        LiveQuadValidator.check(rect(200, 200, 600, 700), imageSize: image) == .ok)
  check("a quad under 12 % of the frame is refused as too small",
        LiveQuadValidator.check(rect(0, 0, 340, 340), imageSize: image) == .tooSmall)
  check("a quad just over 12 % of the frame is accepted",
        LiveQuadValidator.check(rect(0, 0, 350, 350), imageSize: image) == .ok)
  let bowtie = LiveQuad(topLeft: CGPoint(x: 100, y: 100), topRight: CGPoint(x: 900, y: 900),
                        bottomRight: CGPoint(x: 900, y: 100), bottomLeft: CGPoint(x: 100, y: 900))
  check("a crossed quad is refused", LiveQuadValidator.check(bowtie, imageSize: image) != .ok)
  // A parallelogram leaning 45° has corners of 45° and 135°: 45° off square, past the 40° limit.
  let lean = LiveQuad(topLeft: CGPoint(x: 400, y: 100), topRight: CGPoint(x: 900, y: 100),
                      bottomRight: CGPoint(x: 600, y: 400), bottomLeft: CGPoint(x: 100, y: 400))
  check("a corner more than 40° off square is refused", LiveQuadValidator.check(lean, imageSize: image) == .cornerSkewed)
  // Perspective a phone produces: a trapezoid with corners about 76° / 104°.
  let tilt = LiveQuad(topLeft: CGPoint(x: 300, y: 100), topRight: CGPoint(x: 700, y: 100),
                      bottomRight: CGPoint(x: 900, y: 900), bottomLeft: CGPoint(x: 100, y: 900))
  check("ordinary perspective is accepted", LiveQuadValidator.check(tilt, imageSize: image) == .ok)
  check("the corner angle of a right angle is 90°",
        near(LiveQuadValidator.cornerAngleDegrees(CGPoint(x: 0, y: 1), .zero, CGPoint(x: 1, y: 0)), 90, 1e-9))
}

// MARK: overlap

check("a quad overlaps itself completely", near(LiveQuadOverlap.iou(rect(0, 0, 10, 10), rect(0, 0, 10, 10)), 1))
check("two quads apart do not overlap", near(LiveQuadOverlap.iou(rect(0, 0, 10, 10), rect(20, 0, 10, 10)), 0))
check("half-shifted squares overlap by a third",
      near(LiveQuadOverlap.iou(rect(0, 0, 10, 10), rect(5, 0, 10, 10)), 1.0 / 3, 1e-9))
do {
  let a = rect(0, 0, 10, 10)
  let reversed = LiveQuad(topLeft: CGPoint(x: 0, y: 0), topRight: CGPoint(x: 0, y: 10),
                          bottomRight: CGPoint(x: 10, y: 10), bottomLeft: CGPoint(x: 10, y: 0))
  check("overlap does not depend on the clipper's winding", near(LiveQuadOverlap.iou(a, reversed), 1, 1e-9))
  check("overlap does not depend on the subject's winding", near(LiveQuadOverlap.iou(reversed, a), 1, 1e-9))
}

// MARK: One Euro

do {
  var f = OneEuroFilter(minCutoff: 1.5, beta: 4)
  check("the first sample passes through unchanged", f.filter(0.3, at: 0) == 0.3)
  // Jitter of ±0.002 around 0.3 at 30 Hz: the output must wobble far less than the input.
  var outputs: [Double] = []
  for i in 1...90 {
    outputs.append(f.filter(0.3 + (i % 2 == 0 ? 0.002 : -0.002), at: Double(i) / 30))
  }
  let tail = outputs.suffix(30)
  let wobble = (tail.max() ?? 0) - (tail.min() ?? 0)
  check("a still phone's shiver is damped to under a third", wobble < 0.004 / 3, "wobble \(wobble)")

  var slow = OneEuroFilter(minCutoff: 1.5, beta: 0)
  var fast = OneEuroFilter(minCutoff: 1.5, beta: 4)
  _ = slow.filter(0, at: 0); _ = fast.filter(0, at: 0)
  var s = 0.0, q = 0.0
  for i in 1...6 { s = slow.filter(0.05 * Double(i), at: Double(i) / 30); q = fast.filter(0.05 * Double(i), at: Double(i) / 30) }
  check("beta makes a fast move lag less than a fixed low-pass", (0.3 - q) < (0.3 - s), "lag fast \(0.3 - q) fixed \(0.3 - s)")

  f.reset()
  check("after a reset the next sample passes through", f.filter(0.9, at: 10) == 0.9)
}

do {
  var smoother = LiveQuadSmoother()
  let a = rect(100, 100, 200, 300)
  _ = smoother.update(a, at: 0, diagonal: 900)
  let far = rect(600, 500, 200, 300)
  let out = smoother.update(far, at: 1.0 / 30, diagonal: 900)
  check("a different sheet resets the smoother instead of gliding to it", out == far, "\(out)")
  let same = rect(102, 100, 200, 300)
  _ = smoother.update(rect(600, 500, 200, 300), at: 2.0 / 30, diagonal: 900)
  let moved = smoother.update(rect(602, 500, 200, 300), at: 3.0 / 30, diagonal: 900)
  check("a small move is smoothed, not copied", moved.topLeft.x > 600 && moved.topLeft.x < 602, "\(moved.topLeft)")
  _ = same
}

// MARK: hysteresis

do {
  var h = LiveDetectionHysteresis()
  check("one valid frame draws nothing", h.feed(valid: true, at: 0.00) == .none)
  check("two valid frames draw nothing", h.feed(valid: true, at: 0.03) == .none)
  check("the third valid frame in a row draws the outline", h.feed(valid: true, at: 0.06) == .appeared)
  check("a single miss does not hide it", h.feed(valid: false, at: 0.10) == .none && h.visible)
  check("a miss 180 ms after the last valid frame still does not hide it", h.feed(valid: false, at: 0.24) == .none)
  check("a gap longer than 180 ms hides it", h.feed(valid: false, at: 0.25) == .disappeared && !h.visible)

  var broken = LiveDetectionHysteresis()
  _ = broken.feed(valid: true, at: 0); _ = broken.feed(valid: false, at: 0.03)
  _ = broken.feed(valid: true, at: 0.06); _ = broken.feed(valid: true, at: 0.09)
  check("valid frames must be consecutive to draw it", !broken.visible)
}

// MARK: spring

do {
  var spring = CriticalSpring()
  spring.snap(to: [0])
  var maxSeen = 0.0
  var t = 0.0
  var settledAt: Double?
  while t < 0.5 {
    let p = spring.step(toward: [1], dt: 1.0 / 120)[0]
    t += 1.0 / 120
    maxSeen = max(maxSeen, p)
    if settledAt == nil, abs(1 - p) < 0.02 { settledAt = t }
  }
  check("the outline never overshoots the paper", maxSeen <= 1 + 1e-9, "max \(maxSeen)")
  check("it settles within 2 % in about 120 ms", (settledAt ?? 1) > 0.09 && (settledAt ?? 1) < 0.15, "settled at \(settledAt ?? -1)")
  var hitch = CriticalSpring()
  hitch.snap(to: [0])
  let afterHitch = hitch.step(toward: [1], dt: 2.0)[0]
  check("a two-second hitch cannot make it unstable", afterHitch.isFinite && afterHitch <= 1 + 1e-9, "\(afterHitch)")
}

check("a quad survives flattening", LiveQuad(flattened: rect(1, 2, 3, 4).flattened) == rect(1, 2, 3, 4))

liveCaptureGateChecks()

if failures.isEmpty {
  print("✓ live edge geometry: \(passed) checks passed")
} else {
  for f in failures { print("✗ \(f)") }
  print("RESULT: \(failures.count) failed, \(passed) passed")
  exit(1)
}
