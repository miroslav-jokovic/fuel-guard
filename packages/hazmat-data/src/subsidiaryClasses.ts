import type { Dataset, HmtEntry } from "./schema.js";

/**
 * A table entry's subsidiary hazard classes, derived from column (6) of §172.101 (PLACARD-CALCULATOR-RELIABILITY-PLAN
 * D-PC1, 2026-10-26).
 *
 * Column (6) lists the label codes a package must carry: the primary hazard first, then each subsidiary hazard
 * (§172.402(a)(1): "primary and subsidiary hazard labels as specified in column 6"). §172.202(a)(3) makes the
 * shipper print those subsidiaries on the paper in parentheses after the primary class, so they are what the
 * table matcher checks a printed "8 (6.1)" against, what §172.505 placards for, and what §177.848 segregates on.
 * The assembler wrote `subsidiaryClasses: []` on every entry from the first cut to 2026.12.0, while it kept the
 * label codes per packing-group row — so for 561 of 2,479 entries the matcher refused every correctly printed
 * line (`class_mismatch`), the paper audit called the correct paper wrong, and the DANGEROUS WHEN WET
 * subsidiary placard could never fire. Measured 2026-10-26 on the Henkel (a4119634) and PureTech (f2dc74ed)
 * production reads.
 *
 * ONE function derives it, used by the assembler for every future cut and by `loadDataset()` for the cuts
 * already shipped (where the stored field is empty and the label codes are not). A cut whose file carries the
 * field keeps it: a hand-attested correction outranks the derivation.
 *
 * The eCFR text's own quirks, measured on 2026.07.1: UN1052 prints "8.6.1" for "8, 6.1"; one UN3535 row prints
 * "6.1. 4.1"; UN2908 prints "Empty" (an excepted Class 7 package carries no label). Each is read for what it
 * says and no further — an unreadable token is dropped, never guessed.
 */

/** A label code of column (6): a Class 1 division with its compatibility group, "1" alone, or a class / division. */
const LABEL_CODE = /^(?:1(?:\.[1-6][A-NS]?)?|[2-9](?:\.[1-3])?)$/;

/** The codes one column-(6) cell token names, after the text's known slips. */
export function labelCodeTokens(raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(/[,\s]+/)) {
    const t = piece.replace(/\.+$/, "").trim();
    if (!t) continue;
    if (LABEL_CODE.test(t)) { out.push(t); continue; }
    // "8.6.1" — two codes with the comma printed as a dot.
    const glued = /^(\d)\.(\d\.\d)$/.exec(t);
    if (glued) { out.push(glued[1]!, glued[2]!); continue; }
    // "None", "Empty", anything else: no code.
  }
  return out;
}

/**
 * The subsidiary classes of an entry: every label code of its rows that is not the primary class, in column
 * order, once. An entry whose column (3) is blank (UN0190 "Samples, explosive" — the division comes with the
 * approval) derives none: nothing says which of its labels is the primary.
 */
export function subsidiaryClassesOf(hazardClass: string | null, pgRows: ReadonlyArray<{ labelCodes: readonly string[] }>): string[] {
  if (hazardClass == null || hazardClass.trim() === "") return [];
  const primary = hazardClass.trim();
  const out: string[] = [];
  for (const row of pgRows) {
    for (const cell of row.labelCodes) {
      for (const code of labelCodeTokens(cell)) {
        if (code === primary || out.includes(code)) continue;
        out.push(code);
      }
    }
  }
  return out;
}

/**
 * The dataset with `subsidiaryClasses` filled from the label codes wherever the cut's file left it empty, and each row's
 * own `subsidiaryLabels` beside it (TC1.3). Column (6) is per packing group — UN1287 "Rubber solution" is labelled 3 in PG II
 * and carries no label in PG III — so whether a printed line owes a subsidiary is a question of its row, not the entry.
 */
export function withSubsidiaryClasses(dataset: Dataset): Dataset {
  const entries: HmtEntry[] = dataset.entries.map((e) => {
    const pgRows = e.pgRows.map((r) => ({ ...r, subsidiaryLabels: subsidiaryClassesOf(e.hazardClass, [r]) }));
    return { ...e, pgRows, subsidiaryClasses: e.subsidiaryClasses.length > 0 ? e.subsidiaryClasses : subsidiaryClassesOf(e.hazardClass, e.pgRows) };
  });
  return { ...dataset, entries };
}
