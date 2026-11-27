package expo.modules.capturenative

import android.content.Context
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * The live edge detector on Android: DocAligner's heatmap corner model (LIVE-EDGE-DETECTION-PLAN.md
 * §4.5, candidate (a)) run by LiteRT. Everything it decides is in `DocAlignerDecode.kt`, held to the
 * TypeScript reference by `DocAlignerDecodeParityTest`; this class only moves bytes in and out of the
 * interpreter, and reuses every buffer so a frame allocates nothing.
 *
 * NOT thread-safe, on purpose: it lives on the camera's single analysis thread (`LiveEdgeCameraView`),
 * which is the only caller.
 *
 * The model (`modules/capture-native/models/docaligner_lcnet100_256_fp32.tflite`, see its README) is
 * read through an InputStream into a direct buffer rather than memory-mapped, so it does not matter
 * whether the app's packaging compresses `.tflite` assets.
 */
class DocAlignerDetector(context: Context) : Closeable {
  /** A detection: the corners in the UPRIGHT frame's pixels, and the weakest corner's heatmap peak. */
  class Result(val quad: LiveQuad, val confidence: Float)

  private val interpreter: Interpreter
  private val pixels = FloatArray(DocAlignerDecode.SIZE * DocAlignerDecode.SIZE * 3)
  private val input: ByteBuffer =
    ByteBuffer.allocateDirect(pixels.size * 4).order(ByteOrder.nativeOrder())
  private val output: ByteBuffer =
    ByteBuffer.allocateDirect(HEAT_VALUES * 4).order(ByteOrder.nativeOrder())
  private val heat = FloatArray(HEAT_VALUES)
  private val outputFloats: FloatBuffer = output.asFloatBuffer()
  private var frame = ByteArray(0)

  init {
    val bytes = context.assets.open(MODEL_ASSET).use { it.readBytes() }
    val model = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).put(bytes)
    model.rewind()
    interpreter = Interpreter(model, Interpreter.Options().setNumThreads(THREADS))
    val inShape = interpreter.getInputTensor(0).shape()
    val outShape = interpreter.getOutputTensor(0).shape()
    check(inShape.contentEquals(intArrayOf(1, 256, 256, 3))) { "unexpected model input ${inShape.contentToString()}" }
    check(outShape.contentEquals(intArrayOf(1, 128, 128, 4))) { "unexpected model output ${outShape.contentToString()}" }
  }

  /**
   * One camera frame, RGBA in sensor orientation, to the page's corners in the upright `W × H` frame —
   * or null when any corner has no blob (the authors' rule: all four or no document).
   */
  fun detect(rgba: ByteBuffer, srcW: Int, srcH: Int, rowStride: Int, rotation: Int): Result? {
    val needed = rowStride * srcH
    if (frame.size < needed) frame = ByteArray(needed)
    rgba.rewind()
    rgba.get(frame, 0, minOf(needed, rgba.remaining()))
    DocAlignerDecode.input(frame, srcW, srcH, rowStride, rotation, pixels)
    input.rewind()
    input.asFloatBuffer().put(pixels)
    output.rewind()
    interpreter.run(input, output)
    outputFloats.rewind()
    outputFloats.get(heat)

    val turned = rotation == 90 || rotation == 270
    val w = if (turned) srcH else srcW
    val h = if (turned) srcW else srcH
    val planes = (0 until 4).map { c -> DocAlignerDecode.Plane { x, y -> heat[(y * HEAT + x) * 4 + c] } }
    val quad = DocAlignerDecode.quad(planes, HEAT, HEAT, w, h) ?: return null
    var weakest = Float.MAX_VALUE
    for (c in 0 until 4) {
      var peak = 0f
      for (i in 0 until HEAT * HEAT) peak = maxOf(peak, heat[i * 4 + c])
      weakest = minOf(weakest, peak)
    }
    return Result(quad, weakest)
  }

  override fun close() = interpreter.close()

  companion object {
    const val MODEL_ASSET = "docaligner_lcnet100_256_fp32.tflite"
    private const val HEAT = DocAlignerDecode.HEAT
    private const val HEAT_VALUES = HEAT * HEAT * 4
    /** The Tab A9's Helio G99 has 2 fast and 6 slow cores; 2 threads keep inference off the slow ones. */
    private const val THREADS = 2
  }
}
