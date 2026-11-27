import CoreGraphics
import Foundation

// Checks for LiveCaptureGate.swift (D-LED6: no trace until the page is placed well and still; the
// trace's end takes the photo). Compiled beside LiveEdgeGeometryMain.swift, which calls this and owns
// `check`. Each check is written so the mutation it names makes it fail.

func liveCaptureGateChecks() {
  let frame = CGSize(width: 1080, height: 1440)
  let diagonal = hypot(frame.width, frame.height)
  // A well-placed page: 70 % × 70 % of the frame, centred, square-on.
  let good = LiveQuad(topLeft: CGPoint(x: 0.15, y: 0.15), topRight: CGPoint(x: 0.85, y: 0.15),
                      bottomRight: CGPoint(x: 0.85, y: 0.85), bottomLeft: CGPoint(x: 0.15, y: 0.85))
  func framing(_ q: LiveQuad?, scale: CGFloat = 3, floor: CGFloat = 1200) -> LiveCaptureBlocker? {
    LiveFramingCheck.blocker(q, imageSize: frame, photoScale: scale, minPageLongEdgePx: floor)
  }

  // MARK: framing

  check("a centred, square-on page that fills the frame passes framing", framing(good) == nil, "\(String(describing: framing(good)))")
  check("no outline is noPage", framing(nil) == .noPage)

  var cut = good
  cut.topLeft = CGPoint(x: 0.005, y: 0.15)
  check("a corner at the frame's edge is offEdge", framing(cut) == .offEdge, "\(String(describing: framing(cut)))")

  let small = LiveQuad(topLeft: CGPoint(x: 0.35, y: 0.35), topRight: CGPoint(x: 0.75, y: 0.35),
                       bottomRight: CGPoint(x: 0.75, y: 0.75), bottomLeft: CGPoint(x: 0.35, y: 0.75))
  // 0.4 × 0.4 = 16 % of the frame: a page to the validator (≥ 12 %), too far to read (< 25 %).
  check("a page under a quarter of the frame is tooFar", framing(small) == .tooFar, "\(String(describing: framing(small)))")

  // A trapezoid: top edge 0.4 wide, bottom 0.7 — the phone leaning over the page.
  let keystone = LiveQuad(topLeft: CGPoint(x: 0.3, y: 0.15), topRight: CGPoint(x: 0.7, y: 0.15),
                          bottomRight: CGPoint(x: 0.85, y: 0.85), bottomLeft: CGPoint(x: 0.15, y: 0.85))
  check("a strong keystone is tilted", framing(keystone) == .tilted, "\(String(describing: framing(keystone)))")

  // Top 0.62 vs bottom 0.70 = 0.886 ratio, corner skew ~3°: a slight lean still passes.
  let slight = LiveQuad(topLeft: CGPoint(x: 0.19, y: 0.15), topRight: CGPoint(x: 0.81, y: 0.15),
                        bottomRight: CGPoint(x: 0.85, y: 0.85), bottomLeft: CGPoint(x: 0.15, y: 0.85))
  check("a slight lean still passes framing", framing(slight) == nil, "\(String(describing: framing(slight)))")

  // The good page's long edge is 0.7 × 1440 = 1008 frame px. At 1 photo px per frame px that is under
  // a 1200 floor; at 3 (a 12 MP photo over a 1440 px frame) it is 3024.
  check("a page below the resolution floor is lowResolution", framing(good, scale: 1) == .lowResolution)
  check("the resolution floor is the one passed in, not a constant", framing(good, scale: 1, floor: 1000) == nil)

  // MARK: motion

  var motion = LiveMotionGate()
  motion.feed(acceleration: 0.05, rotation: 0.05, at: 0)
  check("calm readings are not still until they have lasted", !motion.still)
  motion.feed(acceleration: 0.05, rotation: 0.05, at: 0.3)
  check("calm readings for 250 ms are still", motion.still)
  motion.feed(acceleration: 0.22, rotation: 0.05, at: 0.35)
  check("a reading between the thresholds keeps the state (hysteresis)", motion.still)
  motion.feed(acceleration: 0.4, rotation: 0.05, at: 0.4)
  check("a jolt is moving at once", !motion.still)
  motion.feed(acceleration: 0.05, rotation: 0.9, at: 0.45)
  motion.feed(acceleration: 0.05, rotation: 0.05, at: 0.8)
  check("a turn of the wrist counts as moving", !motion.still)

  // MARK: the gate

  func px(_ q: LiveQuad) -> LiveQuad { q.mapped { CGPoint(x: $0.x * frame.width, y: $0.y * frame.height) } }
  func f(_ t: Double, _ q: LiveQuad? = good, still: Bool = true, settled: Bool = true) -> LiveCaptureGate.Frame {
    LiveCaptureGate.Frame(quad: q.map(px), framing: framing(q), phoneStill: still, cameraSettled: settled,
                          time: t, diagonal: diagonal)
  }
  let dt = 1.0 / 15

  /// Feeds frames from `from` to `to` and returns every non-`.none` action with its time.
  func run(_ gate: inout LiveCaptureGate, from: Double, to: Double, _ make: (Double) -> LiveCaptureGate.Frame) -> [(Double, LiveCaptureGate.Action)] {
    var out: [(Double, LiveCaptureGate.Action)] = []
    var t = from
    while t <= to + 1e-9 {
      let a = gate.feed(make(t))
      if a != .none { out.append((t, a)) }
      t += dt
    }
    return out
  }

  do {
    var gate = LiveCaptureGate()
    let actions = run(&gate, from: 0, to: 2) { f($0) }
    let start = actions.first { $0.1 == .startTrace }?.0
    let fire = actions.first { $0.1 == .fire }?.0
    check("a still, well-placed page starts the trace", start != nil, "\(actions)")
    check("the trace does not start before the page has settled",
          (start ?? 0) >= LiveCaptureGate.settleSeconds - 1e-9, "started at \(start ?? -1)")
    check("the photo is taken when the trace ends, not before",
          fire != nil && (fire! - start!) >= LiveCaptureGate.traceSeconds - 1e-9, "start \(start ?? -1) fire \(fire ?? -1)")
    check("the photo is taken once", actions.filter { $0.1 == .fire }.count == 1, "\(actions)")
    check("the trace's progress reads 1 once the photo is asked for", gate.traceProgress(at: 99) == 1)
  }

  do {
    var gate = LiveCaptureGate()
    let actions = run(&gate, from: 0, to: 2) { f($0, still: false) }
    check("a moving phone never starts the trace", actions.isEmpty, "\(actions)")
    check("and the reason is moving", gate.phase == .waiting(.moving), "\(gate.phase)")
  }

  do {
    var gate = LiveCaptureGate()
    let actions = run(&gate, from: 0, to: 2) { f($0, settled: false) }
    check("a camera still focusing never starts the trace", actions.isEmpty && gate.phase == .waiting(.focusing), "\(gate.phase)")
  }

  do {
    var gate = LiveCaptureGate()
    let actions = run(&gate, from: 0, to: 2) { f($0, small) }
    check("a page too far away never starts the trace", actions.isEmpty && gate.phase == .waiting(.tooFar), "\(gate.phase)")
  }

  do {
    // The page slides 3 % of the diagonal halfway through the trace: the trace must rewind, no photo.
    let shift = 0.03 * diagonal / frame.width
    var started: Double?
    var gate2 = LiveCaptureGate()
    var acts: [(Double, LiveCaptureGate.Action)] = []
    var t = 0.0
    while t <= 2 {
      let moved = started.map { t - $0 > LiveCaptureGate.traceSeconds / 2 } ?? false
      let a = gate2.feed(f(t, moved ? good.mapped { CGPoint(x: $0.x + shift, y: $0.y) } : good))
      if a == .startTrace, started == nil { started = t }
      if a != .none { acts.append((t, a)) }
      if a == .cancelTrace { break }
      t += dt
    }
    check("a page that moves during the trace rewinds it", acts.contains { $0.1 == .cancelTrace }, "\(acts)")
    check("and no photo is taken", !acts.contains { $0.1 == .fire }, "\(acts)")
    check("and the reason is moving", gate2.phase == .waiting(.moving), "\(gate2.phase)")
  }

  do {
    // A creep: 0.4 % of the diagonal per frame. Frame to frame it is always under tolerance; against
    // the anchor it crosses 1.5 % within four frames. The trace must not complete.
    var gate = LiveCaptureGate()
    let step = 0.004 * diagonal / frame.width
    var acts: [LiveCaptureGate.Action] = []
    var t = 0.0, i = 0.0
    while t <= 3 {
      let a = gate.feed(f(t, good.mapped { CGPoint(x: $0.x + step * i, y: $0.y) }))
      if a != .none { acts.append(a) }
      t += dt
      i += 1
      if 0.15 + step * i > 0.3 { break }
    }
    check("a slow creep never reaches the photo (anchor, not frame to frame)", !acts.contains(.fire), "\(acts)")
  }

  do {
    // A focus hunt during the trace also rewinds it.
    var gate = LiveCaptureGate()
    var acts: [LiveCaptureGate.Action] = []
    var started: Double?
    var t = 0.0
    while t <= 2 {
      let hunting = started.map { t - $0 > 0.3 } ?? false
      let a = gate.feed(f(t, settled: !hunting))
      if a == .startTrace, started == nil { started = t }
      if a != .none { acts.append(a) }
      if a == .cancelTrace { break }
      t += dt
    }
    check("the camera refocusing during the trace rewinds it", acts.last == .cancelTrace && !acts.contains(.fire), "\(acts)")
  }

  do {
    // After a photo, the same page held still must not be shot again; taking it away and bringing a
    // page back re-arms.
    var gate = LiveCaptureGate()
    _ = run(&gate, from: 0, to: 1.5) { f($0) }
    gate.captureFinished(ok: true, at: 1.5)
    let again = run(&gate, from: 1.5, to: 4) { f($0) }
    check("the same page is not shot twice", again.isEmpty && gate.phase == .captured, "\(again) \(gate.phase)")
    _ = run(&gate, from: 4, to: 4.4) { f($0, nil) }
    check("a page gone for less than the re-arm time keeps the gate captured", gate.phase == .captured, "\(gate.phase)")
    _ = run(&gate, from: 4.4, to: 4.7) { f($0, nil) }
    check("a page gone for the re-arm time re-arms the gate", gate.phase != .captured, "\(gate.phase)")
    let next = run(&gate, from: 4.7, to: 7) { f($0) }
    check("and the next page is taken", next.contains { $0.1 == .fire }, "\(next)")
  }

  do {
    // A different sheet replacing the captured one without leaving the frame also re-arms.
    var gate = LiveCaptureGate()
    _ = run(&gate, from: 0, to: 1.5) { f($0) }
    gate.captureFinished(ok: true, at: 1.5)
    let other = LiveQuad(topLeft: CGPoint(x: 0.02, y: 0.4), topRight: CGPoint(x: 0.6, y: 0.4),
                         bottomRight: CGPoint(x: 0.6, y: 0.97), bottomLeft: CGPoint(x: 0.02, y: 0.97))
    _ = run(&gate, from: 1.5, to: 1.8) { f($0, other) }
    check("a different page re-arms the gate without the first leaving", gate.phase != .captured, "\(gate.phase)")
  }

  do {
    var gate = LiveCaptureGate()
    _ = run(&gate, from: 0, to: 1.5) { f($0) }
    gate.captureFinished(ok: false, at: 1.5)
    check("a failed photo re-arms instead of stranding the gate", gate.phase == .waiting(.noPage), "\(gate.phase)")
  }
}
