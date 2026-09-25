import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { deflateSync, inflateSync } from "node:zlib";
import { join } from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream } from "pdf-lib";
import { embedPdfFace } from "../../../../lib/pdfFonts.js";
import { driverPlacementIds, driverPlacements, packetWithdrawal } from "@silvicom/shared";
import type { DriverApplication } from "@silvicom/shared";
import { packetFieldFill } from "./packetFieldValues.js";
import type { PacketFieldOverflow } from "./packetGrid.js";
import { renderPacketOverlay } from "./packetOverlay.js";
import { PACKET_MARK_LINES, markLineFor } from "./packetMarkGeometry.js";
import { cmapFor, pageText, readPacketTemplate } from "./packetTemplate.js";
import { fieldCell, fieldLineFor, PACKET_FIELD_TABLES } from "./packetFieldGeometry.js";

/**
 * The marks, drawn onto the carrier's packet.
 *
 * ⚠ **Read back through `packetTemplate.ts`**, which is the same reader that measured the blank
 * document. So what is asserted is not "the renderer was called" but that the name is IN the produced
 * bytes, on the page the inventory claims, alongside the carrier's own text — and that the carrier's
 * own text is still there, which is the whole point of drawing on top rather than redrawing.
 *
 * ⚠ What no test here can check is that a mark sits on the RIGHT LINE, because a page's text has no
 * lines in it. That was established by rendering this output and looking at it — p20, p4, p25 and p13
 * cover all four of the packet's layouts — and it is held still by `packetMarkGeometry.test.ts`,
 * which pins every coordinate against the template's own rules.
 *
 * ⚠ **`packetTemplate.ts`'s reader cannot give a drawn mark's COORDINATES honestly** for a page we
 * have drawn on: it applies one page transform to everything, which is true of the carrier's own
 * pages and false once `pdf-lib` has bracketed them in `q … Q` and appended operators in absolute
 * space. Text and page structure are what THAT reader gives this file.
 *
 * ⚠ **That is a fact about the reader, and until AUD-5 it was written here as a fact about the
 * document — "nothing here asserts a drawn mark's coordinates", full stop.** It is not: the very
 * bracketing that spoils the template reader is what leaves OUR operators in unmodified page space,
 * in their own stream after the lone `Q`. `drawnRuns` below reads them, and the file's one geometric
 * claim rests on it. The wrong sentence cost this repo more than a wrong coordinate would have —
 * `packetFit.ts` cited a test named *"draws nothing past the span its geometry gives it"* as the
 * thing that catches an overrun, and no such test existed anywhere in the repo for the whole of
 * AUD-1's life. `lint:comment-claims` does not check that a cited title resolves, so nothing said so.
 */

const NAME = "Marija Varmeda";

/** PNG's CRC-32 (ISO 3309), so the fixture below is a file a decoder will actually accept. */
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** The places that take a signature — the other three take initials. */
const signatureIds = new Set(
  driverPlacements(null).filter((p) => p.mark === "signature").map((p) => p.id),
);
const allMarks = (signedName = NAME) =>
  driverPlacementIds(null).map((placementId) => ({ placementId, signedName }));

/**
 * Every IMAGE each page of the produced document carries, as `width×height` (Q-HUI14).
 *
 * ── ⚠ WHY THIS EXISTS, WHEN THE REST OF THE FILE READS TEXT ───────────────────────────────────
 * A3's rule is *the signature picture must never land on `p05`, `p06` or `p09`*, and text was a
 * sufficient discriminator for it only while those three lines printed typed initials: an initials
 * page carrying the initials STRING was a page the drawing had not taken over. Q-HUI14 gives the
 * initials a picture, so both kinds of line now carry an image and NEITHER carries text — and a
 * reader that can only see text cannot tell which of the two images is on which page. It would go
 * green on a renderer that put the signature on all twenty-two, which is precisely the defect.
 *
 * So the discriminator becomes the image's own dimensions, and the fixtures below are deliberately
 * different SIZES. This reads the page's `/XObject` resources — which is how `pdf-lib` records
 * `drawImage` — and reports each one's `/Width` and `/Height`. It is not a measurement of WHERE the
 * picture sits (this file's header says why that cannot be read back honestly); it is a measurement
 * of WHICH picture is on the page, which is the whole of the rule.
 */
async function imagesByPage(pdf: Buffer): Promise<Map<number, string[]>> {
  const doc = await PDFDocument.load(pdf);
  const found = new Map<number, string[]>();
  doc.getPages().forEach((page, index) => {
    const sizes: string[] = [];
    const resources = page.node.Resources();
    const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    for (const [, value] of xobjects?.entries() ?? []) {
      const stream = page.node.context.lookupMaybe(value, PDFStream);
      const dict = stream?.dict;
      if (dict?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString() !== "/Image") continue;
      const width = dict.lookupMaybe(PDFName.of("Width"), PDFNumber)?.asNumber();
      const height = dict.lookupMaybe(PDFName.of("Height"), PDFNumber)?.asNumber();
      if (width !== undefined && height !== undefined) sizes.push(`${width}x${height}`);
    }
    found.set(index + 1, sizes);
  });
  return found;
}

/** The produced document, read back with the same reader that measured the blank one. */
async function readBack(pdf: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "packet-overlay-"));
  const path = join(dir, "signed.pdf");
  await writeFile(path, pdf);
  return readPacketTemplate(path);
}

describe("drawing the driver's marks on the carrier's packet", () => {
  it("returns the carrier's whole document, not a document of ours", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: allMarks() }));
    expect(pages).toHaveLength(31);
    for (const p of pages) {
      expect(p.width).toBeCloseTo(612, 0);
      expect(p.height).toBeCloseTo(792, 0);
    }
  });

  /**
   * ⚠ The assertion that says the pages were not redrawn. `FAIR CREDIT REPORTING ACT DISCLOSURE`,
   * the misprinted citation and the carrier's own spelling of `signatrure` all survive, because
   * nothing rewrote the page they are on.
   */
  it("leaves the carrier's own text exactly where it was", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: allMarks() }));
    expect(pageText(pages[19]!)).toContain("FAIR CREDIT REPORTING ACT DISCLOSURE");
    expect(pageText(pages[19]!)).toContain("168lu");
    expect(pageText(pages[21]!)).toContain("signatrure");
    expect(pageText(pages[16]!)).toContain("INTERVIEW NOTES");
  });

  it("puts the adopted name on every one of the twenty-two pages a mark belongs to", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: allMarks() }));
    for (const id of driverPlacementIds(null)) {
      const line = markLineFor(id)!;
      expect(pageText(pages[line.page - 1]!), `${id} on p${line.page}`).toContain(NAME);
    }
  });

  /**
   * ⚠ Pages 11, 19 and 31 take two marks each, so the name has to appear TWICE on them — a renderer
   * that drew one per page would satisfy the assertion above and leave half the packet blank.
   */
  it("draws both marks on each of the three doubled pages", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: allMarks() }));
    for (const page of [11, 31]) {
      const hits = pageText(pages[page - 1]!).split(NAME).length - 1;
      expect(hits, `p${page}`).toBe(2);
    }
  });

  /**
   * ⚠ Page 19 was the third doubled page until D-MVR1 (2026-09-25) withdrew both of its lines: the
   * driving-record release is a permission now. Both lines carry the notice, and neither the name.
   */
  it("draws the withdrawal notice on both of page 19's lines, and no name", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: allMarks() }));
    const text = pageText(pages[18]!);
    expect(text).not.toContain(NAME);
    expect(text.split(packetWithdrawal("p19a")!.notice).length - 1).toBe(2);
  });

  it("marks no page the driver does not sign", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: allMarks() }));
    const signed = new Set(driverPlacementIds(null).map((id) => markLineFor(id)!.page));
    for (const p of pages) {
      if (signed.has(p.page)) continue;
      expect(pageText(p), `p${p.page} carries no mark`).not.toContain(NAME);
    }
  });

  /**
   * ⚠ **A long name must not run off its line into the printed text beside it.** Page 4's signature
   * shares a rule with the date and page 20's stops before `Date:`; a fixed size puts a long name
   * through both.
   *
   * ⚠ **Presence is not fitting, and asserting presence alone proved nothing.** Written that way
   * first, this passed with the fitting removed entirely — the name is in the bytes either way; it
   * simply runs off the line. So the SIZE the renderer chose is read back out of the drawn content
   * stream and measured with the same face, independently of the renderer's own arithmetic.
   */
  it("shrinks a long name to fit the line rather than overrunning it", async () => {
    const long = "Bartholomew Fitzwilliam-Harrington III";
    // ⚠ The narrowest SIGNATURE line. The three narrower ones take initials, which are two or three
    // characters — and until the ceremony collects them (see the note at the top of `packetOverlay.ts`)
    // this renderer is handed a full name for them, which no type size rescues.
    const narrowest = PACKET_MARK_LINES.filter((l) => signatureIds.has(l.id)).sort(
      (a, b) => a.x2 - a.x1 - (b.x2 - b.x1),
    )[0]!;

    const pdf = await PDFDocument.load(
      await renderPacketOverlay({ marks: [{ placementId: narrowest.id, signedName: long }] }),
    );
    // ⚠ Inflated, because every content stream is deflated — reading raw bytes finds nothing, and the
    // assertion would then pass by being unable to look.
    const drawnStream = (pdf.getPage(narrowest.page - 1).node.Contents() as PDFArray)
      .asArray()
      .map((r) => {
        const raw = Buffer.from(pdf.context.lookup(r, PDFStream).getContents());
        try {
          return inflateSync(raw).toString("latin1");
        } catch {
          return raw.toString("latin1");
        }
      })
      .filter((text) => /\/[^\s]+\s+[\d.]+\s+Tf/.test(text))
      .at(-1);
    expect(drawnStream, "the drawn stream").toBeDefined();

    const size = Number(/\/[^\s]+\s+([\d.]+)\s+Tf/.exec(drawnStream!)![1]);
    const face = await embedPdfFace(await PDFDocument.create(), "italic");
    expect(
      face.widthOfTextAtSize(long, size),
      `at ${size}pt on ${narrowest.id}'s ${narrowest.x2 - narrowest.x1}pt line`,
    ).toBeLessThanOrEqual(narrowest.x2 - narrowest.x1);
  });

  /**
   * ⚠ **A row naming a place the table no longer carries must still produce a document.**
   * `application_packet_marks` is append-only and p24 was in the inventory until 2026-08-23; a
   * renderer that threw on an old row would be a qualification file that cannot be produced, which is
   * the §390.32(d) failure the whole renderer exists to prevent.
   */
  it("skips a placement the table does not carry, and still files the rest", async () => {
    const pdf = await renderPacketOverlay({
      marks: [{ placementId: "p24", signedName: NAME }, { placementId: "p20", signedName: NAME }],
    });
    const pages = await readBack(pdf);
    expect(pages).toHaveLength(31);
    expect(pageText(pages[19]!)).toContain(NAME);
    expect(pageText(pages[23]!)).not.toContain(NAME);
  });

  it("draws nothing for an empty name rather than an empty mark", async () => {
    const pages = await readBack(
      await renderPacketOverlay({ marks: [{ placementId: "p20", signedName: "   " }] }),
    );
    expect(pageText(pages[19]!)).toContain("FAIR CREDIT REPORTING ACT DISCLOSURE");
    expect(pageText(pages[19]!)).not.toContain(NAME);
  });

  /**
   * ⚠ A8b/D-APP8 carried into the renderer: a drawn mark that will not decode must not stand between
   * a driver and a filed application. It falls back to the typed name, which is the record anyway.
   */
  it("falls back to the typed name when the drawn mark will not decode", async () => {
    const pages = await readBack(
      await renderPacketOverlay({
        marks: allMarks(),
        drawnMark: Buffer.from("this is not a png"),
      }),
    );
    expect(pageText(pages[19]!)).toContain(NAME);
  });
});

/**
 * A3 — where a DRAWING is allowed to go, which is not everywhere.
 *
 * ⚠ **The discriminator is text, not pixels**, and that is deliberate rather than a compromise. This
 * file's header explains why a drawn mark's coordinates cannot be read back honestly; but the
 * question here is not *where* the drawing landed, it is *whether the typed mark was drawn instead of
 * it* — and typed text this reader can see. So an initials page that carries the initials STRING is
 * an initials page the drawing did not take over, and a signature page that carries no name is one
 * the drawing did.
 *
 * ⚠ **Two different strings, because one would have proved nothing.** With the same text adopted for
 * both kinds, "page 5 contains the mark" passes whether the renderer read the placement's kind or
 * ignored it — the name is on twenty-two pages either way. `INITIALS` appears nowhere in `NAME`.
 */
describe("a drawn mark goes on the signature lines and nowhere else", () => {
  const INITIALS = "QX";
  /** The three the carrier captioned `Initials` — `p05`, `p06`, `p09`, and they are pages 5, 6, 9. */
  const initialsPlacements = driverPlacements(null).filter((p) => p.mark === "initials");

  /** What the ceremony sends: the initials on the three, the name on the other nineteen. */
  const mixedMarks = () =>
    driverPlacements(null).map((p) => ({
      placementId: p.id,
      signedName: p.mark === "initials" ? INITIALS : NAME,
    }));

  /**
   * A real, decodable 1×1 PNG, built here rather than checked in.
   *
   * ⚠ It has to DECODE — the existing fallback test passes garbage on purpose, and passing garbage
   * here would exercise the `drawn = null` path and assert nothing about the branch under test.
   * `packages/capture-engine/fixtures/png.mjs` writes these too, and is not imported: `lint:boundaries`
   * keeps the hazmat-shaped packages out of `apps/`, and a fixture generator is not a contract.
   */
  function onePixelPng(width = 1, height = 1): Buffer {
    const chunk = (type: string, body: Buffer): Buffer => {
      const head = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(type, "latin1")]);
      head.writeUInt32BE(body.length, 0);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), body])), 0);
      return Buffer.concat([head, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    // 8-bit, colour type 2 (truecolour), no interlace — what pdf-lib's PNG reader accepts.
    ihdr[8] = 8;
    ihdr[9] = 2;
    // ⚠ One filter byte per scanline, then three bytes per pixel. Getting this wrong produces a file
    // `embedPng` rejects, which would silently exercise the FALLBACK and assert nothing.
    const row = Buffer.alloc(1 + width * 3);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  /**
   * ⚠ **Two fixtures of DIFFERENT sizes, and the difference is the whole measurement** (Q-HUI14).
   *
   * With both marks now printed as pictures, `pageText` cannot tell them apart — so `imagesByPage`
   * identifies each one by its dimensions instead, and two fixtures of the same size would make every
   * assertion below vacuous. That is the *fixture too uniform to discriminate* failure this repo keeps
   * meeting, and here "too uniform" would mean two 1×1 PNGs.
   *
   * ⚠ The sizes are also not square, so a renderer that transposed width and height could not pass.
   */
  const SIGNATURE_PNG_SIZE = "3x2";
  const INITIALS_PNG_SIZE = "5x7";
  const signaturePng = () => onePixelPng(3, 2);
  const initialsPng = () => onePixelPng(5, 7);

  /**
   * ⚠ **A3's rule, and it still holds exactly as it did** (Q-HUI14): given only the SIGNATURE picture,
   * the three initials lines print typed initials — the signature picture does not spread onto them.
   * This was A3's test verbatim; what changed is only that `initialsMark` is now named as absent,
   * because "absent" is the state this test is about.
   */
  it("puts the typed initials on the three pages that ask for initials, even in drawn mode", async () => {
    expect(initialsPlacements).toHaveLength(3);
    const pages = await readBack(
      await renderPacketOverlay({
        marks: mixedMarks(),
        drawnMark: signaturePng(),
        initialsMark: null,
      }),
    );
    for (const p of initialsPlacements) {
      const text = pageText(pages[p.page - 1]!);
      expect(text, `page ${p.page} (${p.id})`).toContain(INITIALS);
      // ⚠ And NOT the signature. A renderer that drew both would satisfy the line above.
      expect(text, `page ${p.page} (${p.id})`).not.toContain(NAME);
    }
  });

  /**
   * ⚠ **The step itself: given an initials picture, those three lines carry it instead of text.**
   *
   * Read as text on purpose, which is what makes this the honest complement of the test above: if the
   * initials STRING is still on page 5 then the picture did not land there, whatever else is true.
   */
  it("replaces the typed initials with the initials picture on the three pages that ask for them", async () => {
    const pages = await readBack(
      await renderPacketOverlay({
        marks: mixedMarks(),
        drawnMark: signaturePng(),
        initialsMark: initialsPng(),
      }),
    );
    for (const p of initialsPlacements) {
      const text = pageText(pages[p.page - 1]!);
      expect(text, `page ${p.page} (${p.id})`).not.toContain(INITIALS);
      expect(text, `page ${p.page} (${p.id})`).not.toContain(NAME);
    }
  });

  /**
   * ⚠ **A3's rule measured where text cannot reach it, which is the one test this step could not do
   * without** (Q-HUI14, D-PKT6).
   *
   * The defect A3 fixed was a 141pt autograph in a box captioned `Initials`. With both marks printed
   * as pictures, every earlier assertion in this file would pass on a renderer that put the SIGNATURE
   * on all twenty-two: the initials pages would carry an image and no text either way. So this
   * identifies the picture by its dimensions and asserts, per page, that the one the carrier asked for
   * is the one that landed — and that the other is nowhere on that page.
   *
   * ⚠ Both directions, on every placement, from the real inventory. Asserting only the initials pages
   * would go green on a renderer that drew the INITIALS on all twenty-two, which is the same defect
   * mirrored and just as wrong.
   */
  it("puts each kind of picture only on the lines that ask for that kind", async () => {
    const images = await imagesByPage(
      await renderPacketOverlay({
        marks: mixedMarks(),
        drawnMark: signaturePng(),
        initialsMark: initialsPng(),
      }),
    );
    for (const p of driverPlacements(null)) {
      const onPage = images.get(p.page) ?? [];
      const wanted = p.mark === "initials" ? INITIALS_PNG_SIZE : SIGNATURE_PNG_SIZE;
      const forbidden = p.mark === "initials" ? SIGNATURE_PNG_SIZE : INITIALS_PNG_SIZE;
      expect(onPage, `page ${p.page} (${p.id}) should carry its own mark`).toContain(wanted);
      expect(onPage, `page ${p.page} (${p.id}) must not carry the other mark`).not.toContain(
        forbidden,
      );
    }
  });

  /**
   * ⚠ The partial case for the measurement above: with NO initials picture, the initials pages carry
   * no image at all. Without this, `imagesByPage` returning every image in the document — rather than
   * the ones on that page — would satisfy the test above and prove nothing.
   */
  it("leaves the initials pages carrying no picture when none was adopted", async () => {
    const images = await imagesByPage(
      await renderPacketOverlay({
        marks: mixedMarks(),
        drawnMark: signaturePng(),
        initialsMark: null,
      }),
    );
    for (const p of initialsPlacements) {
      expect(images.get(p.page) ?? [], `page ${p.page} (${p.id})`).not.toContain(
        SIGNATURE_PNG_SIZE,
      );
      expect(images.get(p.page) ?? [], `page ${p.page} (${p.id})`).not.toContain(
        INITIALS_PNG_SIZE,
      );
    }
  });

  /**
   * ⚠ A8b per mark: initials bytes that will not decode fall back to the typed initials, and do not
   * take the signature down with them. ⚠ The signature page assertion is what makes this more than a
   * restatement of the fallback test above — one mark failing must not disturb the other.
   */
  it("falls back to the typed initials when the initials picture will not decode", async () => {
    const pdf = await renderPacketOverlay({
      marks: mixedMarks(),
      drawnMark: signaturePng(),
      initialsMark: Buffer.from("this is not a png"),
    });
    const pages = await readBack(pdf);
    for (const p of initialsPlacements) {
      expect(pageText(pages[p.page - 1]!), `page ${p.page} (${p.id})`).toContain(INITIALS);
    }
    const images = await imagesByPage(pdf);
    const signaturePlacement = driverPlacements(null).find((p) => p.mark === "signature")!;
    expect(images.get(signaturePlacement.page) ?? []).toContain(SIGNATURE_PNG_SIZE);
  });

  /**
   * ⚠ The other half, and without it the test above passes on a renderer that ignores the drawing
   * entirely — which would be a different defect with the same green suite.
   */
  it("replaces the typed name with the drawing on a page that asks for a signature", async () => {
    const pages = await readBack(
      await renderPacketOverlay({ marks: mixedMarks(), drawnMark: signaturePng() }),
    );
    // p20's page, a signature line — the same page the fallback test reads.
    expect(pageText(pages[19]!)).not.toContain(NAME);
    // ⚠ And the whole document, so this cannot pass by one page happening to be blank.
    const signaturePages = driverPlacements(null).filter((p) => p.mark === "signature");
    for (const p of signaturePages) {
      expect(pageText(pages[p.page - 1]!), `page ${p.page} (${p.id})`).not.toContain(NAME);
    }
  });

  /**
   * ⚠ **The mark loop's unknown-placement fallback is deliberately NOT tested here, and this note is
   * why**, so the next reader does not spend an afternoon looking for the gap.
   *
   * To reach it a mark needs an id the GEOMETRY carries and the INVENTORY does not — the geometry
   * lookup runs first and skips anything it does not know. No such id exists, and it is not supposed
   * to: `packetMarkGeometry.test.ts`'s "carries exactly the driver's twenty-two places, and nothing
   * else" is what keeps it that way. Reaching the branch would mean stubbing one of the two tables,
   * which would assert that a mock returns what it was told to.
   *
   * So the branch is unreachable-by-construction rather than untested-by-omission. It stays in the
   * renderer because a filed packet is frozen for ever and the two tables can drift in a later PR;
   * what a test can honestly pin is the invariant, and that is where it is pinned.
   */
});

/** One text run this renderer appended to a page: where it starts, how big, and what it says. */
interface DrawnRun {
  x: number;
  y: number;
  size: number;
  text: string;
}

/**
 * WinAnsi's high range, which is the only part of `pdf-lib`'s encoding that is not Latin-1.
 *
 * ⚠ **It THROWS on a byte it does not carry rather than substituting anything.** A decoder that
 * guessed would report a narrower string than was drawn, and a width assertion fed a short string is
 * an assertion that cannot fail — the exact shape of a green test that proves nothing. Today the
 * only high bytes the packet can emit are `0x85` (the cut ellipsis) and `0x97` (the em dash between
 * two employment dates); the rest are here so that a future answer carrying a smart quote widens the
 * map deliberately instead of silently weakening the claim below.
 */
const WIN_ANSI_HIGH: Readonly<Record<number, string>> = {
  0x80: "\u20ac", 0x82: "\u201a", 0x83: "\u0192", 0x84: "\u201e", 0x85: "\u2026", 0x86: "\u2020",
  0x87: "\u2021", 0x88: "\u02c6", 0x89: "\u2030", 0x8a: "\u0160", 0x8b: "\u2039", 0x8c: "\u0152",
  0x8e: "\u017d", 0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201c", 0x94: "\u201d", 0x95: "\u2022",
  0x96: "\u2013", 0x97: "\u2014", 0x98: "\u02dc", 0x99: "\u2122", 0x9a: "\u0161", 0x9b: "\u203a",
  0x9c: "\u0153", 0x9e: "\u017e", 0x9f: "\u0178",
};

const decodeWinAnsi = (hex: string): string =>
  (hex.match(/../g) ?? [])
    .map((pair) => {
      const byte = parseInt(pair, 16);
      if (byte < 0x80 || byte > 0x9f) return String.fromCharCode(byte);
      const mapped = WIN_ANSI_HIGH[byte];
      if (!mapped) throw new Error(`WinAnsi byte 0x${pair} is not in the decoder's map`);
      return mapped;
    })
    .join("");

/**
 * Every text run WE appended to one page, in the page's own coordinate space.
 *
 * —— ⚠ WHY THIS CAN BE READ HONESTLY WHEN THE TEMPLATE READER CANNOT ——————————————————
 * `pdf-lib` does not edit the carrier's content stream. It brackets it — a stream holding the single
 * operator `q`, then the carrier's (which opens with its own `cm`, a 0.75 scale and a y-flip), then
 * a stream holding the single `Q`, and then ours. The `Q` restores the identity transform, so every
 * operator after it is in unmodified page points: exactly the space `packetFieldGeometry.ts`
 * measured in. Verified on the produced bytes, not assumed — a page nobody drew on has ONE stream
 * and no bracket at all, which is why the split below is "everything after the last lone `Q`" and
 * not an index.
 *
 * ⚠ Text is decoded from the hex `Tj` operand rather than read off the input, so what is measured
 * is what a reader's PDF viewer will show — including an ellipsis the fitter added, which is the
 * character that makes a cut run wider than the string that was handed in.
 */
async function drawnRuns(pdf: Buffer, page: number): Promise<DrawnRun[]> {
  const doc = await PDFDocument.load(pdf);
  const contents = doc.getPage(page - 1).node.get(PDFName.of("Contents"));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const bodies = refs.map((ref) => {
    const stream = doc.context.lookup(ref);
    const raw = Buffer.from((stream as PDFStream & { getContents(): Uint8Array }).getContents());
    try {
      return inflateSync(raw).toString("latin1");
    } catch {
      return raw.toString("latin1");
    }
  });
  const close = bodies.map((b) => b.trim()).lastIndexOf("Q");
  if (close < 0) return [];

  // ⚠ Q-AF2: our faces are EMBEDDED since 2026-09-25, so a `Tj` operand is two-byte glyph ids, not
  // WinAnsi bytes. Decoded through the face's own `ToUnicode` — `cmapFor`, the template reader's
  // decoder, not a second one — so what is measured is still what a viewer shows.
  const fonts = doc.getPage(page - 1).node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
  const cmaps = new Map<string, Map<number, string>>();
  for (const [key, ref] of fonts?.entries() ?? []) cmaps.set(key.toString(), cmapFor(doc, doc.context.lookup(ref, PDFDict)));
  let cmap = new Map<number, string>();

  const runs: DrawnRun[] = [];
  let size = 0;
  let x = 0;
  let y = 0;
  for (const body of bodies.slice(close + 1)) {
    for (const line of body.split("\n")) {
      const tf = /^(\/\S+) ([\d.]+) Tf$/.exec(line.trim());
      if (tf) { cmap = cmaps.get(tf[1]!) ?? new Map(); size = Number(tf[2]); continue; }
      const tm = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/.exec(line.trim());
      if (tm) { x = Number(tm[1]); y = Number(tm[2]); continue; }
      const tj = /^<([0-9A-Fa-f]*)> Tj$/.exec(line.trim());
      if (tj) {
        const text = cmap.size > 0
          ? (tj[1]!.match(/.{4}/g) ?? []).map((cid) => cmap.get(parseInt(cid, 16)) ?? "").join("")
          : decodeWinAnsi(tj[1]!);
        runs.push({ x, y, size, text });
      }
    }
  }
  return runs;
}

/**
 * The renderer's one GEOMETRIC guarantee, and the reason it is worth more than every text assertion
 * above it put together.
 *
 * —— ⚠ THIS IS THE TEST `packetFit.ts` HAS CITED SINCE AUD-1 AND NOBODY HAD WRITTEN ———————
 * The comment on `fitText` said an overrun is caught by *"`packetOverlay.test.ts`'s \"draws nothing
 * past the span its geometry gives it\""*. `grep -rn "draws nothing past the span" apps/api/src`
 * returned nothing, on a green tree, because `lint:comment-claims` checks that a claim quotes a
 * title-shaped string and not that the title resolves. So the property AUD-1 was fixed to establish
 * was, for its whole life, guarded by a sentence.
 *
 * ⚠ **No text assertion in this file can fail on an overrun.** Both runs are in the content stream
 * whether or not they collide, so `pageText` finds every word of a page no human can read — that is
 * how the defect shipped. The property is about WIDTH, which is why this reads coordinates.
 */
describe("a value the carrier's column is too narrow for", () => {
  /**
   * ⚠ The fixture strains three different grids at once, and it has to. A value that fits proves
   * nothing here: the assertion is trivially true of every cell that was never close to its edge,
   * and a fixture of those would be a test that cannot fail. `expect(cut).not.toHaveLength(0)` below
   * is what stops this passing on a comfortable payload.
   */
  const strained = (): DriverApplication => ({
    ...({
      first_name: "Susan", middle_name: "M", last_name: "Godfrey", date_of_birth: "1980-04-01",
      other_names: [], email: "s@x.test", phone: "555-0111", addresses: [],
      cdl_number: "PA334554", cdl_state: "PA", cdl_class: "A", cdl_expires_at: "2029-01-01",
      additional_licences: [], experience: "Eight years.", equipment_experience: [],
      declares_no_violations: true, violations: [],
      licence_ever_denied: false, licence_denial_detail: null,
      prior_failed_pre_employment_test: false, questionnaire_version: "silvicom_driver@1",
      questionnaire_answers: {},
      certified: true, signed_name: NAME,
      declares_no_accidents: false,
      accidents: [
        { occurred_on: "2025-03-04", nature: "Minor", fatalities: 0, injuries: 0, hazmat_spill: false },
        { occurred_on: "2024-11-19", nature: "Rear-ended while stopped", fatalities: 0, injuries: 1, hazmat_spill: false },
        {
          occurred_on: "2024-02-02",
          nature: "Rear-ended while stopped at a construction flagger on I-80 westbound near mile 118",
          fatalities: 0, injuries: 2, hazmat_spill: true,
        },
      ],
      declares_no_employment: false,
      employers: Array.from({ length: 4 }, (_, i) => ({
        employer_name: i === 0 ? "Swift" : `Midwest Regional Carriers of Northern Illinois ${i}`,
        usdot_number: `${100000 + i}`,
        address_line1: i === 0 ? "12 Depot Rd" : `${1200 + i} North Wolf Road Suite ${i}`,
        city: i === 0 ? "Joliet" : "Schaumburg", state: "IL", phone: "555-0100", email: null,
        position_held: "Over-the-road driver",
        started_on: `20${20 + i}-01-01`, ended_on: `20${21 + i}-01-01`,
        operated_cmv: true, dot_regulated: true, reason_for_leaving: "Better route",
        subject_to_fmcsr: true, safety_sensitive: true,
      })),
    } as unknown as DriverApplication),
  });

  const filled = () =>
    packetFieldFill({
      application: strained(),
      certifiedAt: "2026-08-23T18:00:00Z",
      markedAt: {},
      signedName: NAME,
    });

  it("draws nothing past the span its geometry gives it", async () => {
    const { placed, overflow } = filled();
    const pdf = await renderPacketOverlay({ marks: [], fields: placed, overflow });
    const font = await embedPdfFace(await PDFDocument.create(), "regular");

    // ⚠ Matched back to its own line by POSITION, which is the only link that survives rendering:
    // the renderer starts a value 2pt inside its rule and lifts the baseline off it, so a run at
    // those two numbers is that line's and no other's. Matching by TEXT would match the wrong cell
    // whenever two rows answer the same thing — `Over-the-road driver` appears four times here.
    let checked = 0;
    const cut: string[] = [];
    for (const field of placed) {
      const runs = await drawnRuns(pdf, field.line.page);
      const run = runs.find(
        (r) => Math.abs(r.x - (field.line.x1 + 2)) < 0.01 && Math.abs(r.y - (field.line.y + 3)) < 0.01,
      );
      expect(run, `nothing drawn for ${field.line.id}`).toBeDefined();
      const right = run!.x + font.widthOfTextAtSize(run!.text, run!.size);
      expect(right, `${field.line.id} ran past its column: ${JSON.stringify(run!.text)}`)
        .toBeLessThanOrEqual(field.line.x2);
      if (run!.text.endsWith("\u2026")) cut.push(field.line.id);
      checked += 1;
    }

    expect(checked).toBe(placed.length);
    // ⚠ The discriminator. Without it this passes on a payload where nothing was ever near an edge,
    // which is to say it passes on the one case it is not being written for.
    expect(cut.length, "fixture no longer strains any column").toBeGreaterThan(0);
  });

  /**
   * AUD-5: one grid, one size.
   *
   * ⚠ **A SIZE claim, not a text one, for the same reason as above** — p2's accident grid rendered
   * its three `NATURE` rows at 11pt, 11pt and 6pt and every `pdfText()` assertion in this repo was
   * true of it. A signed federal form whose rows are in three sizes reads as broken before anybody
   * reads a word, and nothing but the drawn size can see it.
   */
  it("prints one grid at one size, however long one applicant's answer is", async () => {
    const { placed, overflow } = filled();
    const pdf = await renderPacketOverlay({ marks: [], fields: placed, overflow });

    for (const tableId of ["p02.accidents", "p12.employment"]) {
      const cells = placed.filter((f) => f.line.cell?.tableId === tableId);
      expect(cells.length, `fixture fills no cell of ${tableId}`).toBeGreaterThan(3);
      const sizes = new Set<number>();
      for (const cell of cells) {
        const runs = await drawnRuns(pdf, cell.line.page);
        const run = runs.find(
          (r) => Math.abs(r.x - (cell.line.x1 + 2)) < 0.01 && Math.abs(r.y - (cell.line.y + 3)) < 0.01,
        );
        sizes.add(run!.size);
      }
      expect([...sizes], `${tableId} printed in ${sizes.size} sizes`).toHaveLength(1);
    }
  });

  /**
   * ⚠ **The half that stops "one size" being satisfied by printing everything at the floor.** A
   * renderer that always chose 8pt would pass the test above on every grid in the packet. What makes
   * the rule a rule is that a grid nobody strained keeps the full 11pt — the shrink has to be
   * something ONE long answer causes, not the house style.
   */
  it("leaves a grid nobody strained at full size", async () => {
    const { placed } = filled();
    const roomy = placed.filter((f) => f.line.cell?.tableId === "p02.convictions");
    const pdf = await renderPacketOverlay({
      marks: [],
      fields: placed.filter((f) => f.line.cell?.tableId !== "p02.accidents"),
    });
    const strainedCells = placed.filter((f) => f.line.cell?.tableId === "p12.employment");
    expect(strainedCells.length).toBeGreaterThan(0);
    expect(roomy.length + strainedCells.length).toBeGreaterThan(0);

    const identity = placed.filter((f) => f.line.cell?.tableId === "p12.identity");
    expect(identity.length, "fixture fills no cell of p12.identity").toBeGreaterThan(1);
    for (const cell of identity) {
      const runs = await drawnRuns(pdf, cell.line.page);
      const run = runs.find(
        (r) => Math.abs(r.x - (cell.line.x1 + 2)) < 0.01 && Math.abs(r.y - (cell.line.y + 3)) < 0.01,
      );
      expect(run!.size, `${cell.line.id} shrank with nothing straining it`).toBe(11);
    }
  });

  /**
   * ⚠ **A value starts 2pt INSIDE its rule, so it has 4pt less room than the rule is long** — and
   * the size pass and the draw pass have to agree about that, or the size pass chooses against a
   * width the drawing does not have.
   *
   * —— ⚠ WRITTEN BECAUSE THE MUTANT SURVIVED ——————————————————————————————————
   * Dropping the `- 4` from `groupSizes` passed every other test in this block, because the failure
   * is INVISIBLE to all of them: the size comes out half a point too large, `fitAtSize` then cuts
   * the value honestly, nothing overruns and every grid still prints at one size. What is lost is
   * that the answer did not need cutting at all — it goes to the continuation sheet, and the
   * applicant's sentence leaves the carrier's page, for a rounding error. On the §391.23
   * verification log that is a row an auditor has to turn a page to read.
   *
   * ⚠ The fixture is measured, not chosen: `A friend who drives here` is 102.48pt at 9.5pt type in
   * `p01.heard_from`'s 103.3pt rule and 97.08pt at 9pt. It therefore fits the RULE at 9.5 and the
   * INSET only at 9 — the one band where the two passes can disagree. Any shorter answer fits both
   * and proves nothing.
   */
  it("keeps a value that fits only once the inset is counted, instead of cutting it", async () => {
    const line = fieldLineFor("p01.heard_from")!;
    const text = "A friend who drives here";
    const pdf = await renderPacketOverlay({ marks: [], fields: [{ line, text }] });
    const font = await embedPdfFace(await PDFDocument.create(), "regular");
    const run = (await drawnRuns(pdf, line.page)).find(
      (r) => Math.abs(r.x - (line.x1 + 2)) < 0.01 && Math.abs(r.y - (line.y + 3)) < 0.01,
    );
    expect(run, "nothing drawn for p01.heard_from").toBeDefined();
    expect(run!.text, "cut for want of the 4pt the drawing already gives away").toBe(text);
    expect(run!.x + font.widthOfTextAtSize(run!.text, run!.size)).toBeLessThanOrEqual(line.x2 - 2);
  });

  /**
   * ⚠ **The floor is not a suggestion**, and 8pt is where AUD-5 put it after measuring that floors
   * of 6, 7 and 8 cut exactly the same cells and continue exactly the same rows. No ANSWER on a
   * signed federal form may print smaller than this, whatever an applicant writes.
   *
   * ⚠ **Scoped to the applicant's ANSWERS on purpose, and the first draft of it was not — it failed,
   * correctly, on a 6.5pt run on page 2.** That run is this renderer's own continuation NOTICE
   * (`CONTINUATION_NOTICE_SIZE`), a sentence of ours under the grid rather than anything the driver
   * wrote, so the floor AUD-5 chose for answers does not govern it and widening this assertion to
   * cover it would be deciding its size here, in a test, by accident. It is recorded rather than
   * swallowed: after this change the notice is the smallest type on the page — 6.5pt under an 8pt
   * grid — which is AUD-8's question about metadata leading, not AUD-5's, and is in the plan's §10.
   */
  it("never prints an answer smaller than the floor, however long that answer is", async () => {
    const { placed, overflow } = filled();
    const pdf = await renderPacketOverlay({ marks: [], fields: placed, overflow });
    let shrunk = 0;
    for (const field of placed) {
      const runs = await drawnRuns(pdf, field.line.page);
      const run = runs.find(
        (r) => Math.abs(r.x - (field.line.x1 + 2)) < 0.01 && Math.abs(r.y - (field.line.y + 3)) < 0.01,
      );
      expect(run!.size, `${field.line.id} printed at ${run!.size}pt`).toBeGreaterThanOrEqual(8);
      if (run!.size < 11) shrunk += 1;
    }
    expect(shrunk, "fixture shrank nothing, so the floor was never approached").toBeGreaterThan(0);
  });
});

/**
 * AUD-19 — the continuation notice must land on no printed word of the carrier's.
 *
 * —— ⚠ THIS IS A CLAIM `packetOverlay.ts` USED TO MAKE IN PROSE, AND IT WAS FALSE —————————
 * AUD-1 built a notice for STANDALONE rules, found it drawing through page 16's printed
 * instruction, and removed it — while keeping the GRID notice on the argument that *"`fieldTableFor`
 * gives the grid's last rule and the space under it is measured and empty"*. Nothing had measured
 * it. It is true of six grids and false of two: `p12.employment` and `p16.references` both run to
 * the foot of their sheet, and what is under their last rule is the carrier's own footer. The notice
 * and `FOR DEPARTMENT OF TRANSPORTATION VERIFICATION PURPOSE ONLY` were printed on top of each
 * other, and neither was readable.
 *
 * ⚠ **Asserted on the DRAWN run, not on a function that says where the notice should go.** The
 * first version of this test asked a `continuationNoticePlacement` helper and compared THAT against
 * the carrier's geometry — and a mutant that made the draw loop ignore the placement table while the
 * helper still honoured it **passed**. A test that interrogates a description of intent cannot see
 * the renderer disagreeing with it, which is the whole failure mode this file's header is about. So
 * the helper was deleted and this reads the run out of the produced page.
 */
describe("the notice pointing at the continuation sheet", () => {
  /**
   * ⚠ A conservative envelope around a CARRIER run, because the reader gives a baseline and not an
   * ink box and we do not have their font. Measured on the blank template at 600 dpi: their footer's
   * ink stands 7.32pt above its baseline and their body text drops about 1.5pt below it, so −3/+9
   * covers every run in the packet with room to spare. Too generous is the safe direction — it can
   * only reject a placement that would in fact have been fine.
   */
  const RUN_ABOVE = 9;
  const RUN_BELOW = 3;

  /**
   * ONE grid's overflow, rendered on its own.
   *
   * ⚠ **One grid per render, and the first version of this overflowed them all at once.** Page 2
   * carries FOUR of the packet's eight grids, so a single render puts four notices on it and
   * `find` returns the topmost one every time — the test then checked `p02.licences` four times and
   * never looked at the accident, experience or conviction notices at all. It passed. What gave it
   * away was the second assertion below failing with `expected 552.4 to be less than 484.4`: the
   * licence grid's notice, being measured against the experience grid's band.
   */
  const noticeFor = async (table: (typeof PACKET_FIELD_TABLES)[number]) => {
    const overflow: PacketFieldOverflow[] = [{
      tableId: table.id,
      label: `${table.id} heading`,
      columns: ["A", "B"],
      page: table.page,
      rows: [["one", "two"], ["three", "four"]],
    }];
    const pdf = await renderPacketOverlay({ marks: [], fields: [], overflow });
    const runs = await drawnRuns(pdf, table.page);
    const hits = runs.filter((r) => /more entr|too long for/.test(r.text));
    // ⚠ Exactly one, so a page that grew a second notice cannot be measured as if it had one.
    expect(hits, `notices drawn on page ${table.page} for ${table.id}`).toHaveLength(1);
    return hits[0]!;
  };

  it("lands on no printed word of the carrier's, on every grid it can be drawn for", async () => {
    const blank = await readPacketTemplate();

    let checked = 0;
    for (const table of PACKET_FIELD_TABLES) {
      const notice = await noticeFor(table);

      const top = notice.y + 0.718 * notice.size;
      const bottom = notice.y - 0.207 * notice.size;
      const page = blank[table.page - 1]!;
      for (const run of page.runs) {
        const clear = run.y - RUN_BELOW > top || run.y + RUN_ABOVE < bottom;
        expect(clear, `${table.id}: notice at y${notice.y} hits "${run.text.trim().slice(0, 44)}" at y${run.y.toFixed(1)}`).toBe(true);
      }
      // ⚠ Rules too — a notice struck through by one of the carrier's own lines is the same defect
      // with a thinner offender, and the grid's own border sits a few points off the default drop.
      for (const rule of page.rules) {
        const clear = rule.y1 > top || rule.y1 < bottom;
        expect(clear, `${table.id}: notice at y${notice.y} is struck by a rule at y${rule.y1.toFixed(1)}`).toBe(true);
      }
      checked += 1;
    }
    /**
     * ⚠ All eight, and asserted as a count. Two of them are the ones that moved; a test of just
     * those would pass on a renderer hand-fed the right answers and say nothing about the sixth
     * grid somebody re-measures next year.
     */
    expect(checked).toBe(PACKET_FIELD_TABLES.length);
    expect(checked).toBeGreaterThan(7);
  });

  /**
   * ⚠ **The half that stops "clear of everything" being satisfied by drawing it anywhere.** A
   * renderer that put every notice in the middle of the page's widest white space would pass the
   * test above and tell a reader nothing about which grid continues.
   *
   * ⚠ **This is a DRIFT bound and not a certificate of attribution, and it is worth being plain
   * about which.** Whether a reader attributes the notice to the right grid was settled by looking
   * at 200 dpi, because it depends on what sits between them — on page 12 nothing does, and on page
   * 16 the carrier's own two-line instruction does, which is the compromise that page's layout
   * forces and which the raster is the only judge of. What a number CAN hold is that the notice
   * never wanders to the top of the sheet or into the footer: 100pt is wider than any gap the two
   * exceptions actually use (50.4pt on page 12, 94.4pt on page 16) and far narrower than the page.
   */
  it("keeps each notice near the grid it belongs to", async () => {
    const DRIFT = 100;
    for (const table of PACKET_FIELD_TABLES) {
      const notice = await noticeFor(table);
      const first = table.rows[0]!;
      const last = table.rows[table.rows.length - 1]!;
      const distance = notice.y > first ? notice.y - first : notice.y < last ? last - notice.y : 0;
      expect(distance, `${table.id}: notice is ${distance.toFixed(1)}pt from its grid`).toBeLessThan(DRIFT);
    }
  });

  /**
   * ⚠ **Exactly two grids deviate from the default, and they are named.** Without this the
   * exception table could silently grow — a later step moving a third notice "to be safe" would
   * pass everything above, and the packet would quietly stop reading the way it was measured to.
   */
  it("moves only the two grids that have no room below them", async () => {
    const DROP = 9;
    const moved: string[] = [];
    for (const table of PACKET_FIELD_TABLES) {
      const notice = await noticeFor(table);
      const belowDefault = table.rows[table.rows.length - 1]! - DROP;
      if (Math.abs(notice.y - belowDefault) > 0.01) moved.push(table.id);
    }
    expect(moved.sort()).toEqual(["p12.employment", "p16.references"]);
  });
});

/**
 * The applicant's answers, drawn alongside the marks.
 *
 * ⚠ Read back out of the produced PDF rather than asserted over the input, for the reason the rest
 * of this file exists: `streamOf` inflating only the first stream of a multi-stream page made a page
 * read back completely empty once, which is indistinguishable from a renderer that drew nothing.
 */
describe("drawing the field values", () => {
  /**
   * ⚠ The fixture uses a field on page 16, NOT page 1. With a page-1 field this passes whether the
   * renderer reads `line.page` or hard-codes the first page — which is exactly what it did for one
   * round.
   */
  it("puts a value on the page its line belongs to, and on no other", async () => {
    const line = fieldLineFor("p16.military")!;
    expect(line.page).toBe(16);
    const pages = await readBack(
      await renderPacketOverlay({ marks: [], fields: [{ line, text: "NOTAWORD" }] }),
    );
    expect(pageText(pages[15]!)).toContain("NOTAWORD");
    for (const i of [0, 1, 11, 14, 30]) expect(pageText(pages[i]!), `page ${i + 1}`).not.toContain("NOTAWORD");
  });

  /** ⚠ The carrier's own page survives a value being drawn on it, byte for byte. */
  it("does not disturb the carrier's text on a page it fills", async () => {
    const line = fieldLineFor("p01.dob")!;
    const before = pageText((await readPacketTemplate())[0]!);
    const pages = await readBack(
      await renderPacketOverlay({ marks: [], fields: [{ line, text: "1980-04-01" }] }),
    );
    for (const phrase of ["Commercial driver information", "Previous Three years reisdency", "Cdl #"]) {
      expect(before, `fixture: ${phrase}`).toContain(phrase);
      expect(pageText(pages[0]!), phrase).toContain(phrase);
    }
  });

  /**
   * ⚠ Asserted over the BYTES, not over the read-back text. Whitespace drawn onto a page is
   * invisible in both the rasterised page and the extracted text, so "the page reads the same" is
   * true whether the value was skipped or drawn — that assertion passed with the guard removed and
   * proved nothing. What changes is the content stream: a drawn `"   "` emits its own Tj.
   */
  it("draws nothing at all for a blank value, down to the bytes", async () => {
    const line = fieldLineFor("p01.heard_from")!;
    const none = await renderPacketOverlay({ marks: [], fields: [] });
    const blank = await renderPacketOverlay({ marks: [], fields: [{ line, text: "   " }] });
    const real = await renderPacketOverlay({ marks: [], fields: [{ line, text: "Indeed" }] });
    expect(blank.length).toBe(none.length);
    expect(real.length).not.toBe(none.length);
    expect(pageText((await readBack(real))[0]!)).toContain("Indeed");
  });

  /**
   * ⚠ Both on one page and both legible. The marks are drawn AFTER the values on purpose — if a
   * coordinate is ever wrong enough for two to collide, the signature is the one on top, because a
   * document whose signature is obscured is worse than one whose date is.
   */
  it("draws a mark and a value on the same page without either replacing the other", async () => {
    const line = fieldLineFor("p01.dob")!;
    const pages = await readBack(
      await renderPacketOverlay({
        marks: [{ placementId: "p03", signedName: NAME }],
        fields: [{ line, text: "1980-04-01" }],
      }),
    );
    expect(pageText(pages[0]!)).toContain("1980-04-01");
    expect(pageText(pages[2]!)).toContain(NAME);
  });

  it("files a packet with no fields at all, which is the office previewing the marks", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: allMarks() }));
    expect(pages).toHaveLength(31);
  });
});

/**
 * The DRAFT band (A2).
 *
 * ⚠ **The first test here is the one that keeps A2 off the freeze clock.** `ensureApplicationPdf`
 * renders a packet once, hashes it, and returns those bytes for ever, so a change to how this
 * function prints a FILED document can only be made before the first packet is filed. A2 changes the
 * PREVIEW and must leave the filing alone — and "it is an optional parameter, so it cannot" is an
 * argument, not a measurement. This measures it.
 */
describe("the draft band", () => {
  const BAND = "DRAFT - NOT A SIGNED APPLICATION";

  it("draws no band when the filing path does not ask for one", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: allMarks() }));
    const text = pages.map(pageText).join(" ");
    // Guards the guard: the marks ARE there, so a reader finding no band is reading a real document
    // rather than failing to read anything.
    expect(text).toContain(NAME);
    expect(text).not.toContain(BAND);
  });

  /**
   * ⚠ Every sheet, not just page 1. `stamp.ts` already paid for the alternative on the other
   * document: a preview gets printed, photocopied and posted, and a 31-page draft banded once is
   * thirty unmarked pages that each look like a signed form.
   */
  it("bands every sheet when the preview asks for one", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: [], band: BAND }));
    expect(pages.length).toBeGreaterThan(1);
    for (const [i, page] of pages.entries()) {
      expect(pageText(page), `page ${i + 1} carries no band`).toContain(BAND);
    }
  });

  /**
   * ⚠ The continuation sheet is APPENDED after the carrier's 31 pages, so a band drawn before that
   * append would miss it — and the continuation sheet is the one carrying the answers that did not
   * fit, which is exactly the sheet somebody reads on its own.
   */
  it("bands the continuation sheet too", async () => {
    const overflow = [
      {
        tableId: "p02.accidents",
        label: "Accident record",
        columns: ["Date", "Nature", "Fatalities", "Injuries"],
        page: 2,
        rows: [["2024-05-01", "Fourth accident", "0", "0"]],
      },
    ];
    const pages = await readBack(
      await renderPacketOverlay({ marks: [], band: BAND, overflow, applicantName: NAME }),
    );
    expect(pages.length).toBeGreaterThan(31);
    expect(pageText(pages[pages.length - 1]!)).toContain(BAND);
  });
});

/**
 * AUD-1's other half: cutting must not LOSE the answer.
 *
 * ⚠ `packetContinuation.ts` had the right instinct written down — *"a truncated conviction is the
 * silent loss this whole sheet prevents"* — and drew the wrong conclusion from it, that overrunning
 * was the lesser harm. It is not: an overrun loses the value just as completely and destroys the one
 * beside it. So the cut is paired with the sheet, and this is the assertion that says so.
 */
describe("what was cut off the carrier's page", () => {
  const NATURE = "Rear-ended while stopped at a construction flagger on I-80 westbound near mile 118";

  const accidentRow = () => {
    const cells = ["2024-05-02", NATURE, "0", "2", "No"];
    return cells.map((text, col) => ({
      line: fieldCell("p02.accidents", 0, col)!,
      text,
      grid: { label: "ACCIDENT RECORD FOR PAST 3 YEARS", columns: ["DATES", "NATURE", "F", "I", "SPILLS"] },
    }));
  };

  it("is on the continuation sheet in full, and is not on the page it came from", async () => {
    const pdf = await renderPacketOverlay({ marks: [], fields: accidentRow(), overflow: [] });
    const pages = await readBack(pdf);

    // The carrier's page 2 shows as much as fits and no more.
    expect(pageText(pages[1]!)).not.toContain(NATURE);
    // ⚠ Guards the guard: a renderer that drew nothing at all would satisfy the line above for free.
    expect(pageText(pages[1]!)).toContain("Rear-ended while stopped");

    // A sheet was appended, and it carries the sentence whole.
    expect(pages.length).toBeGreaterThan(31);
    const sheet = pages.slice(31).map((p) => pageText(p)).join(" ");
    expect(sheet).toContain(NATURE);
    // The row's siblings come with it, or the answer cannot be matched back to the accident it is.
    expect(sheet).toContain("2024-05-02");
  });

  it("is announced under the grid it was cut from, in its own words", async () => {
    const pdf = await renderPacketOverlay({ marks: [], fields: accidentRow(), overflow: [] });
    const page2 = pageText((await readBack(pdf))[1]!);
    expect(page2).toContain("too long for its column");
    // ⚠ The discriminator. `1 more entry is` is the OTHER notice — the one for a row the carrier
    // printed no space for — and saying that about a row visibly present on the page is the defect
    // the second sentence exists to avoid.
    expect(page2).not.toContain("1 more entry is");
  });

  it("adds no sheet and no notice when every value fits", async () => {
    const short = accidentRow().map((f) => (f.text === NATURE ? { ...f, text: "Rear-end" } : f));
    const pdf = await renderPacketOverlay({ marks: [], fields: short, overflow: [] });
    const pages = await readBack(pdf);
    expect(pages.length).toBe(31);
    expect(pageText(pages[1]!)).toContain("Rear-end");
    expect(pageText(pages[1]!)).not.toContain("too long for its column");
  });
});
