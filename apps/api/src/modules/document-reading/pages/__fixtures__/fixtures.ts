import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import sharp from "sharp";

/**
 * Step 1.3's fixtures — every one SYNTHETIC, drawn here from rectangles and pdfkit's built-in
 * Helvetica, so the repository (public) holds no real paper and the tests need no fonts on the host.
 * Never take a fixture from `packages/capture-engine/fixtures/real/` — those are real BOLs.
 *
 * Built in memory at test time, except the HEIC: nothing in Node can ENCODE HEVC, so
 * `hevc-page.heic` is committed, made by this file's CLI on macOS from `pagePng()` with Apple's
 * `sips` (`npx tsx fixtures.ts <outDir>` writes every fixture to <outDir> for viewing; add
 * `--regenerate-heic` on macOS to rebuild the committed HEIC beside this file). It is our own
 * drawing encoded by the OS, so it carries no third-party licence.
 *
 * Every image page has the same landmarks, which is what "upright" and "sRGB" are tested against:
 *   - a BLACK square in the top-left corner (orientation: it must still be top-left afterwards);
 *   - a RED patch in the top-right corner (colour: it must still be red, not a CMYK channel or grey);
 *   - grey bars where text lines would be, so lossy encoders have edges to work on.
 */

export const MARKER_FRACTION = 0.1;
const RED = [220, 30, 30] as const;

/** A synthetic upright page as packed 8-bit RGB. */
export function pageRaster(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 3, 255);
  const marker = Math.round(Math.min(width, height) * MARKER_FRACTION);
  const paint = (x0: number, y0: number, w: number, h: number, rgb: readonly number[]) => {
    for (let y = y0; y < Math.min(height, y0 + h); y++) {
      for (let x = x0; x < Math.min(width, x0 + w); x++) data.set(rgb, (y * width + x) * 3);
    }
  };
  paint(0, 0, marker, marker, [0, 0, 0]);
  paint(width - marker, 0, marker, marker, RED);
  for (let y = marker * 2; y < height - marker; y += Math.round(marker / 2)) {
    paint(marker, y, width - marker * 2, Math.max(2, Math.round(marker / 10)), [90, 90, 90]);
  }
  return data;
}

const raw = (width: number, height: number) =>
  sharp(pageRaster(width, height), { raw: { width, height, channels: 3 } });

export const pagePng = (width = 1600, height = 1200) => raw(width, height).png().toBuffer();
export const pageJpeg = (width = 1600, height = 1200) => raw(width, height).jpeg({ quality: 92 }).toBuffer();

/** Pixels stored turned 90° counter-clockwise, EXIF orientation 6 ("turn 90° clockwise to view"). */
export async function exifRotatedJpeg(): Promise<Buffer> {
  return raw(1600, 1200).rotate(270).jpeg({ quality: 92 }).withMetadata({ orientation: 6 }).toBuffer();
}

/** Transparent everywhere except the landmarks, with the transparent pixels' RGB stored as BLACK. */
export async function alphaPng(width = 1400, height = 1800): Promise<Buffer> {
  const rgb = pageRaster(width, height);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];
    const paper = r === 255 && g === 255 && b === 255;
    rgba.set(paper ? [0, 0, 0, 0] : [r, g, b, 255], i * 4);
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export const pageWebp = () => raw(2400, 1800).webp({ quality: 85 }).toBuffer();
export const cmykJpeg = () => raw(1600, 1200).toColourspace("cmyk").jpeg({ quality: 92 }).toBuffer();
/** One channel, like a fax gateway's or a black-and-white copier's scan. */
export const greyJpeg = () => raw(1600, 1200).toColourspace("b-w").jpeg({ quality: 92 }).toBuffer();

export const heicFixture = () => readFileSync(new URL("./hevc-page.heic", import.meta.url));

// ── PDFs (pdfkit, Helvetica — one of the 14 standard fonts, so nothing is embedded) ─────────────────
export const LETTER = { width: 612, height: 792 } as const;
export const BORN_DIGITAL_LINES = [
  { page: 1, text: "BILL OF LADING", x: 72, y: 72, size: 18 },
  { page: 1, text: "SHIPPER ACME CHEMICAL 4417", x: 72, y: 144, size: 12 },
  { page: 1, text: "UN1203 GASOLINE 3 PG II", x: 300, y: 400, size: 10 },
  { page: 2, text: "PAGE 2 OF 2", x: 450, y: 700, size: 9 },
] as const;
export const ROTATED_LINE = { text: "ROTATED PAGE", x: 100, y: 120, size: 14 } as const;

function pdfDoc(options: PDFKit.PDFDocumentOptions = {}): { doc: PDFKit.PDFDocument; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: "LETTER", margin: 0, info: { CreationDate: new Date(0) }, ...options });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}

/**
 * Where the generator put a word: its left edge in points, from pdfkit's own Helvetica metrics —
 * the "generator's coordinates" the text-layer test compares pdf.js's boxes against.
 */
export function wordLeftPt(line: { text: string; x: number; size: number }, wordIndex: number): number {
  const { doc } = pdfDoc();
  doc.font("Helvetica").fontSize(line.size);
  const prefix = line.text.split(" ").slice(0, wordIndex).map((w) => `${w} `).join("");
  return line.x + doc.widthOfString(prefix);
}

export function bornDigitalPdf(): Promise<Buffer> {
  const { doc, done } = pdfDoc();
  doc.font("Helvetica");
  for (const page of [1, 2]) {
    if (page > 1) doc.addPage();
    for (const line of BORN_DIGITAL_LINES.filter((l) => l.page === page)) {
      doc.fontSize(line.size).text(line.text, line.x, line.y, { lineBreak: false });
    }
  }
  doc.end();
  return done;
}

/** A "scan": one page that is nothing but a JPEG of a page — no text operators at all. */
export async function scannedPdf(): Promise<Buffer> {
  const jpeg = await pageJpeg(1275, 1650);
  const { doc, done } = pdfDoc();
  doc.image(jpeg, 0, 0, { width: LETTER.width, height: LETTER.height });
  doc.end();
  return done;
}

/**
 * A portrait page with `/Rotate 90` whose content is drawn turned 90° counter-clockwise, so it READS
 * upright in landscape — what a scanner driver writes for a sideways-fed page. The black marker is
 * drawn where the displayed page's top-left corner falls.
 */
export function rotatedPdf(): Promise<Buffer> {
  const { doc, done } = pdfDoc();
  (doc.page.dictionary.data as Record<string, unknown>).Rotate = 90;
  const H = LETTER.height;
  // Displayed (X, Y) ← unrotated (x, y) = (Y, H − X) for a clockwise /Rotate 90.
  const marker = 60;
  doc.rect(0, H - marker, marker, marker).fill("#000000");
  doc.save();
  const ox = ROTATED_LINE.y;
  const oy = H - ROTATED_LINE.x;
  doc.rotate(-90, { origin: [ox, oy] });
  doc.fillColor("#000000").font("Helvetica").fontSize(ROTATED_LINE.size).text(ROTATED_LINE.text, ox, oy, { lineBreak: false });
  doc.restore();
  doc.end();
  return done;
}

export function encryptedPdf(): Promise<Buffer> {
  const { doc, done } = pdfDoc({ userPassword: "open-sesame", ownerPassword: "owner", pdfVersion: "1.7" });
  doc.font("Helvetica").fontSize(12).text("LOCKED", 72, 72);
  doc.end();
  return done;
}

export function pagesPdf(count: number): Promise<Buffer> {
  const { doc, done } = pdfDoc();
  doc.font("Helvetica").fontSize(12);
  for (let n = 1; n <= count; n++) {
    if (n > 1) doc.addPage();
    doc.text(`PAGE ${n}`, 72, 72, { lineBreak: false });
  }
  doc.end();
  return done;
}

// ── CLI: write every fixture out for a human to look at; regenerate the HEIC on macOS ──────────────
async function writeAll(outDir: string, regenerateHeic: boolean): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const all: Record<string, Promise<Buffer>> = {
    "upright.png": pagePng(),
    "exif-rotated.jpg": exifRotatedJpeg(),
    "alpha.png": alphaPng(),
    "page.webp": pageWebp(),
    "cmyk.jpg": cmykJpeg(),
    "born-digital.pdf": bornDigitalPdf(),
    "scanned.pdf": scannedPdf(),
    "rotated.pdf": rotatedPdf(),
    "encrypted.pdf": encryptedPdf(),
    "eleven-pages.pdf": pagesPdf(11),
  };
  for (const [name, bytes] of Object.entries(all)) writeFileSync(join(outDir, name), await bytes);
  if (regenerateHeic) {
    if (process.platform !== "darwin") throw new Error("--regenerate-heic needs macOS sips (no HEVC encoder in Node)");
    const heic = fileURLToPath(new URL("./hevc-page.heic", import.meta.url));
    execFileSync("sips", ["-s", "format", "heic", join(outDir, "upright.png"), "--out", heic]);
  }
  writeFileSync(join(outDir, "hevc-page.heic"), heicFixture());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  await writeAll(args.find((a) => !a.startsWith("--")) ?? "fixtures-out", args.includes("--regenerate-heic"));
}
