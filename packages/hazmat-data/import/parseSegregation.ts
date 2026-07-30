/**
 * §177.848(d) segregation-grid parser (Phase H1) → `SegregationCell[]`.
 *
 * Built against the real captured `fixtures/section-177-848.xml`. The section has two tables; the
 * FIRST is the class×class segregation grid (the second is the §177.848(f) explosive
 * compatibility-group table — out of scope for v1/fuel). The grid is 18×18:
 *   - header row: c0 "Class or division", c1 (blank), c2 "Notes", then 18 COLUMN class labels
 *     (c3…c20): "1.1 1.2","1.3",…,"2.3 gas zone A","2.3 gas Zone B","3",…,"6.1 liquids PG I zone A",
 *     "7","8 liquids only".
 *   - 18 data rows, IN THE SAME CLASS ORDER as the columns: c0 = descriptive name, c1 = the row's
 *     class/division, c2 = a row-level note letter ("A"), c3…c20 = the grid values (X | O | * | blank).
 * Row i corresponds to column i, so the canonical column labels key BOTH axes (this also disambiguates
 * the two 2.3 zones and the qualified 6.1/8 rows, which share a bare c1 value). Values: `X` (may not be
 * loaded/stored together), `O` (kept apart / "away from"), `*` (see the §177.848 notes), blank (no
 * restriction — not emitted). Only non-blank cells are returned; a missing pair means "no restriction".
 */

import type { SegregationCell } from "../src/schema.js";
import { extractTables, tableRows, rowCells } from "./xmlTable.js";

const VALUES = new Set(["X", "O", "*"]);

/** Loose class-label match so a row's printed class (c1) can be checked against its column label. */
function normClass(s: string): string {
  return s.toLowerCase().replace(/\band\b/g, " ").replace(/[.,]/g, ".").replace(/\s+/g, " ").trim();
}

export function parseSegregationGrid(xml: string): SegregationCell[] {
  const tables = extractTables(xml);
  if (!tables.length) throw new Error("parseSegregationGrid: no <TABLE> in §177.848 XML.");
  const grid = tables[0]!; // the (d) class grid; tables[1] is the (f) compatibility-group table
  const rows = tableRows(grid);
  if (rows.length < 2) throw new Error("parseSegregationGrid: grid table has no data rows.");

  const header = rowCells(rows[0]!);
  if (!/class or division/i.test(header[0]?.text ?? "")) {
    throw new Error("parseSegregationGrid: first table is not the segregation grid (missing 'Class or division').");
  }
  const colLabels = header.slice(3).map((c) => c.text); // 18 canonical column classes
  if (colLabels.length < 2) throw new Error("parseSegregationGrid: grid header has too few columns.");

  const dataRows = rows.slice(1);
  if (dataRows.length !== colLabels.length) {
    throw new Error(
      `parseSegregationGrid: ${dataRows.length} data rows vs ${colLabels.length} columns — grid is not square, structure drifted.`,
    );
  }

  const cells: SegregationCell[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const rc = rowCells(dataRows[i]!);
    const rowLabel = colLabels[i]!; // row i ↔ column i (verified same order)
    const printedClass = rc[1]?.text ?? "";
    // sanity: the row's printed class must be consistent with its canonical column label
    if (printedClass && !normClass(rowLabel).startsWith(normClass(printedClass))) {
      throw new Error(
        `parseSegregationGrid: row ${i} class "${printedClass}" does not match column label "${rowLabel}" — order drift.`,
      );
    }
    const note = (rc[2]?.text ?? "").trim() || null;
    const values = rc.slice(3);
    if (values.length !== colLabels.length) {
      throw new Error(`parseSegregationGrid: row ${i} has ${values.length} value cells, expected ${colLabels.length}.`);
    }
    for (let j = 0; j < values.length; j++) {
      const v = values[j]!.text.trim();
      if (v === "") continue; // blank = no restriction
      if (!VALUES.has(v)) {
        throw new Error(`parseSegregationGrid: unexpected grid value "${v}" at row ${i} col ${j} — wrong table?`);
      }
      cells.push({
        rowClass: rowLabel,
        colClass: colLabels[j]!,
        value: v as "X" | "O" | "*",
        notes: note,
      });
    }
  }
  return cells;
}
