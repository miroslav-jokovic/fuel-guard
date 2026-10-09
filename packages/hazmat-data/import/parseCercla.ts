/**
 * 40 CFR 302.4 "Table 302.4—List of Hazardous Substances and Reportable Quantities" → `HazSubstance[]`,
 * from EITHER official rendering: the eCFR versioner XML (`<TABLE>`/`<TR>`/`<TD>`, Source A) or the
 * GovInfo annual-edition XML (`<GPOTABLE>`/`<ROW>`/`<ENT>`, Source B). Both feed one row classifier,
 * so the two-source diff (`crossCheckCercla`) compares data, not two parsers' habits.
 *
 * Why this table: 91 FR 49305 (FR doc 2026-15809), effective 2026-12-02, revises Appendix A to §172.101
 * to read only "Refer to 40 CFR 302.4 to see the list of hazardous substances and their reportable
 * quantities (RQs) in Table 302.4. The list includes an Appendix B to § 302.4 for radionuclides and
 * their adjusted RQs.", and §171.8 "Reportable quantity (RQ)" becomes "the final RQ specified for each
 * hazardous substance identified in 40 CFR 302.4". From that date this table IS the RQ list.
 *
 * The table has five columns — Hazardous substance · CASRN · Statutory code · RCRA waste No. ·
 * Final RQ [pounds (kg)] — so it carries everything `hazSubstanceSchema` needs (name, lb AND kg) and
 * one thing Appendix A never did: the CAS number, which fills `casNumber` ("N.A." and blank → null).
 * Statutory code and RCRA waste No. have no place in the schema and are not carried.
 *
 * Row rules (each one read off the captured table, 2026-10-09):
 *   - Footnote superscripts (`<sup>`/`<SU>`: I, II, III, IV, v, a–f) are dropped from the name. Appendix A's
 *     parser keeps its markers ("Arsenic ¢", "Ammonium dichromate @") and so never matches those names; this
 *     one does not repeat that.
 *   - Subscripts (`<sub>`, GovInfo `<E T="0732">`) are joined to the formula: "Calcium cyanide Ca(CN)2".
 *   - A waste-stream row whose name is "F001—The following spent halogenated solvents…" (a paragraph)
 *     is named by its code alone, "F001", which is how Appendix A lists every D/F/K stream.
 *   - An RQ cell reading "LBS (KG)" makes a substance. Four other cells are KNOWN and kept out of
 *     `substances`, each with the footnote that explains it, in `withoutRq`:
 *       "**"  — "Indicates that no RQ is being assigned to the generic or broad class." (ANTIMONY AND
 *               COMPOUNDS and 49 others; their members carry their own RQs);
 *       "§"   — "The adjusted RQs for radionuclides may be found in appendix B to this table." (in
 *               curies, a unit `hazSubstanceSchema` has no field for — Appendix A's Table 2 was never
 *               carried either);
 *       "(##)" — "until then the statutory one-pound RQ applies" (K181): pounds stated in words, NO
 *               kilograms printed. `rqKg` is required, and a conversion would be our number, not the
 *               table's, so the row is reported, not invented;
 *       blank — a heading row with no CAS, code, waste number or RQ ("Unlisted Hazardous Wastes
 *               Characteristic of Toxicity", whose D004–D043 members follow with their own RQs).
 *     Any OTHER RQ text throws: an unrecognised cell is a table change a person must read.
 */

import type { HazSubstance } from "../src/schema.js";
import { normalizeName } from "./parseAppendices.js";
import { findTableByHeader, rowCells, tableRows } from "./xmlTable.js";
import { boxheadCells, entCells, extractGpoTables, gpoRows, stripTagsNoSup } from "./gpoTable.js";

export type CerclaNoRqReason = "no_rq_assigned" | "radionuclide_appendix_b" | "statutory_rq_no_kg" | "heading";

export interface CerclaRowWithoutRq {
  name: string;
  casNumber: string | null;
  rqCell: string;
  reason: CerclaNoRqReason;
}

export interface CerclaTable {
  substances: HazSubstance[];
  withoutRq: CerclaRowWithoutRq[];
}

/** The four header needles that identify Table 302.4 (and not its CAS-ordered Appendix A or Appendix B). */
const HEADER = ["hazardous substance", "casrn", "statutory", "final rq"];
const RQ_RE = /^([\d,]+(?:\.\d+)?)\s*\(\s*([\d,]+(?:\.\d+)?)\s*\)$/;
const WASTE_STREAM_RE = /^([DFK]\d{3})\s*(?:—|$)/;
const NO_RQ: Record<string, CerclaNoRqReason> = { "**": "no_rq_assigned", "§": "radionuclide_appendix_b", "(##)": "statutory_rq_no_kg" };

const num = (s: string): number => Number(s.replace(/,/g, ""));

/** Name cell → text: subscripts joined to their formula, footnote superscripts dropped. */
export function cerclaName(inner: string): string {
  // The trailing `\s*(?=[,.)])` eats GovInfo's line break between a subscript and the punctuation after
  // it ("CrO<E>4</E>\n , calcium salt"), which the eCFR rendering does not have.
  const joined = inner.replace(/\s*<(sub|E)\b[^>]*>([^<]*)<\/\1>(?:\s*(?=[,.)]))?/gi, (whole, tag: string, body: string) =>
    tag.toLowerCase() === "sub" || /T="0732"/.test(whole) ? body : ` ${body}`,
  );
  const text = stripTagsNoSup(joined);
  return WASTE_STREAM_RE.exec(text)?.[1] ?? text;
}

interface RawRow {
  nameInner: string;
  cas: string;
  code: string;
  waste: string;
  rq: string;
}

function classify(rows: RawRow[]): CerclaTable {
  const substances: HazSubstance[] = [];
  const withoutRq: CerclaRowWithoutRq[] = [];
  for (const r of rows) {
    const name = cerclaName(r.nameInner);
    if (!name || /^hazardous substance$/i.test(name)) continue;
    const casNumber = r.cas === "" || /^n\.?a\.?$/i.test(r.cas) ? null : r.cas;
    const m = RQ_RE.exec(r.rq);
    if (m) {
      substances.push({ name, nameNormalized: normalizeName(name), casNumber, rqPounds: num(m[1] as string), rqKg: num(m[2] as string) });
      continue;
    }
    const reason = r.rq === "" && !r.cas && !r.code && !r.waste ? "heading" : NO_RQ[r.rq];
    if (!reason) throw new Error(`parseCercla: unrecognised RQ cell "${r.rq}" for "${name}" — read the table before re-cutting.`);
    withoutRq.push({ name, casNumber, rqCell: r.rq, reason });
  }
  return { substances, withoutRq };
}

/** Source A: the eCFR versioner XML of 40 CFR 302.4. */
export function parseCerclaTable(xml: string): CerclaTable {
  const table = findTableByHeader(xml, HEADER);
  if (!table) throw new Error("parseCerclaTable: no Table 302.4 (header Hazardous substance/CASRN/Statutory code/Final RQ) found.");
  const rows: RawRow[] = [];
  for (const tr of tableRows(table)) {
    const cells = rowCells(tr);
    if (cells.length !== 5) continue; // footnote rows are one colspan cell
    const [, cas, code, waste, rq] = cells.map((c) => stripTagsNoSup(c.inner));
    rows.push({ nameInner: cells[0]!.inner, cas: cas!, code: code!, waste: waste!, rq: rq! });
  }
  return classify(rows);
}

/** Source B: the GovInfo annual-edition granule of 40 CFR 302.4. */
export function parseCerclaTableGovInfo(xml: string): CerclaTable {
  const table = extractGpoTables(xml).find((t) => {
    const head = boxheadCells(t).map((c) => c.text).join(" ").toLowerCase();
    return HEADER.every((h) => head.includes(h));
  });
  if (!table) throw new Error("parseCerclaTableGovInfo: no Table 302.4 GPOTABLE found.");
  const rows: RawRow[] = [];
  for (const row of gpoRows(table)) {
    // GPO omits trailing empty `<ENT/>`s (the "Unlisted … Toxicity" heading row has three cells), and
    // every GPOTABLE `<ROW>` is a data row (footnotes are `<TNOTE>`), so short rows are padded, not dropped.
    const cells = entCells(row);
    if (cells.length === 0 || cells.length > 5) continue;
    const [, cas = "", code = "", waste = "", rq = ""] = cells.map((c) => stripTagsNoSup(c.inner));
    rows.push({ nameInner: cells[0]!.inner, cas, code, waste, rq });
  }
  return classify(rows);
}
