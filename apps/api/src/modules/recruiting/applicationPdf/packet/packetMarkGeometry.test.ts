import { describe, it, expect } from "vitest";
import { paperDriverPlacements } from "@silvicom/shared";
import { PACKET_MARK_LINES, markLineFor } from "./packetMarkGeometry.js";
import { readPacketTemplate, type TemplatePage } from "./packetTemplate.js";

/**
 * The mark table, against the paper it was measured from.
 *
 * ⚠ **The table is hand-verified and this is what stops it rotting.** Every line below is asserted to
 * EXIST in `assets/application-11.pdf` at the recorded position, so a re-export that moves the
 * carrier's paper fails the build by name rather than silently moving somebody's signature a
 * centimetre onto the printed text beneath it.
 *
 * ⚠ What it cannot check is that the right line was chosen — that is a judgement about a form, made
 * by drawing every candidate in colour and looking at the rasterised page, and recorded in each
 * entry's `source` and `note`. A test can hold a chosen line still; it cannot choose one.
 */

const pages: TemplatePage[] = await readPacketTemplate();

/** Horizontal rules on a page, de-duplicated — the producer strokes several of them twice. */
const rulesOn = (page: number): Array<{ x1: number; x2: number; y: number }> =>
  pages[page - 1]!.rules
    .filter((r) => Math.abs(r.y1 - r.y2) < 0.5)
    .map((r) => ({ x1: Math.min(r.x1, r.x2), x2: Math.max(r.x1, r.x2), y: r.y1 }));

describe("the mark table", () => {
  it("carries exactly the driver's twenty-two places, and nothing else", () => {
    expect(PACKET_MARK_LINES.map((l) => l.id).sort()).toEqual(paperDriverPlacements().map((p) => p.id).sort());
  });

  it("agrees with the inventory about which page each mark is on", () => {
    for (const placement of paperDriverPlacements()) {
      const line = markLineFor(placement.id);
      expect(line, placement.id).not.toBeNull();
      expect(line!.page, placement.id).toBe(placement.page);
    }
  });

  /**
   * ⚠ The assertion this file exists for. The producer strokes many rules twice at y and y−0.3, so a
   * 1pt tolerance on y and 2pt on each end is the width of the paper's own noise — not slack for a
   * coordinate that has drifted.
   */
  it.each(
    // ⚠ p04 and p10 excluded BY NAME, not by a filter that could quietly grow: their `x2` is not a
    // rule's end, because on both pages the signature SHARES its rule with the date and stops short
    // of the `Date` caption. They have their own assertion below.
    //
    // ⚠ p10 joined this list on 2026-09-14, as a correction. It recorded the shared rule's full
    // width (102..464) and so allowed a long name to be drawn through the printed `Date` at x310.8
    // and through the date value beside it. `packetFieldGeometry.test.ts`'s "never overlaps the
    // mark's own span" is what found it; this file could not, because 102..464 IS a real rule.
    PACKET_MARK_LINES.filter((l) => l.id !== "p04" && l.id !== "p10").map((l) => [l.id, l] as const),
  )(
    "%s sits on a ruled line the carrier's page actually has",
    (_id, line) => {
      const match = rulesOn(line.page).find(
        (r) =>
          Math.abs(r.y - line.y) < 1
          && Math.abs(r.x1 - line.x1) < 2
          && Math.abs(r.x2 - line.x2) < 2,
      );
      expect(
        match,
        `no rule near x ${line.x1}..${line.x2} y ${line.y} on p${line.page}`,
      ).toBeDefined();
    },
  );

  /**
   * ⚠ p04 and p10 are the two entries whose `x2` is NOT a rule's own end: on both, the signature and
   * the date share one rule and the signature stops short of the `Date` caption at x311. So they are
   * checked differently — the rule must exist and must CONTAIN the recorded span.
   */
  it("keeps page 10's signature inside the rule it shares with the date", () => {
    const line = markLineFor("p10")!;
    const rule = rulesOn(10).find((r) => Math.abs(r.y - line.y) < 1 && r.x2 - r.x1 > 300);
    expect(rule, "page 10's shared rule").toBeDefined();
    expect(line.x1).toBeGreaterThanOrEqual(rule!.x1 - 1);
    expect(line.x2).toBeLessThanOrEqual(rule!.x2 - 1);
    // ⚠ And short of the `Date` caption, which is the whole of the 2026-09-14 correction.
    expect(line.x2).toBeLessThan(310.8);
  });

  it("keeps page 4's signature inside the rule it shares with the date", () => {
    const line = markLineFor("p04")!;
    const containing = rulesOn(4).find(
      (r) => Math.abs(r.y - line.y) < 1 && r.x1 <= line.x1 + 1 && r.x2 >= line.x2 - 1,
    );
    expect(containing).toBeDefined();
    const date = pages[3]!.runs.find((r) => r.text.trim().startsWith("Date"));
    expect(date).toBeDefined();
    expect(line.x2, "the signature must stop before the Date caption").toBeLessThan(date!.x);
  });

  /** A signature needs room. Anything this narrow is a date box, which is how the heuristic failed. */
  it("gives every mark a line wide enough to be signed on", () => {
    for (const line of PACKET_MARK_LINES) {
      expect(line.x2 - line.x1, `${line.id} is ${line.x2 - line.x1}pt wide`).toBeGreaterThan(28);
    }
  });

  it("keeps every line inside the page", () => {
    for (const line of PACKET_MARK_LINES) {
      expect(line.y, line.id).toBeGreaterThan(0);
      expect(line.y, line.id).toBeLessThan(792);
      expect(line.x1, line.id).toBeGreaterThanOrEqual(0);
      expect(line.x2, line.id).toBeLessThanOrEqual(612);
    }
  });

  /**
   * ⚠ Page 19 carries its signature line twice and page 11 and 31 carry theirs twice — the duplicate
   * placements must land on DIFFERENT lines. A table that gave both the same y would sign one place
   * twice and leave the other blank, which is the failure the ids exist to prevent.
   */
  it("puts each of the doubled pages' two marks on different lines", () => {
    for (const [a, b] of [["p11a", "p11b"], ["p19a", "p19b"], ["p31a", "p31b"]] as const) {
      const first = markLineFor(a)!;
      const second = markLineFor(b)!;
      expect(first.page).toBe(second.page);
      expect(Math.abs(first.y - second.y), `${a} vs ${b}`).toBeGreaterThan(20);
    }
  });

  /** Every entry says how it was established, so a reader knows which were seen and which inferred. */
  it("records how each entry was established", () => {
    for (const line of PACKET_MARK_LINES) {
      expect(["seen", "sibling"]).toContain(line.source);
      expect(line.note.length, line.id).toBeGreaterThan(20);
    }
    /**
     * ⚠ Six inferred, sixteen seen — pinned as a NUMBER so a later entry cannot quietly be added as
     * "sibling" without somebody deciding that is true. The six are p06 and p09 (p05's initials box),
     * p19a and p19b (p18/p20's `Driver signature:` layout, both verified), p26 (p25) and p28 (p27).
     */
    expect(PACKET_MARK_LINES.filter((l) => l.source === "sibling").map((l) => l.id)).toEqual([
      "p06", "p09", "p19a", "p19b", "p26", "p28",
    ]);
  });
});
