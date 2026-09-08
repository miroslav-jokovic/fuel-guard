import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

/**
 * Turn a piece of reference artwork into a hero texture: an image that occupies a DELIBERATE tonal
 * band, from `floor` to `ceiling`, and never a level brighter than the ceiling.
 *
 * The ceiling is the contrast budget — `src/theme/heroTexture.ts` derives it from the tones the hero
 * carries, and nothing may exceed it. The floor is what makes the texture visible, and it was the
 * missing half until 2026-09-08. The first version of this tool blended each pixel toward the hero
 * navy by a gamma curve, which pulls the darks UP as hard as it pulls the highlights down: measured
 * on the shipped band texture, the whole image lived between levels 48 and 54 — **six levels of
 * range**, which is why the owner could not see it. The auth texture read fine at 32 levels.
 *
 * So the mapping is a normalisation, not a blend. The source's own 1st-to-99th percentile is
 * stretched onto [floor, ceiling], which gives the full band whatever the source looks like, and the
 * ceiling still binds. Hue survives because each pixel is scaled rather than mixed with navy.
 *
 * Usage: tonemap <src.png> <out.png> <width> <height> <floor> <ceiling>
 */
let a = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let outW = Int(a[3])!, outH = Int(a[4])!
let floorLevel = Double(a[5])!
let ceiling = Double(a[6])!

let ctx = CGContext(data: nil, width: outW, height: outH, bitsPerComponent: 8, bytesPerRow: outW*4,
  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.interpolationQuality = .high
let sw = Double(img.width), sh = Double(img.height)
let scale = max(Double(outW)/sw, Double(outH)/sh)
let dw = sw*scale, dh = sh*scale
ctx.draw(img, in: CGRect(x: (Double(outW)-dw)/2, y: (Double(outH)-dh)/2, width: dw, height: dh))

let buf = ctx.data!.bindMemory(to: UInt8.self, capacity: outW*outH*4)
let count = outW*outH

// Pass 1 — where the source's tones actually sit. Percentiles rather than min/max so a handful of
// stray pixels cannot define the range and flatten everything else.
var hist = [Int](repeating: 0, count: 256)
for i in stride(from: 0, to: count*4, by: 4) {
  hist[max(Int(buf[i]), max(Int(buf[i+1]), Int(buf[i+2])))] += 1
}
var cum = 0, p1 = 0, p99 = 255
for v in 0..<256 { cum += hist[v]; if cum >= count/100 { p1 = v; break } }
cum = 0
for v in stride(from: 255, through: 0, by: -1) { cum += hist[v]; if cum >= count/100 { p99 = v; break } }
let span = max(Double(p99 - p1), 1)

// Pass 2 — stretch that span onto [floor, ceiling], scaling each pixel so its hue survives.
var peak = 0.0
for i in stride(from: 0, to: count*4, by: 4) {
  let r = Double(buf[i]), g = Double(buf[i+1]), b = Double(buf[i+2])
  let v = max(r, max(g, b))
  let t = min(max((v - Double(p1)) / span, 0), 1)
  let target = floorLevel + t * (ceiling - floorLevel)
  let k = v > 0 ? target / v : 0
  let nr = min(r*k, ceiling), ng = min(g*k, ceiling), nb = min(b*k, ceiling)
  peak = max(peak, max(nr, max(ng, nb)))
  buf[i] = UInt8(nr.rounded()); buf[i+1] = UInt8(ng.rounded()); buf[i+2] = UInt8(nb.rounded()); buf[i+3] = 255
}
let out = ctx.makeImage()!
let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dst, out, nil)
CGImageDestinationFinalize(dst)
print("source span p1=\(p1) p99=\(p99) → mapped to [\(Int(floorLevel)), \(Int(ceiling))]; peak channel \(Int(peak))")
