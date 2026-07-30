/**
 * §172.504(e) placarding-tables parser (Phase H1) — the two general placarding tables → `PlacardSpec[]`.
 *
 * Built against the real captured `fixtures/section-172-504.xml`. The section has exactly TWO tables,
 * in printed order:
 *   - Table 1 (`table: 1`): materials that require a placard in ANY quantity (1.1–1.3, 2.3, 4.3,
 *     5.2 temperature-controlled, 6.1 PIH, 7 Radioactive-Yellow-III).
 *   - Table 2 (`table: 2`): materials that require a placard only at ≥ 454 kg (1,001 lb) aggregate
 *     (1.4–1.6, 2.1, 2.2, 3, Combustible liquid, 4.1, 4.2, 5.1, 5.2 other, 6.1 other, 6.2→NONE, 8, 9).
 * Both tables are 3-column: (0) category = hazard class/division (+ qualifier), (1) placard name,
 * (2) placard-design section reference. A trailing footnote row (colspan, `<sup>1</sup> RADIOACTIVE
 * placards are also required for …`) is skipped by the 3-cell requirement. The which-table distinction
 * is safety-critical (any-amount vs 1,001-lb), so the parser asserts a content signature on each table.
 *
 * `wordingOptions` is NOT in this section; the two fuel-relevant alternates come from §172.542(c)
 * (FLAMMABLE → GASOLINE) and §172.544(c) (COMBUSTIBLE → FUEL OIL) and are applied as a small, cited
 * overlay so a gasoline / fuel-oil load can be shown its exact placard wording.
 */

import type { PlacardSpec } from "../src/schema.js";
import { extractTables, tableRows, rowCells, stripTagsNoSup } from "./xmlTable.js";

/** §172.542(c) / §172.544(c): the only alternate placard wordings v1 needs (fuel). Keyed by category. */
const WORDING_OVERLAY: Record<string, string[]> = {
  "3": ["GASOLINE"], // §172.542(c) — FLAMMABLE placard may read GASOLINE for a highway gasoline cargo tank
  "Combustible liquid": ["FUEL OIL"], // §172.544(c) — COMBUSTIBLE placard may read FUEL OIL
};

function parseOneTable(tableXml: string, table: 1 | 2): PlacardSpec[] {
  const specs: PlacardSpec[] = [];
  const rows = tableRows(tableXml);
  for (const tr of rows) {
    const cells = rowCells(tr);
    if (cells.length !== 3) continue; // header (also 3 cells — filtered below) and footnote (1 cell)
    const category = cells[0]!.text;
    const nameRaw = stripTagsNoSup(cells[1]!.inner); // drop the <sup> footnote marker on RADIOACTIVE
    const designRef = (cells[2]!.text.replace(/§/g, "").trim()) || null;
    // skip the header row
    if (/^category of material/i.test(category) || /^placard name$/i.test(nameRaw)) continue;
    if (!category || !nameRaw) continue;
    // Placard name: drop a trailing "(see § …)" cross-reference so the name is display-clean
    // (handles nested parens, e.g. "CLASS 9 (see § 172.504(f)(9))" → "CLASS 9").
    const placardName = nameRaw.replace(/\s*\(see\b.*$/i, "").trim();
    specs.push({
      classOrDivision: category,
      table,
      placardName,
      designRef,
      wordingOptions: WORDING_OVERLAY[category] ?? [],
    });
  }
  return specs;
}

export function parsePlacardTables(xml: string): PlacardSpec[] {
  const tables = extractTables(xml);
  if (tables.length < 2) {
    throw new Error(`parsePlacardTables: expected 2 §172.504 tables, found ${tables.length}.`);
  }
  const t1 = parseOneTable(tables[0]!, 1);
  const t2 = parseOneTable(tables[1]!, 2);

  // Content signatures — refuse to ship if the two tables are swapped or mis-parsed (safety-critical:
  // Table 1 = placard at ANY amount, Table 2 = only ≥ 1,001 lb).
  const has = (specs: PlacardSpec[], cat: string, name: string): boolean =>
    specs.some((s) => s.classOrDivision.startsWith(cat) && s.placardName === name);
  if (!has(t1, "2.3", "POISON GAS") || !has(t1, "4.3", "DANGEROUS WHEN WET")) {
    throw new Error("parsePlacardTables: first table lacks the Table-1 signature (2.3→POISON GAS, 4.3→DANGEROUS WHEN WET).");
  }
  if (!has(t2, "3", "FLAMMABLE") || !has(t2, "8", "CORROSIVE")) {
    throw new Error("parsePlacardTables: second table lacks the Table-2 signature (3→FLAMMABLE, 8→CORROSIVE).");
  }
  return [...t1, ...t2];
}
