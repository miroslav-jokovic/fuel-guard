package expo.modules.capturenative

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.view.View

/**
 * The outline, drawn natively over the preview (D-LED2) — Android's `CAShapeLayer` pair from
 * `ios/LiveEdgeCameraView.swift`: a tinted fill and a stroke whose drawn LENGTH is the trace's progress
 * (`strokeEnd` on iOS, a `PathMeasure` segment here), starting at the top-left corner and running
 * clockwise. Nothing here decides anything; `LiveEdgeCameraView` sets the shape, the progress and the
 * opacities, every display frame while a trace is running.
 */
@SuppressLint("ViewConstructor")
class LiveEdgeOverlay(context: Context) : View(context) {
  private val path = Path()
  private val traced = Path()
  private val measure = PathMeasure()
  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeJoin = Paint.Join.ROUND
    strokeCap = Paint.Cap.ROUND
  }
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

  var strokeColor: Int = Color.WHITE
  var fillColor: Int = Color.argb(31, 255, 255, 255)
  /** 0–1: how much of the outline is drawn. The gate's own clock (D-LED6). */
  var progress = 0f
  /** 0–1 for the stroke and the fill together. */
  var outlineAlpha = 0f
  /** 0–1: the white shutter dim over everything. */
  var flashAlpha = 0f
  private var hasShape = false

  init {
    setWillNotDraw(false)
    strokePaint.strokeWidth = 4 * resources.displayMetrics.density
  }

  fun setQuad(q: LiveQuad) {
    path.reset()
    path.moveTo(q.topLeft.x.toFloat(), q.topLeft.y.toFloat())
    path.lineTo(q.topRight.x.toFloat(), q.topRight.y.toFloat())
    path.lineTo(q.bottomRight.x.toFloat(), q.bottomRight.y.toFloat())
    path.lineTo(q.bottomLeft.x.toFloat(), q.bottomLeft.y.toFloat())
    path.close()
    hasShape = true
  }

  fun clearShape() {
    hasShape = false
    path.reset()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (hasShape && outlineAlpha > 0f) {
      fillPaint.color = fillColor
      fillPaint.alpha = (Color.alpha(fillColor) * outlineAlpha).toInt()
      canvas.drawPath(path, fillPaint)
      if (progress > 0f) {
        measure.setPath(path, true)
        traced.reset()
        measure.getSegment(0f, measure.length * progress.coerceIn(0f, 1f), traced, true)
        strokePaint.color = strokeColor
        strokePaint.alpha = (Color.alpha(strokeColor) * outlineAlpha).toInt()
        canvas.drawPath(traced, strokePaint)
      }
    }
    if (flashAlpha > 0f) canvas.drawColor(Color.argb((255 * flashAlpha).toInt(), 255, 255, 255))
  }
}
