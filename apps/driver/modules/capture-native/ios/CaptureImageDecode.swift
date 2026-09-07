import CoreGraphics
import Foundation

/**
 Decoding, separated from arithmetic (SCANNER-UPGRADE-PLAN.md Step 3.1).

 The plan's Step 3.1 says: "Render the image into an 8-bit RGBA `CGContext` (deterministic, no
 colour-management surprises)". This is that sentence, and the reason it is its own file is that
 `CaptureMetrics.swift` must stay importable by a `swiftc` invocation with nothing but Foundation, so
 that the parity harness runs on a laptop rather than only on a phone.

 ── WHY A CGCONTEXT AND NOT `CGImage`'s OWN BYTES ─────────────────────────────────────────────
 `CGImage.dataProvider` hands back whatever layout the decoder happened to produce: 8 or 16 bits per
 component, RGB or BGRA, alpha first or last, premultiplied or not, and a row stride that is padded
 to a multiple the framework chose. Reading that directly means the metric quietly depends on which
 codec decoded which file. Drawing into a context WE describe makes the layout ours: tightly packed,
 8-bit, RGBA in memory order, sRGB.

 ── WHAT "NO COLOUR-MANAGEMENT SURPRISES" ACTUALLY RESTS ON ───────────────────────────────────
 Nothing here can prove the render is a byte-for-byte identity — that depends on the source image's
 profile and on Core Graphics. So the parity harness does not assume it: it digests the decoded RGB
 and compares against `pixelSha256`, which the corpus computes over the generator's own raw pixels.
 A decode that shifts a single count fails as a DECODE mismatch and is reported separately from an
 arithmetic mismatch, because "Swift computes the metric differently" and "Swift is measuring
 different pixels" are two entirely different bugs and a single tolerance failure would hide which.
 */
enum CaptureImageDecode {
  /// One decoded image in the layout `CaptureMetrics` expects: interleaved RGBA, 8 bits per channel,
  /// tightly packed, `width * height * 4` bytes.
  struct Decoded {
    var rgba: [UInt8]
    var width: Int
    var height: Int
  }

  /// Channels per pixel in a `Decoded.rgba` — pass this to `CaptureMetrics.compute`.
  static let channels = 4

  static func decode(_ image: CGImage) -> Decoded? {
    let width = image.width
    let height = image.height
    guard width > 0, height > 0 else { return nil }

    // A hard cap so a corrupt or hostile header cannot ask for a multi-gigabyte allocation on a
    // phone. 100 MP is roughly four times the largest sensor in any fleet handset, and the OS
    // scanner's own output is far below it, so this refuses only images that should be refused.
    guard width * height <= 100_000_000 else { return nil }

    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
    var rgba = [UInt8](repeating: 0, count: width * height * channels)
    let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue

    let drawn: Bool = rgba.withUnsafeMutableBytes { buffer -> Bool in
      guard let base = buffer.baseAddress,
            let context = CGContext(
              data: base,
              width: width,
              height: height,
              bitsPerComponent: 8,
              // Stated explicitly rather than left to Core Graphics, which pads a row to a
              // convenient multiple. A padded stride would make every metric read across gaps of
              // uninitialised memory — and would do it silently, since the numbers would still look
              // like numbers.
              bytesPerRow: width * channels,
              space: colorSpace,
              bitmapInfo: bitmapInfo
            )
      else { return false }
      context.interpolationQuality = .none
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard drawn else { return nil }
    return Decoded(rgba: rgba, width: width, height: height)
  }
}
