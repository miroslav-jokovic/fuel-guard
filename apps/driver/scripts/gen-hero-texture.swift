import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Compress the artwork's highlights toward the hero navy so the shipped texture cannot brighten the
// hero past the contrast budget, while the dark two-thirds of the art keep their detail.
let a = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let outW = Int(a[3])!, outH = Int(a[4])!
let ceiling = Double(a[5])!          // max channel the result may reach
let gamma = Double(a[6])!            // how hard highlights are pulled down

let hero = (r: 32.0, g: 40.0, b: 58.0)

let ctx = CGContext(data: nil, width: outW, height: outH, bitsPerComponent: 8, bytesPerRow: outW*4,
  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.interpolationQuality = .high
// cover-fit the source into the output box
let sw = Double(img.width), sh = Double(img.height)
let scale = max(Double(outW)/sw, Double(outH)/sh)
let dw = sw*scale, dh = sh*scale
ctx.draw(img, in: CGRect(x: (Double(outW)-dw)/2, y: (Double(outH)-dh)/2, width: dw, height: dh))

let buf = ctx.data!.bindMemory(to: UInt8.self, capacity: outW*outH*4)
var peak = 0.0
for i in stride(from: 0, to: outW*outH*4, by: 4) {
  let r = Double(buf[i]), g = Double(buf[i+1]), b = Double(buf[i+2])
  let lum = max(r, max(g, b)) / 255.0
  // Blend toward the hero navy, harder the brighter the pixel is.
  let keep = pow(1.0 - lum, gamma)
  var nr = hero.r + (r - hero.r) * keep
  var ng = hero.g + (g - hero.g) * keep
  var nb = hero.b + (b - hero.b) * keep
  // Hard ceiling, applied as a proportional pull so hue survives the clamp.
  let mx = max(nr, max(ng, nb))
  if mx > ceiling {
    let k = ceiling / mx
    nr *= k; ng *= k; nb *= k
  }
  peak = max(peak, max(nr, max(ng, nb)))
  buf[i] = UInt8(nr.rounded()); buf[i+1] = UInt8(ng.rounded()); buf[i+2] = UInt8(nb.rounded()); buf[i+3] = 255
}
let out = ctx.makeImage()!
let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dst, out, nil)
CGImageDestinationFinalize(dst)
print("peak channel in the generated texture: \(Int(peak))")
