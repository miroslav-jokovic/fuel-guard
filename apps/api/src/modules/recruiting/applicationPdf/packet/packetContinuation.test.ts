import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendContinuationSheet, continuationNoticeFor } from "./packetContinuation.js";
import { PACKET_TEMPLATE_PATH, pageText, readPacketTemplate } from "./packetTemplate.js";
import { renderPacketOverlay } from "./packetOverlay.js";
import type { PacketFieldOverflow } from "./packetGrid.js";

/**
 * The continuation sheet (Q-PKT10, answered 2026-09-14).
 *
 * ⚠ **What this has to hold still is that nothing is LOST.** §391.21(b)(7) asks for every accident in
 * the preceding three years and (b)(8) for every conviction other than parking; the carrier's grids
 * hold three of each. A form that drew three and dropped the fourth would be signed, filed and
 * materially false, and it would look exactly like a correct one.
 */

const block = (over: Partial<PacketFieldOverflow> = {}): PacketFieldOverflow => ({
  tableId: "p02.convictions",
  label: "TRAFFIC CONVICTIONS AND FORFEITTURES FOR THE PAST 3 YEARS",
  columns: ["DATE CONVICTED", "VIOLATION", "STATE OF VIOLATION", "PENALTY"],
  page: 2,
  rows: [["2023-04-08", "Speeding 14 over", "IL", "$200 fine"]],
  ...over,
});

/**
 * The produced document, read back with the same reader that measured the blank one —
 * `packetOverlay.test.ts`'s helper, and for its reason: `streamOf` yielding only the first stream of
 * a multi-stream page made a page read back completely empty once, which is indistinguishable from
 * a renderer that drew nothing.
 */
async function readBack(pdf: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "packet-continuation-"));
  const path = join(dir, "packet.pdf");
  await writeFile(path, pdf);
  return readPacketTemplate(path);
}

describe("the sheet itself", () => {
  /**
   * ⚠ **Nothing is added when nothing overflowed**, which is the ordinary case. A packet that grew a
   * blank "continuation sheet" every time would be 32 pages of which one says nothing.
   */
  it("adds no page at all when there is no overflow", async () => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    const before = doc.getPageCount();
    expect(await appendContinuationSheet(doc, { overflow: [], applicantName: "Marija Varmeda" })).toBe(0);
    expect(doc.getPageCount()).toBe(before);
  });

  it("adds no page for a block that carries no rows", async () => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    const before = doc.getPageCount();
    const added = await appendContinuationSheet(doc, {
      overflow: [block({ rows: [] })],
      applicantName: "Marija Varmeda",
    });
    expect(added).toBe(0);
    expect(doc.getPageCount()).toBe(before);
  });

  /**
   * ⚠ **APPENDED, never inserted.** `packetMarkGeometry.ts` records the carrier's FOOTER page number
   * and `packetOverlay.ts` uses it as the PDF index, so a sheet inserted after page 2 would move
   * nineteen of the driver's twenty-two signatures onto the wrong pages. This asserts the carrier's
   * own 31 are still where they were.
   */
  it("appends after the carrier's last page and leaves all 31 of theirs in place", async () => {
    const original = await readPacketTemplate();
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    await appendContinuationSheet(doc, { overflow: [block()], applicantName: "Marija Varmeda" });
    const pages = await readBack(Buffer.from(await doc.save()));

    expect(pages).toHaveLength(32);
    for (const n of [1, 2, 11, 12, 19, 22, 31]) {
      expect(pageText(pages[n - 1]!), `page ${n}`).toBe(pageText(original[n - 1]!));
    }
  });

  it("carries every overflowed row onto the sheet, not just the first", async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => [`2023-0${n}-08`, `OFFENCE${n}`, "IL", `$${n}00 fine`]);
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    await appendContinuationSheet(doc, { overflow: [block({ rows })], applicantName: "Marija Varmeda" });
    const sheet = pageText((await readBack(Buffer.from(await doc.save())))[31]!);
    for (const n of [1, 2, 3, 4, 5]) expect(sheet, `OFFENCE${n}`).toContain(`OFFENCE${n}`);
  });

  /** ⚠ The carrier's own words, so a reader can line the sheet up against the page it continues. */
  it("heads each block with the carrier's own heading and column names, and the page it continues", async () => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    await appendContinuationSheet(doc, { overflow: [block()], applicantName: "Marija Varmeda" });
    const sheet = pageText((await readBack(Buffer.from(await doc.save())))[31]!);
    expect(sheet).toContain("TRAFFIC CONVICTIONS AND FORFEITTURES");
    expect(sheet).toContain("continued from page 2");
    expect(sheet).toContain("DATE CONVICTED");
    expect(sheet).toContain("PENALTY");
  });

  it("names the applicant, so a sheet separated from the packet can be put back", async () => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    await appendContinuationSheet(doc, { overflow: [block()], applicantName: "Marija Ana Varmeda" });
    const sheet = pageText((await readBack(Buffer.from(await doc.save())))[31]!);
    expect(sheet).toContain("CONTINUATION SHEET");
    expect(sheet).toContain("Marija Ana Varmeda");
  });

  /**
   * ⚠ **A long row runs onto a second sheet rather than off the bottom of the first.** The employment
   * log can overflow by twelve, and a renderer that wrote past the margin would lose exactly the
   * entries the sheet exists to keep.
   */
  it("starts a second sheet rather than writing off the bottom of the first", async () => {
    const rows = Array.from({ length: 70 }, (_, i) => [`2020-01-${String(i % 28 + 1).padStart(2, "0")}`, `ROW${i}`, "IL", "$100"]);
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    const added = await appendContinuationSheet(doc, { overflow: [block({ rows })], applicantName: "M V" });
    expect(added).toBeGreaterThan(1);
    const pages = await readBack(Buffer.from(await doc.save()));
    const all = pages.slice(31).map((p) => pageText(p)).join(" ");
    for (const i of [0, 30, 69]) expect(all, `ROW${i}`).toContain(`ROW${i}`);
  });

  /**
   * ⚠ A block whose rows carry MORE cells than its headings drew its last value off the right edge
   * of the paper once — `p02.experience`, whose `DATES FROM / TO` is one bordered column holding two
   * captions. The column width is taken from the longest row as well as from the heading list.
   */
  it("keeps a row with more cells than headings inside the page's margins", async () => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    await appendContinuationSheet(doc, {
      overflow: [block({ columns: ["A", "B"], rows: [["one", "two", "three", "MILES999"]] })],
      applicantName: "M V",
    });
    const sheet = (await readBack(Buffer.from(await doc.save())))[31]!;
    expect(pageText(sheet)).toContain("MILES999");
    /**
     * ⚠ **Asserted on the run's POSITION, not on the text.** A value drawn past the right edge is
     * still in the content stream and still extracts, so "the sheet contains MILES999" passed with
     * the width guard removed and proved nothing — the string was on the page in the sense that
     * mattered to the reader and off it in the sense that mattered to the applicant.
     */
    for (const run of sheet.runs) {
      expect(run.x, `${JSON.stringify(run.text)} at x=${run.x}`).toBeLessThan(554);
    }
  });
});

describe("the notice on the grid that continues", () => {
  /**
   * ⚠ Without it the sheet is a place the answer was HIDDEN rather than continued: a page-2
   * conviction grid showing three rows is a page that misleads anybody who stops reading there.
   */
  it("counts what is on the sheet, in words that point at it", () => {
    expect(continuationNoticeFor(block())).toMatch(/^1 more entry is on the continuation sheet/);
    expect(continuationNoticeFor(block({ rows: [["a"], ["b"], ["c"]] })))
      .toMatch(/^3 more entries are on the continuation sheet/);
  });

  it("is drawn on the carrier's own page, under the grid it belongs to", async () => {
    const pdf = await renderPacketOverlay({
      marks: [],
      fields: [],
      overflow: [block({ rows: [["a", "b", "c", "d"], ["e", "f", "g", "h"]] })],
      applicantName: "Marija Varmeda",
    });
    const pages = await readBack(pdf);
    expect(pageText(pages[1]!)).toContain("2 more entries are on the continuation sheet");
    // ⚠ On page 2 and nowhere else — the notice belongs to one grid.
    expect(pageText(pages[0]!)).not.toContain("continuation sheet");
    expect(pageText(pages[11]!)).not.toContain("continuation sheet");
  });

  it("draws no notice and appends nothing when the caller passes no overflow", async () => {
    const pdf = await renderPacketOverlay({ marks: [], fields: [] });
    const pages = await readBack(pdf);
    expect(pages).toHaveLength(31);
    for (const p of pages) expect(pageText(p)).not.toContain("continuation sheet");
  });
});
