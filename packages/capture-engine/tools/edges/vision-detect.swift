import CoreGraphics
import Foundation
import ImageIO
import Vision

// Apple's two document detectors, run on photographs on a Mac (LIVE-EDGE-DETECTION-PLAN.md step L1).
//
// Reads image paths, one per line, on stdin. Writes one JSON object per line on stdout:
//   {"file", "width", "height", "segmentation": {corners, confidence, ms} | null, "rectangles": … | null}
// Corners are in the photo's UPRIGHT pixels (EXIF orientation applied), top-left origin, in the order
// top-left, top-right, bottom-right, bottom-left — the order `capture-engine` uses everywhere.
//
// With `--ppm-dir DIR` it also writes each photo, upright and at most 1,568 px on the long edge, as a
// binary PPM named by line number, so detectors written in TypeScript (`findDocument`) can read the same
// pixels without a JPEG decoder in Node.
//
// Why on a Mac: Vision is the same framework on macOS and iOS, so `VNDetectDocumentSegmentationRequest`
// scored here is the detector the L0 camera runs on the phone, and the labelled set is scored without a
// phone in the room. The SPEED it reports here is a Mac's, not a phone's; only L0's readout measures that.
//
//   swiftc -O -o vision-detect vision-detect.swift && ls photos/*.jpg | ./vision-detect > detections.jsonl

struct Options {
  var ppmDir: String?
}

func parseOptions() -> Options {
  var options = Options()
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let arg = args.next() {
    switch arg {
    case "--ppm-dir": options.ppmDir = args.next()
    default:
      FileHandle.standardError.write("unknown argument \(arg)\n".data(using: .utf8)!)
      exit(2)
    }
  }
  return options
}

/// EXIF orientations 5–8 turn the image a quarter turn, so its upright width is its stored height.
func isQuarterTurn(_ o: CGImagePropertyOrientation) -> Bool {
  switch o {
  case .leftMirrored, .right, .rightMirrored, .left: return true
  default: return false
  }
}

func corners(_ o: VNRectangleObservation, width: Double, height: Double) -> [[String: Double]] {
  // Vision: normalised to the ORIENTED image, origin at the bottom-left.
  [o.topLeft, o.topRight, o.bottomRight, o.bottomLeft].map { p in
    ["x": Double(p.x) * width, "y": (1 - Double(p.y)) * height]
  }
}

func timed<T>(_ body: () throws -> T) rethrows -> (T, Double) {
  let start = DispatchTime.now().uptimeNanoseconds
  let value = try body()
  return (value, Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
}

func writePPM(_ image: CGImage, to path: String) -> Bool {
  let w = image.width, h = image.height
  var rgba = [UInt8](repeating: 0, count: w * h * 4)
  guard let ctx = CGContext(
    data: &rgba, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
  ) else { return false }
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  var data = Data("P6\n\(w) \(h)\n255\n".utf8)
  data.reserveCapacity(data.count + w * h * 3)
  for i in 0..<(w * h) {
    data.append(rgba[i * 4]); data.append(rgba[i * 4 + 1]); data.append(rgba[i * 4 + 2])
  }
  return FileManager.default.createFile(atPath: path, contents: data)
}

let options = parseOptions()
var line = 0
while let raw = readLine() {
  let path = raw.trimmingCharacters(in: .whitespaces)
  if path.isEmpty { continue }
  line += 1
  var record: [String: Any] = ["file": path]
  defer {
    let json = try! JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
    print(String(data: json, encoding: .utf8)!)
    fflush(stdout)
  }
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    record["error"] = "cannot decode"
    continue
  }
  let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
  let orientation = (props?[kCGImagePropertyOrientation] as? UInt32).flatMap(CGImagePropertyOrientation.init) ?? .up
  let width = Double(isQuarterTurn(orientation) ? image.height : image.width)
  let height = Double(isQuarterTurn(orientation) ? image.width : image.height)
  record["width"] = Int(width)
  record["height"] = Int(height)

  let segmentation = VNDetectDocumentSegmentationRequest()
  // WeScan's settings for the rectangle detector (MIT, shipped in an App Store scanner): confidence 0.8,
  // aspect down to 0.3 so a receipt qualifies, and up to 15 candidates of which the largest wins.
  let rectangles = VNDetectRectanglesRequest()
  rectangles.minimumConfidence = 0.8
  rectangles.minimumAspectRatio = 0.3
  rectangles.maximumObservations = 15

  let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
  let (_, segMs) = timed { try? handler.perform([segmentation]) }
  let (_, rectMs) = timed { try? handler.perform([rectangles]) }

  if let best = segmentation.results?.max(by: { $0.confidence < $1.confidence }) {
    record["segmentation"] = ["corners": corners(best, width: width, height: height), "confidence": Double(best.confidence), "ms": segMs]
  } else {
    record["segmentation"] = NSNull()
  }
  let area = { (o: VNRectangleObservation) in o.boundingBox.width * o.boundingBox.height }
  if let biggest = rectangles.results?.max(by: { area($0) < area($1) }) {
    record["rectangles"] = ["corners": corners(biggest, width: width, height: height), "confidence": Double(biggest.confidence), "ms": rectMs]
  } else {
    record["rectangles"] = NSNull()
  }

  if let dir = options.ppmDir {
    let thumbOptions: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: 1568,
    ]
    let ppm = "\(dir)/\(line).ppm"
    if let upright = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions as CFDictionary), writePPM(upright, to: ppm) {
      record["ppm"] = ppm
    }
  }
}
