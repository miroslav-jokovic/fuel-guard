package expo.modules.capturenative

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import kotlin.math.sqrt

/**
 * The two "is it still?" inputs of the capture gate on Android, kept out of the camera view:
 *
 *  - [Motion]: the phone's motion sensors into `LiveMotionGate` — linear acceleration (gravity removed,
 *    m/s²) and the gyroscope (rad/s), the two quantities iOS reads from Core Motion's device motion.
 *  - [Focus]: whether the camera is still focusing or adjusting exposure, read from every capture
 *    result's auto-focus and auto-exposure state — Android's `isAdjustingFocus` / `isAdjustingExposure`.
 */
object LiveEdgeSensors {
  class Motion(context: Context) : SensorEventListener {
    val gate = LiveMotionGate()
    private val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val linear: Sensor? = manager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private val gyro: Sensor? = manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private var acceleration = 0.0
    private var rotation = 0.0

    fun start() {
      gate.reset()
      if (linear == null && gyro == null) {
        // No sensor to ask: the outline's own anchor test is then the only stillness check (as on iOS).
        gate.feed(0.0, 0.0, 0.0)
        gate.feed(0.0, 0.0, LiveMotionGate.CALM_FOR_SECONDS)
        return
      }
      linear?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
      gyro?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    fun stop() = manager.unregisterListener(this)

    override fun onSensorChanged(event: SensorEvent) {
      val v = event.values
      val magnitude = sqrt((v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).toDouble())
      when (event.sensor.type) {
        Sensor.TYPE_LINEAR_ACCELERATION -> acceleration = magnitude
        Sensor.TYPE_GYROSCOPE -> rotation = magnitude
      }
      gate.feed(acceleration, rotation, event.timestamp / 1e9)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  }

  /** Attached to the analysis stream's requests; written on the camera's thread, read on the main one. */
  class Focus : CameraCaptureSession.CaptureCallback() {
    @Volatile
    var settled = true
      private set

    override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
      val af = result.get(CaptureResult.CONTROL_AF_STATE)
      val ae = result.get(CaptureResult.CONTROL_AE_STATE)
      val focusing = af == CaptureResult.CONTROL_AF_STATE_PASSIVE_SCAN || af == CaptureResult.CONTROL_AF_STATE_ACTIVE_SCAN
      val exposing = ae == CaptureResult.CONTROL_AE_STATE_SEARCHING || ae == CaptureResult.CONTROL_AE_STATE_PRECAPTURE
      settled = !focusing && !exposing
    }
  }
}
