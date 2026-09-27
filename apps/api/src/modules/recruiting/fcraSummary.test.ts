import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { FCRA_SUMMARY, FCRA_SUMMARY_VERSION } from "./fcraSummary.js";

/**
 * The FCRA summary, checked against the Bureau's form it was transcribed from — `pspDisclosure.test.ts`'s
 * bar, for `fcraSummary.ts`'s reason: "substantially similar to the Bureau's model summary" is only
 * provably met by reproducing it, so a dropped or reworded clause has to fail the build.
 *
 * The source is `docs/plans/recruitment/fcra-summary/` — the downloaded PDF and its `pdftotext -layout`
 * extraction, committed so this works offline and a reader can hold the two side by side.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM = join(HERE, "../../../../../docs/plans/recruitment/fcra-summary/bcfp_consumer-rights-summary_2018-09.txt");
const raw = readFileSync(FORM, "utf8");

/** Where the two-column contact table starts; everything above it is prose. */
const tableAt = raw.indexOf("TYPE OF BUSINESS:");
/**
 * A page number: right-aligned, so far indented. ⚠ Not "any line that is only digits" — the table's
 * "1921" (the Packers and Stockyards Act's year) is one of those, flush left, and it is the form's.
 */
const isPageNumber = (line: string): boolean => /^\s{40,}\d+\s*$/.test(line);
/**
 * The prose with the PDF's geometry taken out: page numbers dropped (two paragraphs straddle a page
 * break, and "1"/"2" land in the middle of them), then every run of whitespace collapsed.
 */
const flatten = (s: string): string => s.replace(/\s+/g, " ").trim();
const prose = flatten(
  raw.slice(0, tableAt).split("\n").filter((line) => !isPageNumber(line)).join("\n"),
);

/**
 * The table's two columns. The layout extraction keeps the PDF's columns at fixed offsets; the right
 * one starts at the same character on every row, measured off the header row's first data line.
 */
const tableLines = raw.slice(tableAt).split("\n").slice(1).filter((line) => !isPageNumber(line));
const COLUMN = tableLines[0]!.indexOf("a. Consumer Financial Protection Bureau");
const businessColumn = flatten(tableLines.map((l) => l.slice(0, COLUMN)).join("\n"));
const contactLines = tableLines.map((l) => l.slice(COLUMN).trim()).filter(Boolean);

describe("the transcription", () => {
  it("can read the committed form at all", () => {
    // Guards the guard: an unreadable file or a mis-measured column makes every check below vacuous.
    expect(prose.length).toBeGreaterThan(5_000);
    expect(tableAt).toBeGreaterThan(0);
    expect(COLUMN).toBeGreaterThan(40);
    expect(contactLines.length).toBeGreaterThan(40);
  });

  it("reproduces the title, the Spanish note, the introduction and the closing", () => {
    expect(prose).toContain(FCRA_SUMMARY.title);
    expect(prose).toContain(FCRA_SUMMARY.spanishNote);
    for (const p of FCRA_SUMMARY.intro) expect(prose).toContain(p);
    expect(prose).toContain(FCRA_SUMMARY.closing);
  });

  /** ⚠ The assertion this file exists for: every right, its heading and every block, in the form. */
  it("reproduces every right, paragraph and list item of the form", () => {
    const missing: string[] = [];
    for (const right of FCRA_SUMMARY.rights) {
      if (!prose.includes(right.heading)) missing.push(right.heading);
      for (const block of right.blocks) {
        for (const text of typeof block === "string" ? [block] : block) {
          if (!prose.includes(text)) missing.push(text);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps the rights in the form's order", () => {
    const at = FCRA_SUMMARY.rights.map((r) => prose.indexOf(r.heading));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("reproduces every regulator in the contact table, both columns", () => {
    const missing: string[] = [];
    for (const row of FCRA_SUMMARY.contacts) {
      if (!businessColumn.includes(row.business)) missing.push(row.business);
      for (const line of row.contact) if (!contactLines.includes(line)) missing.push(line);
    }
    expect(missing).toEqual([]);
  });

  it("counts what it carries — a deletion passes every containment check above", () => {
    // Whatever REMAINS after a dropped clause is still found in the source, so only counts see it.
    expect(FCRA_SUMMARY.rights).toHaveLength(12);
    const blocks = FCRA_SUMMARY.rights.flatMap((r) => r.blocks);
    expect(blocks.filter((b) => typeof b === "string")).toHaveLength(16);
    expect(blocks.filter((b) => typeof b !== "string").flat()).toHaveLength(5);
    expect(FCRA_SUMMARY.contacts).toHaveLength(13);
    expect(FCRA_SUMMARY.contacts.flatMap((c) => c.contact)).toHaveLength(contactLines.length);
  });

  it("is the current form: both of 88 FR 58065's corrections are in it", () => {
    expect(prose).toContain("You may opt out with the nationwide credit bureaus at 1-888-567-8688.");
    expect(FCRA_SUMMARY.contacts.flatMap((c) => c.contact)).toContain(
      "Assistant General Counsel for Office of Aviation Consumer Protection",
    );
  });
});

describe("the version", () => {
  /**
   * `application_intakes.fcra_summary_version` says which text an applicant was shown, so the text and
   * the version move together. Editing any word here changes the hash; the fix is a new version (and a
   * new hash), never a new hash under the old version.
   */
  it("names exactly this text", () => {
    const { version: _version, ...text } = FCRA_SUMMARY;
    const hash = createHash("sha256").update(JSON.stringify(text)).digest("hex").slice(0, 16);
    expect({ version: FCRA_SUMMARY_VERSION, hash }).toEqual({
      version: "cfpb-appendix-k-2023-09-25",
      hash: "af32f0daae01aa42",
    });
  });
});
