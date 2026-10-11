/**
 * The six FMCSA open-data datasets the inspection-challenge engine collects
 * (docs/plans/safety-dqf/INSPECTION-CHALLENGE-PLAN.md §0.4, IC1; sources in docs/regulatory/fmcsa/SOURCES.md).
 *
 * ── ONE VOCABULARY ─────────────────────────────────────────────────────────────────────────────
 * 0457's CHECK on `fmcsa_fetch_runs.dataset` and `fmcsa_raw_rows.dataset` lists exactly these ids, and
 * `supabase/tests/fmcsa-feed.test.mjs` reads the constraint back out of the applied catalog and compares
 * it with this list. A seventh dataset is a migration and an entry here in the same PR.
 *
 * ── HOW EACH ONE IS SCOPED TO US ───────────────────────────────────────────────────────────────
 * Only two of the six carry the USDOT number. The violation, unit and citation files are children of
 * the inspection file and carry `inspection_id` alone (no carrier column at all, per their published
 * metadata), so the only way to ask for ours is by OUR inspection ids. ⚠ `inspection_id` is a NUMBER
 * in the inspection and violation files and TEXT in the
 * unit and citation files; a numeric `in (…)` on a text column is an HTTP 400, not an empty answer.
 *
 * ── THE NATURAL KEY IS FMCSA'S OWN ID ──────────────────────────────────────────────────────────
 * Each key was measured unique over our full record on 2026-10-10 (1,390 / 1,422 / 2,763 / 21 / 953 /
 * 741 rows). The SMS violation file has no row id, so its key is the triple that names a violation
 * on a unit of an inspection; a repeat of the triple gets `#2`, `#3` in payload order (zero measured).
 * ⚠ The SMS files' `unique_id` is NOT `inspection_id`: the two are joined on
 * (`report_number`, `report_state`), which the projector (IC1b) does, not this file.
 */
export const FMCSA_DATASETS = [
  "fx4q-ay7w", // Vehicle Inspection File — one row per inspection
  "876r-jsdb", // Vehicle Inspections and Violations — one row per violation
  "wt8s-2hbx", // Inspections Per Unit — one row per inspected unit
  "qbt8-7vic", // Inspections and Citations — one row per adjudicated citation result
  "rbkj-cgst", // SMS Input – Inspection — the inspections FMCSA's monthly SMS scored
  "8mt8-2mdr", // SMS Input – Violation — the violations it scored, with their weights
] as const;
export type FmcsaDataset = (typeof FMCSA_DATASETS)[number];

export type FmcsaScope =
  /** `dot_number = <ours>`; the column's Socrata type decides whether the literal is quoted. */
  | { by: "dot_number"; quoted: boolean }
  /** `inspection_id in (<our inspection ids>)`, quoted when the column is text. */
  | { by: "inspection_id"; quoted: boolean };

export interface FmcsaDatasetSpec {
  id: FmcsaDataset;
  name: string;
  scope: FmcsaScope;
  /** The payload fields whose values, joined by `|`, are the row's natural key. */
  keyFields: readonly string[];
}

export const FMCSA_DATASET_SPECS: Record<FmcsaDataset, FmcsaDatasetSpec> = {
  "fx4q-ay7w": {
    id: "fx4q-ay7w",
    name: "Vehicle Inspection File",
    scope: { by: "dot_number", quoted: false },
    keyFields: ["inspection_id"],
  },
  "876r-jsdb": {
    id: "876r-jsdb",
    name: "Vehicle Inspections and Violations",
    scope: { by: "inspection_id", quoted: false },
    keyFields: ["insp_violation_id"],
  },
  "wt8s-2hbx": {
    id: "wt8s-2hbx",
    name: "Inspections Per Unit",
    scope: { by: "inspection_id", quoted: true },
    keyFields: ["insp_unit_id"],
  },
  "qbt8-7vic": {
    id: "qbt8-7vic",
    name: "Inspections and Citations",
    scope: { by: "inspection_id", quoted: true },
    keyFields: ["inspection_id", "vioseqnum", "adjseq"],
  },
  "rbkj-cgst": {
    id: "rbkj-cgst",
    name: "SMS Input – Inspection",
    scope: { by: "dot_number", quoted: true },
    keyFields: ["unique_id"],
  },
  "8mt8-2mdr": {
    id: "8mt8-2mdr",
    name: "SMS Input – Violation",
    scope: { by: "dot_number", quoted: true },
    keyFields: ["unique_id", "viol_code", "viol_unit"],
  },
};

/**
 * Natural keys for one fetched snapshot, in payload order. A key field that is missing or empty is a
 * row we cannot version, so it throws rather than inventing a key: a fabricated key would make the
 * next run's comparison report a vanish and a new row for what is one unchanged record.
 */
export function fmcsaNaturalKeys(dataset: FmcsaDataset, rows: readonly Record<string, unknown>[]): string[] {
  const { keyFields } = FMCSA_DATASET_SPECS[dataset];
  const seen = new Map<string, number>();
  return rows.map((row, i) => {
    const parts = keyFields.map((f) => {
      const v = row[f];
      if (v === undefined || v === null || String(v).trim() === "") {
        throw new Error(`${dataset} row ${i} has no ${f}; its natural key cannot be formed`);
      }
      return String(v).trim();
    });
    const base = parts.join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}
