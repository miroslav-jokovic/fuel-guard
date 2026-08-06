package expo.modules.capturenative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.result.IntentSenderRequest
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
 * APIs verified against the installed expo-modules-core + Google ML Kit docs. Built/verified on a Mac —
 * never compiled in the cloud VM.
 */
class CaptureNativeModule : Module() {
  // The IntentSender obtained from Play Services just before launch; read by the contract's createIntent.
  // Needed only at launch (present), never on result restoration, so holding it transiently is safe.
  @Volatile
  private var pendingRequest: IntentSenderRequest? = null

  private lateinit var scannerLauncher:
    AppContextActivityResultLauncher<DocumentScannerInput, DocumentScannerResult>

  override fun definition() = ModuleDefinition {
    Name("CaptureNative")

    AsyncFunction("isSupported") {
      // Optimistic: the real doc-scanner module state surfaces at scan() as SCANNER_MODULE_UNAVAILABLE.
      mapOf("camera" to true, "docScanner" to true, "ocr" to true)
    }

    AsyncFunction("scan") Coroutine { options: Map<String, Any?> ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val longEdge = (options["enhanceLongEdgePx"] as? Number)?.toInt() ?: 1568
      val quality = (options["enhanceQuality"] as? Number)?.toInt() ?: 80
      val maxPages = (options["maxPages"] as? Number)?.toInt() ?: 10

      val scannerOptions = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(false)
        .setPageLimit(maxPages)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()

      val intentSender = withContext(Dispatchers.IO) {
        try {
          Tasks.await(GmsDocumentScanning.getClient(scannerOptions).getStartScanIntent(activity))
        } catch (e: Exception) {
          // Module absent / not-yet-downloaded (de-Googled or enterprise-locked device) — DCE §9.
          throw CodedScannerException("SCANNER_MODULE_UNAVAILABLE", e.message ?: "Document scanner module unavailable")
        }
      }

      pendingRequest = IntentSenderRequest.Builder(intentSender).build()
      val result = try {
        scannerLauncher.launch(DocumentScannerInput(System.identityHashCode(intentSender).toLong()))
      } finally {
        pendingRequest = null
      }

      when (result) {
        is DocumentScannerResult.Cancelled -> mapOf("pages" to emptyList<Any>(), "cancelled" to true)
        is DocumentScannerResult.Success -> {
          val pages = withContext(Dispatchers.IO) {
            GmsDocumentScanningResult.fromActivityResultIntent(result.data)
              ?.pages.orEmpty()
              .mapNotNull { page -> processPage(page.imageUri, longEdge, quality) }
          }
          mapOf("pages" to pages, "cancelled" to false)
        }
      }
    }

    AsyncFunction("recognize") Coroutine { uri: String ->
      withContext(Dispatchers.IO) {
        val bitmap = BitmapFactory.decodeFile(Uri.parse(uri).path)
          ?: throw CodedScannerException("PROVIDER_ERROR", "Could not load image at $uri")
        recognize(bitmap)
      }
    }

    Function("cancel") {
      // The scanner activity owns its own cancel affordance; nothing to tear down here.
    }

    RegisterActivityContracts {
      scannerLauncher = registerForActivityResult(DocumentScannerContract { pendingRequest }) { _, _ -> }
    }
  }

  private fun processPage(imageUri: Uri, longEdge: Int, quality: Int): Map<String, Any?>? {
    val path = imageUri.path ?: return null
    val decoded = BitmapFactory.decodeFile(path) ?: return null
    val resized = scale(decoded, longEdge)
    val out = File.createTempFile("bol-", ".jpg", appContext.cacheDirectory)
    FileOutputStream(out).use { resized.compress(Bitmap.CompressFormat.JPEG, quality, it) }
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

  private fun scale(bitmap: Bitmap, longEdge: Int): Bitmap {
    val maxEdge = max(bitmap.width, bitmap.height)
    if (maxEdge <= longEdge) return bitmap
    val factor = longEdge.toFloat() / maxEdge
    return Bitmap.createScaledBitmap(bitmap, (bitmap.width * factor).toInt(), (bitmap.height * factor).toInt(), true)
  }

  // ML Kit Text Recognition v2 → the portable legibility metrics the §5 gate consumes. Runs synchronously
  // (Tasks.await) — callers already dispatch to Dispatchers.IO.
  private fun recognize(bitmap: Bitmap): Map<String, Any?> {
    return try {
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      val text = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)))
      var chars = 0
      var words = 0
      var coverage = 0.0
      val heights = mutableListOf<Int>()
      val tokens = mutableListOf<String>()
      val area = (bitmap.width.toLong() * bitmap.height.toLong()).toDouble()
      for (block in text.textBlocks) {
        for (line in block.lines) {
          chars += line.text.length
          words += line.elements.size
          line.boundingBox?.let { box ->
            if (area > 0) coverage += (box.width().toDouble() * box.height()) / area
            heights.add(box.height())
          }
          Regex("\\d{3,}").findAll(line.text).forEach { tokens.add(it.value) }
        }
      }
      val sortedHeights = heights.sorted()
      val median = if (sortedHeights.isEmpty()) 0 else sortedHeights[sortedHeights.size / 2]
      val smallSum = sortedHeights.take(max(1, sortedHeights.size / 4)).sum()
      val smallCoverage = if (bitmap.height > 0) smallSum.toDouble() / bitmap.height else 0.0
      mapOf(
        "engine" to "android.mlkit",
        "recognizedChars" to chars,
        "recognizedWords" to words,
        "textCoverageFraction" to coverage,
        "medianCharHeightPx" to median,
        "smallTextBandCoverage" to smallCoverage,
        // ML Kit exposes no reliable per-element confidence (DCE §12 #3) → omitted; the gate treats it absent.
        "numberTokens" to tokens,
      )
    } catch (e: Exception) {
      // OCR failure → degrade closed (the TS gate treats absent metrics as na + ocrDegraded).
      mapOf(
        "engine" to "android.mlkit", "recognizedChars" to 0, "recognizedWords" to 0,
        "textCoverageFraction" to 0.0, "medianCharHeightPx" to 0, "smallTextBandCoverage" to 0.0,
        "numberTokens" to emptyList<String>(),
      )
    }
  }
}
