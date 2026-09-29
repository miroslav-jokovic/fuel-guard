import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { carrierPlacementIds, driverPlacementIds } from "@silvicom/shared";
import { renderPacketOverlay } from "./packetOverlay.js";
import { pageText, readPdfPages } from "./packetTemplate.js";
import { countersignCaption, stampPacketCountersignature, type PacketCountersignStamp } from "./packetCountersignStamp.js";

/**
 * The carrier's countersignature, stamped onto a filed packet (Q-HB1, D-HB9). Drawn on real overlay
 * output, with the withdrawal notices on it, and with a name the standard fonts cannot encode.
 */

let filed: Buffer;
beforeAll(async () => {
  filed = await renderPacketOverlay({
    marks: driverPlacementIds(null).map((placementId) => ({ placementId, signedName: "Jovana Petrović-Szczepańska" })),
  });
});

const STAMP: PacketCountersignStamp = {
  placements: carrierPlacementIds(),
  signature: null,
  fullName: "Aleksandra Wiśniewska-Petrović",
  title: "Director of Safety and Compliance",
  appliedBy: "Miroslav Jokovic",
  signedOn: "09/29/2026",
};

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe("stamping the carrier's lines", () => {
  it("signs each carrier line once, dates the two that have a date rule, and captions every one", async () => {
    const pages = await readPdfPages(new Uint8Array(await stampPacketCountersignature(filed, STAMP)));
    const caption = countersignCaption(STAMP);
    const [p18, p19, p22] = [pageText(pages[17]!), pageText(pages[18]!), pageText(pages[21]!)];
    // Typed name (no picture): once on 18, twice on 19, once on 22; plus once inside each caption.
    expect([count(p18, STAMP.fullName), count(p19, STAMP.fullName), count(p22, STAMP.fullName)]).toEqual([2, 4, 2]);
    expect([count(p18, caption), count(p19, caption), count(p22, caption)]).toEqual([1, 2, 1]);
    // The date rule: p19ac and p22c have one, p18c and p19bc do not (so 18 carries the date only in its caption).
    expect([count(p18, "09/29/2026"), count(p19, "09/29/2026"), count(p22, "09/29/2026")]).toEqual([1, 3, 2]);
  });

  it("changes nothing on any other page, and keeps the filed document's metadata", async () => {
    // ⚠ A source whose metadata pdf-lib would NOT reproduce by accident: the overlay's own output carries
    // pdf-lib's producer and a date from the same second, so a stamp that rewrote both matched it anyway.
    const marked = await PDFDocument.load(filed, { updateMetadata: false });
    marked.setProducer("The carrier's filing");
    marked.setModificationDate(new Date("2026-09-01T12:00:00Z"));
    const source = Buffer.from(await marked.save());
    const out = await stampPacketCountersignature(source, STAMP);
    const [before, after] = [await readPdfPages(new Uint8Array(source)), await readPdfPages(new Uint8Array(out))];
    expect(after).toHaveLength(before.length);
    for (const i of before.keys()) {
      if ([17, 18, 21].includes(i)) continue;
      expect(pageText(after[i]!), `page ${i + 1}`).toBe(pageText(before[i]!));
    }
    const b = await PDFDocument.load(out, { updateMetadata: false });
    expect(b.getModificationDate()?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(b.getProducer()).toBe("The carrier's filing");
  });

  it("draws the picture instead of the typed name when one is given, and the typed name when it will not decode", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const drawn = pageText((await readPdfPages(new Uint8Array(await stampPacketCountersignature(filed, { ...STAMP, signature: png }))))[17]!);
    expect(count(drawn, STAMP.fullName)).toBe(1); // the caption's only
    const brokenOut = await stampPacketCountersignature(filed, { ...STAMP, signature: Buffer.from("not a png") });
    const broken = pageText((await readPdfPages(new Uint8Array(brokenOut)))[17]!);
    expect(count(broken, STAMP.fullName)).toBe(2);
  });

  it("draws nothing for an empty list or an id it does not carry", async () => {
    for (const placements of [[], ["p18"], ["h4c"]]) {
      const out = await readPdfPages(new Uint8Array(await stampPacketCountersignature(filed, { ...STAMP, placements })));
      expect(pageText(out[17]!)).not.toContain(STAMP.fullName);
    }
  });

  it("refuses a document too short to be the packet rather than drawing somewhere else", async () => {
    const short = await PDFDocument.create();
    short.addPage();
    await expect(stampPacketCountersignature(await short.save(), STAMP)).rejects.toThrow(/page 18/);
  });
});
