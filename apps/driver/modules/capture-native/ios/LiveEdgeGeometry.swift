import CoreGraphics
import Foundation

// Live edge detection — the arithmetic, with no camera in it (LIVE-EDGE-DETECTION-PLAN.md, step L0).
//
// Everything the live outline decides lives in this file and imports only Foundation and CoreGraphics,
// so `tests/ios/run-live-edge-tests.sh` can compile it with `swiftc` on a Mac and check it without a
// phone, a simulator or a camera. That is the scanner programme's rule, learned when a mutation of
// D-SCAN4 passed the whole driver suite: decisions where a test can reach them, I/O somewhere else.
// `LiveEdgeCameraView.swift` owns the I/O (AVFoundation, Vision, layers); it calls in here for every
// number it acts on.
//
// ⚠ L0 IS A SPIKE. The starting values below are other people's measured defaults (each names its
// source, plan §2a), not ours. Step L1 measures them on our own photos and Step L3 moves the capture
// decision into `capture-engine` (Q-LED4), where the thresholds become signed configuration. Until then
// they are constants here, and that is a restatement waiting on L3, not a second source of truth by
// choice.

/// Four corners, top-left first, clockwise — the order `capture-engine`'s `homography.ts` uses.
struct LiveQuad: Equatable {
  var topLeft: CGPoint
  var topRight: CGPoint
  var bottomRight: CGPoint
  var bottomLeft: CGPoint

  var points: [CGPoint] { [topLeft, topRight, bottomRight, bottomLeft] }

  init(topLeft: CGPoint, topRight: CGPoint, bottomRight: CGPoint, bottomLeft: CGPoint) {
    self.topLeft = topLeft
    self.topRight = topRight
    self.bottomRight = bottomRight
    self.bottomLeft = bottomLeft
  }

  init(_ p: [CGPoint]) {
    precondition(p.count == 4, "a LiveQuad has four corners")
    self.init(topLeft: p[0], topRight: p[1], bottomRight: p[2], bottomLeft: p[3])
  }

  func mapped(_ f: (CGPoint) -> CGPoint) -> LiveQuad { LiveQuad(points.map(f)) }

  /// Shoelace area. Positive for the clockwise-on-screen order this type promises (y grows downward).
  var signedArea: CGFloat {
    let p = points
    var sum: CGFloat = 0
    for i in 0..<4 {
      let a = p[i], b = p[(i + 1) % 4]
      sum += a.x * b.y - b.x * a.y
    }
    return sum / 2
  }

  var area: CGFloat { abs(signedArea) }
}

// MARK: - Vision → screen

enum LiveEdgeMapping {
  /// Vision reports normalised points with the origin at the BOTTOM-left of the (oriented) image; the
  /// screen's origin is the TOP-left. Flipping y is the whole conversion.
  static func fromVision(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x, y: 1 - p.y) }

  /// A point in the image (normalised, top-left origin) to the preview's coordinates, for a preview
  /// drawn with `.resizeAspectFill` — the image is scaled to COVER the view and the overflow is cropped
  /// equally from both sides. A point in the cropped part maps outside the view's bounds, which is
  /// correct: the outline then runs off the screen exactly where the paper does.
  static func aspectFill(_ p: CGPoint, imageSize: CGSize, viewSize: CGSize) -> CGPoint {
    guard imageSize.width > 0, imageSize.height > 0 else { return .zero }
    let scale = max(viewSize.width / imageSize.width, viewSize.height / imageSize.height)
    let drawnW = imageSize.width * scale
    let drawnH = imageSize.height * scale
    let offX = (viewSize.width - drawnW) / 2
    let offY = (viewSize.height - drawnH) / 2
    return CGPoint(x: offX + p.x * drawnW, y: offY + p.y * drawnH)
  }
}

// MARK: - Is this a document?

enum LiveQuadValidity: String {
  case ok
  case tooSmall
  case notConvex
  case cornerSkewed
}

enum LiveQuadValidator {
  /// The same three refusals `capture-engine`'s `findDocument.ts` makes (MIN_AREA, MAX_CORNER_SKEW and a
  /// convex shape), restated in Swift because Swift cannot import TypeScript. Step L2 holds both to one
  /// fixture file, as `CaptureMetrics` is held to `fixtures/expected.json`; until then a change to either
  /// side must be made to both.
  static let minAreaFraction: CGFloat = 0.12
  static let maxCornerSkewDegrees: CGFloat = 40

  /// `quad` in IMAGE pixels (not normalised — angles are only meaningful at the image's own aspect).
  static func check(_ quad: LiveQuad, imageSize: CGSize) -> LiveQuadValidity {
    let frameArea = imageSize.width * imageSize.height
    guard frameArea > 0, quad.area >= minAreaFraction * frameArea else { return .tooSmall }
    let p = quad.points
    var sign: CGFloat = 0
    for i in 0..<4 {
      let a = p[(i + 3) % 4], b = p[i], c = p[(i + 1) % 4]
      let cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      if cross == 0 { return .notConvex }
      if sign == 0 { sign = cross > 0 ? 1 : -1 } else if (cross > 0 ? 1 : -1) != sign { return .notConvex }
      if abs(cornerAngleDegrees(a, b, c) - 90) > maxCornerSkewDegrees { return .cornerSkewed }
    }
    return .ok
  }

  /// The interior angle at `b` between `b→a` and `b→c`.
  static func cornerAngleDegrees(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint) -> CGFloat {
    let u = CGVector(dx: a.x - b.x, dy: a.y - b.y)
    let v = CGVector(dx: c.x - b.x, dy: c.y - b.y)
    let lu = hypot(u.dx, u.dy), lv = hypot(v.dx, v.dy)
    guard lu > 0, lv > 0 else { return 0 }
    let cosine = max(-1, min(1, (u.dx * v.dx + u.dy * v.dy) / (lu * lv)))
    return acos(cosine) * 180 / .pi
  }
}

// MARK: - Overlap of two outlines

enum LiveQuadOverlap {
  /// Intersection-over-union of two CONVEX quads (the validator has refused every other kind), by
  /// clipping one against the other (Sutherland–Hodgman). Used to tell "the same sheet, moved" from
  /// "a different sheet": below `LiveQuadSmoother.jumpOverlap` the smoother starts again instead of
  /// gliding the outline across the table from one to the other.
  static func iou(_ a: LiveQuad, _ b: LiveQuad) -> CGFloat {
    let inter = polygonArea(clip(subject: a.points, by: oriented(b.points)))
    let union = a.area + b.area - inter
    return union > 0 ? inter / union : 0
  }

  private static func oriented(_ p: [CGPoint]) -> [CGPoint] {
    LiveQuad(p).signedArea >= 0 ? p : p.reversed()
  }

  private static func clip(subject: [CGPoint], by clipper: [CGPoint]) -> [CGPoint] {
    var output = subject
    for i in 0..<clipper.count {
      guard !output.isEmpty else { break }
      let a = clipper[i], b = clipper[(i + 1) % clipper.count]
      let input = output
      output = []
      func inside(_ p: CGPoint) -> Bool { (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0 }
      func cut(_ p: CGPoint, _ q: CGPoint) -> CGPoint {
        let d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
        let d2 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)
        let t = d1 / (d1 - d2)
        return CGPoint(x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t)
      }
      for j in 0..<input.count {
        let p = input[j], q = input[(j + 1) % input.count]
        if inside(q) {
          if !inside(p) { output.append(cut(p, q)) }
          output.append(q)
        } else if inside(p) {
          output.append(cut(p, q))
        }
      }
    }
    return output
  }

  private static func polygonArea(_ p: [CGPoint]) -> CGFloat {
    guard p.count >= 3 else { return 0 }
    var sum: CGFloat = 0
    for i in 0..<p.count {
      let a = p[i], b = p[(i + 1) % p.count]
      sum += a.x * b.y - b.x * a.y
    }
    return abs(sum) / 2
  }
}

// MARK: - Smoothing for the eye (plan §4.3)

/// The One Euro filter (Casiez, Roussel, Vogel, CHI 2012): a low-pass filter whose cutoff rises with
/// speed — heavy smoothing while the phone is still (no shiver), light while it moves (no trailing).
struct OneEuroFilter {
  var minCutoff: Double
  var beta: Double
  var derivativeCutoff: Double

  private var lastValue: Double?
  private var lastDerivative: Double = 0
  private var lastTime: Double?

  init(minCutoff: Double, beta: Double, derivativeCutoff: Double = 1) {
    self.minCutoff = minCutoff
    self.beta = beta
    self.derivativeCutoff = derivativeCutoff
  }

  static func alpha(cutoff: Double, dt: Double) -> Double {
    let tau = 1 / (2 * Double.pi * cutoff)
    return 1 / (1 + tau / dt)
  }

  mutating func filter(_ value: Double, at time: Double) -> Double {
    guard let previous = lastValue, let previousTime = lastTime, time > previousTime else {
      lastValue = value
      lastTime = time
      return value
    }
    let dt = time - previousTime
    let derivative = (value - previous) / dt
    let aD = Self.alpha(cutoff: derivativeCutoff, dt: dt)
    lastDerivative = aD * derivative + (1 - aD) * lastDerivative
    let cutoff = minCutoff + beta * abs(lastDerivative)
    let a = Self.alpha(cutoff: cutoff, dt: dt)
    let smoothed = a * value + (1 - a) * previous
    lastValue = smoothed
    lastTime = time
    return smoothed
  }

  mutating func reset() {
    lastValue = nil
    lastTime = nil
    lastDerivative = 0
  }
}

/// A One Euro filter on each of the eight coordinates, in units of the view's DIAGONAL so the same
/// settings mean the same thing on an SE and a Pro Max.
///
/// ⚠ For DISPLAY ONLY. The decision to take a photo reads the RAW corners against an anchor (plan §3.2,
/// practice 5): a smoothed outline lags by construction, and a gate reading it would call a phone still
/// while it is still settling.
struct LiveQuadSmoother {
  /// docap's `tracker.ts` (`new OneEuroFilter(1.5, 4, 1)`, diagonal units). A starting point to tune
  /// on a phone with the authors' procedure (plan §4.3), not a measurement of ours.
  static let minCutoff = 1.5
  static let beta = 4.0
  /// Below this overlap with the last outline, the new one is a different sheet: start again.
  static let jumpOverlap: CGFloat = 0.5

  private var filters = (0..<8).map { _ in OneEuroFilter(minCutoff: minCutoff, beta: beta) }
  private(set) var current: LiveQuad?

  /// Returns the outline to draw. `diagonal` is the view's diagonal in the quad's units.
  mutating func update(_ raw: LiveQuad, at time: Double, diagonal: CGFloat) -> LiveQuad {
    if let previous = current, LiveQuadOverlap.iou(previous, raw) < Self.jumpOverlap { reset() }
    guard diagonal > 0 else { current = raw; return raw }
    var out: [CGPoint] = []
    for (i, p) in raw.points.enumerated() {
      let x = filters[2 * i].filter(Double(p.x / diagonal), at: time)
      let y = filters[2 * i + 1].filter(Double(p.y / diagonal), at: time)
      out.append(CGPoint(x: CGFloat(x) * diagonal, y: CGFloat(y) * diagonal))
    }
    let smoothed = LiveQuad(out)
    current = smoothed
    return smoothed
  }

  mutating func reset() {
    for i in filters.indices { filters[i].reset() }
    current = nil
  }
}

// MARK: - Found / lost, without flicker (plan §3.2)

/// When the outline appears and when it goes. Appearing needs a few valid detections in a row, so one
/// lucky frame of a table edge does not draw an outline; going needs a GAP in time, so one missed frame
/// does not make a found page blink.
struct LiveDetectionHysteresis {
  /// WeScan's funnel and Dynamsoft's stabiliser both wait for three.
  static let acquireFrames = 3
  /// docap's `gapMs: 180` — detection gaps shorter than this are forgiven.
  static let loseAfterSeconds = 0.18

  private(set) var visible = false
  private var consecutive = 0
  private var lastValidTime: Double?

  enum Change: Equatable { case none, appeared, disappeared }

  /// Feed every detection attempt, valid or not, with its frame time.
  mutating func feed(valid: Bool, at time: Double) -> Change {
    if valid {
      consecutive += 1
      lastValidTime = time
      if !visible, consecutive >= Self.acquireFrames {
        visible = true
        return .appeared
      }
      return .none
    }
    consecutive = 0
    if visible, let last = lastValidTime, time - last > Self.loseAfterSeconds {
      visible = false
      return .disappeared
    }
    return .none
  }

  mutating func reset() {
    visible = false
    consecutive = 0
    lastValidTime = nil
  }
}

// MARK: - Gliding between detections (plan §5 step 3)

/// A critically damped spring per coordinate, stepped on every display refresh. Detection arrives at
/// 15–30 Hz and the screen refreshes at 60–120 Hz; the spring is what makes the outline glide between
/// detections instead of stepping. Critically damped: it arrives as fast as a spring can without
/// overshooting, because an outline that bounces past the paper's edge reads as wrong.
struct CriticalSpring {
  /// ω in rad/s. A critically damped spring settles to within 2 % in about 5.8/ω — ~120 ms at 48,
  /// the plan's starting value. Tune on a phone against the outline-lag measurement L0 exists for.
  static let defaultOmega: Double = 48

  var omega: Double = defaultOmega
  private(set) var position: [Double] = []
  private var velocity: [Double] = []

  mutating func snap(to target: [Double]) {
    position = target
    velocity = Array(repeating: 0, count: target.count)
  }

  /// Advance by `dt` seconds toward `target`. Semi-implicit Euler, sub-stepped so a long frame (a hitch,
  /// a 30 Hz device) cannot make it unstable. The 0.1 s cap on `dt` changes no outcome (sub-stepping
  /// alone keeps it stable); it bounds the WORK, so a two-second stall costs 24 sub-steps, not 480.
  mutating func step(toward target: [Double], dt: Double) -> [Double] {
    if position.count != target.count { snap(to: target); return position }
    var remaining = min(max(dt, 0), 0.1)
    let maxStep = 1.0 / 240
    while remaining > 0 {
      let h = min(remaining, maxStep)
      for i in position.indices {
        let accel = omega * omega * (target[i] - position[i]) - 2 * omega * velocity[i]
        velocity[i] += accel * h
        position[i] += velocity[i] * h
      }
      remaining -= h
    }
    return position
  }
}

extension LiveQuad {
  var flattened: [Double] { points.flatMap { [Double($0.x), Double($0.y)] } }

  init(flattened v: [Double]) {
    precondition(v.count == 8, "a flattened LiveQuad has eight values")
    self.init((0..<4).map { CGPoint(x: v[2 * $0], y: v[2 * $0 + 1]) })
  }
}
