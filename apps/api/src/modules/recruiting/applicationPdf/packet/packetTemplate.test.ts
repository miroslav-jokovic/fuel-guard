import { describe, it, expect } from "vitest";
import { PACKET_PLACEMENTS } from "@silvicom/shared";
import { PACKET_INSTRUMENTS } from "../../packetWording.js";
import { PACKET_TEMPLATE_PATH, pageText, readPacketTemplate, type TemplatePage } from "./packetTemplate.js";

/**
 * The carrier's own packet, asserted against the BYTES (§2.5).
 *
 * ── THE CHECK THE PLAN SAID DID NOT EXIST ─────────────────────────────────────────────────────
 * Three defects in this area share one shape, and §2.5 names it: **a guard scoped to our own files
 * cannot check a fact about the carrier's paper.** p24 was classified static and shipped wrong
 * (D-PKT10). p17 was excluded whole on a reading of its bottom half (D-PKT12). And on 2026-09-14
 * every page number in `packetWording.ts` turned out to be one too low, under a test that asserted
 * the constant against itself — whose replacement had to admit, in its own comment, that the check
 * which would close the gap "needs that PDF in the repository".
 *
 * The PDF is in the repository now, and this is that check. Every assertion below reads
 * `assets/application-11.pdf` and compares it against a constant somewhere else in the tree, so a
 * constant that drifts from the carrier's document fails the build by name.
 *
 * ⚠ **Position is asserted now, and was not until the CTM was resolved (2026-09-14).** Every page
 * opens with one `0.75 0 0 -0.75 0 792 cm` and never touches the matrix again, so
 * `pageY = 792 − 0.75·y`, and the landmarks below prove it at both ends of the sheet rather than
 * trusting the arithmetic.
 *
 * ⚠ The earlier note claimed the axis was unexplained because the letterhead read 88 and
 * `FOR DEPARTMENT` read 149. Both readings were right: **that line is printed twice on page 1**, as a
 * sub-header and again in the footer. The landmark below is therefore the line that occurs ONCE.
 *
 * ⚠ What has NOT come back is `footerNumber()`. The first one looked for digits "below the footer
 * rule", found null on all 31 pages, and would have been a gate passing by finding nothing. Page
 * identity is still asserted by headings, which needs no coordinate system at all.
 */

// ⚠ The carrier's file AS GIVEN, not as it prints (D-PKT20): this file checks the inventory's
// anchors and the wording register's `packet` strings, both of which are keys into the carrier's
// own text, typos included. What prints is `packetSpelling.test.ts`'s business.
const pages: TemplatePage[] = await readPacketTemplate(PACKET_TEMPLATE_PATH);
const textOf = (page: number): string => pageText(pages[page - 1]!);
/** Whitespace in a PDF content stream is the producer's, not the carrier's. */
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

describe("the carrier's packet, as shipped", () => {
  it("is the 31-page letter document every page reference in this area assumes", () => {
    expect(pages).toHaveLength(31);
    for (const p of pages) {
      expect(p.width, `p${p.page} width`).toBeCloseTo(612, 0);
      expect(p.height, `p${p.page} height`).toBeCloseTo(792, 0);
    }
  });

  /**
   * ⚠ Guards the guard. The text is glyph IDs against a subsetted font in the file; without the
   * `ToUnicode` CMap every assertion below would compare against mojibake and fail for the wrong
   * reason — or, worse, a `.includes()` looking for something absent would pass.
   */
  it("decodes to real text rather than to glyph ids", () => {
    const all = pages.map((p) => pageText(p)).join("\n");
    expect(all).toContain("SILVICOM INC");
    expect(all).toContain("FOR DEPARTMENT OF TRANSPORTATION VERIFICATION PURPOSE ONLY");
    expect(all.length).toBeGreaterThan(40_000);
  });
});

/**
 * ⚠ **This is the assertion #780 could not make.**
 *
 * `packetWording.ts` publishes three of the carrier's instruments and records which page a reviewer
 * turns to for each. Those numbers were 14/19/21 and are 15/20/22, and the cross-check that replaced
 * the self-restating test catches only two of the three — page 19 carries driver signatures, so an
 * instrument wrongly placed there passes it. Reading the document settles all three.
 */
describe("every published instrument is on the page it says it is", () => {
  it.each(PACKET_INSTRUMENTS.map((i) => [i.instrument, i.page, i.heading] as const))(
    "%s is on page %i, under its own heading",
    (_instrument, page, heading) => {
      expect(flat(textOf(page))).toContain(flat(heading));
    },
  );

  /**
   * And nowhere else — the half that makes the above meaningful. A heading appearing on two pages
   * would make "it is on page 15" true and useless.
   */
  it.each(PACKET_INSTRUMENTS.map((i) => [i.instrument, i.heading] as const))(
    "%s's heading appears on exactly one page",
    (_instrument, heading) => {
      const on = pages.filter((p) => flat(pageText(p)).includes(flat(heading))).map((p) => p.page);
      expect(on).toHaveLength(1);
    },
  );

  /**
   * ⚠ The three fragments the repair registers name, each on the page its entry claims. These moved
   * with the instruments in #780 and nothing had ever read them off the paper.
   */
  it("finds each recorded defect on the page its register entry names", () => {
    expect(textOf(20)).toContain("168lu");
    expect(flat(textOf(20))).toContain("T he purpose");
    expect(textOf(15)).toContain("applicanthas");
    expect(flat(textOf(22))).toContain("pre-employment. contracted");
  });
});

/**
 * The placement inventory, against the paper it was measured from.
 *
 * ⚠ Anchors are compared LOOSELY — the workbook joins cells with `|`, which the PDF does not print,
 * so each side of the separator is checked on its own. `packetPlacements.test.ts` already pins the
 * anchor against the workbook character for character; what this adds is the PAGE, which the
 * workbook cannot say because it stores no page breaks.
 *
 * ⚠ **AND ITS LIMIT, STATED RATHER THAN IMPLIED: a generic anchor cannot distinguish two signing
 * pages.** `Driver signature: | Date:` appears on pages 18, 19, 20 and 21 among others, so moving
 * `p20` to page 21 passes this check — measured, by doing it. What the check does catch is a
 * placement moved to a page carrying no such line at all, which is the larger half of the mistakes
 * actually made here (p24 and p17 were both classification errors about whole pages).
 *
 * The count assertion below is the part that discriminates where it can, and page 19 is why it is
 * worth having: the inventory claims TWO driver signatures there, and one line would satisfy a
 * presence check while making D-PKT12 wrong.
 */
describe("every placement sits on the page the inventory claims", () => {
  const pieces = (anchor: string): string[] =>
    anchor.split("|").map((s) => flat(s)).filter((s) => s.length > 3);

  it.each(PACKET_PLACEMENTS.map((p) => [p.id, p.page, p.anchor] as const))(
    "%s — page %i",
    (_id, page, anchor) => {
      const text = flat(textOf(page));
      for (const piece of pieces(anchor)) expect(text, piece).toContain(piece);
    },
  );

  /**
   * ⚠ A page claiming N driver signature lines must carry at least N of them.
   *
   * ⚠ **EQUALITY, and it has to be, because the two directions catch different mistakes.** Too few
   * lines on the paper means the inventory invented a placement. Too many means it MISSED one — and
   * that is the direction that found p17, the one no test could see while the page was excluded from
   * the render. `toBeGreaterThanOrEqual` was written first and caught neither: it skipped every page
   * claiming a single line, so deleting one of page 19's two passed.
   */
  it("counts exactly as many signature lines on a page as the inventory claims", () => {
    /**
     * Placements per page, grouped by the signature label their anchor carries.
     *
     * ⚠ **Every party, not just the driver** — and the test taught that. Counting driver placements
     * alone expected 2 `Signature` lines on page 31 where the paper has 3, because the third is the
     * WITNESS's. The paper does not know who a line belongs to; it has lines, and the inventory
     * claims all of them.
     *
     * ⚠ And the needle is the piece that actually names a signature, not the anchor's first cell:
     * page 3 reads `Date | Signature`, and counting occurrences of "Date" would compare against a
     * word the packet prints on nearly every page.
     */
    const claims = new Map<string, { page: number; needle: string; n: number }>();
    for (const p of PACKET_PLACEMENTS) {
      const needle = p.anchor
        .split("|")
        .map((piece) => flat(piece))
        .filter((piece) => /signat/i.test(piece))
        .sort((a, b) => b.length - a.length)[0];
      if (!needle) continue;
      const key = `${p.page}|${needle}`;
      const seen = claims.get(key) ?? { page: p.page, needle, n: 0 };
      claims.set(key, { ...seen, n: seen.n + 1 });
    }
    for (const { page, needle, n } of claims.values()) {
      const hits = flat(textOf(page)).split(needle).length - 1;
      expect(hits, `p${page} "${needle}"`).toBe(n);
    }
  });

  /** ⚠ D-PKT12's finding, read off the paper: page 19 really does carry its heading twice. */
  it("finds page 19's heading twice, which is why it holds two driver signatures", () => {
    const hits = flat(textOf(19)).match(/AUTHORIZATION FOR DRIVING RECORD CHECK/g) ?? [];
    expect(hits).toHaveLength(2);
  });

  /** ⚠ The carrier's own spelling, on the three pages that use it. A grep for "signature" misses them. */
  it("keeps the carrier's `signatrure` where the carrier put it", () => {
    expect(textOf(22)).toContain("signatrure");
  });
});

/**
 * The pages §2.4 excludes, checked for the thing that would prove the exclusion wrong.
 *
 * ⚠ This is the scan that found p17, written down. It cannot prove a classification correct — no
 * test can — but it can fail when an excluded page turns out to carry the applicant's own
 * certification, which is exactly how p17 was caught after two classifications had missed it.
 */
describe("the excluded pages still read as somebody else's", () => {
  it("page 14 is the request the CARRIER sends, not a page the applicant signs", () => {
    const t = flat(textOf(14));
    expect(t).toContain("Sent to");
    expect(t).toContain("Person providing information");
    // The applicant's own signature line is what would make this theirs. It is not there.
    expect(t).not.toContain("Signature of applicant");
  });

  it("page 17's bottom half is the carrier's interview record", () => {
    const t = flat(textOf(17));
    expect(t).toContain("INTERVIEW NOTES");
    // ⚠ And its TOP half is the applicant's, which is D-PKT12 and why the page is not excluded.
    expect(t).toContain("Signature of applicant");
  });

  it("page 21 is the Seven Day Work Statement that left under D-PKT7", () => {
    expect(flat(textOf(21))).toMatch(/seven|7 day|last relieved/i);
  });
});

/**
 * The coordinate system, proved at both ends of the sheet.
 *
 * ⚠ **Landmarks, not arithmetic.** `pageY = 792 − 0.75·y` is easy to write down and easy to get
 * backwards, and a y-flip that is inverted still produces numbers inside the page — so what is
 * asserted is that things known to be at the TOP of the carrier's paper come out near 792 and things
 * known to be at the BOTTOM come out near 0. An inverted transform fails both.
 */
describe("the page coordinate system", () => {
  const p1 = pages[0]!;
  const find = (needle: string): number => {
    const run = p1.runs.find((r) => r.text.includes(needle));
    expect(run, needle).toBeDefined();
    return run!.y;
  };

  it("puts the letterhead at the top of the page and the footer at the bottom", () => {
    // Both occur exactly once on page 1, which is what makes them usable as landmarks at all.
    const letterhead = find("SILVICOM INC");
    const disclaimer = find("THIS IS NOT AN EMPLOYMENT");

    expect(letterhead).toBeGreaterThan(700);
    expect(disclaimer).toBeLessThan(100);
    // An inverted flip still yields numbers inside the page; only the ORDER catches it.
    expect(disclaimer).toBeLessThan(letterhead);
  });

  /**
   * ⚠ The line that misled the earlier note, pinned so the next reader meets the fact rather than
   * re-deriving it: page 1 prints `FOR DEPARTMENT OF TRANSPORTATION` twice, top and bottom.
   */
  it("prints the department line twice on page 1 — a sub-header and a footer", () => {
    const ys = p1.runs
      .filter((r) => r.text.includes("FOR DEPARTMENT OF TRANSPORTATION"))
      .map((r) => r.y)
      .sort((a, b) => a - b);
    expect(ys).toHaveLength(2);
    expect(ys[0]).toBeLessThan(100);
    expect(ys[1]).toBeGreaterThan(600);
  });

  it("keeps every page's content inside the page box", () => {
    for (const page of pages) {
      for (const run of page.runs) {
        expect(run.y, `p${page.page} "${run.text.slice(0, 20)}"`).toBeGreaterThanOrEqual(0);
        expect(run.y, `p${page.page} "${run.text.slice(0, 20)}"`).toBeLessThanOrEqual(page.height);
        expect(run.x, `p${page.page} x`).toBeGreaterThanOrEqual(0);
        expect(run.x, `p${page.page} x`).toBeLessThanOrEqual(page.width);
      }
    }
  });

  /**
   * ⚠ The rules are what the overlay draws onto, so their geometry has to survive the flip. A
   * horizontal line in the source is still horizontal here — only `d` is negative, so y mirrors and
   * x scales — and a rule whose ends disagree in y would mean the transform had been applied to one
   * end and not the other.
   */
  it("keeps the ruled lines horizontal and on the page", () => {
    const horizontal = pages.flatMap((p) => p.rules).filter((r) => Math.abs(r.y1 - r.y2) < 0.01);
    expect(horizontal.length).toBeGreaterThan(200);
    for (const rule of horizontal) {
      expect(rule.y1).toBeGreaterThanOrEqual(0);
      expect(rule.y1).toBeLessThanOrEqual(792);
    }
  });
});
