package expo.modules.capturenative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.result.IntentSenderRequest
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
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
      // Was `mapOf("camera" to true, "docScanner" to true, "ocr" to true)` — a hardcoded answer that
      // made `scannerModule` permanently null and left the DCE §9 onboarding pre-warm with nothing to
      // read. What can actually be established cheaply, without an Activity and without triggering the
      // module download, is whether Google Play services is present at all: that is the de-Googled and
      // enterprise-locked case, which is the one that matters most because on those devices
      // GmsDocumentScanner cannot ever work.
      //
      // ⚠ "available" therefore means Play services is present, NOT that the ~300 KB scanner module has
      // already been downloaded. Only launching the scanner settles that, which is why scan() still
      // reports SCANNER_MODULE_UNAVAILABLE as a value. Saying "available" here and failing there is
      // not a contradiction; it is the honest limit of what a cheap check can see.
      // A null context is "cannot tell right now" (the app is between states), not "this device cannot
      // scan" — so scannerModule is OMITTED rather than guessed, which is precisely what the field
      // being optional means. Guessing "unavailable" here would send a driver on a perfectly capable
      // phone to a Wi-Fi hotspot for no reason.
      val context = appContext.reactContext
      val playServices = context?.let {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(it) == ConnectionResult.SUCCESS
      }
      buildMap {
        put("camera", true)
        put("docScanner", playServices ?: true)
        put("ocr", true) // ML Kit text recognition is bundled with the app, not a Play-Services module.
        if (playServices != null) put("scannerModule", if (playServices) "available" else "unavailable")
      }
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

      // The module being absent is ANTICIPATED (de-Googled or enterprise-locked device, or a first run
      // with no connectivity — DCE §9), so it is reported as a value rather than thrown. This used to
      // throw a CodedScannerException, and the provider above caught every throw as PROVIDER_ERROR
      // without reading its code — so the driver was told "Something went wrong with the capture"
      // instead of "connect to Wi-Fi once, then retake", and the whole taxonomy died at the last hop.
      // D-SCAN7: an expected outcome travels as a value; only the unforeseen travels as an exception.
      val intentSender = withContext(Dispatchers.IO) {
        try {
          Tasks.await(GmsDocumentScanning.getClient(scannerOptions).getStartScanIntent(activity))
        } catch (e: Exception) {
          null
        }
      } ?: return@Coroutine mapOf(
        "pages" to emptyList<Any>(),
        "cancelled" to false,
        "unavailable" to mapOf(
          "reason" to "SCANNER_MODULE_UNAVAILABLE",
          "detail" to "The Play services document scanner module is not available on this device.",
        ),
      )

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
    // Decoded at a bounded size rather than at full resolution. `BitmapFactory.decodeFile(path)` with
    // no options allocates the whole sensor-resolution bitmap in ARGB_8888 — a 12 MP page is about
    // 48 MB — and this loop runs once per page, which on a min-spec phone scanning ten pages is an
    // out-of-memory candidate the audit named. inSampleSize halves during DECODE, so the 48 MB is
    // never allocated at all; `scale` then trims the remainder to the exact long edge.
    val decoded = decodeBounded(path, longEdge) ?: return null
    val resized = scale(decoded, longEdge)
    val out = File.createTempFile("bol-", ".jpg", appContext.cacheDirectory)
    FileOutputStream(out).use { resized.compress(Bitmap.CompressFormat.JPEG, quality, it) }
    val bytes = out.readBytes()
    val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    val ocr = recognize(resized)
    val page = mapOf(
      "uri" to Uri.fromFile(out).toString(),
      "width" to resized.width,
      "height" to resized.height,
      "bytes" to bytes.size,
      "mediaType" to "image/jpeg",
      "integrityHash" to hash,
      "osEnhanced" to true,
      "ocr" to ocr,
    )
    // Freed here rather than left to the collector: every value read out of these bitmaps is already
    // in `page`, and on a ten-page scan waiting for GC to notice is what turns a survivable peak into
    // an OOM. `scale` returns its input unchanged when no scaling was needed, so the identity check
    // avoids recycling the same bitmap twice — which would throw on the second call.
    if (resized !== decoded) resized.recycle()
    decoded.recycle()
    return page
  }

  /**
   * Decode no larger than we need. `inJustDecodeBounds` reads the header only (no pixels allocated),
   * and `inSampleSize` must be a power of two — the platform rounds anything else down to one, so
   * computing it any other way silently does nothing.
   */
  private fun decodeBounded(path: String, longEdge: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    val sourceLongEdge = max(bounds.outWidth, bounds.outHeight)
    if (sourceLongEdge <= 0) return null

    var sample = 1
    while (sourceLongEdge / (sample * 2) >= longEdge) sample *= 2
    return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
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
