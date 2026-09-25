import { describe, it, expect } from "vitest";
import { paperDriverPlacements } from "@silvicom/shared";
import { FIELD_BASELINE_LIFT, PACKET_FIELD_LINES } from "./packetFieldGeometry.js";
import { PACKET_MARK_LINES } from "./packetMarkGeometry.js";
import {
  PACKET_SIGNING_FIELD_LINES,
  SINGLE_LICENCE_BLOCK_FIELDS,
  SINGLE_LICENCE_BLOCK_PAGES,
  signingLineFor,
} from "./packetSigningGeometry.js";
import { readPacketTemplate, type TemplatePage } from "./packetTemplate.js";

/**
 * The signing-page table, against the paper it was measured from (AUD-17).
 *
 * ⚠ **Same contract as `packetMarkGeometry.test.ts` and `packetFieldGeometry.test.ts`, and the same
 * limit.** Every position below is asserted to EXIST in `assets/application-11.pdf`, so a re-export
 * that moves the carrier's paper fails the build by name rather than silently printing a driver's
 * name across the carrier's own words. What it cannot check is that the right line was CHOSEN —
 * that judgement was made by drawing sample values in colour and looking at the rasterised page,
 * and is recorded in each entry's `source` and `note`.
 *
 * ⚠ **The last test in this file is the one that is not about a coordinate.** Pages 14, 21, 23 and
 * 24 carry blanks the packet asks somebody to fill and take NO driver mark, and D-PKT1 says a name
 * printed on one of them asserts an act nobody performed. An absence nothing checks is an absence
 * the next person fills in while closing a gap.
 */

const pages: TemplatePage[] = await readPacketTemplate();

/** Horizontal rules on a page, de-duplicated — the producer strokes several of them twice. */
const rulesOn = (page: number): Array<{ x1: number; x2: number; y: number }> =>
  pages[page - 1]!.rules
    .filter((r) => Math.abs(r.y1 - r.y2) < 0.5)
    .map((r) => ({ x1: Math.min(r.x1, r.x2), x2: Math.max(r.x1, r.x2), y: r.y1 }));

/** Is there a rule at this y that covers this span? Tolerances are a point, the producer's jitter. */
const ruleCovering = (page: number, y: number, x1: number, x2: number): boolean =>
  rulesOn(page).some((r) => Math.abs(r.y - y) <= 1.2 && r.x1 <= x1 + 1.2 && r.x2 >= x2 - 1.2);

/**
 * The entries whose blank is NOT a ruled line, named rather than matched by a pattern.
 *
 * ⚠ A regular expression over ids would quietly adopt the next entry that happened to match it. Each
 * name below has its own assertion further down saying what it IS instead — printed underscores, or
 * the inside of a bordered box.
 */
const NOT_ON_A_RULE = new Set([
  "p31.driver_name",
  "p31.owner_operator_name",
  /**
   * ⚠ **This one PASSES the rule test without being here, and that is exactly why it is here**
   * (AUD-7, 2026-09-19). `ruleCovering` finds a stroke at y493.2 running 52.8→253.1 that brackets
   * the blank within the 1.2pt tolerance — but that stroke is the TOP BORDER OF THE TABLE ROW
   * BELOW the sentence, in a document whose paragraphs sit in table cells. It starts at the text
   * margin rather than at the blank, and it ends at the next row's width. Left out of this set, the
   * entry would be held still by a coincidence, and the day a re-measurement moved the blank the
   * test would stay green because the border had not moved.
   */
  "p31.aka_op",
  "p26.prior_test.yes",
  "p26.prior_test.no",
]);

describe("the signing table, against the carrier's own pages", () => {
  it("puts every ruled entry on a rule that is really there", () => {
    const onRules = PACKET_SIGNING_FIELD_LINES.filter((l) => !NOT_ON_A_RULE.has(l.id));
    // ⚠ The count is asserted so that a table emptied by a bad refactor cannot pass this vacuously.
    expect(onRules.length).toBe(PACKET_SIGNING_FIELD_LINES.length - NOT_ON_A_RULE.size);
    expect(onRules.length).toBeGreaterThan(20);
    for (const l of onRules) {
      expect(ruleCovering(l.page, l.y, l.x1, l.x2), `${l.id} at (${l.x1}..${l.x2}, ${l.y})`).toBe(true);
    }
  });

  /**
   * ⚠ Page 31's two name blanks are printed underscores, exactly as page 2's `Yes______` is, so
   * there is no rule to find. What CAN be held still is the printed run they are written over, and
   * where along it the value is allowed to begin.
   *
   * ⚠ **`x1 > run.x` is NOT the assertion, and a mutant proved it.** Moving the blank to x60 still
   * satisfies "after the run starts" and draws the driver's name straight through the printed words
   * `Driver name:`. What bounds it instead comes off the carrier's own paper: pages 18 and 19 BOX
   * that identical caption, in the same document and the same font, at 52.8→109.0. A caption cannot
   * be narrower on one page than the carrier's own cell for it is on another.
   */
  it("starts page 31's two name blanks after the captions they follow", () => {
    const CAPTION_BOX_RIGHT = 109.0;
    const driver = signingLineFor("p31.driver_name")!;
    const owner = signingLineFor("p31.owner_operator_name")!;

    for (const [line, caption] of [
      [driver, "Driver name:"],
      [owner, "Owner Operator Name:"],
    ] as const) {
      const baseline = line.y + FIELD_BASELINE_LIFT;
      const run = pages[30]!.runs.find(
        (r) => r.text.startsWith(caption) && Math.abs(r.y - baseline) <= 1.2,
      );
      expect(run, `${line.id} over ${caption} at y=${baseline}`).toBeDefined();
      expect(run!.text.slice(caption.length), line.id).toMatch(/_{4,}/);
      expect(line.x1, `${line.id} must clear the printed caption`).toBeGreaterThanOrEqual(
        CAPTION_BOX_RIGHT,
      );
      expect(line.x2, `${line.id} must end inside the run's own cell`).toBeLessThanOrEqual(432.6);
    }

    // ⚠ `Owner Operator Name:` is eight characters longer than `Driver name:`, so its blank cannot
    // begin at or before the other's. Derived from the two captions rather than from the numbers.
    expect(owner.x1).toBeGreaterThan(driver.x1);
  });

  /**
   * AUD-7: the packet's only blank in the MIDDLE of a sentence.
   *
   * ⚠ **It is bounded on BOTH sides by the carrier's words**, which nothing else in this table is.
   * Every other blank runs out into white space; this one has `aka (OP)` immediately after it, so a
   * value that overruns destroys the sentence that gives the name its meaning rather than just
   * looking untidy.
   *
   * ⚠ **`x2`'s exact value CANNOT be checked here, and this says so rather than pretending** — the
   * same position `packetFieldGeometry.ts` takes on `PAGE_1_NAME_COLUMNS`. The end of a line of
   * underscores is not a run whose x anything can read: the whole sentence is one `TJ` array with
   * per-glyph kerning, so the interior positions are advance widths inside a font this repo does not
   * parse. 244.0 was measured off a 2pt coordinate ruler and confirmed by drawing a value under it
   * at 300 dpi. What holds the value inside the span at RENDER time is
   * `packetOverlay.test.ts`'s "draws nothing past the span its geometry gives it".
   *
   * What IS checkable is everything else, and it is what a mutant would break first.
   */
  it("puts page 31's mid-sentence blank on its underscores, after a one-letter word", () => {
    const line = signingLineFor("p31.aka_op")!;
    const run = pages[30]!.runs.find(
      (r) => Math.abs(r.y - (line.y + FIELD_BASELINE_LIFT)) <= 1.2 && r.text.includes("aka (OP)"),
    );
    expect(run, "no `aka (OP)` run at the blank's baseline").toBeDefined();
    expect(run!.text.startsWith("I "), "the sentence opens with the one-letter word").toBe(true);
    expect(run!.text, "the blank is printed underscores, not a rule").toMatch(/_{4,}/);

    /**
     * ⚠ **`x1 > run.x` alone is NOT the assertion, for the reason the driver-name test states** —
     * it is satisfied by any x to the right, including ones that print the name over the carrier's
     * own words. What bounds it here is that the word the blank follows is a SINGLE LETTER: `I `
     * cannot be 12pt wide at the carrier's type, so a blank starting more than that far along is
     * over the underscores' left end or past it.
     */
    expect(line.x1, "starts after the printed `I `").toBeGreaterThan(run!.x);
    expect(line.x1, "a one-letter word cannot be this wide").toBeLessThan(run!.x + 12);

    // ⚠ The span must stay inside the TABLE CELL the sentence is in, whose own borders are real
    // strokes: y508.4 and y494.4, both running 52.8 → 478.6. This is a genuine bound off the
    // carrier's paper and is NOT the 244.0 measurement, which no test can check.
    expect(ruleCovering(31, 494.4, 52.8, 478.6), "the sentence's own cell floor").toBe(true);
    expect(line.x2, "must end inside the sentence's cell").toBeLessThan(478.6);
    expect(line.x2, "a span that ends before it starts is not a span").toBeGreaterThan(line.x1);
  });

  /**
   * ⚠ Page 26's answer goes INSIDE a bordered box rather than on a rule, so "is there a rule at this
   * y" is the wrong question and would fail. The right one is whether the X lands between the box's
   * own floor and ceiling — which is what makes it read as a tick rather than as a mark that missed.
   */
  it("puts page 26's two ticks inside the box the carrier drew", () => {
    const [floor, ceiling] = [427.2, 457.7];
    for (const y of [floor, ceiling]) {
      expect(ruleCovering(26, y, 103.0, 309.4), `box rule y=${y}`).toBe(true);
    }
    /**
     * ⚠ **The MIDDLE third, and "inside the box" is not enough** — a mutant that dropped the tick
     * onto the floor rule survived the weaker assertion. Sitting 3pt above the box's own floor is
     * what an X looks like when it missed the box; halfway up is what a tick looks like. Both were
     * drawn at `-r 150` and compared before this number was chosen.
     */
    const third = (ceiling - floor) / 3;
    for (const id of ["p26.prior_test.yes", "p26.prior_test.no"]) {
      const baseline = signingLineFor(id)!.y + FIELD_BASELINE_LIFT;
      expect(baseline, `${id} off the box floor`).toBeGreaterThan(floor + third);
      expect(baseline, `${id} clear of the box lid`).toBeLessThan(ceiling - third);
    }
    // ⚠ The divider is a real vertical, so `YES` and `NO` are two cells and not one guessed split.
    const verticals = pages[25]!.rules
      .filter((r) => Math.abs(r.x1 - r.x2) < 0.5 && Math.abs(r.y1 - r.y2) > 1)
      .map((r) => r.x1);
    for (const x of [103.0, 206.2, 309.4]) {
      expect(verticals.some((v) => Math.abs(v - x) <= 1.2), `box boundary x=${x}`).toBe(true);
    }
  });
});

/**
 * Q-HM14's page 22. ⚠ **The derivation leans on something the carrier printed**, and so this pins it:
 * the company driver's reason, `Pre-Employment Qualification:`, carries the carrier's own `yes` on its
 * rule, which is WHY `packetSigningFields.ts` draws nothing for a company driver. A re-export that
 * dropped that word would leave every company driver's page 22 with no reason at all while this
 * renderer went on assuming the paper answers it — so the day the paper changes, this fails by name.
 */
describe("page 22's reason box", () => {
  const runs = pages[21]!.runs;
  const at = (text: string) => runs.find((r) => r.text.trim() === text);

  it("carries the carrier's own printed yes beside Pre-Employment Qualification, on the row above ours", () => {
    const caption = at("Pre-Employment Qualification:")!;
    const printed = at("yes")!;
    expect(printed, "the carrier's printed `yes`").toBeTruthy();
    expect(Math.abs(printed.y - caption.y), "same row as its caption").toBeLessThan(0.5);
    expect(printed.x).toBeGreaterThan(caption.x);
    expect(ruleCovering(22, 522.24, 205.7, 257.4), "the rule under it").toBe(true);
  });

  it("puts the owner-operator's reason after its caption and before `Other`", () => {
    const line = signingLineFor("p22.reason.contracting")!;
    const caption = at("Pre-Qualification for Contracting a Driver/ Owner Operator")!;
    const other = at("Other")!;
    expect(Math.abs(line.y + FIELD_BASELINE_LIFT - caption.y), "on the caption's row").toBeLessThan(5);
    expect(line.x2).toBeLessThan(other.x);
    expect(ruleCovering(22, line.y, line.x1, line.x2)).toBe(true);
  });
});

describe("the identity block pages 18 and 19 share", () => {
  it("generates all sixteen lines, eight to a page", () => {
    for (const page of SINGLE_LICENCE_BLOCK_PAGES) {
      const got = SINGLE_LICENCE_BLOCK_FIELDS.map((f) => signingLineFor(`p${page}.${f}`));
      expect(got.filter(Boolean), `page ${page}`).toHaveLength(8);
      for (const l of got) expect(l!.page, l!.id).toBe(page);
    }
  });

  /**
   * ⚠ **This is the assertion the generator exists to earn.** Pages 18 and 19 agreeing on eight x
   * spans is a fact about the carrier's paper that was confirmed by rendering BOTH pages, and the
   * generator would happily produce sixteen lines from one page's measurements if it ever stopped
   * being true. Held against the template rather than against the constant.
   */
  it("holds the two pages' spans identical, and both against the template", () => {
    for (const field of SINGLE_LICENCE_BLOCK_FIELDS) {
      const [a, b] = SINGLE_LICENCE_BLOCK_PAGES.map((p) => signingLineFor(`p${p}.${field}`)!);
      expect([a!.x1, a!.x2], field).toEqual([b!.x1, b!.x2]);
      expect(a!.y, `${field} rows differ between the two pages`).not.toBe(b!.y);
      for (const l of [a!, b!]) {
        expect(ruleCovering(l.page, l.y, l.x1, l.x2), `${l.id}`).toBe(true);
      }
    }
  });
});

describe("the vocabulary, across all three geometry tables", () => {
  it("names every id once", () => {
    const ids = PACKET_SIGNING_FIELD_LINES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /** ⚠ An id in both tables is a value drawn twice, once from each module that fills one of them. */
  it("shares no id with the answers table", () => {
    const answers = new Set(PACKET_FIELD_LINES.map((l) => l.id));
    expect(PACKET_SIGNING_FIELD_LINES.filter((l) => answers.has(l.id)).map((l) => l.id)).toEqual([]);
  });

  /**
   * ⚠ **D-HIRE6, asserted as an ABSENCE.** Page 4's printed-name rule is SHARED with
   * `Social Security Number`, which is exactly the shape of line somebody fills in while closing a
   * gap — so the span stops at 305 and nothing here may ever name those nine digits.
   */
  it("carries no field for the Social Security number anywhere", () => {
    expect(PACKET_SIGNING_FIELD_LINES.filter((l) => /ssn|social|ss_?#/i.test(l.id))).toEqual([]);
    expect(signingLineFor("p04.printed_name")!.x2).toBeLessThan(310.8);
  });
});

/**
 * Nothing measured may collide with anything else measured.
 *
 * ⚠ **This is the only test in the area that could catch a wrong coordinate rather than a moved
 * one**, and it exists because no assertion about TEXT can: both runs land in the content stream, so
 * `pdfText()` finds every word on a page no human could read. It is the generalisation of
 * `packetFieldGeometry.test.ts`'s "never overlaps the mark's own span", which caught `p10` drawing
 * its date through the carrier's printed `Date` on 2026-09-14 — widened here to every pair of
 * measured spans in the packet, because AUD-17 added twenty-eight more chances to make that mistake.
 */
describe("no two measured spans on one band overlap", () => {
  const everything = [
    ...PACKET_FIELD_LINES.map((l) => ({ id: l.id, page: l.page, y: l.y, x1: l.x1, x2: l.x2 })),
    ...PACKET_SIGNING_FIELD_LINES.map((l) => ({ id: l.id, page: l.page, y: l.y, x1: l.x1, x2: l.x2 })),
    ...PACKET_MARK_LINES.map((l) => ({ id: l.id, page: l.page, y: l.y, x1: l.x1, x2: l.x2 })),
  ];

  it("keeps every pair within a line's height of each other side by side", () => {
    const clashes: string[] = [];
    for (let i = 0; i < everything.length; i += 1) {
      for (let j = i + 1; j < everything.length; j += 1) {
        const a = everything[i]!;
        const b = everything[j]!;
        if (a.page !== b.page || Math.abs(a.y - b.y) > 8) continue;
        // ⚠ Adjacent spans SHARE a boundary by design — a grid's columns, page 1's caption-aligned
        // name cells — so the overlap has to be strict rather than touching.
        if (a.x1 < b.x2 - 0.5 && b.x1 < a.x2 - 0.5) {
          clashes.push(`${a.id} (${a.x1}..${a.x2}) vs ${b.id} (${b.x1}..${b.x2}) on page ${a.page}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });
});

/**
 * ⚠ **The four pages that must stay blank, derived rather than listed** (D-PKT1, Q-PKT5).
 *
 * 14 is the previous-employer request WE send, 21 and 23 the carrier's own reviews, 24 the
 * `DRIVER SAFETY TRAINING` page that left the packet on 2026-08-23 because it affirms a training
 * that has not happened. All four carry ruled blanks, and none of them carries a driver's mark.
 */
describe("the pages that are not the applicant's document", () => {
  it("measures nothing on a page the driver never signs", () => {
    const signed = new Set(paperDriverPlacements().map((p) => p.page));
    const strays = PACKET_SIGNING_FIELD_LINES.filter((l) => !signed.has(l.page)).map((l) => l.id);
    expect(strays).toEqual([]);
    // ⚠ Named as well as derived: the derivation is only as good as the inventory, and these four
    // are the pages the ruling is about.
    for (const page of [14, 21, 23, 24]) {
      expect(signed.has(page), `page ${page} must take no driver mark`).toBe(false);
    }
  });
});
