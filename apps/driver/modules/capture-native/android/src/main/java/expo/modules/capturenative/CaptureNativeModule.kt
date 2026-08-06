package expo.modules.capturenative

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import kotlin.math.max

/**
 * FuelGuard self-built document scanner — DCE v1 SystemScanner provider (Android).
 *
 * CAPTURE (GmsDocumentScanner — crop-only, OS-enhanced) + MEASURE (ML Kit Text Recognition v2 →
 * legibility metrics). It never decides accept/reject — the §5 gate is TS in @fuelguard/capture-engine.
 *
 * Build/verify on a Mac. DCE-0 hardware checks: confirm no network egress during a scan + OCR (ML Kit's
 * on-device claim is not explicit in its docs, and BOLs are PII), and confirm the OCR confidence spread
 * on a min-spec device (confidence is SECONDARY in the gate).
 */
class CaptureNativeModule : Module() {
  private var pendingPromise: Promise? = null
  private var enhanceLongEdge: Int = 1568
  private var enhanceQuality: Int = 80

  private val scannerRequestCode = 0xB01

  override fun definition() = ModuleDefinition {
    Name("CaptureNative")

    AsyncFunction("isSupported") { promise: Promise ->
      // Camera + OCR are always present; the doc-scanner module state is discovered lazily at scan time.
      promise.resolve(mapOf("camera" to true, "docScanner" to true, "ocr" to true, "scannerModule" to "available"))
    }

    AsyncFunction("scan") { options: Map<String, Any?>, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) { promise.reject("no_activity", "No foreground activity", null); return@AsyncFunction }
      enhanceLongEdge = (options["enhanceLongEdgePx"] as? Number)?.toInt() ?: 1568
      enhanceQuality = (options["enhanceQuality"] as? Number)?.toInt() ?: 80
      val maxPages = (options["maxPages"] as? Number)?.toInt() ?: 10
      pendingPromise = promise
      val opts = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(false)
        .setPageLimit(maxPages)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()
      GmsDocumentScanning.getClient(opts).getStartScanIntent(activity)
        .addOnSuccessListener { intentSender ->
          try {
            activity.startIntentSenderForResult(intentSender, scannerRequestCode, null, 0, 0, 0)
          } catch (e: Exception) {
            pendingPromise = null
            promise.reject("scanner_launch_failed", e.message, e)
          }
        }
        .addOnFailureListener { e ->
          pendingPromise = null
          // Play-Services scanner module absent / not yet downloaded (DCE §9).
          promise.reject("SCANNER_MODULE_UNAVAILABLE", e.message ?: "Document scanner module unavailable", e)
        }
    }

    AsyncFunction("recognize") { uri: String, promise: Promise ->
      try { promise.resolve(recognize(BitmapFactory.decodeFile(uriToPath(uri)))) }
      catch (e: Exception) { promise.reject("ocr_failed", e.message, e) }
    }

    Function("cancel") { /* the scanner activity owns its own cancel affordance */ }

    OnActivityResult { _, payload ->
      if (payload.requestCode != scannerRequestCode) return@OnActivityResult
      val promise = pendingPromise ?: return@OnActivityResult
      pendingPromise = null
      if (payload.resultCode != Activity.RESULT_OK) {
        promise.resolve(mapOf("pages" to emptyList<Any>(), "cancelled" to true)); return@OnActivityResult
      }
      val result = GmsDocumentScanningResult.fromActivityResultIntent(payload.data)
      val pages = result?.pages?.mapNotNull { page -> processPage(page.imageUri) } ?: emptyList()
      promise.resolve(mapOf("pages" to pages, "cancelled" to false))
    }
  }

  private fun processPage(imageUri: Uri): Map<String, Any?>? {
    val path = imageUri.path ?: return null
    val bmp = BitmapFactory.decodeFile(path) ?: return null
    val resized = resize(bmp, enhanceLongEdge)
    val out = File.createTempFile("bol-", ".jpg", appContext.reactContext?.cacheDir)
    FileOutputStream(out).use { resized.compress(Bitmap.CompressFormat.JPEG, enhanceQuality, it) }
    val bytes = out.readBytes()
    val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    return mapOf(
      "uri" to Uri.fromFile(out).toString(),
      "width" to resized.width,
      "height" to resized.height,
      "bytes" to bytes.size,
      "mediaType" to "image/jpeg",
      "integrityHash" to hash,
      "osEnhanced" to true,
      "ocr" to recognize(resized),
    )
  }

  private fun resize(bmp: Bitmap, longEdge: Int): Bitmap {
    val maxEdge = max(bmp.width, bmp.height)
    if (maxEdge <= longEdge) return bmp
    val scale = longEdge.toFloat() / maxEdge
    return Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
  }

  // ML Kit Text Recognition v2 → the portable legibility metrics the §5 gate consumes.
  private fun recognize(bmp: Bitmap): Map<String, Any?> {
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bmp, 0)))
    var chars = 0; var words = 0; var coverage = 0.0
    val heights = mutableListOf<Int>()
    val tokens = mutableListOf<String>()
    val imgArea = (bmp.width * bmp.height).toDouble()
    for (block in result.textBlocks) for (line in block.lines) {
      chars += line.text.length
      words += line.elements.size
      val box = line.boundingBox
      if (box != null) { coverage += (box.width() * box.height()) / imgArea; heights.add(box.height()) }
      for (t in Regex("\\d{3,}").findAll(line.text)) tokens.add(t.value)
    }
    val sortedH = heights.sorted()
    val median = if (sortedH.isEmpty()) 0 else sortedH[sortedH.size / 2]
    val smallBand = sortedH.take(max(1, sortedH.size / 4)).sum()
    val smallCoverage = if (bmp.height > 0) smallBand.toDouble() / bmp.height else 0.0
    return mapOf(
      "engine" to "android.mlkit",
      "recognizedChars" to chars,
      "recognizedWords" to words,
      "textCoverageFraction" to coverage,
      "medianCharHeightPx" to median,
      "smallTextBandCoverage" to smallCoverage,
      // ML Kit exposes no reliable per-element confidence (DCE §12 #3) → omit; the gate treats it as absent.
      "numberTokens" to tokens,
    )
  }

  private fun uriToPath(uri: String): String = Uri.parse(uri).path ?: uri
}
