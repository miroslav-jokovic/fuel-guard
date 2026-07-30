/**
 * §177.848(d) segregation-grid parser — official GovInfo source (D5 v7 automated second source).
 *
 * GovInfo GPO counterpart of `parseSegregation.ts`, emitting the same `SegregationCell[]` so the two can
 * be diffed. Verified against import/fixtures/govinfo/segregation-177-848.xml (CFR-2025-title49-vol2,
 * edition 2025-10-01): the (d) grid is a `<GPOTABLE COLS="21">` whose `<BOXHD>` gives column labels
 * ("Class or division", blank, "Notes", then the 18 class columns) and each `<ROW>` is
 * name / class / note / 18 values. Row i ↔ column i, so the canonical column labels key both axes — the
 * SAME labels the eCFR header carries, which is what makes the cross-check meaningful.
 */

import type { SegregationCell } from "../src/schema.js";
import { extractGpoTables, gpoRows, entCells, boxheadCells } from "./gpoTable.js";

const VALUES = new Set(["X", "O", "*"]);

function normClass(s: string): string {
  return s.toLowerCase().replace(/\band\b/g, " ").replace(/[.,]/g, ".").replace(/\s+/g, " ").trim();
}

export function parseSegregationGridGovInfo(xml: string): SegregationCell[] {
  // The (d) class grid is the GPOTABLE whose BOXHD leads with "Class or division"; the (f) compatibility
  // table (out of scope) does not.
  const grid = extractGpoTables(xml).find((t) => /class or division/i.test(boxheadCells(t)[0]?.text ?? ""));
  if (!grid) throw new Error("parseSegregationGridGovInfo: no GPOTABLE with a 'Class or division' header.");

  const header = boxheadCells(grid);
  const colLabels = header.slice(3).map((c) => c.text); // 18 canonical column classes
  if (colLabels.length < 2) throw new Error("parseSegregationGridGovInfo: grid header has too few columns.");

  const dataRows = gpoRows(grid);
  if (dataRows.length !== colLabels.length) {
    throw new Error(
      `parseSegregationGridGovInfo: ${dataRows.length} data rows vs ${colLabels.length} columns — grid not square, structure drifted.`,
    );
  }

  const cells: SegregationCell[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const rc = entCells(dataRows[i]!);
    const rowLabel = colLabels[i]!; // row i ↔ column i (verified same order)
    const printedClass = rc[1]?.text ?? "";
    if (printedClass && !normClass(rowLabel).startsWith(normClass(printedClass))) {
      throw new Error(
        `parseSegregationGridGovInfo: row ${i} class "${printedClass}" does not match column label "${rowLabel}" — order drift.`,
      );
    }
    const note = (rc[2]?.text ?? "").trim() || null;
    const values = rc.slice(3);
    if (values.length > colLabels.length) {
      throw new Error(`parseSegregationGridGovInfo: row ${i} has ${values.length} value cells, expected ≤ ${colLabels.length}.`);
    }
    while (values.length < colLabels.length) values.push({ text: "", inner: "" }); // GPO omits trailing blank cells
    for (let j = 0; j < values.length; j++) {
      const v = values[j]!.text.trim();
      if (v === "") continue; // blank = no restriction
      if (!VALUES.has(v)) {
        throw new Error(`parseSegregationGridGovInfo: unexpected grid value "${v}" at row ${i} col ${j} — wrong table?`);
      }
      cells.push({ rowClass: rowLabel, colClass: colLabels[j]!, value: v as "X" | "O" | "*", notes: note });
    }
  }
  return cells;
}
