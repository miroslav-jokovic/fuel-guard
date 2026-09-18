import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { deflateSync, inflateSync } from "node:zlib";
import { join } from "node:path";
import { PDFArray, PDFDocument, PDFStream, StandardFonts } from "pdf-lib";
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
  function onePixelPng(): Buffer {
    const chunk = (type: string, body: Buffer): Buffer => {
      const head = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(type, "latin1")]);
      head.writeUInt32BE(body.length, 0);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), body])), 0);
      return Buffer.concat([head, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    // 8-bit, colour type 2 (truecolour), no interlace — what pdf-lib's PNG reader accepts.
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      // One scanline: filter byte 0, then one black pixel.
      chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0]))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  it("puts the typed initials on the three pages that ask for initials, even in drawn mode", async () => {
    expect(initialsPlacements).toHaveLength(3);
    const pages = await readBack(
      await renderPacketOverlay({ marks: mixedMarks(), drawnMark: onePixelPng() }),
    );
    for (const p of initialsPlacements) {
      const text = pageText(pages[p.page - 1]!);
      expect(text, `page ${p.page} (${p.id})`).toContain(INITIALS);
      // ⚠ And NOT the signature. A renderer that drew both would satisfy the line above.
      expect(text, `page ${p.page} (${p.id})`).not.toContain(NAME);
    }
  });

  /**
   * ⚠ The other half, and without it the test above passes on a renderer that ignores the drawing
   * entirely — which would be a different defect with the same green suite.
   */
  it("replaces the typed name with the drawing on a page that asks for a signature", async () => {
    const pages = await readBack(
      await renderPacketOverlay({ marks: mixedMarks(), drawnMark: onePixelPng() }),
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
