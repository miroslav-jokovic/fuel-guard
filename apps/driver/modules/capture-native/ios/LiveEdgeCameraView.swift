import AVFoundation
import CoreMotion
import ExpoModulesCore
import UIKit
import Vision

// The live edge camera — LIVE-EDGE-DETECTION-PLAN.md, D-LED2: our own camera with the document outline
// drawn NATIVELY over the preview, so the outline never waits on the JavaScript thread or the bridge.
//
// It takes the photo itself, under the capture gate the owner set on 2026-11-23 (D-LED6,
// `LiveCaptureGate.swift`): nothing is drawn until the page is placed well enough to straighten and the
// phone and page are still; then the outline traces itself around the page, and when the trace ends the
// photo is taken. Any condition breaking during the trace rewinds it. JavaScript is told why the gate is
// waiting (`blocker`) and gets the photo (`onCapture`); every decision is in `LiveCaptureGate.swift` and
// `LiveEdgeGeometry.swift`, which are tested without a camera (`tests/ios/run-live-edge-tests.sh`).
//
// Detector: Apple's `VNDetectDocumentSegmentationRequest` (candidate (b), plan §4.5) through a
// `VNSequenceRequestHandler`, which keeps state between frames. The heatmap model (a) is measured
// against it at L1/L2 and replaces it here if it wins on our photos.

final class LiveEdgeCameraView: ExpoView {
  let onDetection = EventDispatcher()
  let onCameraState = EventDispatcher()
  let onCapture = EventDispatcher()

  var active = true { didSet { updateRunning() } }
  var strokeColor: UIColor = .white { didSet { applyColors() } }
  var fillColor: UIColor = UIColor.white.withAlphaComponent(0.12) { didSet { applyColors() } }
  /// The outline's colour from the moment the photo is asked for.
  var successColor: UIColor = .green
  /// The quality gate's `resolutionMinLongEdgePx`, from the signed capture config. JavaScript always
  /// passes it (`live-edge.tsx`); zero would switch the resolution condition off, never on.
  var minPageLongEdgePx: Double = 0

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "capture-native.live-edge.session")
  private let previewLayer: AVCaptureVideoPreviewLayer
  private let fillLayer = CAShapeLayer()
  private let strokeLayer = CAShapeLayer()
  private let flashLayer = CALayer()
  private let detector = LiveEdgeFrameDetector()
  private let photoOutput = AVCapturePhotoOutput()
  private let motion = CMMotionManager()
  private let lightHaptic = UIImpactFeedbackGenerator(style: .light)
  private let shutterHaptic = UIImpactFeedbackGenerator(style: .medium)

  private var device: AVCaptureDevice?
  /// The photo's long edge in pixels, known once the session is configured (0 until then).
  private var photoLongEdge: CGFloat = 0
  private var photoInFlight: LiveEdgePhotoCapture?
  private var configured = false
  private var running = false
  private var displayLink: CADisplayLink?
  private var lastTick: CFTimeInterval?

  private var gate = LiveCaptureGate()
  private var motionGate = LiveMotionGate()
  private var hysteresis = LiveDetectionHysteresis()
  private var smoother = LiveQuadSmoother()
  private var spring = CriticalSpring()
  /// The smoothed outline in VIEW coordinates — what is drawn.
  private var target: LiveQuad?
  /// The last raw outline, normalised to the frame — what the photo is cropped to.
  private var lastNormalized: LiveQuad?
  private var lastConfidence: Float = 0
  private var lastLatencyMs: Double = 0
  private var detectionTimes: [Double] = []
  private var lastEventTime: Double = 0
  /// At most this many `onDetection` events a second. The outline and the gate are native; the events
  /// carry the readout and the reason the gate is waiting, and 10 Hz is plenty for both.
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
    strokeLayer.lineWidth = 4
    strokeLayer.strokeEnd = 0
    flashLayer.backgroundColor = UIColor.white.cgColor
    flashLayer.opacity = 0
    layer.addSublayer(flashLayer)
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
    flashLayer.frame = bounds
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateRunning()
  }

  deinit {
    displayLink?.invalidate()
    motion.stopDeviceMotionUpdates()
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
    startMotion()
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
    motion.stopDeviceMotionUpdates()
    resetTracking()
    let session = self.session
    sessionQueue.async { if session.isRunning { session.stopRunning() } }
  }

  /// Device motion at 60 Hz into `LiveMotionGate`. User acceleration is in g with gravity removed.
  /// No permission is needed for device motion (only activity and pedometer data ask).
  private func startMotion() {
    guard motion.isDeviceMotionAvailable else {
      // No sensor to ask: the outline's own anchor test is then the only stillness check.
      motionGate.feed(acceleration: 0, rotation: 0, at: 0)
      motionGate.feed(acceleration: 0, rotation: 0, at: LiveMotionGate.calmForSeconds)
      return
    }
    motionGate.reset()
    motion.deviceMotionUpdateInterval = 1.0 / 60
    motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
      guard let self, let data else { return }
      let a = data.userAcceleration, r = data.rotationRate
      self.motionGate.feed(
        acceleration: (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot() * 9.81,
        rotation: (r.x * r.x + r.y * r.y + r.z * r.z).squareRoot(),
        at: data.timestamp
      )
    }
  }

  /// Runs on `sessionQueue`. Returns a reason when the camera cannot be set up, nil on success.
  ///
  /// D-LED7: the preview frames and the photo share ONE 4:3 field of view, so the corners found on a
  /// frame are the corners on the photo, scaled. (The old 1080p preset was 16:9, a crop of the sensor
  /// the photo does not share — corners from it would land in the wrong place.) A format whose frames
  /// are at most 1920 px wide keeps detection at 30 fps; its photos are still full resolution.
  private func configure() -> String? {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
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
    guard session.canAddOutput(photoOutput) else { return "photo output refused" }
    session.addOutput(photoOutput)
    // Portrait, as the app is and as Vision reads the frames (`.right`): the JPEG then carries the
    // rotation that makes it upright, and the corners — measured upright — land where they belong.
    if let connection = photoOutput.connection(with: .video) {
      if #available(iOS 17.0, *) {
        if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
      } else if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
    }

    let format = Self.fourByThreeFormat(device)
    if (try? device.lockForConfiguration()) != nil {
      if let format {
        session.sessionPreset = .inputPriority
        device.activeFormat = format
      } else if session.canSetSessionPreset(.photo) {
        session.sessionPreset = .photo
      }
      if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
      if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
      // A document is held 20–50 cm away; telling autofocus so stops it hunting to infinity first.
      if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
      device.unlockForConfiguration()
    }
    let largest = device.activeFormat.supportedMaxPhotoDimensions.max { $0.width * $0.height < $1.width * $1.height }
    if let largest { photoOutput.maxPhotoDimensions = largest }
    photoOutput.maxPhotoQualityPrioritization = .quality
    let long = CGFloat(max(photoOutput.maxPhotoDimensions.width, photoOutput.maxPhotoDimensions.height))
    DispatchQueue.main.async { [weak self] in
      self?.device = device
      self?.photoLongEdge = long
    }
    return nil
  }

  /// The 4:3 format with frames no wider than 1920 px that offers the largest photo, at 30 fps.
  private static func fourByThreeFormat(_ device: AVCaptureDevice) -> AVCaptureDevice.Format? {
    device.formats
      .filter { f in
        let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
        return d.width <= 1920 && d.width * 3 == d.height * 4
          && CMFormatDescriptionGetMediaSubType(f.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
          && f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 30 }
      }
      .max { a, b in
        func photo(_ f: AVCaptureDevice.Format) -> Int32 {
          f.supportedMaxPhotoDimensions.map { $0.width * $0.height }.max() ?? 0
        }
        let (pa, pb) = (photo(a), photo(b))
        if pa != pb { return pa < pb }
        return CMVideoFormatDescriptionGetDimensions(a.formatDescription).width
          < CMVideoFormatDescriptionGetDimensions(b.formatDescription).width
      }
  }

  // MARK: Detection results (main thread)

  private func handle(_ result: LiveEdgeFrameResult) {
    guard running else { return }
    detectionTimes.append(result.time)
    detectionTimes.removeAll { result.time - $0 > 1 }
    lastLatencyMs = result.latencyMs

    let size = result.imageSize
    let framing = LiveFramingCheck.blocker(
      result.quad,
      imageSize: size,
      photoScale: photoLongEdge > 0 ? photoLongEdge / max(size.width, size.height) : 1,
      minPageLongEdgePx: CGFloat(minPageLongEdgePx)
    )
    // A page shape the validator refuses outright is not drawn or tracked at all.
    let seen = framing != .noPage ? result.quad : nil
    if let normalized = seen {
      lastNormalized = normalized
      lastConfidence = result.confidence
      let viewQuad = normalized.mapped { LiveEdgeMapping.aspectFill($0, imageSize: size, viewSize: bounds.size) }
      target = smoother.update(viewQuad, at: result.time, diagonal: hypot(bounds.width, bounds.height))
    }
    if hysteresis.feed(valid: seen != nil, at: result.time) == .disappeared { smoother.reset() }

    let settled = !(device?.isAdjustingFocus ?? false) && !(device?.isAdjustingExposure ?? false)
    let action = gate.feed(LiveCaptureGate.Frame(
      quad: seen?.mapped { CGPoint(x: $0.x * size.width, y: $0.y * size.height) },
      framing: framing,
      phoneStill: motionGate.still,
      cameraSettled: settled,
      time: result.time,
      diagonal: hypot(size.width, size.height)
    ))
    switch action {
    case .startTrace: startTrace()
    case .cancelTrace: rewindTrace()
    case .fire: takePhoto()
    case .none: break
    }
    emitEvent(at: result.time, force: action != .none)
  }

  private func emitEvent(at time: Double, force: Bool) {
    guard force || time - lastEventTime >= 1 / Self.eventHz else { return }
    lastEventTime = time
    var payload: [String: Any] = [
      "state": hysteresis.visible ? "tracking" : "searching",
      "detectFps": detectionTimes.count,
      "latencyMs": (lastLatencyMs * 10).rounded() / 10,
      "confidence": Double(lastConfidence),
    ]
    switch gate.phase {
    case .waiting(let blocker):
      payload["gate"] = "waiting"
      payload["blocker"] = blocker?.rawValue ?? "settling"
    case .tracing: payload["gate"] = "tracing"
    case .capturing: payload["gate"] = "capturing"
    case .captured: payload["gate"] = "captured"
    }
    if hysteresis.visible, let quad = target, bounds.width > 0, bounds.height > 0 {
      payload["corners"] = quad.points.map { [Double($0.x / bounds.width), Double($0.y / bounds.height)] }
    }
    onDetection(payload)
  }

  // MARK: Photo

  private func takePhoto() {
    guard let corners = lastNormalized, photoInFlight == nil else {
      gate.captureFinished(ok: false, at: CACurrentMediaTime())
      return
    }
    strokeLayer.strokeColor = successColor.cgColor
    shutterHaptic.impactOccurred()
    if !reduceMotion {
      let flash = CABasicAnimation(keyPath: "opacity")
      flash.fromValue = 0.6
      flash.toValue = 0
      flash.duration = 0.25
      flashLayer.add(flash, forKey: "flash")
    }

    let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
    settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
    settings.photoQualityPrioritization = .quality
    let capture = LiveEdgePhotoCapture(corners: corners) { [weak self] result in
      DispatchQueue.main.async { self?.photoFinished(result) }
    }
    photoInFlight = capture
    let output = photoOutput
    sessionQueue.async { output.capturePhoto(with: settings, delegate: capture) }
  }

  private func photoFinished(_ result: Result<LiveEdgeCapturedPhoto, Error>) {
    photoInFlight = nil
    let now = CACurrentMediaTime()
    switch result {
    case .success(let photo):
      gate.captureFinished(ok: true, at: now)
      onCapture([
        "originalUri": photo.originalURL.absoluteString,
        "pageUri": photo.pageURL.absoluteString,
        "photoWidth": Double(photo.photoSize.width),
        "photoHeight": Double(photo.photoSize.height),
        "pageWidth": Double(photo.pageSize.width),
        "pageHeight": Double(photo.pageSize.height),
      ])
    case .failure(let error):
      gate.captureFinished(ok: false, at: now)
      onCameraState(["status": "failed", "detail": "photo: \(error.localizedDescription)"])
    }
    hideOutline()
  }

  // MARK: Drawing

  private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

  /// Every condition holds: the outline traces itself around the page from its top-left corner, and
  /// the tint fades in behind it. `tick` drives the trace from the gate's own clock.
  private func startTrace() {
    guard let quad = target else { return }
    spring.snap(to: quad.flattened)
    setPath(quad)
    strokeLayer.removeAllAnimations()
    fillLayer.removeAllAnimations()
    applyColors()
    strokeLayer.opacity = 1
    fillLayer.opacity = 1
    setStrokeEnd(reduceMotion ? 1 : 0)
    lightHaptic.impactOccurred()
  }

  /// A condition broke during the trace: the stroke runs back from where it stands, and fades.
  private func rewindTrace() {
    let from = strokeLayer.presentation()?.strokeEnd ?? strokeLayer.strokeEnd
    setStrokeEnd(0)
    strokeLayer.opacity = 0
    fillLayer.opacity = 0
    guard !reduceMotion else { return }
    let back = CABasicAnimation(keyPath: "strokeEnd")
    back.fromValue = from
    back.toValue = 0
    back.duration = 0.18
    back.timingFunction = CAMediaTimingFunction(name: .easeIn)
    strokeLayer.add(back, forKey: "rewind")
    for shape in [strokeLayer, fillLayer] {
      let fade = CABasicAnimation(keyPath: "opacity")
      fade.fromValue = 1
      fade.toValue = 0
      fade.duration = 0.18
      shape.add(fade, forKey: "fade")
    }
  }

  /// After the photo: the outline fades, never snaps out of sight (plan §5 step 6).
  private func hideOutline() {
    for shape in [fillLayer, strokeLayer] {
      let fade = CABasicAnimation(keyPath: "opacity")
      fade.fromValue = shape.presentation()?.opacity ?? shape.opacity
      fade.toValue = 0
      fade.duration = reduceMotion ? 0 : 0.25
      shape.opacity = 0
      shape.add(fade, forKey: "fadeOut")
    }
  }

  private func resetTracking() {
    gate.reset()
    hysteresis.reset()
    smoother.reset()
    target = nil
    lastNormalized = nil
    fillLayer.opacity = 0
    strokeLayer.opacity = 0
    detector.reset()
  }

  @objc private func tick(_ link: CADisplayLink) {
    let now = link.timestamp
    let dt = lastTick.map { now - $0 } ?? 0
    lastTick = now
    switch gate.phase {
    case .tracing, .capturing: break
    case .waiting, .captured: return
    }
    if !reduceMotion { setStrokeEnd(CGFloat(gate.traceProgress(at: now))) }
    guard let quad = target else { return }
    let drawn = reduceMotion ? quad.flattened : spring.step(toward: quad.flattened, dt: dt)
    if reduceMotion { spring.snap(to: drawn) }
    setPath(LiveQuad(flattened: drawn))
  }

  private func setStrokeEnd(_ value: CGFloat) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    strokeLayer.strokeEnd = value
    CATransaction.commit()
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
