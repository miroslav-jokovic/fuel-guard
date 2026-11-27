package expo.modules.capturenative

import android.Manifest
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import android.util.Size
import android.view.Choreographer
import android.view.HapticFeedbackConstants
import android.view.Surface
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Our own scanner camera on Android (LIVE-EDGE-DETECTION-PLAN.md L4, D-LED2) — the same screen as
 * `ios/LiveEdgeCameraView.swift`, held to the same decisions: the capture gate (D-LED6,
 * `LiveCaptureGate.kt`) waits until the page is placed well enough to straighten and the phone, page and
 * focus are still; then the outline traces itself around the page, and the trace's end takes the photo.
 * JavaScript gets the reason it is waiting (`onDetection`), the camera's state and the photo
 * (`onCapture`), with the same payloads iOS sends.
 *
 * Detector: DocAligner's heatmap corner model through LiteRT (`DocAlignerDetector`), candidate (a) —
 * the measured winner at L1 (SmartDoc 2015: 2.7 px against Apple segmentation's 8.7 px). D-LED7: the
 * preview, the analysis frames and the photo are all 4:3 views of the whole sensor, so the corners found
 * on a frame are the corners on the photo, scaled.
 */
@SuppressLint("ViewConstructor")
class LiveEdgeCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onDetection by EventDispatcher()
  private val onCameraState by EventDispatcher()
  private val onCapture by EventDispatcher()

  var active = true
    set(value) { field = value; updateRunning() }
  var strokeColor: Int
    get() = overlay.strokeColor
    set(value) { overlay.strokeColor = value; overlay.invalidate() }
  var fillColor: Int
    get() = overlay.fillColor
    set(value) { overlay.fillColor = value; overlay.invalidate() }
  var successColor: Int = 0xFF34C759.toInt()
  /** The quality gate's `resolutionMinLongEdgePx` from the signed capture config, passed by JS. */
  var minPageLongEdgePx = 0.0

  private val preview = PreviewView(context).apply {
    scaleType = PreviewView.ScaleType.FILL_CENTER
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }
  private val overlay = LiveEdgeOverlay(context)
  /** The stroke colour JS set; the success colour replaces it only from the shutter to the next trace. */
  private var baseStroke: Int = overlay.strokeColor
  private val analysisThread = Executors.newSingleThreadExecutor()
  private val motion = LiveEdgeSensors.Motion(context)
  private val focus = LiveEdgeSensors.Focus()
  private var detector: DocAlignerDetector? = null
  private var provider: ProcessCameraProvider? = null
  private var capture: ImageCapture? = null
  private var running = false
  private var attached = false
  private var photoInFlight = false
  /** The photo's long edge in pixels, once the camera is bound (0 until then). */
  private var photoLongEdge = 0.0

  private val gate = LiveCaptureGate()
  private val hysteresis = LiveDetectionHysteresis()
  private val smoother = LiveQuadSmoother()
  private val spring = CriticalSpring()
  /** The smoothed outline in VIEW pixels — what is drawn. */
  private var target: LiveQuad? = null
  /** The last raw outline normalised to the upright frame — what the photo is cropped to. */
  private var lastNormalized: LiveQuad? = null
  private var lastConfidence = 0f
  private var lastLatencyMs = 0.0
  private val detectionTimes = ArrayDeque<Double>()
  private var lastEventTime = 0.0
  private var lastTick = 0L
  private var ticking = false

  init {
    val fill = ViewGroup.LayoutParams.MATCH_PARENT
    val stack = FrameLayout(context)
    stack.addView(preview, FrameLayout.LayoutParams(fill, fill))
    stack.addView(overlay, FrameLayout.LayoutParams(fill, fill))
    addView(stack, ViewGroup.LayoutParams(fill, fill))
    setBackgroundColor(0xFF000000.toInt())
  }

  fun setStroke(color: Int) { baseStroke = color; strokeColor = color }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); attached = true; updateRunning() }

  override fun onDetachedFromWindow() {
    attached = false
    updateRunning()
    super.onDetachedFromWindow()
  }

  /** The view is gone for good (Expo calls this when React unmounts it). */
  fun destroy() {
    attached = false
    updateRunning()
    analysisThread.execute { detector?.close(); detector = null }
    analysisThread.shutdown()
  }

  private fun updateRunning() {
    val shouldRun = active && attached
    if (shouldRun == running) return
    running = shouldRun
    if (shouldRun) start() else stop()
  }

  // ── Session ────────────────────────────────────────────────────────────────────────────────────

  private fun start() {
    val permissions = appContext.permissions
    if (permissions == null || permissions.hasGrantedPermissions(Manifest.permission.CAMERA)) return bind()
    permissions.askForPermissions({ result ->
      post {
        if (!running) return@post
        if (result[Manifest.permission.CAMERA]?.status == PermissionsStatus.GRANTED) bind()
        else onCameraState(mapOf("status" to "denied"))
      }
    }, Manifest.permission.CAMERA)
  }

  @androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
  private fun bind() {
    val owner = appContext.currentActivity as? LifecycleOwner
      ?: return onCameraState(mapOf("status" to "failed", "detail" to "no activity to bind the camera to"))
    motion.start()
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (!running) return@addListener
      try {
        val cameraProvider = future.get()
        provider = cameraProvider
        val fourByThree = AspectRatioStrategy(androidx.camera.core.AspectRatio.RATIO_4_3, AspectRatioStrategy.FALLBACK_RULE_AUTO)
        val previewCase = Preview.Builder()
          .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(fourByThree).build())
          .build().also { it.surfaceProvider = preview.surfaceProvider }
        val analysisBuilder = ImageAnalysis.Builder()
          .setResolutionSelector(
            ResolutionSelector.Builder().setAspectRatioStrategy(fourByThree)
              .setResolutionStrategy(ResolutionStrategy(ANALYSIS_SIZE, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
              .build(),
          )
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
        Camera2Interop.Extender(analysisBuilder).setSessionCaptureCallback(focus)
        val analysis = analysisBuilder.build().also { it.setAnalyzer(analysisThread, ::analyze) }
        val photo = ImageCapture.Builder()
          .setResolutionSelector(
            ResolutionSelector.Builder().setAspectRatioStrategy(fourByThree)
              .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY).build(),
          )
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
          .setTargetRotation(Surface.ROTATION_0)
          .build()
        capture = photo
        cameraProvider.unbindAll()
        cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, previewCase, analysis, photo)
        photo.resolutionInfo?.resolution?.let { photoLongEdge = max(it.width, it.height).toDouble() }
        startTicking()
        onCameraState(mapOf("status" to "ready"))
      } catch (e: Exception) {
        onCameraState(mapOf("status" to "failed", "detail" to (e.message ?: e.javaClass.simpleName)))
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun stop() {
    motion.stop()
    stopTicking()
    provider?.unbindAll()
    capture = null
    resetTracking()
  }

  // ── Detection (analysis thread → main thread) ──────────────────────────────────────────────────

  private fun analyze(image: ImageProxy) {
    image.use {
      val began = System.nanoTime()
      val rotation = image.imageInfo.rotationDegrees
      val plane = image.planes[0]
      val result = try {
        val d = detector ?: DocAlignerDetector(context).also { detector = it }
        d.detect(plane.buffer, image.width, image.height, plane.rowStride, rotation)
      } catch (e: Exception) {
        post { onCameraState(mapOf("status" to "failed", "detail" to "detector: ${e.message}")) }
        null
      }
      val turned = rotation == 90 || rotation == 270
      val w = (if (turned) image.height else image.width).toDouble()
      val h = (if (turned) image.width else image.height).toDouble()
      // Capture → answer when the camera stamps frames on the boot clock (most do); otherwise the
      // detector's own time, which is the part this code controls.
      val sinceCapture = (SystemClock.elapsedRealtimeNanos() - image.imageInfo.timestamp) / 1e6
      val latencyMs = if (sinceCapture in 0.0..2000.0) sinceCapture else (System.nanoTime() - began) / 1e6
      val quad = result?.quad?.mapped { Pt(it.x / w, it.y / h) }
      val confidence = result?.confidence ?: 0f
      val time = began / 1e9
      post { handle(quad, confidence, w, h, time, latencyMs) }
    }
  }

  private fun handle(normalized: LiveQuad?, confidence: Float, imageW: Double, imageH: Double, time: Double, latencyMs: Double) {
    if (!running) return
    detectionTimes.addLast(time)
    while (detectionTimes.isNotEmpty() && time - detectionTimes.first() > 1) detectionTimes.removeFirst()
    lastLatencyMs = latencyMs

    val framing = LiveFramingCheck.blocker(
      normalized, imageW, imageH,
      photoScale = if (photoLongEdge > 0) photoLongEdge / max(imageW, imageH) else 1.0,
      minPageLongEdgePx = minPageLongEdgePx,
    )
    // A shape the validator refuses outright is not drawn or tracked at all.
    val seen = if (framing != LiveCaptureBlocker.NO_PAGE) normalized else null
    val vw = width.toDouble()
    val vh = height.toDouble()
    if (seen != null) {
      lastNormalized = seen
      lastConfidence = confidence
      val viewQuad = seen.mapped { LiveEdgeMapping.aspectFill(it, imageW, imageH, vw, vh) }
      target = smoother.update(viewQuad, time, hypot(vw, vh))
    }
    if (hysteresis.feed(seen != null, time) == LiveDetectionHysteresis.Change.DISAPPEARED) smoother.reset()

    val action = gate.feed(LiveCaptureGate.Frame(
      quad = seen?.mapped { Pt(it.x * imageW, it.y * imageH) },
      framing = framing,
      phoneStill = motion.gate.still,
      cameraSettled = focus.settled,
      time = time,
      diagonal = hypot(imageW, imageH),
    ))
    when (action) {
      LiveCaptureGate.Action.START_TRACE -> startTrace()
      LiveCaptureGate.Action.CANCEL_TRACE -> rewindTrace()
      LiveCaptureGate.Action.FIRE -> takePhoto()
      LiveCaptureGate.Action.NONE -> {}
    }
    emitEvent(time, force = action != LiveCaptureGate.Action.NONE)
  }

  private fun emitEvent(time: Double, force: Boolean) {
    if (!force && time - lastEventTime < 1 / EVENT_HZ) return
    lastEventTime = time
    val payload = mutableMapOf<String, Any>(
      "state" to if (hysteresis.visible) "tracking" else "searching",
      "detectFps" to detectionTimes.size,
      "latencyMs" to (lastLatencyMs * 10).roundToInt() / 10.0,
      "confidence" to lastConfidence.toDouble(),
    )
    when (val p = gate.phase) {
      is LiveCaptureGate.Phase.Waiting -> {
        payload["gate"] = "waiting"
        payload["blocker"] = p.blocker?.wire ?: "settling"
      }
      is LiveCaptureGate.Phase.Tracing -> payload["gate"] = "tracing"
      LiveCaptureGate.Phase.Capturing -> payload["gate"] = "capturing"
      LiveCaptureGate.Phase.Captured -> payload["gate"] = "captured"
    }
    val quad = target
    if (hysteresis.visible && quad != null && width > 0 && height > 0) {
      payload["corners"] = quad.points.map { listOf(it.x / width, it.y / height) }
    }
    onDetection(payload)
  }

  // ── Photo ──────────────────────────────────────────────────────────────────────────────────────

  private fun takePhoto() {
    val corners = lastNormalized
    val photo = capture
    if (corners == null || photo == null || photoInFlight) {
      gate.captureFinished(false, System.nanoTime() / 1e9)
      return
    }
    photoInFlight = true
    overlay.strokeColor = successColor
    performHapticFeedback(HapticFeedbackConstants.CONFIRM)
    if (!reduceMotion) animate(0.6f, 0f, 250) { overlay.flashAlpha = it }
    val id = UUID.randomUUID().toString().lowercase()
    val original = File(context.cacheDir, "live-edge-$id.original.jpg")
    photo.takePicture(
      ImageCapture.OutputFileOptions.Builder(original).build(),
      analysisThread,
      object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(output: ImageCapture.OutputFileResults) {
          val written = runCatching { LiveEdgePhoto.writePage(original, corners, File(context.cacheDir, "live-edge-$id.page.jpg")) }
          post { photoFinished(original, written) }
        }

        override fun onError(exception: ImageCaptureException) {
          post { photoFinished(original, Result.failure(exception)) }
        }
      },
    )
  }

  private fun photoFinished(original: File, written: Result<LiveEdgePhoto.Written>) {
    photoInFlight = false
    val now = System.nanoTime() / 1e9
    written.onSuccess { w ->
      gate.captureFinished(true, now)
      onCapture(mapOf(
        "originalUri" to "file://${original.path}",
        "pageUri" to "file://${w.page.path}",
        "photoWidth" to w.photoW.toDouble(),
        "photoHeight" to w.photoH.toDouble(),
        "pageWidth" to w.pageW.toDouble(),
        "pageHeight" to w.pageH.toDouble(),
      ))
    }.onFailure { e ->
      gate.captureFinished(false, now)
      onCameraState(mapOf("status" to "failed", "detail" to "photo: ${e.message ?: e.javaClass.simpleName}"))
    }
    hideOutline()
  }

  // ── Drawing ────────────────────────────────────────────────────────────────────────────────────

  private val reduceMotion: Boolean
    get() = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

  /** Every condition holds: the outline traces itself from the top-left corner; `tick` drives it. */
  private fun startTrace() {
    val quad = target ?: return
    spring.snap(quad.flattened)
    overlay.setQuad(quad)
    overlay.strokeColor = baseStroke
    overlay.outlineAlpha = 1f
    overlay.progress = if (reduceMotion) 1f else 0f
    overlay.invalidate()
    performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
  }

  /** A condition broke during the trace: the stroke runs back from where it stands, and fades. */
  private fun rewindTrace() {
    if (reduceMotion) {
      overlay.outlineAlpha = 0f
      overlay.progress = 0f
      overlay.invalidate()
      return
    }
    val from = overlay.progress
    animate(1f, 0f, 180) { t ->
      overlay.progress = from * t
      overlay.outlineAlpha = t
    }
  }

  /** After the photo: the outline fades, never snaps out of sight (plan §5 step 6). */
  private fun hideOutline() {
    val from = overlay.outlineAlpha
    if (reduceMotion || from == 0f) {
      overlay.outlineAlpha = 0f
      overlay.invalidate()
      return
    }
    animate(from, 0f, 250) { overlay.outlineAlpha = it }
  }

  private fun animate(from: Float, to: Float, ms: Long, apply: (Float) -> Unit) {
    ValueAnimator.ofFloat(from, to).apply {
      duration = ms
      addUpdateListener { apply(it.animatedValue as Float); overlay.invalidate() }
      start()
    }
  }

  private fun resetTracking() {
    gate.reset()
    hysteresis.reset()
    smoother.reset()
    target = null
    lastNormalized = null
    overlay.outlineAlpha = 0f
    overlay.clearShape()
    overlay.invalidate()
  }

  private val frameCallback = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (!ticking) return
      tick(frameTimeNanos)
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  private fun startTicking() {
    if (ticking) return
    ticking = true
    lastTick = 0L
    Choreographer.getInstance().postFrameCallback(frameCallback)
  }

  private fun stopTicking() {
    ticking = false
    Choreographer.getInstance().removeFrameCallback(frameCallback)
  }

  /** Every display frame while tracing: the stroke's length is the gate's clock; the shape glides. */
  private fun tick(frameTimeNanos: Long) {
    val dt = if (lastTick == 0L) 0.0 else (frameTimeNanos - lastTick) / 1e9
    lastTick = frameTimeNanos
    val phase = gate.phase
    if (phase !is LiveCaptureGate.Phase.Tracing && phase != LiveCaptureGate.Phase.Capturing) return
    if (!reduceMotion) overlay.progress = gate.traceProgress(frameTimeNanos / 1e9).toFloat()
    val quad = target ?: return
    val drawn = if (reduceMotion) quad.flattened.also { spring.snap(it) } else spring.step(quad.flattened, dt)
    overlay.setQuad(LiveQuad.fromFlattened(drawn))
    overlay.invalidate()
  }

  companion object {
    /** The analysis frames: small enough for ~15 detections a second, 4:3 like the photo (D-LED7). */
    private val ANALYSIS_SIZE = Size(640, 480)
    /** At most this many `onDetection` events a second, plus one on every gate transition (as iOS). */
    private const val EVENT_HZ = 10.0
  }
}
