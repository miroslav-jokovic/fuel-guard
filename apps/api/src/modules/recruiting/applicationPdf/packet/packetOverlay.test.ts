import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { PDFArray, PDFDocument, PDFStream, StandardFonts } from "pdf-lib";
import { driverPlacementIds, driverPlacements } from "@silvicom/shared";
import { renderPacketOverlay } from "./packetOverlay.js";
import { PACKET_MARK_LINES, markLineFor } from "./packetMarkGeometry.js";
import { pageText, readPacketTemplate } from "./packetTemplate.js";

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
