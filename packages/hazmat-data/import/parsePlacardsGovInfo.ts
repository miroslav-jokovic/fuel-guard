/**
 * §172.504 placarding-tables parser — official GovInfo source (D5 v7 automated second source).
 *
 * GovInfo GPO counterpart of `parsePlacards.ts`. Same two 3-column tables in printed order (Table 1 =
 * placard at ANY amount; Table 2 = placard only at ≥ 454 kg / 1,001 lb), same `PlacardSpec[]` output and
 * same §172.542(c)/§172.544(c) fuel wording overlay — so the two parses can be diffed directly. Verified
 * against import/fixtures/govinfo/placardTables-172-504.xml (CFR-2025-title49-vol2, edition 2025-10-01):
 * the RADIOACTIVE footnote is a `<SU>` superscript (dropped) whose text lives in a `<TNOTE>` (not a row),
 * and "CLASS 9 (see § 172.504(f)(9))" carries a trailing see-reference dropped from the display name.
 */

import type { PlacardSpec } from "../src/schema.js";
import { extractGpoTables, gpoRows, entCells, stripTagsNoSup } from "./gpoTable.js";

/** §172.542(c)/§172.544(c): the only alternate placard wordings v1 needs (fuel). Keyed by category. */
const WORDING_OVERLAY: Record<string, string[]> = {
  "3": ["GASOLINE"],
  "Combustible liquid": ["FUEL OIL"],
};

function parseOneTable(tableXml: string, table: 1 | 2): PlacardSpec[] {
  const specs: PlacardSpec[] = [];
  for (const row of gpoRows(tableXml)) {
    const cells = entCells(row);
    if (cells.length < 2 || cells.length > 3) continue; // data rows are 3-col; GPO omits a trailing empty
    while (cells.length < 3) cells.push({ text: "", inner: "" }); // e.g. "6.2 / NONE" has no design ref
    const category = cells[0]!.text;
    const nameRaw = stripTagsNoSup(cells[1]!.inner); // drop the <SU> footnote marker on RADIOACTIVE
    const designRef = (cells[2]!.text.replace(/§/g, "").trim()) || null;
    if (/^category of material/i.test(category) || /^placard name$/i.test(nameRaw)) continue;
    if (!category || !nameRaw) continue;
    const placardName = nameRaw.replace(/\s*\(see\b.*$/i, "").trim();
    specs.push({ classOrDivision: category, table, placardName, designRef, wordingOptions: WORDING_OVERLAY[category] ?? [] });
  }
  return specs;
}

export function parsePlacardTablesGovInfo(xml: string): PlacardSpec[] {
  // The two §172.504 placarding tables carry a "Placard name" column header; take them in printed order.
  const tables = extractGpoTables(xml).filter((t) => /placard name/i.test(stripTagsNoSup(t.slice(0, 4000))));
  if (tables.length < 2) {
    throw new Error(`parsePlacardTablesGovInfo: expected 2 §172.504 GPOTABLEs, found ${tables.length}.`);
  }
  const t1 = parseOneTable(tables[0]!, 1);
  const t2 = parseOneTable(tables[1]!, 2);

  const has = (specs: PlacardSpec[], cat: string, name: string): boolean =>
    specs.some((s) => s.classOrDivision.startsWith(cat) && s.placardName === name);
  if (!has(t1, "2.3", "POISON GAS") || !has(t1, "4.3", "DANGEROUS WHEN WET")) {
    throw new Error("parsePlacardTablesGovInfo: first table lacks the Table-1 signature (2.3→POISON GAS, 4.3→DANGEROUS WHEN WET).");
  }
  if (!has(t2, "3", "FLAMMABLE") || !has(t2, "8", "CORROSIVE")) {
    throw new Error("parsePlacardTablesGovInfo: second table lacks the Table-2 signature (3→FLAMMABLE, 8→CORROSIVE).");
  }
  return [...t1, ...t2];
}
