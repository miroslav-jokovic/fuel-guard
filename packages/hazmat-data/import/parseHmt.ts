/**
 * §172.101 HMT parser — eCFR source (Phase H1, deliverable 2 — the parse half).
 *
 * Turns the raw eCFR §172.101 "processed" XML (fetched by `EcfrClient.getFullXml`, captured by
 * `captureFixtures.ts`) into `HmtEntry[]`. This is the single hardest table in the regulation, and a
 * mis-parse is a WRONG VERDICT — so it is built against a CAPTURED REAL FIXTURE and frozen with
 * hand-verified expectations (see parseHmt.test.ts), never against a guessed XML structure.
 *
 * This file is now ONLY the eCFR-format extraction layer: pick the HMT <TABLE>, tokenize each 14-<TD>
 * data row into cells, and hand them to the shared `assembleHmtEntries` (import/hmtAssemble.ts), which
 * holds the §172.101(c) regulation semantics shared with the official GovInfo parser (parseHmtGovInfo.ts).
 *
 * WHAT THE REAL eCFR "processed" XML actually is (verified against the captured
 * import/fixtures/section-172-101.xml, eCFR date 2026-07-28):
 *   - The section contains 6 HTML <TABLE>s. The HMT is the LARGEST (≈3,689 <TR>); the others are the
 *     two (c)(11) notes tables, Appendix A (haz-substances), the ERG-ID note, and Appendix B (marine
 *     pollutants). We pick the table with the most rows and assert a header signature before trusting it.
 *   - Two header <TR> (10 + 7 cells). Every DATA row has EXACTLY 14 <TD> and NO rowspan/colspan — eCFR
 *     FLATTENS the printed multi-PG entries: a PSN that spans PG I/II/III becomes one "lead" row (with
 *     symbols/PSN/class/ID filled) followed by continuation rows whose symbols/PSN/class/ID are BLANK
 *     and only the PG + downstream columns differ. (Grouping handled by assembleHmtEntries.)
 *   - The 14 columns, in order: (0) Symbols, (1) PSN, (2) Hazard class, (3) ID number, (4) PG,
 *     (5) Label codes, (6) Special provisions, (7) 8A packaging-exceptions, (8) 8B non-bulk,
 *     (9) 8C bulk, (10) 9A passenger-aircraft/rail, (11) 9B cargo-aircraft, (12) 10A vessel location,
 *     (13) 10B vessel other.
 */

import { assembleHmtEntries, stripTags, type Cell } from "./hmtAssemble.js";
import type { HmtEntry } from "../src/schema.js";

/** Pick the HMT table: the <TABLE> with the most <TR>, then confirm its header signature. */
function extractHmtTable(xml: string): string {
  const tables = xml.match(/<TABLE\b[^>]*>[\s\S]*?<\/TABLE>/gi) ?? [];
  let best: string | null = null;
  let bestRows = -1;
  for (const t of tables) {
    const rows = (t.match(/<TR\b/gi) ?? []).length;
    if (rows > bestRows) {
      bestRows = rows;
      best = t;
    }
  }
  if (!best) {
    throw new Error("parseHmtSection: no <TABLE> found in the §172.101 XML — wrong input or markup drift.");
  }
  const header = stripTags(best.slice(0, 6000)).toLowerCase();
  if (!header.includes("hazardous materials descriptions") || !header.includes("identification numbers")) {
    throw new Error(
      "parseHmtSection: the largest table does not carry the HMT header signature " +
        "('Hazardous materials descriptions' + 'Identification Numbers'). Refusing to parse the wrong table.",
    );
  }
  return best;
}

function cellsOf(trInner: string): Cell[] {
  const out: Cell[] = [];
  for (const m of trInner.matchAll(/<TD\b[^>]*>([\s\S]*?)<\/TD>/gi)) {
    const inner = m[1] ?? "";
    out.push({ text: stripTags(inner), inner });
  }
  return out;
}

/**
 * Parse the raw eCFR §172.101 XML into validated `HmtEntry[]`. Each entry is run through
 * `hmtEntrySchema` inside `assembleHmtEntries`, so the return value is the engine's data boundary.
 */
export function parseHmtSection(xml: string): HmtEntry[] {
  const table = extractHmtTable(xml);
  const rows: Cell[][] = [];
  for (const m of table.matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/gi)) {
    const cells = cellsOf(m[1] ?? "");
    if (cells.length !== 14) continue; // header rows (10/7 cells) or malformed — never a data row
    rows.push(cells);
  }
  return assembleHmtEntries(rows);
}
