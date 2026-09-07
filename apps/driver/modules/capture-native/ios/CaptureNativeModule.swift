import ExpoModulesCore
import VisionKit
import Vision
import UIKit
import CryptoKit

// FuelGuard self-built document scanner — DCE v1 SystemScanner provider (iOS).
//
// CAPTURE (VNDocumentCameraViewController — crop-only, OS-enhanced) + MEASURE (VNRecognizeText →
// legibility metrics). It never decides accept/reject — the §5 gate is TS in @fuelguard/capture-engine.
// Nothing leaves the device (Apple Vision is documented on-device).
//
// APIs verified against the installed ExpoModulesCore + Apple docs (VisionKit is iOS 13+; app targets
// iOS 16.4). Built/verified on a Mac — never compiled in the cloud VM.
public class CaptureNativeModule: Module {
  // Retain the delegate for the lifetime of one scan — VNDocumentCameraViewController holds its delegate
  // weakly, so without this it would deallocate while the scanner UI is up.
  private var activeDelegate: DocumentScanDelegate?

  public func definition() -> ModuleDefinition {
    Name("CaptureNative")

    AsyncFunction("isSupported") { () -> [String: Any] in
      // `scannerModule` is deliberately absent rather than reported as "available": it describes a
      // Play-Services download that does not exist on this platform, and an iPhone answering
      // "available" to a question about Android's module store would be a tidy-looking lie. Absent
      // is what the field's optionality is for.
      [
        "camera": UIImagePickerController.isSourceTypeAvailable(.camera),
        "docScanner": VNDocumentCameraViewController.isSupported,
        "ocr": true,
      ]
    }

    // D-SCAN7: an ANTICIPATED outcome resolves as a value; only the unforeseen rejects.
    //
    // The device not supporting VisionKit's scanner is anticipated — it is a fact about the hardware,
    // known before anything is attempted — so it resolves with `unavailable` and the driver is told
    // what is true. It used to reject with the code "UNSUPPORTED_DEVICE", and the provider above
    // caught every rejection as PROVIDER_ERROR without reading a code, so the message never arrived.
    //
    // Having no view controller to present from stays a REJECTION, and the difference is the point:
    // that is not a fact about the device, it is the app being in a state it should never be in while
    // a driver is asking to scan. PROVIDER_ERROR is the honest answer to it.
    AsyncFunction("scan") { (options: [String: Any], promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        promise.resolve([
          "pages": [[String: Any]](),
          "cancelled": false,
          "unavailable": ["reason": "UNSUPPORTED_DEVICE", "detail": "Document scanning is not supported on this device."],
        ])
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("PROVIDER_ERROR", "No view controller is available to present the scanner.")
        return
      }
      let longEdge = (options["enhanceLongEdgePx"] as? Int) ?? 1568
      let quality = (options["enhanceQuality"] as? Int) ?? 80
      let delegate = DocumentScanDelegate(longEdge: longEdge, quality: quality, promise: promise) { [weak self] in
        self?.activeDelegate = nil
      }
      self.activeDelegate = delegate
      let scanner = VNDocumentCameraViewController()
      scanner.delegate = delegate
      presenter.present(scanner, animated: true)
    }
    .runOnQueue(DispatchQueue.main)

    /**
     Measure one image against the metric definition of record (plan Step 3.1, D-SCAN1..5, D-SCAN8).

     `analysisLongEdgePx` is REQUIRED and comes from the signed capture config in JavaScript. It is
     part of what the metric means, not a tuning knob — D-SCAN1 fixes the analysis scale precisely so
     that a number recorded today can be compared with one recorded next month — so Swift holds no
     default for it. A default here would be a second copy of a signed value, in force whenever a
     caller forgot to pass it, and silently disagreeing with the server the day the config moved.

     Failure to load or decode REJECTS rather than resolving with a value, and that is consistent
     with D-SCAN7 rather than an exception to it: this URI is one we wrote ourselves moments ago
     during a capture we are still inside. A file we just wrote being unreadable is not an
     anticipated outcome about the device — it is the unforeseen, which is what PROVIDER_ERROR is.

     ⚠ OWED ON DEVICE (D-SCAN13): nothing below has run on a phone. `tests/ios/run-metrics-parity.sh`
     proves the ARITHMETIC reproduces the reference exactly over all 24 fixtures, on macOS, through
     ImageIO. It does not prove this function is reachable across the bridge, and it does not prove
     `UIImage` on a real device hands `CaptureImageDecode` the same pixels ImageIO hands it here.
     */
    AsyncFunction("measure") { (uri: String, analysisLongEdgePx: Int, promise: Promise) in
      guard analysisLongEdgePx > 0 else {
        promise.reject("PROVIDER_ERROR", "measure() needs a positive analysis scale, received \(analysisLongEdgePx).")
        return
      }
      DispatchQueue.global(qos: .userInitiated).async {
        // The same reasoning as ImagePipeline's per-page pool: a decoded multi-megapixel image and
        // the RGBA buffer drawn from it are both large and both autoreleased, and without an
        // explicit pool they survive until this thread's pool drains rather than until this call
        // returns. Step 1.4 closed two OOM paths in this module; this is not the place to open a third.
        let measured: MeasuredMetrics? = autoreleasepool {
          guard let image = ImageLoader.load(uri),
                let cgImage = image.cgImage,
                let decoded = CaptureImageDecode.decode(cgImage)
          else { return nil }
          return CaptureMetrics.compute(
            rgb: decoded.rgba,
            width: decoded.width,
            height: decoded.height,
            analysisLongEdgePx: analysisLongEdgePx,
            channels: CaptureImageDecode.channels
          )
        }
        guard let measured else {
          promise.reject("PROVIDER_ERROR", "Could not decode an image at \(uri).")
          return
        }
        promise.resolve(measured.asDictionary)
      }
    }

    AsyncFunction("recognize") { (uri: String, promise: Promise) in
      guard let image = ImageLoader.load(uri) else {
        promise.reject("PROVIDER_ERROR", "Could not load an image at \(uri).")
        return
      }
      OcrEngine.recognize(image) { metrics in promise.resolve(metrics) }
    }

    // Dismissing the scanner does NOT call any delegate method, so the previous implementation —
    // dismiss the presented view controller and return — left `scan()`'s promise unsettled forever.
    // Nothing calls this today, which is the only reason it has never hung a capture. Routing through
    // the delegate settles it as a cancellation, which is what a caller asking to cancel means.
    Function("cancel") {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.appContext?.utilities?.currentViewController()?.dismiss(animated: true)
        self.activeDelegate?.cancelFromHost()
      }
    }
  }
}

// MARK: - Scanner delegate

private final class DocumentScanDelegate: NSObject, VNDocumentCameraViewControllerDelegate {
  private let longEdge: Int
  private let quality: Int
  private let promise: Promise
  private let onFinish: () -> Void
  private var settled = false

  init(longEdge: Int, quality: Int, promise: Promise, onFinish: @escaping () -> Void) {
    self.longEdge = longEdge
    self.quality = quality
    self.promise = promise
    self.onFinish = onFinish
  }

  // Every terminal path routes through here exactly once — no double-resolve, and the delegate is released.
  private func settle(_ block: () -> Void) {
    guard !settled else { return }
    settled = true
    block()
    onFinish()
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    controller.dismiss(animated: true)
    // The scan object is only valid inside this callback — snapshot every page now.
    var images: [UIImage] = []
    for i in 0..<scan.pageCount { images.append(scan.imageOfPage(at: i)) }
    ImagePipeline.process(images: images, longEdge: longEdge, quality: quality) { [weak self] pages in
      guard let self else { return }
      self.settle { self.promise.resolve(["pages": pages, "cancelled": false]) }
    }
  }

  /// Cancellation asked for by our own JS layer rather than by the driver tapping Cancel. The
  /// scanner has already been dismissed by the caller; `settle`'s guard makes a later delegate
  /// callback a no-op, so this cannot double-resolve.
  func cancelFromHost() {
    settle { promise.resolve(["pages": [[String: Any]](), "cancelled": true]) }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true)
    settle { promise.resolve(["pages": [[String: Any]](), "cancelled": true]) }
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    controller.dismiss(animated: true)
    settle { promise.reject("PROVIDER_ERROR", error.localizedDescription) }
  }
}

// MARK: - Image pipeline (downscale → JPEG → hash → OCR)

private enum ImagePipeline {
  /**
   How many pages may be in flight at once.

   This used to be "all of them": every page was dispatched onto the global queue at the same moment,
   so a ten-page scan ran ten UIGraphicsImageRenderer bitmaps and ten concurrent `.accurate` Vision
   requests simultaneously. Each of those holds a multi-megapixel buffer, and the audit named this the
   single most likely crash in the module.

   Two rather than one because the work alternates between memory-bound (resize + encode) and
   compute-bound (Vision) phases, so a second page fills the gaps without doubling peak memory; and
   two rather than ProcessInfo.activeProcessorCount because the constraint here is memory on the
   worst phone in the fleet, not cores on the best one.
   */
  private static let maxConcurrentPages = 2

  static func process(images: [UIImage], longEdge: Int, quality: Int, completion: @escaping ([[String: Any]]) -> Void) {
    let group = DispatchGroup()
    var results = [Int: [String: Any]]()
    let lock = NSLock()
    let slots = DispatchSemaphore(value: maxConcurrentPages)
    for (idx, image) in images.enumerated() {
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        slots.wait()
        // Without an explicit pool, the CGImage and Data temporaries each page creates are only
        // released when the dispatch queue's own pool drains — which is after the LAST page on this
        // thread, so the peak is the sum of every page rather than of the two in flight. This is the
        // difference between bounding concurrency and actually bounding memory.
        autoreleasepool {
          let page = makePage(image, longEdge: longEdge, quality: quality)
          lock.lock(); results[idx] = page; lock.unlock()
        }
        slots.signal()
        group.leave()
      }
    }
    group.notify(queue: .main) {
      completion(results.keys.sorted().compactMap { results[$0] })
    }
  }

  // JPEG (not WebP): iOS WebP encoding is unreliable (DCE §4) — the server normalizer produces the
  // canonical WebP, so the evidentiary record stays consistent.
  private static func makePage(_ image: UIImage, longEdge: Int, quality: Int) -> [String: Any] {
    let resized = ImageScaler.scale(image, longEdge: CGFloat(longEdge))
    let data = resized.jpegData(compressionQuality: CGFloat(quality) / 100.0) ?? Data()
    let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let uri = TempFile.write(data)
    return [
      "uri": uri,
      "width": Int(resized.size.width * resized.scale),
      "height": Int(resized.size.height * resized.scale),
      "bytes": data.count,
      "mediaType": "image/jpeg",
      "integrityHash": hash,
      "osEnhanced": true,
      "ocr": OcrEngine.recognizeSync(resized),
    ]
  }
}

private enum ImageScaler {
  static func scale(_ image: UIImage, longEdge: CGFloat) -> UIImage {
    let maxEdge = max(image.size.width, image.size.height)
    guard maxEdge > longEdge, maxEdge > 0 else { return image }
    let factor = longEdge / maxEdge
    let newSize = CGSize(width: image.size.width * factor, height: image.size.height * factor)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1 // 1 device-pixel per point → size in points == size in pixels
    return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: newSize))
    }
  }
}

private enum TempFile {
  static func write(_ data: Data) -> String {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("bol-\(UUID().uuidString).jpg")
    try? data.write(to: url)
    return url.absoluteString
  }
}

private enum ImageLoader {
  static func load(_ uri: String) -> UIImage? {
    if let url = URL(string: uri), url.isFileURL, let data = try? Data(contentsOf: url) {
      return UIImage(data: data)
    }
    return UIImage(contentsOfFile: uri.replacingOccurrences(of: "file://", with: ""))
  }
}

// MARK: - OCR (VNRecognizeText → portable legibility metrics for the §5 gate)

private enum OcrEngine {
  static func recognize(_ image: UIImage, completion: @escaping ([String: Any]) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async { completion(recognizeSync(image)) }
  }

  static func recognizeSync(_ image: UIImage) -> [String: Any] {
    guard let cg = image.cgImage else { return empty() }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return empty() // OCR failure → degrade closed (the TS gate treats absent metrics as na + flag)
    }
    // `request.results` is already `[VNRecognizedTextObservation]?` on VNRecognizeTextRequest, so the
    // conditional downcast this used to carry did nothing and the compiler said so — surfaced by the
    // first Xcode build this module has had on record (Step 1.1, 2026-09-07).
    let observations = request.results ?? []
    return metrics(from: observations, imageWidthPx: CGFloat(cg.width), imageHeightPx: CGFloat(cg.height))
  }

  /**
   ── F7 (plan Step 3.3): both coverage figures are now UNIONS over the page area ────────────────
   `textCoverageFraction` used to SUM `box.width * box.height` over boxes that overlap and nest, so
   it could exceed 1 and grew with OCR redundancy; `smallTextBandCoverage` used to be
   `Σ(line heights) / imageHeight`, a sum of heights over a height, which is not a fraction of
   anything and grew without bound with line count. Both now go through `CaptureTextCoverage`, the
   transliteration of `packages/capture-engine/src/textCoverage.ts`, which is held to
   `fixtures/textBoxes.json`. Their gate floors are `null` until Step 5.2 re-derives them: the old
   0.08 and 0.02 were aimed at the quantities described above.

   ⚠ Vision's `boundingBox` is normalised 0..1 with a **BOTTOM-left** origin. The flip to top-left
   pixels happens HERE, next to the Vision call, rather than inside the geometry — which takes pixels
   in a stated origin precisely so that neither platform's convention leaks into the definition. A
   missed flip would still produce plausible numbers on a page whose text is roughly symmetric
   vertically, which is most of them.
   */
  private static func metrics(
    from observations: [VNRecognizedTextObservation],
    imageWidthPx: CGFloat,
    imageHeightPx: CGFloat
  ) -> [String: Any] {
    var chars = 0
    var words = 0
    var boxes: [TextBox] = []
    var heights: [CGFloat] = []
    var confidences: [Float] = []
    var tokens: [String] = []
    for observation in observations {
      guard let candidate = observation.topCandidates(1).first else { continue }
      let text = candidate.string
      chars += text.count
      words += text.split(separator: " ").count
      confidences.append(candidate.confidence)
      let box = observation.boundingBox // normalized 0..1, BOTTOM-left origin
      boxes.append(TextBox(
        x: Double(box.minX * imageWidthPx),
        y: Double((1 - box.maxY) * imageHeightPx),
        width: Double(box.width * imageWidthPx),
        height: Double(box.height * imageHeightPx)
      ))
      heights.append(box.height * imageHeightPx)
      for token in text.split(whereSeparator: { !$0.isNumber }) where token.count >= 3 {
        tokens.append(String(token))
      }
    }
    let width = Double(imageWidthPx)
    let height = Double(imageHeightPx)
    let coverage = CaptureTextCoverage.textCoverageFraction(boxes, width: width, height: height)
    let smallCoverage = CaptureTextCoverage.smallTextBandCoverage(boxes, width: width, height: height)
    let sortedHeights = heights.sorted()
    let median = sortedHeights.isEmpty ? 0.0 : Double(sortedHeights[sortedHeights.count / 2])
    let meanConfidence = confidences.isEmpty ? 0.0 : Double(confidences.reduce(0, +)) / Double(confidences.count)
    return [
      "engine": "ios.vision",
      "recognizedChars": chars,
      "recognizedWords": words,
      "textCoverageFraction": coverage,
      "medianCharHeightPx": median,
      "smallTextBandCoverage": smallCoverage,
      "meanConfidence": meanConfidence,
      "numberTokens": tokens,
    ]
  }

  static func empty() -> [String: Any] {
    [
      "engine": "ios.vision", "recognizedChars": 0, "recognizedWords": 0, "textCoverageFraction": 0.0,
      "medianCharHeightPx": 0.0, "smallTextBandCoverage": 0.0, "meanConfidence": 0.0, "numberTokens": [String](),
    ]
  }
}
