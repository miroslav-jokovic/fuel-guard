import { describe, expect, it } from "vitest";
import { FORMAT_LABELS, FORMAT_MIMES, INTAKE_MIMES, INTAKE_REFUSALS, SNIFF_BYTES, SOURCE_FORMATS, sniffFormat } from "./index.js";

/**
 * The one sniff the browser and the intake share. What it must not do: name a file by anything but its
 * bytes, send an AVIF to the HEVC decoder (its ftyp lists `mif1` too), or need more bytes than the browser
 * reads before deciding.
 */
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const ftyp = (major: string, ...compatible: string[]) => {
  const size = 16 + compatible.length * 4;
  return new Uint8Array([0, 0, 0, size, ...ascii("ftyp"), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)]);
};

describe("sniffFormat", () => {
  const CASES: [string, Uint8Array, string | null][] = [
    ["a JFIF JPEG (Google Voice)", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...ascii("JFIF"), 0]), "jpeg"],
    ["an EXIF JPEG (a phone camera)", new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0x10, ...ascii("Exif")]), "jpeg"],
    ["a PNG", new Uint8Array([0x89, ...ascii("PNG\r\n\x1a\n")]), "png"],
    ["a WebP", new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]), "webp"],
    ["a little-endian TIFF", new Uint8Array(ascii("II*\0")), "tiff"],
    ["a big-endian TIFF", new Uint8Array(ascii("MM\0*")), "tiff"],
    ["a GIF89a", new Uint8Array(ascii("GIF89a")), "gif"],
    ["a GIF87a", new Uint8Array(ascii("GIF87a")), "gif"],
    ["an iPhone HEIC", ftyp("heic", "mif1", "heic"), "heic"],
    ["a generic HEIF (mif1 only as a compatible brand)", ftyp("isom", "mif1"), "heic"],
    ["an AVIF, which also lists mif1", ftyp("avif", "mif1", "miaf"), "avif"],
    ["an AVIF named only among the compatible brands", ftyp("mif1", "avif"), "avif"],
    ["a PDF", new Uint8Array(ascii("%PDF-1.7\n")), "pdf"],
    ["a PDF behind a mail gateway's stray line", new Uint8Array(ascii("Content-Type: x\r\n%PDF-1.4")), "pdf"],
    ["an MP4 video (ftyp, no image brand)", ftyp("isom", "mp41"), null],
    ["a Word file (a zip)", new Uint8Array([...ascii("PK"), 3, 4]), null],
    ["plain text", new Uint8Array(ascii("Bill of lading")), null],
    ["nothing", new Uint8Array(0), null],
  ];
  it.each(CASES)("knows %s", (_, bytes, want) => {
    expect(sniffFormat(bytes)).toBe(want);
  });

  it("finds a PDF header anywhere the browser's read reaches", () => {
    const late = new Uint8Array(SNIFF_BYTES);
    late.set(ascii("%PDF-1.7"), 1000);
    expect(sniffFormat(late)).toBe("pdf");
  });
});

describe("the format lists", () => {
  it("accepts every format's field mimes as a declaration, its canonical one first", () => {
    for (const f of SOURCE_FORMATS) expect(INTAKE_MIMES).toEqual(expect.arrayContaining([...FORMAT_MIMES[f]]));
    expect(SOURCE_FORMATS.map((f) => FORMAT_MIMES[f][0])).toEqual(
      ["image/jpeg", "image/png", "image/webp", "image/heic", "image/avif", "image/tiff", "image/gif", "application/pdf"],
    );
  });

  it("names every format in the unsupported-format refusal, JFIF by name", () => {
    for (const f of SOURCE_FORMATS) expect(INTAKE_REFUSALS.unsupported_format).toContain(FORMAT_LABELS[f]);
    expect(INTAKE_REFUSALS.unsupported_format).toContain("JFIF");
  });
});
