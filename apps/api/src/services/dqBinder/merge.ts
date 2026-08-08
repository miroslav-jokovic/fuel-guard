import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { footerPosition, visibleSize } from "./footer.js";
import { MARGIN, PAGE_HEIGHT, PAGE_WIDTH, winAnsi } from "./pdfDraw.js";

/**
 * Assembly (DQ-BINDER-PLAN D-BD1). pdfkit draws; pdf-lib COPIES.
 *
 * This module exists because pdfkit cannot merge an existing PDF — it draws pages, it cannot bring
 * one in. `defensePacket.ts` gets away without it because hazmat evidence is photographs, which
 * `sharp` rasterises and pdfkit draws. A qualification file does not have that shape: a medical
 * examiner's certificate, an MVR printout and a Clearinghouse query result all arrive as PDFs, and
 * `sharp` cannot read a PDF either. Without page copying the binder is not assemblable at all.
 *
 * Everything here is deliberately primitive — append, embed, stamp. What to do when a scan cannot be
 * read is policy, and policy lives in `index.ts`.
 */

/** Ceiling on total source bytes pulled into one binder. Above this the job fails LOUDLY (see index). */
export const MAX_SOURCE_BYTES = 180 * 1024 * 1024;

export interface BinderMeta {
  title: string;
  carrierName: string;
  exportId: string;
  generatedAt: string;
}

export async function createBinderDocument(meta: BinderMeta): Promise<PDFDocument> {
  const out = await PDFDocument.create();
  out.setTitle(winAnsi(meta.title));
  out.setAuthor(winAnsi(meta.carrierName));
  out.setSubject(winAnsi(`Driver qualification file — export ${meta.exportId}`));
  out.setProducer("FuelGuard");
  out.setCreator("FuelGuard");
  out.setCreationDate(new Date(meta.generatedAt));
  return out;
}

/** Copy every page of a PDF onto the end of the binder. Returns how many pages arrived. */
export async function appendPdf(out: PDFDocument, bytes: Buffer): Promise<number> {
  // `ignoreEncryption` covers the common case of a scanner or a state DMV portal writing an
  // owner-password-only PDF: the pages are readable, the flag only says we are not honouring a
  // permissions bit that was never a protection. A genuinely encrypted file still throws, and the
  // caller turns that into a page saying so rather than into a silent gap.
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await out.copyPages(src, src.getPageIndices());
  for (const p of pages) out.addPage(p);
  return pages.length;
}

/**
 * Put an image on its own Letter page, scaled to fit inside the margins.
 *
 * A photograph of a medical card is not a page — it is a picture with whatever aspect ratio the
 * phone had. Giving it a Letter page keeps the binder one uniform size, which is what makes it
 * printable in a single job (D-BD2) and leaves the footer somewhere predictable.
 */
export async function appendImage(
  out: PDFDocument,
  bytes: Buffer,
  contentType: string,
): Promise<number> {
  let data = bytes;
  let type = contentType;
  // pdf-lib embeds JPEG and PNG only. webp and heic go through sharp, which is already a dependency
  // and already does exactly this for the hazmat packet.
  if (type !== "image/jpeg" && type !== "image/png") {
    data = await sharp(bytes).rotate().png().toBuffer(); // .rotate() honours the EXIF orientation
    type = "image/png";
  }
  const image = type === "image/jpeg" ? await out.embedJpg(data) : await out.embedPng(data);

  const page = out.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const maxW = PAGE_WIDTH - MARGIN * 2;
  const maxH = PAGE_HEIGHT - MARGIN * 2 - 18; // 18pt kept clear for the footer stamp
  const scaled = image.scaleToFit(maxW, maxH);
  page.drawImage(image, {
    x: (PAGE_WIDTH - scaled.width) / 2,
    y: (PAGE_HEIGHT - scaled.height) / 2 + 6,
    width: scaled.width,
    height: scaled.height,
  });
  return 1;
}

export interface FooterContext {
  exportId: string;
  generatedAt: string;
}

/**
 * Stamp every page — including the copied scans — with who it belongs to, where it came from and
 * where it sits.
 *
 * §390.32(c)–(d) requires an electronic record to be accurately reproducible, and a page that has
 * come loose from the binder and cannot be tied back to it is not (D-BD5's sibling requirement).
 * This is Bates numbering, which is what litigation support has done to page sets for a century, and
 * it is done HERE rather than while drawing because "page 7 of 214" is not knowable until the last
 * scan has been copied in.
 *
 * ROTATION IS HANDLED, NOT IGNORED. A scanned page frequently carries /Rotate 90. Drawing at the
 * page's own bottom-left would put the stamp up the side of the printed sheet. For each of the four
 * lawful angles the text is placed so that it lands at the VISUAL bottom of the printed page and
 * reads horizontally.
 */
export async function stampFooters(
  out: PDFDocument,
  labels: string[],
  ctx: FooterContext,
): Promise<void> {
  const font = await out.embedFont(StandardFonts.Helvetica);
  const size = 7;
  const grey = rgb(0.42, 0.42, 0.42);
  const pages = out.getPages();
  const total = pages.length;
  const when = ctx.generatedAt.slice(0, 19).replace("T", " ") + " UTC";
  const m = 18;

  for (let i = 0; i < total; i++) {
    const page = pages[i]!;
    const { width, height } = page.getSize();
    const angle = ((page.getRotation().angle % 360) + 360) % 360;

    const left = winAnsi(`${labels[i] ?? ""} · export ${ctx.exportId} · generated ${when}`);
    const right = winAnsi(`Page ${i + 1} of ${total}`);
    const rightWidth = font.widthOfTextAtSize(right, size);

    const visW = visibleSize(angle, width, height).width;

    for (const [text, fromLeft] of [[left, m] as const, [right, visW - m - rightWidth] as const]) {
      const pos = footerPosition(angle, width, height, fromLeft, m);
      page.drawText(text, {
        x: pos.x,
        y: pos.y,
        size,
        font,
        color: grey,
        rotate: degrees(pos.rotate),
      });
    }
  }
}

export async function finalize(out: PDFDocument): Promise<Buffer> {
  return Buffer.from(await out.save());
}
