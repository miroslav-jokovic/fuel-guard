import { describe, it, expect } from "vitest";
import { carrierPlacementIds, packetPlacementById } from "@silvicom/shared";
import { PACKET_COUNTERSIGN_LINES } from "./packetCountersignGeometry.js";
import { readPacketTemplate, type TemplatePage } from "./packetTemplate.js";

/**
 * The carrier's four lines, against the paper they were measured from (Q-HB1, D-HB9).
 *
 * ⚠ The same job `packetMarkGeometry.test.ts` does for the driver's: a re-export that moves the
 * carrier's paper fails here by name instead of moving a Representative's signature onto printed text.
 * Which line is the carrier's was chosen by drawing and looking; this holds the choice still.
 */

const pages: TemplatePage[] = await readPacketTemplate();

/** Horizontal rules on a page, de-duplicated (the producer strokes several twice, 0.3pt apart). */
const rulesOn = (page: number) =>
  pages[page - 1]!.rules
    .filter((r) => Math.abs(r.y1 - r.y2) < 0.5)
    .map((r) => ({ x1: Math.min(r.x1, r.x2), x2: Math.max(r.x1, r.x2), y: r.y1 }));

const ruleAt = (page: number, x1: number, x2: number, y: number) =>
  rulesOn(page).find((r) => Math.abs(r.y - y) < 1 && Math.abs(r.x1 - x1) < 2 && Math.abs(r.x2 - x2) < 2);

describe("the countersign table", () => {
  it("carries exactly the carrier's lines from the inventory, each on the inventory's page", () => {
    expect(PACKET_COUNTERSIGN_LINES.map((l) => l.id).sort()).toEqual(carrierPlacementIds().sort());
    for (const line of PACKET_COUNTERSIGN_LINES) expect(line.page, line.id).toBe(packetPlacementById(line.id)!.page);
  });

  it.each(PACKET_COUNTERSIGN_LINES.map((l) => [l.id, l] as const))("%s sits on a rule the carrier's page has", (_id, line) => {
    expect(ruleAt(line.page, line.x1, line.x2, line.y), `signature rule of ${line.id}`).toBeDefined();
    if (line.date) expect(ruleAt(line.page, line.date.x1, line.date.x2, line.date.y), `date rule of ${line.id}`).toBeDefined();
  });

  /**
   * ⚠ The caption is drawn where the carrier printed nothing. A 7pt line needs about 8pt of box above
   * its baseline and 2pt below; nothing of the carrier's may start in that band across the caption's
   * span, or the applied-by line prints over their words (page 22's own caption is the case that
   * moved `p22c`'s down).
   */
  it.each(PACKET_COUNTERSIGN_LINES.map((l) => [l.id, l] as const))("%s's caption sits on blank paper", (_id, line) => {
    const runs = pages[line.page - 1]!.runs.filter(
      (r) => r.y > line.caption.y - 9 && r.y < line.caption.y + 8 && r.x < line.caption.x2 && r.x >= line.caption.x - 60,
    );
    expect(runs.map((r) => r.text)).toEqual([]);
  });

  it("puts p22c's date on its own lower rule, not level with the signature", () => {
    const line = PACKET_COUNTERSIGN_LINES.find((l) => l.id === "p22c")!;
    expect(line.date!.y).toBeLessThan(line.y - 10);
  });
});
