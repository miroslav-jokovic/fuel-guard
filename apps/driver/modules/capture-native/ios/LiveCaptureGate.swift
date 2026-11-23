import CoreGraphics
import Foundation

// The capture gate — when the live edge camera may take its photo (LIVE-EDGE-DETECTION-PLAN.md §3.2,
// as the owner restated it on 2026-11-23, D-LED6):
//
//   "The app must not take a scan until the camera and the document are in a position that makes our
//    normalisation decent; the edge animation must not start until those conditions are met; and when
//    the animation ends, it takes the scan."
//
// So the outline is not drawn the moment a page is seen (plan §5 step 2 said it was; the owner's rule
// replaces that). Nothing is drawn while a condition fails — the screen says which one, in words. When
// every condition holds, the outline TRACES itself around the page; the trace IS the hold-still timer.
// If any condition breaks during the trace, it rewinds and the gate starts again. When the trace
// completes on a frame that still passes, the photo is taken.
//
// Pure Foundation/CoreGraphics like `LiveEdgeGeometry.swift`, for the same reason: it is compiled and
// checked by `tests/ios/run-live-edge-tests.sh` with plain swiftc, with no phone, camera or simulator.
// The camera view owns the I/O and calls in here for every decision.
//
// ⚠ Every threshold below is a STARTING value with its source named, not a measurement of ours. Step L3
// moves the machine to signed configuration and re-derives the numbers from recorded captures
// (Step 5.2's method); until then they are constants here, which is a restatement waiting on L3.

/// Why the gate is not taking the photo — the first failing condition, in the order the driver should
/// fix them. The raw values are the event's wire format; the words live in the JavaScript screen.
enum LiveCaptureBlocker: String {
  /// No page outline in the frame (or nothing a page could be).
  case noPage
  /// A corner is at or past the frame's edge: part of the page would be cut off.
  case offEdge
  /// The page fills too little of the frame.
  case tooFar
  /// The page is seen at too steep an angle: straightening it would stretch one end.
  case tilted
  /// The straightened page would be smaller than the quality gate's resolution floor.
  case lowResolution
  /// The camera is still focusing or adjusting exposure.
  case focusing
  /// The phone, or the page in the frame, is moving.
  case moving
}

// MARK: - Framing: is this page placed well enough to straighten?

enum LiveFramingCheck {
  /// The page must cover a quarter of the frame. The validator's 12 % (findDocument.ts) answers "is
  /// this a page at all"; this answers "is it close enough to read", and is double it as a start.
  static let minAreaFraction: CGFloat = 0.25
  /// Every corner at least this far (fraction of the frame) inside the edge, so the detector's error
  /// cannot put a real corner outside the photo.
  static let edgeMarginFraction: CGFloat = 0.015
  /// A corner more than this far off square means the phone is tilted over the page. Half the
  /// validator's 40°, which only refuses shapes that cannot be a page.
  static let maxCornerSkewDegrees: CGFloat = 20
  /// Opposite edges must be within this ratio of each other; below it the far end of the page is
  /// sampled at too few pixels for the straightened image to stay even.
  static let minOppositeEdgeRatio: CGFloat = 0.8

  /// - Parameters:
  ///   - normalized: the RAW detected outline, normalised to the oriented frame (top-left origin).
  ///   - imageSize: the oriented frame's size in pixels.
  ///   - photoScale: photo pixels per frame pixel (same field of view, D-LED7).
  ///   - minPageLongEdgePx: the quality gate's `resolutionMinLongEdgePx`, passed in from the signed
  ///     capture config by JavaScript so it is read from one place, not restated here.
  static func blocker(
    _ normalized: LiveQuad?,
    imageSize: CGSize,
    photoScale: CGFloat,
    minPageLongEdgePx: CGFloat
  ) -> LiveCaptureBlocker? {
    guard let normalized, imageSize.width > 0, imageSize.height > 0 else { return .noPage }
    let m = edgeMarginFraction
    for p in normalized.points where p.x < m || p.y < m || p.x > 1 - m || p.y > 1 - m {
      return .offEdge
    }
    let px = normalized.mapped { CGPoint(x: $0.x * imageSize.width, y: $0.y * imageSize.height) }
    switch LiveQuadValidator.check(px, imageSize: imageSize) {
    case .ok: break
    case .tooSmall: return .tooFar
    case .cornerSkewed: return .tilted
    case .notConvex: return .noPage
    }
    if px.area < minAreaFraction * imageSize.width * imageSize.height { return .tooFar }

    let p = px.points
    for i in 0..<4 {
      let angle = LiveQuadValidator.cornerAngleDegrees(p[(i + 3) % 4], p[i], p[(i + 1) % 4])
      if abs(angle - 90) > maxCornerSkewDegrees { return .tilted }
    }
    let side = (0..<4).map { hypot(p[($0 + 1) % 4].x - p[$0].x, p[($0 + 1) % 4].y - p[$0].y) }
    // side[0] top, side[1] right, side[2] bottom, side[3] left.
    for (a, b) in [(side[0], side[2]), (side[1], side[3])] where max(a, b) > 0 {
      if min(a, b) / max(a, b) < minOppositeEdgeRatio { return .tilted }
    }

    // The straightened page's long edge, conservatively: the SHORTER of each pair of opposite sides
    // (the far end is what limits it), the longer of those two, scaled to the photo.
    let longEdgePx = max(min(side[0], side[2]), min(side[1], side[3])) * photoScale
    if longEdgePx < minPageLongEdgePx { return .lowResolution }
    return nil
  }
}

// MARK: - Is the phone still? (motion sensors)

/// The motion sensors' answer, with hysteresis: calm only after the readings have stayed low for a
/// while, moving as soon as one is clearly high, and in between the state holds. ScanFromCam's values
/// for user acceleration (calm < 0.18 m/s² for 250 ms, moving > 0.28 m/s²); the rotation thresholds
/// are ours, a hand's tremor being well under 0.3 rad/s.
struct LiveMotionGate {
  static let calmAcceleration = 0.18
  static let movingAcceleration = 0.28
  static let calmRotation = 0.3
  static let movingRotation = 0.5
  static let calmForSeconds = 0.25

  private(set) var still = false
  private var calmSince: Double?

  /// - Parameters: acceleration in m/s² (gravity removed), rotation in rad/s, both magnitudes.
  @discardableResult
  mutating func feed(acceleration: Double, rotation: Double, at time: Double) -> Bool {
    if acceleration > Self.movingAcceleration || rotation > Self.movingRotation {
      still = false
      calmSince = nil
    } else if acceleration < Self.calmAcceleration && rotation < Self.calmRotation {
      if calmSince == nil { calmSince = time }
      if let since = calmSince, time - since >= Self.calmForSeconds { still = true }
    } else {
      calmSince = nil
    }
    return still
  }

  mutating func reset() {
    still = false
    calmSince = nil
  }
}

// MARK: - The gate

struct LiveCaptureGate {
  /// Valid frames in a row before anything starts (WeScan, Dynamsoft).
  static let acquireFrames = 3
  /// The page's corners must already have held inside the tolerance for this long before the trace
  /// starts, so a trace does not begin on a page still being put down.
  static let settleSeconds = 0.2
  /// The trace — and therefore the hold — lasts this long. docap holds 650 ms; the trace adds a little
  /// so the driver can see it is about to happen.
  static let traceSeconds = 0.8
  /// A raw corner moving more than this (fraction of the frame diagonal) from where it stood when the
  /// hold began is movement (docap: 1.5 %, against an ANCHOR, not frame to frame, so a slow creep
  /// cannot pass).
  static let anchorTolerance: CGFloat = 0.015
  /// After a photo, the gate re-arms only once the page has been out of sight this long...
  static let rearmGoneSeconds = 0.5
  /// ...or a DIFFERENT page (overlap with the captured one below this) has been seen for
  /// `acquireFrames` frames. Without this the same page is shot twice (docap).
  static let rearmNewPageOverlap: CGFloat = 0.5

  enum Phase: Equatable {
    /// Not ready; the blocker is the reason, nil while the page is settling before the trace.
    case waiting(LiveCaptureBlocker?)
    case tracing(startedAt: Double)
    /// The photo has been asked for and has not come back.
    case capturing
    /// The photo was taken; waiting for this page to leave or another to arrive.
    case captured
  }

  enum Action: Equatable { case none, startTrace, cancelTrace, fire }

  struct Frame {
    /// The raw outline in frame PIXELS, nil when none was found.
    var quad: LiveQuad?
    /// `LiveFramingCheck`'s answer for this frame.
    var framing: LiveCaptureBlocker?
    var phoneStill: Bool
    var cameraSettled: Bool
    var time: Double
    /// The frame's diagonal in pixels (the unit `anchorTolerance` is a fraction of).
    var diagonal: CGFloat
  }

  private(set) var phase: Phase = .waiting(.noPage)
  /// The outline the trace started on, and the one the photo was taken of.
  private(set) var anchor: LiveQuad?
  private(set) var capturedQuad: LiveQuad?
  private var anchorTime: Double = 0
  private var goodFrames = 0
  private var lastSeen: Double = 0
  private var newPageFrames = 0

  /// How far through the trace, 0–1. The drawn outline's `strokeEnd` is this, so the animation is the
  /// gate's own clock and cannot drift from the moment the photo is taken.
  func traceProgress(at time: Double) -> Double {
    switch phase {
    case .tracing(let start): return min(1, max(0, (time - start) / Self.traceSeconds))
    case .capturing, .captured: return 1
    case .waiting: return 0
    }
  }

  mutating func feed(_ f: Frame) -> Action {
    let blocker = f.framing ?? (f.cameraSettled ? nil : .focusing) ?? (f.phoneStill ? nil : .moving)

    switch phase {
    case .capturing:
      return .none

    case .captured:
      guard let quad = f.quad, f.framing != .noPage else {
        if f.time - lastSeen >= Self.rearmGoneSeconds { rearm() }
        return .none
      }
      lastSeen = f.time
      if let captured = capturedQuad, LiveQuadOverlap.iou(captured, quad) < Self.rearmNewPageOverlap {
        newPageFrames += 1
        if newPageFrames >= Self.acquireFrames { rearm() }
      } else {
        newPageFrames = 0
      }
      return .none

    case .waiting:
      guard blocker == nil, let quad = f.quad else {
        goodFrames = 0
        anchor = nil
        phase = .waiting(blocker ?? .noPage)
        return .none
      }
      goodFrames += 1
      if let a = anchor, Self.drift(from: a, to: quad, diagonal: f.diagonal) <= Self.anchorTolerance {
        // Still where it was: the settle clock keeps running from the anchor's time.
      } else {
        anchor = quad
        anchorTime = f.time
      }
      if goodFrames >= Self.acquireFrames, f.time - anchorTime >= Self.settleSeconds {
        phase = .tracing(startedAt: f.time)
        return .startTrace
      }
      phase = .waiting(nil)
      return .none

    case .tracing(let start):
      let moved = f.quad.map { q in anchor.map { Self.drift(from: $0, to: q, diagonal: f.diagonal) > Self.anchorTolerance } ?? true } ?? true
      if let reason = blocker ?? (moved ? .moving : nil) {
        goodFrames = 0
        anchor = nil
        phase = .waiting(reason)
        return .cancelTrace
      }
      if f.time - start >= Self.traceSeconds {
        capturedQuad = f.quad
        phase = .capturing
        return .fire
      }
      return .none
    }
  }

  /// The view reports the photo's outcome. A failed photo starts again rather than stranding the gate.
  mutating func captureFinished(ok: Bool, at time: Double) {
    guard phase == .capturing else { return }
    if ok {
      phase = .captured
      lastSeen = time
      newPageFrames = 0
    } else {
      rearm()
    }
  }

  mutating func reset() { rearm() }

  private mutating func rearm() {
    phase = .waiting(.noPage)
    anchor = nil
    capturedQuad = nil
    goodFrames = 0
    newPageFrames = 0
  }

  /// The largest distance any corner has moved, as a fraction of `diagonal`.
  static func drift(from a: LiveQuad, to b: LiveQuad, diagonal: CGFloat) -> CGFloat {
    guard diagonal > 0 else { return .infinity }
    return zip(a.points, b.points).map { hypot($0.x - $1.x, $0.y - $1.y) }.max()! / diagonal
  }
}
