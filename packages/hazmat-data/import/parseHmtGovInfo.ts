/**
 * §172.101 HMT parser — official GovInfo source (Phase H1, D5 v7 — the automated second source).
 *
 * Turns the OFFICIAL GovInfo annual-edition CFR XML (captured by `captureGovInfo.ts` into
 * import/fixtures/govinfo/hmt-172-101.xml) into `HmtEntry[]`, using the SAME shared assembly
 * (import/hmtAssemble.ts) as the eCFR parser. Only the extraction differs: GovInfo uses the GPO DTD
 * (`<GPOTABLE>/<ROW>/<ENT>`) instead of eCFR's processed HTML (`<TABLE>/<TR>/<TD>`).
 *
 * VERIFIED against the real captured fixture (CFR-2025-title49-vol2-sec172-101, edition 2025-10-01):
 *   - The HMT is the single `<GPOTABLE COLS="14">` titled "§ 172.101 Hazardous Materials Table"; the
 *     other GPOTABLEs in the granule are the Label Substitution Table, the solid/liquid packaging table,
 *     and the Appendix A/B tables. We pick by header signature, exactly like the eCFR parser.
 *   - The 14 columns are in the SAME order as eCFR (Symbols, PSN, Class, ID, PG, Label, Special
 *     provisions, 8A/8B/8C, 9A/9B, 10A/10B) and the PSN column uses the SAME `<E T="03">` italic
 *     convention — so once tokenized into 14 cells the shared assembly is identical.
 *   - GPO OMITS trailing empty cells (a row can have 2, 3, 13 or 14 `<ENT>`), keeps middle empties as
 *     `<ENT> </ENT>`, and self-closes empties as `<ENT/>` / `<ENT O="xl"/>`. So we tokenize left-aligned
 *     and PAD to 14; a "see" cross-reference row (2 cells: empty symbols + italic PSN) pads to a row with
 *     no valid ID and is dropped by the shared assembly, exactly as eCFR drops its ID-less rows.
 */

import { assembleHmtEntries, stripTags, type Cell } from "./hmtAssemble.js";
import type { HmtEntry } from "../src/schema.js";

const HMT_COLS = 14;

/** Pick the §172.101 HMT GPOTABLE by the same header signature the eCFR parser uses. */
function extractHmtGpoTable(xml: string): string {
  const tables = xml.match(/<GPOTABLE\b[^>]*>[\s\S]*?<\/GPOTABLE>/gi) ?? [];
  const matches = tables.filter((t) => {
    const header = stripTags(t.slice(0, 6000)).toLowerCase();
    return header.includes("hazardous materials descriptions") && header.includes("identification numbers");
  });
  if (matches.length === 0) {
    throw new Error(
      "parseHmtGovInfoSection: no <GPOTABLE> carries the HMT header signature " +
        "('Hazardous materials descriptions' + 'Identification Numbers'). Wrong granule or GPO markup drift.",
    );
  }
  if (matches.length > 1) {
    throw new Error(`parseHmtGovInfoSection: expected exactly one HMT GPOTABLE, found ${matches.length}.`);
  }
  return matches[0] as string;
}

/** Tokenize a <ROW> into its <ENT> cells, handling `<ENT/>` self-closing and `<ENT ...>text</ENT>`. */
function entCellsOf(rowInner: string): Cell[] {
  const out: Cell[] = [];
  for (const m of rowInner.matchAll(/<ENT\b[^>]*?(?:\/>|>([\s\S]*?)<\/ENT>)/gi)) {
    const inner = m[1] ?? "";
    out.push({ text: stripTags(inner), inner });
  }
  return out;
}

/**
 * Parse the official GovInfo §172.101 XML into validated `HmtEntry[]` — the D5 v7 automated second
 * source. Same output type + semantics as `parseHmtSection`, so the two can be diffed row-by-row.
 */
export function parseHmtGovInfoSection(xml: string): HmtEntry[] {
  const table = extractHmtGpoTable(xml);
  const rows: Cell[][] = [];
  for (const m of table.matchAll(/<ROW\b[^>]*>([\s\S]*?)<\/ROW>/gi)) {
    const cells = entCellsOf(m[1] ?? "");
    if (cells.length === 0 || cells.length > HMT_COLS) continue; // not a data/continuation row
    while (cells.length < HMT_COLS) cells.push({ text: "", inner: "" }); // pad GPO's trailing-omitted cells
    rows.push(cells);
  }
  return assembleHmtEntries(rows);
}
