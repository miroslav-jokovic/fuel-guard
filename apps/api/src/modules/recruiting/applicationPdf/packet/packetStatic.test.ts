import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import { STATIC_PAGES } from "./packetStatic.js";
import { CORRECTIONS, correct } from "./packetText.js";

/**
 * The static pages, checked against the workbook they came from (P3).
 *
 * ── WHY THIS TEST EXISTS AT ALL ───────────────────────────────────────────────────────────────
 * The owner chose to transcribe 128 lines of the carrier's policy and contract text rather than wait
 * for a supplied PDF. The weakness of that choice is exactly one thing: counsel would then be
 * reviewing an engineer's typing instead of the carrier's document. This test removes that weakness
 * by re-reading `APPLICATION.xlsx` at test time and comparing — so a transcription drift fails the
 * build rather than reaching a signed page.
 *
 * ⚠ **It reads the .xlsx with no dependency.** A workbook is a zip of XML; the two entries this needs
 * are found by scanning for local file headers and inflated with `zlib.inflateRawSync`. Reaching for
 * `jszip` would mean depending on a package that is present only because something else hoisted it,
 * which is how a test starts failing on a machine that resolved differently.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKBOOK = join(HERE, "../../../../../../../docs/plans/recruitment/APPLICATION.xlsx");

/** One entry out of a zip, by name. Returns null when the archive does not hold it. */
function zipEntry(archive: Buffer, name: string): Buffer | null {
  for (let i = 0; i < archive.length - 30; i++) {
    if (archive.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLen = archive.readUInt16LE(i + 26);
    if (archive.subarray(i + 30, i + 30 + nameLen).toString() !== name) continue;
    const method = archive.readUInt16LE(i + 8);
    const compressed = archive.readUInt32LE(i + 18);
    const start = i + 30 + nameLen + archive.readUInt16LE(i + 28);
    const raw = archive.subarray(start, start + compressed);
    return method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
  }
  return null;
}

/**
 * The workbook's rows as text, in the same normalisation `packetStatic.ts` was generated with: the
 * spreadsheet's dot-leaders and column padding collapsed, because those are Excel's geometry rather
 * than the carrier's words.
 */
function workbookLines(): string[] {
  const archive = readFileSync(WORKBOOK);
  const strings = (zipEntry(archive, "xl/sharedStrings.xml") ?? Buffer.alloc(0)).toString("utf8");
  const sheet = (zipEntry(archive, "xl/worksheets/sheet1.xml") ?? Buffer.alloc(0)).toString("utf8");

  const shared: string[] = [];
  for (const si of strings.split("<si>").slice(1)) {
    shared.push(
      [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((m) => m[1] ?? "")
        .join("")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    );
  }

  const out: string[] = [];
  for (const row of sheet.split("<row ").slice(1)) {
    const values: string[] = [];
    for (const cell of row.split("<c ").slice(1)) {
      const v = /<v>([\s\S]*?)<\/v>/.exec(cell);
      if (!v?.[1]) continue;
      values.push(/t="s"/.test(cell) ? (shared[Number(v[1])] ?? "") : v[1]);
    }
    if (values.length > 0) out.push(values.join(" | "));
  }
  return out;
}

/** Applied to every line on both sides — the generator did the same. */
const normalise = (s: string): string => s.replace(/\.{3,}/g, " ").replace(/\s+/g, " ").trim();

describe("the static packet pages", () => {
  const lines = workbookLines().map(normalise);

  it("can read the workbook at all", () => {
    // Guards the guard: an unreadable archive would make every comparison below vacuously true.
    expect(lines.length).toBeGreaterThan(700);
    expect(lines.some((l) => l.includes("THIS IS NOT AN EMPLOYMENT APPLICATION"))).toBe(true);
  });

  it("covers the four pages the plan classifies as STATIC", () => {
    expect(STATIC_PAGES.map((p) => p.page)).toEqual([7, 8, 29, 30]);
  });

  /**
   * ⚠ The pin for Q-PKT5. Page 24 was in this pack for one day on a classification nobody could
   * test: `DRIVER SAFETY TRAINING` reads as policy text and is a post-hire training record with a
   * driver signature, an instructor signature and a fill-in date on it. A pack filed once per version
   * can never carry anybody's mark, so those were three signature lines drawn as inert labels.
   *
   * Asserted rather than just deleted, because the mistake is re-makeable: the page LOOKS static, and
   * the next person extending this pack from the workbook will meet it again.
   */
  it("does not carry page 24 — it is a post-hire training record, not policy text (Q-PKT5)", () => {
    expect(STATIC_PAGES.some((p) => p.page === 24)).toBe(false);
    const all = STATIC_PAGES.flatMap((p) => [p.heading, ...p.body]).join(" ");
    expect(all).not.toContain("DRIVER SAFETY TRAINING");
    // The three marks that gave it away. None of them may reach a document nobody signs.
    expect(all).not.toContain("Driver signatrure");
    expect(all).not.toContain("Instructor's signatrure");
    expect(all).not.toContain("I have completed training");
  });

  it("registers no correction against page 24 either — the page and its typos left together", () => {
    expect(CORRECTIONS.filter((c) => c.page === 24)).toEqual([]);
  });

  /**
   * ⚠ The assertion this file exists for. Every transcribed line must appear in the workbook, which is
   * what makes "we transcribed the carrier's document" a checkable claim rather than an assurance.
   *
   * Compared as SUBSTRINGS of a normalised row: a spreadsheet row is cells joined by a separator, and
   * a body line is one cell out of it.
   */
  it("every transcribed line is really in the carrier's workbook", () => {
    const haystack = lines.join("\n");
    const missing: string[] = [];
    for (const page of STATIC_PAGES) {
      for (const bodyLine of [page.heading, ...page.body]) {
        if (!haystack.includes(bodyLine)) missing.push(`p${page.page}: ${bodyLine.slice(0, 60)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("transcribes every line of those pages — nothing was skipped", () => {
    // 101 lines are extracted; a transcription that quietly dropped a clause would still pass the
    // assertion above, because everything remaining would still be found in the source.
    // ⚠ It was 128 while page 24 was in the pack (Q-PKT5, 2026-08-23) — 27 of those lines left with it.
    const total = STATIC_PAGES.reduce((n, p) => n + p.body.length + 1, 0);
    expect(total).toBe(101);
  });

  /**
   * ⚠ Pages 29–30 are the Owner Operator & Leased Driver Agreement — a contract the driver signs on
   * page 31 — and its corruption is not spelling. `shall not he appeasable`, `one arbitration`,
   * `select a natural arbitrator`, and a severability clause missing its middle are all places where
   * choosing the intended word is DRAFTING. The register must never reach them, and this is the pin.
   */
  it("registers no correction against the agreement pages", () => {
    expect(CORRECTIONS.filter((c) => c.page === 29 || c.page === 30)).toEqual([]);
  });

  it("leaves the agreement's own defects intact, so counsel sees what the carrier wrote", () => {
    const agreement = STATIC_PAGES.filter((p) => p.page === 29 || p.page === 30)
      .flatMap((p) => p.body)
      .join(" ");
    // Reproduced, not repaired — and asserted, so a well-meaning tidy-up fails here.
    expect(correct(agreement)).toContain("shall not he appeasable");
    expect(correct(agreement)).toContain("select a natural arbitrator");
  });

  it("does spell-correct the policy pages", () => {
    const policy = STATIC_PAGES.filter((p) => [7, 8].includes(p.page))
      .flatMap((p) => p.body)
      .join(" ");
    expect(policy).toContain("OVERWIGHT");
    expect(correct(policy)).not.toContain("OVERWIGHT");
    expect(correct(policy)).toContain("OVERWEIGHT");
  });
});
