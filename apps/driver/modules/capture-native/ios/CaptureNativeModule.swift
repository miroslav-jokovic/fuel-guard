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
      [
        "camera": UIImagePickerController.isSourceTypeAvailable(.camera),
        "docScanner": VNDocumentCameraViewController.isSupported,
        "ocr": true,
      ]
    }

    AsyncFunction("scan") { (options: [String: Any], promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        promise.reject("UNSUPPORTED_DEVICE", "Document scanning is not supported on this device.")
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

    AsyncFunction("recognize") { (uri: String, promise: Promise) in
      guard let image = ImageLoader.load(uri) else {
        promise.reject("PROVIDER_ERROR", "Could not load an image at \(uri).")
        return
      }
      OcrEngine.recognize(image) { metrics in promise.resolve(metrics) }
    }

    Function("cancel") {
      DispatchQueue.main.async { [weak self] in
        self?.appContext?.utilities?.currentViewController()?.dismiss(animated: true)
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
  static func process(images: [UIImage], longEdge: Int, quality: Int, completion: @escaping ([[String: Any]]) -> Void) {
    let group = DispatchGroup()
    var results = [Int: [String: Any]]()
    let lock = NSLock()
    for (idx, image) in images.enumerated() {
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        let page = makePage(image, longEdge: longEdge, quality: quality)
        lock.lock(); results[idx] = page; lock.unlock()
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
    let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
    return metrics(from: observations, imageHeightPx: CGFloat(cg.height))
  }

  private static func metrics(from observations: [VNRecognizedTextObservation], imageHeightPx: CGFloat) -> [String: Any] {
    var chars = 0
    var words = 0
    var coverage: CGFloat = 0
    var heights: [CGFloat] = []
    var confidences: [Float] = []
    var tokens: [String] = []
    for observation in observations {
      guard let candidate = observation.topCandidates(1).first else { continue }
      let text = candidate.string
      chars += text.count
      words += text.split(separator: " ").count
      confidences.append(candidate.confidence)
      let box = observation.boundingBox // normalized 0..1
      coverage += box.width * box.height
      heights.append(box.height * imageHeightPx)
      for token in text.split(whereSeparator: { !$0.isNumber }) where token.count >= 3 {
        tokens.append(String(token))
      }
    }
    let sortedHeights = heights.sorted()
    let median = sortedHeights.isEmpty ? 0.0 : Double(sortedHeights[sortedHeights.count / 2])
    let smallCount = max(1, sortedHeights.count / 4)
    let smallSum = sortedHeights.prefix(smallCount).reduce(0, +)
    let smallCoverage = imageHeightPx > 0 ? Double(smallSum / imageHeightPx) : 0.0
    let meanConfidence = confidences.isEmpty ? 0.0 : Double(confidences.reduce(0, +)) / Double(confidences.count)
    return [
      "engine": "ios.vision",
      "recognizedChars": chars,
      "recognizedWords": words,
      "textCoverageFraction": Double(coverage),
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
