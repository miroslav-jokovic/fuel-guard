import AVFoundation
import ExpoModulesCore
import UIKit
import Vision

// The live edge camera — step L0 of LIVE-EDGE-DETECTION-PLAN.md (D-LED2): our own camera with the
// document outline drawn NATIVELY over the preview, so the outline never waits on the JavaScript
// thread or the bridge. JavaScript receives only events, throttled, for the spike's measurements.
//
// L0 is deliberately a viewfinder and nothing more: no photo, no gate, no auto-capture. It exists to
// answer three things on a real phone before the rest is built — how fast detection runs, how far the
// drawn outline trails the paper, and whether the owner prefers it to the VisionKit screen drivers have
// today. Every decision it makes is in `LiveEdgeGeometry.swift`, which is tested without a camera.
//
// Detector: Apple's `VNDetectDocumentSegmentationRequest` (candidate (b), plan §4.5) through a
// `VNSequenceRequestHandler`, which keeps state between frames. It is the cheapest candidate to stand up
// and the one VisionKit itself uses, so it is the honest first baseline; the heatmap model (a) is
// measured against it next.

final class LiveEdgeCameraView: ExpoView {
  let onDetection = EventDispatcher()
  let onCameraState = EventDispatcher()

  var active = true { didSet { updateRunning() } }
  var strokeColor: UIColor = .white { didSet { applyColors() } }
  var fillColor: UIColor = UIColor.white.withAlphaComponent(0.12) { didSet { applyColors() } }

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "capture-native.live-edge.session")
  private let previewLayer: AVCaptureVideoPreviewLayer
  private let fillLayer = CAShapeLayer()
  private let strokeLayer = CAShapeLayer()
  private let detector = LiveEdgeFrameDetector()
  private let haptic = UIImpactFeedbackGenerator(style: .light)

  private var configured = false
  private var running = false
  private var displayLink: CADisplayLink?
  private var lastTick: CFTimeInterval?

  private var hysteresis = LiveDetectionHysteresis()
  private var smoother = LiveQuadSmoother()
  private var spring = CriticalSpring()
  private var target: LiveQuad?
  private var lastConfidence: Float = 0
  private var lastLatencyMs: Double = 0
  private var detectionTimes: [Double] = []
  private var lastEventTime: Double = 0
  /// At most this many `onDetection` events a second. The overlay is native; the events exist for the
  /// spike's readout, and 10 Hz is plenty to read while staying off the bridge's back.
  private static let eventHz: Double = 10

  required init(appContext: AppContext? = nil) {
    previewLayer = AVCaptureVideoPreviewLayer(session: session)
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)

    for shape in [fillLayer, strokeLayer] {
      shape.opacity = 0
      shape.lineJoin = .round
      shape.lineCap = .round
      layer.addSublayer(shape)
    }
    fillLayer.strokeColor = nil
    strokeLayer.fillColor = nil
    strokeLayer.lineWidth = 3
    applyColors()

    detector.onResult = { [weak self] result in
      DispatchQueue.main.async { self?.handle(result) }
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    previewLayer.frame = bounds
    fillLayer.frame = bounds
    strokeLayer.frame = bounds
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateRunning()
  }

  deinit {
    displayLink?.invalidate()
    let session = self.session
    sessionQueue.async { if session.isRunning { session.stopRunning() } }
  }

  private func applyColors() {
    strokeLayer.strokeColor = strokeColor.cgColor
    fillLayer.fillColor = fillColor.cgColor
  }

  // MARK: Session

  private func updateRunning() {
    let shouldRun = active && window != nil
    guard shouldRun != running else { return }
    running = shouldRun
    if shouldRun { start() } else { stop() }
  }

  private func start() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      startSession()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        DispatchQueue.main.async {
          guard let self, self.running else { return }
          if granted { self.startSession() } else { self.onCameraState(["status": "denied"]) }
        }
      }
    default:
      onCameraState(["status": "denied"])
    }
  }

  private func startSession() {
    let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
    link.add(to: .main, forMode: .common)
    displayLink = link
    lastTick = nil
    sessionQueue.async { [weak self] in
      guard let self else { return }
      if !self.configured {
        if let failure = self.configure() {
          DispatchQueue.main.async { self.onCameraState(["status": "failed", "detail": failure]) }
          return
        }
        self.configured = true
      }
      self.session.startRunning()
      DispatchQueue.main.async { self.onCameraState(["status": "ready"]) }
    }
  }

  private func stop() {
    displayLink?.invalidate()
    displayLink = nil
    resetTracking()
    let session = self.session
    sessionQueue.async { if session.isRunning { session.stopRunning() } }
  }

  /// Runs on `sessionQueue`. Returns a reason when the camera cannot be set up, nil on success.
  private func configure() -> String? {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    // 1080p: enough for the detector (which works far smaller) and cheap enough to keep 30 fps. The
    // photo the gate judges is NOT this stream — L5 takes a full-resolution still for that.
    if session.canSetSessionPreset(.hd1920x1080) { session.sessionPreset = .hd1920x1080 }
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
      return "no back camera"
    }
    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
      return "camera input refused"
    }
    session.addInput(input)

    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    output.setSampleBufferDelegate(detector, queue: detector.queue)
    guard session.canAddOutput(output) else { return "video output refused" }
    session.addOutput(output)

    if (try? device.lockForConfiguration()) != nil {
      if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
      if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
      // A document is held 20–50 cm away; telling autofocus so stops it hunting to infinity first.
      if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
      device.unlockForConfiguration()
    }
    return nil
  }

  // MARK: Detection results (main thread)

  private func handle(_ result: LiveEdgeFrameResult) {
    guard running else { return }
    detectionTimes.append(result.time)
    detectionTimes.removeAll { result.time - $0 > 1 }
    lastLatencyMs = result.latencyMs

    var screenQuad: LiveQuad?
    if let normalized = result.quad {
      let pixels = normalized.mapped { CGPoint(x: $0.x * result.imageSize.width, y: $0.y * result.imageSize.height) }
      if LiveQuadValidator.check(pixels, imageSize: result.imageSize) == .ok {
        screenQuad = normalized.mapped {
          LiveEdgeMapping.aspectFill($0, imageSize: result.imageSize, viewSize: bounds.size)
        }
        lastConfidence = result.confidence
      }
    }

    let diagonal = hypot(bounds.width, bounds.height)
    if let quad = screenQuad { target = smoother.update(quad, at: result.time, diagonal: diagonal) }

    switch hysteresis.feed(valid: screenQuad != nil, at: result.time) {
    case .appeared: appear()
    case .disappeared: disappear()
    case .none: break
    }
    emitEvent(at: result.time)
  }

  private func emitEvent(at time: Double) {
    guard time - lastEventTime >= 1 / Self.eventHz else { return }
    lastEventTime = time
    var payload: [String: Any] = [
      "state": hysteresis.visible ? "tracking" : "searching",
      "detectFps": detectionTimes.count,
      "latencyMs": (lastLatencyMs * 10).rounded() / 10,
      "confidence": Double(lastConfidence),
    ]
    if hysteresis.visible, let quad = target, bounds.width > 0, bounds.height > 0 {
      payload["corners"] = quad.points.map { [Double($0.x / bounds.width), Double($0.y / bounds.height)] }
    }
    onDetection(payload)
  }

  // MARK: Drawing

  private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

  /// The Genius moment (plan §5 step 2): the stroke runs once around the page from its top-left corner
  /// and the tint fades in behind it.
  private func appear() {
    guard let quad = target else { return }
    spring.snap(to: quad.flattened)
    setPath(quad)
    fillLayer.removeAllAnimations()
    strokeLayer.removeAllAnimations()
    fillLayer.opacity = 1
    strokeLayer.opacity = 1
    strokeLayer.strokeEnd = 1
    haptic.impactOccurred()
    guard !reduceMotion else { return }

    let draw = CABasicAnimation(keyPath: "strokeEnd")
    draw.fromValue = 0
    draw.toValue = 1
    draw.duration = 0.28
    draw.timingFunction = CAMediaTimingFunction(name: .easeOut)
    strokeLayer.add(draw, forKey: "drawIn")

    let tint = CABasicAnimation(keyPath: "opacity")
    tint.fromValue = 0
    tint.toValue = 1
    tint.duration = 0.28
    fillLayer.add(tint, forKey: "tintIn")
  }

  /// Fades, never snaps out of sight (plan §5 step 6).
  private func disappear() {
    for shape in [fillLayer, strokeLayer] {
      let fade = CABasicAnimation(keyPath: "opacity")
      fade.fromValue = shape.presentation()?.opacity ?? shape.opacity
      fade.toValue = 0
      fade.duration = reduceMotion ? 0 : 0.15
      shape.opacity = 0
      shape.add(fade, forKey: "fadeOut")
    }
    smoother.reset()
    target = nil
  }

  private func resetTracking() {
    hysteresis.reset()
    smoother.reset()
    target = nil
    fillLayer.opacity = 0
    strokeLayer.opacity = 0
    detector.reset()
  }

  @objc private func tick(_ link: CADisplayLink) {
    let now = link.timestamp
    let dt = lastTick.map { now - $0 } ?? 0
    lastTick = now
    guard hysteresis.visible, let quad = target else { return }
    let drawn = reduceMotion ? quad.flattened : spring.step(toward: quad.flattened, dt: dt)
    if reduceMotion { spring.snap(to: drawn) }
    setPath(LiveQuad(flattened: drawn))
  }

  private func setPath(_ quad: LiveQuad) {
    let path = UIBezierPath()
    path.move(to: quad.topLeft)
    path.addLine(to: quad.topRight)
    path.addLine(to: quad.bottomRight)
    path.addLine(to: quad.bottomLeft)
    path.close()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    strokeLayer.path = path.cgPath
    fillLayer.path = path.cgPath
    CATransaction.commit()
  }
}

// MARK: - Frame detector (video queue)

struct LiveEdgeFrameResult {
  /// Normalised to the ORIENTED (portrait) image, top-left origin. Nil when nothing was found.
  let quad: LiveQuad?
  let confidence: Float
  /// The oriented image's size in pixels.
  let imageSize: CGSize
  /// The frame's capture time, seconds on the host clock.
  let time: Double
  /// From the frame's capture to the end of detection.
  let latencyMs: Double
}

/// The sample-buffer delegate, kept apart from the view so nothing main-thread-only is touched from the
/// video queue. Detection runs synchronously inside the callback; with `alwaysDiscardsLateVideoFrames`
/// that is the throttle — a frame arriving while one is being read is dropped by AVFoundation, so the
/// detector runs as fast as it can and never queues up stale frames.
final class LiveEdgeFrameDetector: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  let queue = DispatchQueue(label: "capture-native.live-edge.video", qos: .userInitiated)
  var onResult: ((LiveEdgeFrameResult) -> Void)?

  private var sequence = VNSequenceRequestHandler()
  private let request = VNDetectDocumentSegmentationRequest()

  func reset() {
    queue.async { self.sequence = VNSequenceRequestHandler() }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    // Camera sample buffers are stamped on the host clock, the same clock `CACurrentMediaTime` reads,
    // so the difference is the real time from capture to answer.
    let frameTime = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    // The app is portrait-only (app.config.ts) and the back camera's sensor is landscape: `.right` is
    // the rotation that makes the buffer upright, so Vision sees the page the way the driver does and
    // its coordinates are already portrait.
    let width = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
    let height = CGFloat(CVPixelBufferGetHeight(pixelBuffer))
    let orientedSize = CGSize(width: height, height: width)

    var quad: LiveQuad?
    var confidence: Float = 0
    do {
      try sequence.perform([request], on: pixelBuffer, orientation: .right)
      if let best = request.results?.max(by: { $0.confidence < $1.confidence }) {
        quad = LiveQuad(
          topLeft: LiveEdgeMapping.fromVision(best.topLeft),
          topRight: LiveEdgeMapping.fromVision(best.topRight),
          bottomRight: LiveEdgeMapping.fromVision(best.bottomRight),
          bottomLeft: LiveEdgeMapping.fromVision(best.bottomLeft)
        )
        confidence = best.confidence
      }
    } catch {
      quad = nil
    }
    let latency = max(0, (CACurrentMediaTime() - frameTime) * 1000)
    onResult?(LiveEdgeFrameResult(quad: quad, confidence: confidence, imageSize: orientedSize, time: frameTime, latencyMs: latency))
  }
}
