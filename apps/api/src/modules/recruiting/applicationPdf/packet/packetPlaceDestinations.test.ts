import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { driverPlacementIds, paperDriverPlacements, signingPlaceDestination } from "@silvicom/shared";
import { pdfDestinations, type PdfDestination } from "../../../../testing/pdfDestinations.js";
import { renderPacketOverlay } from "./packetOverlay.js";
import { markLineFor } from "./packetMarkGeometry.js";
import { pageText, readPdfPages } from "./packetTemplate.js";
import { withPacketPlaceDestinations } from "./packetPlaceDestinations.js";

/**
 * The packet's places, named inside the reading copy (D-HB12). ⚠ Asserted against the carrier's own
 * page and the measured line, not against the module's arithmetic alone.
 */
let source: Buffer;
let named: Buffer;
let dests: Map<string, PdfDestination>;
beforeAll(async () => {
  source = await renderPacketOverlay({ marks: driverPlacementIds(null).slice(0, 3).map((placementId) => ({ placementId, signedName: "Jovana" })) });
  named = await withPacketPlaceDestinations(source);
  dests = await pdfDestinations(named);
});

describe("the packet's place destinations", () => {
  it("names every driver line on the carrier's paper, on the page the inventory says, as its measured box", () => {
    for (const p of paperDriverPlacements()) {
      const d = dests.get(signingPlaceDestination(p.id));
      expect(d, p.id).toBeDefined();
      expect(d!.page, p.id).toBe(p.page);
      expect(d!.kind).toBe("FitR");
      const line = markLineFor(p.id)!;
      const [left, bottom, right, top] = d!.args as [number, number, number, number];
      expect([left, right]).toEqual([line.x1, line.x2]);
      // From just under the rule to the top of the tallest mark the overlay draws there.
      expect(bottom).toBeLessThan(line.y);
      expect(top).toBeGreaterThan(line.y + 18);
    }
  });

  it("names no carrier or witness line — the walk never stands on one", () => {
    for (const id of ["p18c", "p19ac", "p19bc", "p22c", "p22w", "p31w"]) expect(dests.has(signingPlaceDestination(id)), id).toBe(false);
  });

  it("changes nothing a reader can see, and keeps the document's metadata", async () => {
    const [before, after] = [await readPdfPages(new Uint8Array(source)), await readPdfPages(new Uint8Array(named))];
    expect(after.map(pageText)).toEqual(before.map(pageText));
    const [a, b] = [await PDFDocument.load(source, { updateMetadata: false }), await PDFDocument.load(named, { updateMetadata: false })];
    expect(b.getProducer()).toBe(a.getProducer());
    expect(b.getModificationDate()?.getTime()).toBe(a.getModificationDate()?.getTime());
  });
});
