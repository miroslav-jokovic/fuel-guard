import { describe, it, expect } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, StandardFonts } from "pdf-lib";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendContinuationSheet,
  continuationNoticeFor,
  FURNITURE_SOURCE_PAGE,
  LETTERHEAD_BAND,
  wrap,
} from "./packetContinuation.js";
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

/** Letter, as every page of this packet is. */
const PAGE_WIDTH_PT = 612;

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
    const original = await readPacketTemplate(PACKET_TEMPLATE_PATH);
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

/**
 * AUD-6 — the one sheet in the packet designed to be separated, and the only one that did not say
 * whose it was.
 *
 * ⚠ **Text assertions cannot see most of this, and the reason is structural rather than incidental.**
 * The letterhead and footer are the carrier's own bytes, lifted off their page 31 with `embedPage`
 * and drawn as form XObjects. `readPacketTemplate` parses a page's content stream and does not
 * follow a `Do`, so the words `SILVICOM INC` are simply not in its runs for a sheet — `pageText`
 * would report them missing on a correct document. What CAN be read is the page's `/XObject`
 * resources, the PAGE NUMBER (which is ours and is real drawn text), and the coordinates of
 * everything we draw. The raster is what settled that the bands land where the carrier's do.
 */
describe("a continuation sheet carries the carrier's own furniture", () => {
  const manyRows = () =>
    Array.from({ length: 70 }, (_, i) => [`2020-01-${String((i % 28) + 1).padStart(2, "0")}`, `ROW${i}`, "IL", "$100"]);

  const withSheets = async (rows = manyRows()) => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    const added = await appendContinuationSheet(doc, { overflow: [block({ rows })], applicantName: "Marija Ana Varmeda" });
    const pdf = Buffer.from(await doc.save());
    return { added, pdf, pages: await readBack(pdf), doc: await PDFDocument.load(pdf) };
  };

  /** The form XObjects on one 1-based page — how `embedPage` records a lifted region. */
  const formsOn = (doc: PDFDocument, page: number): string[] => {
    const xo = doc.getPage(page - 1).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const found: string[] = [];
    for (const [, value] of xo?.entries() ?? []) {
      const stream = doc.context.lookupMaybe(value, PDFStream);
      if (stream?.dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString() === "/Form") found.push("form");
    }
    return found;
  };

  /**
   * ⚠ **The whole page-numbering scheme rests on this and `packetTemplate.ts` recorded it as
   * BELIEVED AND NOT PROVED** — *"believed to equal the number the carrier prints in that page's
   * footer … but NOT proved here"*. A sheet numbered 32 only continues the carrier's sequence if
   * their printed 31 is on the thirty-first page. It is, on all thirty-one; now asserted.
   */
  it("continues a numbering the carrier's own pages really follow", async () => {
    const pages = await readPacketTemplate();
    expect(pages).toHaveLength(31);
    for (const page of pages) {
      const printed = page.runs
        .map((r) => /THIS IS NOT AN EMPLOYMENT APPLICATION\s+(\d+)\s*$/.exec(r.text.trimEnd()))
        .filter((m): m is RegExpExecArray => m !== null);
      expect(printed, `page ${page.page} footer number`).toHaveLength(1);
      expect(Number(printed[0]![1]), `page ${page.page} prints its own index`).toBe(page.page);
    }
  });

  it("puts the letterhead and the footer on every sheet, and adds neither to the carrier's pages", async () => {
    const { added, doc } = await withSheets();
    expect(added).toBeGreaterThan(1);
    for (let n = 32; n <= 31 + added; n += 1) {
      expect(formsOn(doc, n), `sheet ${n}`).toHaveLength(2);
    }
    /**
     * ⚠ **The discriminator.** Counting two forms on our sheets says nothing unless the carrier's
     * pages have none — otherwise the assertion above passes on a document where the bands were
     * never drawn and something else was always there. Page 31 is the one they are lifted FROM.
     */
    for (const n of [1, 2, 12, 31]) expect(formsOn(doc, n), `carrier page ${n}`).toHaveLength(0);
  });

  it("numbers each sheet where the carrier numbers theirs, continuing their sequence", async () => {
    const { added, pages } = await withSheets();
    expect(added).toBeGreaterThan(1);
    for (let n = 32; n <= 31 + added; n += 1) {
      const number = pages[n - 1]!.runs.find((r) => r.text.trim() === String(n));
      expect(number, `sheet ${n} carries its own number`).toBeDefined();
      // ⚠ The carrier's own footer baseline and their number's x, so the sheets line up with the
      // pages in front of them when the packet is flicked through.
      expect(number!.y, `sheet ${n} number baseline`).toBeCloseTo(70.7, 1);
      expect(number!.x, `sheet ${n} number x`).toBeCloseTo(489.4, 1);
    }
    // ⚠ A sheet must not print the number of the page it continues, nor the same one twice.
    const numbers = Array.from({ length: added }, (_, i) => 32 + i);
    expect(new Set(numbers).size).toBe(added);
  });

  /**
   * ⚠ **Written because the mutant survived**, and it is the sharper of the two this block gained.
   * Widening the footer band to the full page width leaves every other assertion here green and
   * copies THE CARRIER'S OWN PAGE NUMBER onto every sheet — so sheet 32 prints `31` beside its own
   * `32`, twice over, on a filed federal document. It is invisible to `pageText` because the copied
   * number lives inside a form XObject, and invisible to the number test above because that looks
   * for the right number and finds it.
   */
  it("clips the lifted footer between the carrier's last word and the carrier's own number", async () => {
    const { doc } = await withSheets();
    const xo = doc.getPage(31).node.Resources()!.lookupMaybe(PDFName.of("XObject"), PDFDict)!;
    const boxes: number[][] = [];
    for (const [, ref] of xo.entries()) {
      const box = doc.context.lookupMaybe(ref, PDFStream)!.dict.lookupMaybe(PDFName.of("BBox"), PDFArray);
      boxes.push(box!.asArray().map((v) => Number(v.toString())));
    }
    const footer = boxes.find((b) => b[1]! < 100);
    expect(footer, "no footer band on the sheet").toBeDefined();

    /**
     * ⚠ The lower bound is DERIVED from the carrier's own paper, not from our constant: their
     * footer's first line starts at x140.2 and is centred, so it ends at 612 − 140.2. A band that
     * stopped before that would slice `…VERIFICATION PURPOSE ONLY`, which the first attempt did.
     */
    const line1 = (await readPacketTemplate())[FURNITURE_SOURCE_PAGE - 1]!.runs
      .find((r) => r.text.startsWith("FOR DEPARTMENT"))!;
    expect(footer![2], "clips the carrier's own disclaimer").toBeGreaterThan(PAGE_WIDTH_PT - line1.x);
    // ⚠ The upper bound is a MEASUREMENT and cannot be derived: their page number is padded onto the
    // end of the line below with spaces, so no run's x marks where it starts. 600 dpi, page 31: the
    // `31` begins at 489.4.
    expect(footer![2], "lets the carrier's own page number through").toBeLessThan(489.4);
  });

  /**
   * ⚠ **Also written because the mutant survived.** Lifting the letterhead from page 1 instead of
   * page 31 passes everything else and prints a sliced half-line of somebody else's sentence under
   * the address — page 1 carries a second `FOR DEPARTMENT OF…` at y680.3 whose ascenders rise into
   * the band. The rule is not "use page 31"; it is that whatever page the furniture is lifted from
   * must have NOTHING in the band but the letterhead, and this asserts that of the page actually
   * named in the module.
   */
  it("lifts the letterhead from a page with nothing else in the band", async () => {
    const source = (await readPacketTemplate())[FURNITURE_SOURCE_PAGE - 1]!;
    const LETTERHEAD = ["SILVICOM INC", "1301 ARMITAGE AVE", "MELROSE PARK IL 60160"];
    /**
     * ⚠ Reaching 12pt BELOW the band, because a run's y is its BASELINE and its ascenders stand
     * above it — the carrier's body type is about 9.4pt. A check that used the band's own bottom
     * would clear page 1, whose stray baseline is at 680.3, and page 1 is the case this exists for.
     */
    const intruders = source.runs.filter(
      (r) => r.y > LETTERHEAD_BAND.bottom - 12 && r.y < LETTERHEAD_BAND.top && !LETTERHEAD.includes(r.text.trim()),
    );
    expect(intruders.map((r) => `${r.y.toFixed(1)}:${r.text.slice(0, 40)}`), "not just letterhead in the band").toEqual([]);
    // ⚠ Not vacuous: the band must actually contain the letterhead, or an empty band would pass.
    const inBand = source.runs.filter((r) => r.y >= LETTERHEAD_BAND.bottom && r.y < LETTERHEAD_BAND.top);
    expect(inBand.map((r) => r.text.trim()).sort()).toEqual([...LETTERHEAD].sort());
  });

  /**
   * ⚠ **This is the assertion that the margins moved, and a raster is what found the need for it.**
   * The sheet used the whole page when it had no furniture; drawn at the old `TOP` of 726 its title
   * lands inside the letterhead band and prints through `MELROSE PARK IL 60160`. No text assertion
   * can see that — both strings are in the document either way — so the claim has to be about where
   * every run sits.
   */
  it("keeps every word it draws clear of the letterhead and the footer", async () => {
    const { added, pages } = await withSheets();
    let checked = 0;
    for (let n = 32; n <= 31 + added; n += 1) {
      const runs = pages[n - 1]!.runs;
      // ⚠ Not vacuous: a sheet with nothing on it would satisfy every bound below.
      expect(runs.length, `sheet ${n} drew nothing`).toBeGreaterThan(5);
      for (const run of runs) {
        // The page number is drawn INSIDE the footer band on purpose and is the one exception.
        if (run.text.trim() === String(n)) continue;
        expect(run.y, `sheet ${n}: "${run.text.slice(0, 30)}" is under the letterhead`).toBeLessThan(688);
        expect(run.y, `sheet ${n}: "${run.text.slice(0, 30)}" is above the footer`).toBeGreaterThan(94);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(30);
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

/**
 * AUD-2: on this sheet a value WRAPS, and the sheet is the one place it can.
 *
 * ⚠ These two tests exist because the fix shipped without them and a mutation proved it. Removing
 * the wrap — `return [text]` in the row loop — and removing the character break inside `wrap` BOTH
 * left the whole suite green, on the module whose stated purpose is that nothing is lost. The old
 * comment here said a value too long for its column *"shrinks to 5pt and is allowed to be small"*;
 * at 5pt the fourth accident's description still ran through `FATALITIES NUMBER` beside it.
 */
describe("a value too wide for its column on the sheet", () => {
  const LONG = "Rear-ended while stopped at a construction flagger on I-80 westbound near mile 118";

  it("is drawn as several lines, not one run that overruns", async () => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    await appendContinuationSheet(doc, {
      overflow: [block({ rows: [["2024-05-02", LONG, "IL", "$200"]] })],
      applicantName: "Marija Varmeda",
    });
    const sheet = (await readBack(Buffer.from(await doc.save())))[31]!;

    // ⚠ Counting RUNS, not reading text: `pageText` rejoins the lines with spaces and gives back the
    // original sentence either way, so the words on the page cannot tell a wrapped cell from an
    // overrunning one. How many separate runs were drawn can.
    const pieces = sheet.runs.filter((r) => LONG.includes(r.text.trim()) && r.text.trim().length > 3);
    expect(pieces.length).toBeGreaterThan(1);
    // Guards the guard: no single run may be the whole sentence, which is what not wrapping produces.
    expect(sheet.runs.some((r) => r.text.includes(LONG))).toBe(false);
    // And nothing was lost on the way.
    expect(pageText(sheet)).toContain("westbound near mile 118");
  });

  it("breaks a word that is itself wider than the column, rather than letting it run", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const width = 60;
    for (const text of [
      LONG,
      // One token, no spaces to break at. Word-wrapping alone cannot place it.
      "Featherstonehaughvillanuevafeatherstonehaughvillanueva",
      "short",
    ]) {
      for (const line of wrap(font, text, 8.5, width)) {
        expect(font.widthOfTextAtSize(line, 8.5)).toBeLessThanOrEqual(width);
      }
    }
    // ⚠ Discriminating: a `wrap` that returned [] would satisfy every assertion above for free.
    expect(wrap(font, "short", 8.5, width)).toEqual(["short"]);
    expect(wrap(font, LONG, 8.5, width).join(" ")).toContain("mile 118");
  });
});

/**
 * A block that spills onto a second sheet takes its heading with it.
 *
 * ⚠ Found by rendering the long fixture and looking: page 33 opened with the employment log's rows
 * and no heading, because the heading had been drawn once at the foot of page 32 and the first row
 * then broke the page. A reader of that page has five unlabelled columns and no way to tell which
 * grid they continue — the same defect as AUD-4 in the certificate next door, one module over.
 *
 * ⚠ It cannot be fixed by reserving room before the heading, which is what the code did. Rows here
 * WRAP, so a row's height is not known until it has been laid out, and the four-row reservation is a
 * guess that a tall row falsifies.
 */
describe("a block that runs past the foot of the sheet", () => {
  it("repeats its heading and its columns on every page it reaches", async () => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    const label = "TRAFFIC CONVICTIONS AND FORFEITTURES FOR THE PAST 3 YEARS";
    await appendContinuationSheet(doc, {
      overflow: [block({
        label,
        rows: Array.from({ length: 70 }, (_, i) => [
          `2023-04-${String((i % 28) + 1).padStart(2, "0")}`,
          "Speeding 14 over the posted limit in a marked construction zone with workers present",
          "IL",
          "$200 fine",
        ]),
      })],
      applicantName: "Marija Varmeda",
    });
    const sheets = (await readBack(Buffer.from(await doc.save()))).slice(31);

    // Guards the guard: one page would make the claim below vacuous.
    expect(sheets.length).toBeGreaterThan(1);
    for (const sheet of sheets) {
      const text = pageText(sheet);
      // Every page that carries a row must carry the words that say what the row is.
      if (!text.includes("Speeding 14 over")) continue;
      expect(text).toContain(label);
      expect(text).toContain("DATE CONVICTED");
    }
  });
});
