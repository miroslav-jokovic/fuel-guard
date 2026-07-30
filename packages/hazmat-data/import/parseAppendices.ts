/**
 * Appendix A & B to §172.101 parsers (Phase H1). Both tables live INSIDE the §172.101 XML (the same
 * file the HMT parser reads) and are selected by header signature, not position.
 *
 *   - Appendix A — hazardous substances / RQ table → `HazSubstance[]`. Two columns: the substance
 *     name and "Reportable quantity (RQ) pounds (kilograms)" formatted "LBS (KG)" (e.g. "5000 (2270)",
 *     "1 (0.454)"). No CAS column in the eCFR rendering → `casNumber: null`.
 *   - Appendix B — marine pollutants → `MarinePollutant[]`. Two columns: "S.M.P." ("PP" marks a SEVERE
 *     marine pollutant, else blank) and the pollutant name.
 *
 * Built against frozen slices (`fixtures/appendix-a-slice.xml`, `fixtures/appendix-b-slice.xml`) cut
 * verbatim from the real §172.101 XML; the production build runs them over the full captured file.
 */

import type { HazSubstance, MarinePollutant } from "../src/schema.js";
import { findTableByHeader, tableRows, rowCells } from "./xmlTable.js";

/** Lowercase, collapse whitespace — the matchable form for name lookups. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Parse a number that may carry thousands commas ("5,000" → 5000, "0.454" → 0.454). */
function num(s: string): number {
  return Number(s.replace(/,/g, ""));
}

/** "5000 (2270)" | "1 (0.454)" | "5,000 (2,270)" — lbs then (kg). */
const RQ_RE = /([\d,]+(?:\.\d+)?)\s*\(\s*([\d,]+(?:\.\d+)?)\s*\)/;

export function parseHazSubstances(xml: string): HazSubstance[] {
  const table = findTableByHeader(xml, ["reportable quantity"]);
  if (!table) throw new Error("parseHazSubstances: no Appendix-A table (header 'Reportable quantity') found.");
  const out: HazSubstance[] = [];
  let lastRq: { pounds: number; kg: number } | null = null; // for indented isomer sub-entries
  for (const tr of tableRows(table)) {
    const cells = rowCells(tr);
    if (cells.length !== 2) continue;
    let name = cells[0]!.text;
    const rqText = cells[1]!.text;
    if (/^hazardous substance$/i.test(name) || /reportable quantity/i.test(rqText)) continue; // header
    if (!name) continue;

    let pounds: number;
    let kg: number;
    const inCell = new RegExp("^" + RQ_RE.source).exec(rqText);
    if (inCell) {
      pounds = num(inCell[1] as string);
      kg = num(inCell[2] as string);
      lastRq = { pounds, kg };
    } else {
      // Blank RQ cell. Two real Appendix-A cases (verified against the live table):
      //  (a) the rendering merged the RQ into the NAME cell (e.g. "…8abeta)-1 (0.454)") — recover it;
      //  (b) an indented isomer/synonym (iso-/sec-/tert-, o-/m-/p-) that INHERITS the RQ of the entry
      //      above it (a standard Appendix-A grouping) — carry the parent RQ forward.
      const inName = new RegExp(RQ_RE.source + "\\s*$").exec(name);
      if (inName) {
        pounds = num(inName[1] as string);
        kg = num(inName[2] as string);
        name = name.slice(0, inName.index).replace(/[-,\s]+$/, "").trim();
        lastRq = { pounds, kg };
      } else if (lastRq) {
        pounds = lastRq.pounds;
        kg = lastRq.kg;
      } else {
        throw new Error(`parseHazSubstances: RQ missing and no parent entry to inherit from for "${name}".`);
      }
    }
    out.push({ name, nameNormalized: normalizeName(name), casNumber: null, rqPounds: pounds, rqKg: kg });
  }
  return out;
}

export function parseMarinePollutants(xml: string): MarinePollutant[] {
  const table = findTableByHeader(xml, ["marine pollutant"]);
  if (!table) throw new Error("parseMarinePollutants: no Appendix-B table (header 'Marine pollutant') found.");
  const out: MarinePollutant[] = [];
  for (const tr of tableRows(table)) {
    const cells = rowCells(tr);
    if (cells.length !== 2) continue;
    const smp = cells[0]!.text.trim();
    const name = cells[1]!.text;
    if (name === "" || /^marine pollutant/i.test(name)) continue; // blank / header ("Marine pollutant (2)")
    out.push({
      name,
      nameNormalized: normalizeName(name),
      severe: /^pp$/i.test(smp),
    });
  }
  return out;
}
