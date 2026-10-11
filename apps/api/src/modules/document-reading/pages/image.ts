import sharp, { type Sharp } from "sharp";
import { INTAKE_LIMITS, type IntakeRefusalCode } from "@silvicom/shared";
import type { RgbRaster } from "./canonical.js";
import type { SourceFormat } from "./sniff.js";

/**
 * A photo or screenshot → one upright, flattened, 8-bit sRGB raster (D-DR13).
 *
 * The order matters and each step is the one a format would otherwise smuggle past the readers:
 *   1. `.rotate()` — applies EXIF orientation. A phone stores the sensor's pixels and a tag saying
 *      "turn me"; a reader that ignores the tag sees the BOL sideways, and a crop's bbox lands on
 *      the wrong paper. Applying it and then writing no metadata is what "applied and stripped" means.
 *   2. `.toColourspace("srgb")` — a greyscale scan (a fax gateway, a "black & white" copier setting)
 *      decodes to one channel, a CMYK JPEG (a print shop's scanner, an InDesign export) to four, a
 *      Display-P3 iPhone JPEG to wide-gamut RGB; each must leave as sRGB RGB. sharp 0.35 already
 *      converts every one of those on output by itself — measured 2026-10-09: deleting this line
 *      leaves the greyscale and CMYK tests green — so the line states the stage's contract rather
 *      than doing the work today, and keeps doing it if a sharp release changes that default.
 *   3. `.flatten({ background: white })` — a screenshot PNG or a cut-out WebP has transparency, and
 *      "transparent" is not a colour: dropped naively, transparent pixels keep whatever RGB the
 *      encoder stored (usually black), and black-on-black type disappears. Paper is white.
 *   4. `.raw({ depth: "uchar" })` — a 16-bit PNG becomes 8-bit here, once, so nothing downstream
 *      meets a second bit depth.
 */

/**
 * `failOn: "error"`: refuse a file libvips cannot decode, but read one it can decode with a warning.
 * MMS gateways and some Android cameras write JPEGs with trailing garbage or a short final scan,
 * which `"warning"` (sharp's default) refuses although every printed character is present.
 */
const DECODE_OPTIONS = { failOn: "error" } as const;

type ImageOutcome = { ok: true; raster: RgbRaster } | { ok: false; code: IntakeRefusalCode };

/**
 * heic-decode (WASM libheif, LGPL-3.0, approved in D-DR13): prebuilt sharp parses a HEVC HEIC's
 * header and then fails on the pixels — its libvips has no libde265 (the evidence module measured
 * this for A3). libheif applies the container's `irot`/`imir` transforms itself, so its output is
 * already upright; there is no EXIF orientation left to apply. Loaded lazily so the WASM is only
 * initialised by a process that actually receives a HEIC.
 */
async function decodeHeic(bytes: Buffer): Promise<Sharp> {
  const { default: heicDecode } = await import("heic-decode");
  const { width, height, data } = await heicDecode({ buffer: bytes });
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } });
}

async function toUprightRaster(input: Sharp, applyExif: boolean): Promise<RgbRaster> {
  const oriented = applyExif ? input.rotate() : input;
  const { data, info } = await oriented
    .toColourspace("srgb")
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`expected 3 channels after sRGB conversion, got ${info.channels}`);
  return { data, width: info.width, height: info.height };
}

export async function decodeImage(bytes: Buffer, format: Exclude<SourceFormat, "pdf">): Promise<ImageOutcome> {
  let raster: RgbRaster;
  try {
    const input = format === "heic" ? await decodeHeic(bytes) : sharp(bytes, DECODE_OPTIONS);
    raster = await toUprightRaster(input, format !== "heic");
  } catch {
    return { ok: false, code: "decode_failed" };
  }
  // The live resolution floor (§3): measured on the decoded raster, so an EXIF-rotated photo is
  // judged by its long edge whichever way it was held. A PDF page has no such floor — it is rendered
  // at 300 DPI, so its pixels are a choice of ours, not a property of the capture.
  if (Math.max(raster.width, raster.height) < INTAKE_LIMITS.minLongEdgePx) return { ok: false, code: "too_small" };
  return { ok: true, raster };
}
