import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { deflateSync, inflateSync } from "node:zlib";
import { join } from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, StandardFonts } from "pdf-lib";
import { driverPlacementIds, driverPlacements } from "@silvicom/shared";
import { renderPacketOverlay } from "./packetOverlay.js";
import { PACKET_MARK_LINES, markLineFor } from "./packetMarkGeometry.js";
import { pageText, readPacketTemplate } from "./packetTemplate.js";
import { fieldLineFor } from "./packetFieldGeometry.js";

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
 * ⚠ **And nothing here asserts a drawn mark's COORDINATES**, because the reader cannot give them
 * honestly for a page we have drawn on: it applies one page transform to everything, which is true of
 * the carrier's own pages and false once `pdf-lib` has bracketed them in `q … Q` and appended
 * operators in absolute space. Text and page structure are what this file reads.
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
  driverPlacements().filter((p) => p.mark === "signature").map((p) => p.id),
);
const allMarks = (signedName = NAME) =>
  driverPlacementIds().map((placementId) => ({ placementId, signedName }));

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
    for (const id of driverPlacementIds()) {
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
    for (const page of [11, 19, 31]) {
      const hits = pageText(pages[page - 1]!).split(NAME).length - 1;
      expect(hits, `p${page}`).toBe(2);
    }
  });

  it("marks no page the driver does not sign", async () => {
    const pages = await readBack(await renderPacketOverlay({ marks: allMarks() }));
    const signed = new Set(driverPlacementIds().map((id) => markLineFor(id)!.page));
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
    const face = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaOblique);
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
  const initialsPlacements = driverPlacements().filter((p) => p.mark === "initials");

  /** What the ceremony sends: the initials on the three, the name on the other nineteen. */
  const mixedMarks = () =>
    driverPlacements().map((p) => ({
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
    for (const p of driverPlacements()) {
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
    const signaturePlacement = driverPlacements().find((p) => p.mark === "signature")!;
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
    const signaturePages = driverPlacements().filter((p) => p.mark === "signature");
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
