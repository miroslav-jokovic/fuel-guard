/**
 * Cited reconciliations — the eCFR↔GovInfo differences a published Federal Register rule explains
 * (Q-DR14a option (b), ruled by the owner 2026-10-14).
 *
 * Why this exists: the triangulation compares the CURRENT eCFR against GovInfo's annual edition
 * (Title 49 is revised as of October 1). Any PHMSA rule effective between the two shows up as a
 * disagreement, and until this file `crossCheckAll()` had no way to accept one — so a fresh cut was
 * forced provisional however it was attested, for up to a year after each amendment. The first case:
 * 91 FR 51098 (effective 2026-09-08) put special provision 200 on three fireworks rows, which kept every
 * cut after 2026-09-08 NOT CLEAN until GovInfo publishes CFR-2026 Title 49 — after 2026-12-02, the day
 * the RQ list moves to 40 CFR 302.4 (91 FR 49305) and a new cut is due.
 *
 * What a reconciliation may do, and nothing more:
 *   - It names ONE rule (FR document number, citation, publication and effective dates, checked against
 *     the Federal Register API when it is written) and lists every field it changed, row by row, with
 *     the exact value in each source. A difference is explained only by an exact match on row key,
 *     field, eCFR value and GovInfo value; a second difference on the same row is not covered.
 *   - The rule must postdate the edition (effective after its `dateIssued`) and be in force on the
 *     pinned eCFR date (`fixtures/ecfr-provenance.json`). Outside that window it cannot be why the two
 *     sources differ, and the whole check fails rather than ignoring it.
 *   - Every listed row must be used. When GovInfo's next edition carries the rule the rows stop
 *     disagreeing and the check fails until the entry is deleted — the list cannot rot into a standing
 *     allow-list.
 *   - It never touches the in-scope fuel gate (`inScope`): a fuel row that moves still fails the
 *     release gate outright and is reviewed by a person before any cut.
 *
 * The human attestation (RELEASING.md step 5) covers this list: the report prints each explained
 * difference beside its citation, and the attester checks them against the rule's text.
 */

import type { FieldDiff } from "./diff.js";

export interface CitedRow {
  /** `rowKey()` of the HMT entry: `${prefix}${number}|${normalised printed name}`. */
  key: string;
  field: string;
  ecfr: unknown;
  govinfo: unknown;
}

export interface CitedReconciliation {
  /** Federal Register document number, e.g. "2026-16111". */
  frDoc: string;
  citation: string;
  title: string;
  publishedOn: string;
  effectiveOn: string;
  rows: readonly CitedRow[];
}

/**
 * §172.101 differences between the pinned eCFR and GovInfo CFR-2025-title49-vol2 (2025-10-01).
 * 91 FR 51098 republishes the three rows in its amendatory text; the rule's own row prints "75kg", which
 * is why the cargo-aircraft cell of UN0431 differs in spacing as well.
 */
export const HMT_RECONCILIATIONS: readonly CitedReconciliation[] = [
  {
    frDoc: "2026-16111",
    citation: "91 FR 51098",
    title: "Hazardous Materials: Allowing Fireworks Certification Agencies (FCAs) To Approve Professional Fireworks",
    publishedOn: "2026-08-07",
    effectiveOn: "2026-09-08",
    rows: [
      { key: "UN0431|articles, pyrotechnic", field: "pgRows[—].specialProvisions", ecfr: ["200", "381"], govinfo: ["381"] },
      { key: "UN0431|articles, pyrotechnic", field: "pgRows[—].quantityLimits.cargoAircraft", ecfr: "75kg", govinfo: "75 kg" },
      { key: "UN0335|fireworks", field: "pgRows[—].specialProvisions", ecfr: ["108", "200"], govinfo: ["108"] },
      { key: "UN0101|fuse, non-detonating", field: "pgRows[—].specialProvisions", ecfr: ["200"], govinfo: [] },
    ],
  },
];

export interface ExplainedDiff {
  key: string;
  diff: FieldDiff;
  frDoc: string;
  citation: string;
}

export interface Reconciliation {
  /** GovInfo edition date and pinned eCFR date the window was judged against. */
  editionDate: string | null;
  ecfrDate: string | null;
  explained: ExplainedDiff[];
  /** Differences no listed rule explains — each one keeps the check NOT CLEAN. */
  unexplained: Array<{ key: string; diff: FieldDiff }>;
  /** Listed rows that matched no difference (the edition caught up, or the entry is wrong). */
  unused: Array<{ frDoc: string; row: CitedRow }>;
  /** Rules that cannot explain a difference between these two sources on these dates. */
  outOfWindow: Array<{ frDoc: string; effectiveOn: string; why: string }>;
  clean: boolean;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Explain each disagreement by a cited rule, or don't. Pure: the dates come from the caller's fixtures. */
export function reconcile(
  disagreements: ReadonlyArray<{ key: string; fieldDiffs: readonly FieldDiff[] }>,
  reconciliations: readonly CitedReconciliation[],
  dates: { editionDate: string | null; ecfrDate: string | null },
): Reconciliation {
  const { editionDate, ecfrDate } = dates;
  const outOfWindow: Reconciliation["outOfWindow"] = [];
  const usable: CitedReconciliation[] = [];
  for (const r of reconciliations) {
    if (!editionDate || !ecfrDate) outOfWindow.push({ frDoc: r.frDoc, effectiveOn: r.effectiveOn, why: "edition or eCFR date unknown" });
    else if (r.effectiveOn <= editionDate) outOfWindow.push({ frDoc: r.frDoc, effectiveOn: r.effectiveOn, why: `in force before the edition (${editionDate})` });
    else if (r.effectiveOn > ecfrDate) outOfWindow.push({ frDoc: r.frDoc, effectiveOn: r.effectiveOn, why: `not yet in force on the eCFR date (${ecfrDate})` });
    else usable.push(r);
  }

  const used = new Set<CitedRow>();
  const explained: ExplainedDiff[] = [];
  const unexplained: Reconciliation["unexplained"] = [];
  for (const d of disagreements) {
    for (const diff of d.fieldDiffs) {
      let hit: { r: CitedReconciliation; row: CitedRow } | null = null;
      for (const r of usable) {
        const row = r.rows.find((x) => !used.has(x) && x.key === d.key && x.field === diff.field && same(x.ecfr, diff.sourceA) && same(x.govinfo, diff.sourceB));
        if (row) { hit = { r, row }; break; }
      }
      if (hit) {
        used.add(hit.row);
        explained.push({ key: d.key, diff, frDoc: hit.r.frDoc, citation: hit.r.citation });
      } else unexplained.push({ key: d.key, diff });
    }
  }
  const unused = reconciliations.flatMap((r) => r.rows.filter((row) => !used.has(row)).map((row) => ({ frDoc: r.frDoc, row })));
  return {
    editionDate, ecfrDate, explained, unexplained, unused, outOfWindow,
    clean: unexplained.length === 0 && unused.length === 0 && outOfWindow.length === 0,
  };
}
