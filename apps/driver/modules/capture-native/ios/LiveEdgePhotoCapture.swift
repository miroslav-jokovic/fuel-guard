import AVFoundation
import CoreImage
import UIKit

// The photo the capture gate takes (D-LED6), and the straightened page cut from it.
//
// The ORIGINAL is the full-resolution JPEG exactly as the camera gave it — the original of record, as
// Phase 4 made it for the system scanners (`{id}.original.jpg`). The PAGE is that photo straightened to
// the outline the gate approved, by Core Image's perspective correction.
//
// ⚠ The page here is the spike's PREVIEW of the result, so the owner can judge the gate on a phone today.
// It is not the product's normalisation: L2 refines the corners on the full-resolution photo first
// (plan §4.2), and L5 hands the original to the capture pipeline (`capture-engine`, enhance + the quality
// gate), which makes the page a driver sends. Nothing here is uploaded.

struct LiveEdgeCapturedPhoto {
  let originalURL: URL
  let pageURL: URL
  let photoSize: CGSize
  let pageSize: CGSize
}

final class LiveEdgePhotoCapture: NSObject, AVCapturePhotoCaptureDelegate {
  private let corners: LiveQuad
  private let completion: (Result<LiveEdgeCapturedPhoto, Error>) -> Void
  private static let context = CIContext()

  /// `corners` normalised to the UPRIGHT image, top-left origin — the frame's own coordinates, which
  /// are the photo's because both come from the same 4:3 field of view (D-LED7).
  init(corners: LiveQuad, completion: @escaping (Result<LiveEdgeCapturedPhoto, Error>) -> Void) {
    self.corners = corners
    self.completion = completion
  }

  struct Failure: LocalizedError {
    let errorDescription: String?
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    if let error { return completion(.failure(error)) }
    guard let data = photo.fileDataRepresentation() else {
      return completion(.failure(Failure(errorDescription: "the camera returned no image data")))
    }
    let corners = self.corners
    let completion = self.completion
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        completion(.success(try Self.write(data, corners: corners)))
      } catch {
        completion(.failure(error))
      }
    }
  }

  private static func write(_ data: Data, corners: LiveQuad) throws -> LiveEdgeCapturedPhoto {
    let id = UUID().uuidString.lowercased()
    let dir = FileManager.default.temporaryDirectory
    let originalURL = dir.appendingPathComponent("live-edge-\(id).original.jpg")
    let pageURL = dir.appendingPathComponent("live-edge-\(id).page.jpg")
    try data.write(to: originalURL)

    // The JPEG carries its rotation as EXIF; applying it gives the upright image the corners describe.
    guard let upright = CIImage(data: data, options: [.applyOrientationProperty: true]) else {
      throw Failure(errorDescription: "the photo could not be decoded")
    }
    let extent = upright.extent
    // Core Image's origin is the BOTTOM-left; the corners' is the top-left.
    func ci(_ p: CGPoint) -> CIVector {
      CIVector(x: extent.minX + p.x * extent.width, y: extent.minY + (1 - p.y) * extent.height)
    }
    guard let filter = CIFilter(name: "CIPerspectiveCorrection") else {
      throw Failure(errorDescription: "perspective correction is unavailable")
    }
    filter.setValue(upright, forKey: kCIInputImageKey)
    filter.setValue(ci(corners.topLeft), forKey: "inputTopLeft")
    filter.setValue(ci(corners.topRight), forKey: "inputTopRight")
    filter.setValue(ci(corners.bottomRight), forKey: "inputBottomRight")
    filter.setValue(ci(corners.bottomLeft), forKey: "inputBottomLeft")
    guard let page = filter.outputImage,
          let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let jpeg = context.jpegRepresentation(
            of: page, colorSpace: colorSpace,
            options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.9]
          )
    else {
      throw Failure(errorDescription: "the page could not be straightened")
    }
    try jpeg.write(to: pageURL)
    return LiveEdgeCapturedPhoto(originalURL: originalURL, pageURL: pageURL, photoSize: extent.size, pageSize: page.extent.size)
  }
}
