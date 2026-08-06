import ExpoModulesCore
import VisionKit
import Vision
import UIKit
import CryptoKit

// FuelGuard self-built document scanner — DCE v1 SystemScanner provider (iOS).
//
// Responsibility: CAPTURE (VNDocumentCameraViewController — crop-only, OS-enhanced) and MEASURE
// (VNRecognizeText → legibility metrics). It NEVER decides accept/reject — the §5 gate is TS code in
// @fuelguard/capture-engine. Nothing leaves the device (Apple Vision is documented on-device).
//
// Build/verify on a Mac (this file is authored in the cloud VM and cannot be compiled there). The two
// hardware checks the DCE gates on (DCE-0): confirm no network egress during a scan, and confirm the
// OCR confidence spread on a min-spec device (confidence is SECONDARY in the gate, so this is a tune,
// not a blocker).

public class CaptureNativeModule: Module {
  private var activeDelegate: ScannerDelegate?

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
      DispatchQueue.main.async {
        guard VNDocumentCameraViewController.isSupported else {
          promise.resolve(["pages": [], "cancelled": false]); return
        }
        let longEdge = (options["enhanceLongEdgePx"] as? Int) ?? 1568
        let quality = (options["enhanceQuality"] as? Int) ?? 80
        let delegate = ScannerDelegate(longEdge: longEdge, quality: quality, promise: promise) { [weak self] in
          self?.activeDelegate = nil
        }
        self.activeDelegate = delegate
        let vc = VNDocumentCameraViewController()
        vc.delegate = delegate
        Self.topViewController()?.present(vc, animated: true)
      }
    }

    AsyncFunction("recognize") { (uri: String, promise: Promise) in
      guard let image = Self.loadImage(uri) else {
        promise.reject("no_image", "Could not load image at \(uri)"); return
      }
      OcrEngine.recognize(image) { ocr in promise.resolve(ocr) }
    }

    Function("cancel") {
      DispatchQueue.main.async { Self.topViewController()?.dismiss(animated: true) }
    }
  }

  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
    var top = scene?.keyWindow?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }

  static func loadImage(_ uri: String) -> UIImage? {
    if let url = URL(string: uri), let data = try? Data(contentsOf: url) { return UIImage(data: data) }
    return UIImage(contentsOfFile: uri.replacingOccurrences(of: "file://", with: ""))
  }
}

private class ScannerDelegate: NSObject, VNDocumentCameraViewControllerDelegate {
  let longEdge: Int
  let quality: Int
  let promise: Promise
  let onDone: () -> Void

  init(longEdge: Int, quality: Int, promise: Promise, onDone: @escaping () -> Void) {
    self.longEdge = longEdge; self.quality = quality; self.promise = promise; self.onDone = onDone
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    controller.dismiss(animated: true)
    var pages: [[String: Any]] = []
    let group = DispatchGroup()
    for i in 0..<scan.pageCount {
      let page = scan.imageOfPage(at: i)
      group.enter()
      Self.process(page, longEdge: longEdge, quality: quality) { dict in
        if let dict = dict { pages.append(dict) }
        group.leave()
      }
    }
    group.notify(queue: .main) { self.promise.resolve(["pages": pages, "cancelled": false]); self.onDone() }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true)
    promise.resolve(["pages": [], "cancelled": true]); onDone()
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    controller.dismiss(animated: true)
    promise.reject("scan_failed", error.localizedDescription); onDone()
  }

  // Downscale to longEdge, JPEG-encode at `quality` (the server normalizer produces the canonical WebP —
  // iOS WebP encoding is unreliable, DCE §4 note), hash, then measure OCR legibility.
  static func process(_ image: UIImage, longEdge: Int, quality: Int, completion: @escaping ([String: Any]?) -> Void) {
    let resized = resize(image, longEdge: CGFloat(longEdge))
    guard let data = resized.jpegData(compressionQuality: CGFloat(quality) / 100.0) else { completion(nil); return }
    let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let uri = writeTemp(data)
    OcrEngine.recognize(resized) { ocr in
      completion([
        "uri": uri,
        "width": Int(resized.size.width * resized.scale),
        "height": Int(resized.size.height * resized.scale),
        "bytes": data.count,
        "mediaType": "image/jpeg",
        "integrityHash": hash,
        "osEnhanced": true,
        "ocr": ocr,
      ])
    }
  }

  static func resize(_ image: UIImage, longEdge: CGFloat) -> UIImage {
    let w = image.size.width, h = image.size.height
    let maxEdge = max(w, h)
    guard maxEdge > longEdge else { return image }
    let scale = longEdge / maxEdge
    let newSize = CGSize(width: w * scale, height: h * scale)
    let renderer = UIGraphicsImageRenderer(size: newSize)
    return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
  }

  static func writeTemp(_ data: Data) -> String {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("bol-\(UUID().uuidString).jpg")
    try? data.write(to: url)
    return url.absoluteString
  }
}

// VNRecognizeText → the portable legibility metrics the §5 gate consumes (geometry + coverage first).
private enum OcrEngine {
  static func recognize(_ image: UIImage, completion: @escaping ([String: Any]) -> Void) {
    guard let cg = image.cgImage else { completion(empty()); return }
    let request = VNRecognizeTextRequest { req, _ in
      let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
      var chars = 0, words = 0, coverage: CGFloat = 0
      var heights: [CGFloat] = []
      var confidences: [Float] = []
      var tokens: [String] = []
      let imgArea = CGFloat(cg.width * cg.height)
      for o in obs {
        guard let top = o.topCandidates(1).first else { continue }
        let text = top.string
        chars += text.count
        words += text.split(separator: " ").count
        confidences.append(top.confidence)
        let box = o.boundingBox // normalized 0..1
        coverage += box.width * box.height
        heights.append(box.height * CGFloat(cg.height))
        for t in text.split(whereSeparator: { !$0.isNumber }) where t.count >= 3 { tokens.append(String(t)) }
      }
      let sortedH = heights.sorted()
      let median = sortedH.isEmpty ? 0 : Double(sortedH[sortedH.count / 2])
      let smallBand = sortedH.prefix(max(1, sortedH.count / 4))
      let smallCoverage = imgArea > 0 ? Double(smallBand.reduce(0, +)) / Double(image.size.height) : 0
      let meanConf = confidences.isEmpty ? 0 : Double(confidences.reduce(0, +)) / Double(confidences.count)
      completion([
        "engine": "ios.vision",
        "recognizedChars": chars,
        "recognizedWords": words,
        "textCoverageFraction": Double(coverage),
        "medianCharHeightPx": median,
        "smallTextBandCoverage": smallCoverage,
        "meanConfidence": meanConf,
        "numberTokens": tokens,
      ])
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    DispatchQueue.global(qos: .userInitiated).async { try? handler.perform([request]) }
  }

  static func empty() -> [String: Any] {
    ["engine": "ios.vision", "recognizedChars": 0, "recognizedWords": 0, "textCoverageFraction": 0,
     "medianCharHeightPx": 0, "smallTextBandCoverage": 0, "meanConfidence": 0, "numberTokens": [String]()]
  }
}
