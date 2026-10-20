import { describe, expect, it } from "vitest";
import { auditPrintedPaper, matchAppendixNames, type PrintedPaperLine } from "@hazmat/engine";
import { loadDataset } from "@hazmat/data";

/**
 * paper_rq over every HMT row Appendix A reaches (engine 0.20.0, READER-CORRECTNESS-PLAN R-M1, D-RC1). Each
 * row is printed as a paper prints it — a count, a NET weight column, a gross a little above it, and for a
 * solution the concentration in its description cell, as Mayo Products BOL 14182 prints "CAUSTIC SODA 50%" —
 * at amounts on both sides of its reportable quantity. What must hold on every one:
 *   - P1: the rule never PASSES a line whose packages hold the RQ of the substance or more, unless "RQ" is
 *     printed; it passes only where the package's contents, or its whole gross weight, are under the RQ;
 *   - it FAILS only where the printed amount times the printed share is at or over the RQ;
 *   - a line that holds the RQ by its contents but under it by a printed percentage waits for a person
 *     (§171.8 judges by weight; the paper does not say by what), and so does a solution with no percentage.
 */
const ds = loadDataset();
const names = (e: (typeof ds.entries)[number]) => [e.psnPrinted, ...(e.psnAlternates ?? [])].filter((n): n is string => typeof n === "string");

interface Case { id: string; perPackage: number | null; grossPerPackage: number; pct: number | null; rq: number; neat: boolean; printedRq: boolean }

const ROWS = ds.entries.flatMap((e) => {
  const { neat, mixture } = matchAppendixNames(names(e), ds.hazSubstances);
  const listed = neat.length ? neat : mixture;
  if (listed.length !== 1 || listed[0]!.rqPounds == null || !e.hazardClass) return [];
  return e.pgRows.map((r) => ({ e, pg: r.pg as "I" | "II" | "III" | null, rq: listed[0]!.rqPounds!, neat: neat.length > 0 }));
});

function audit(row: (typeof ROWS)[number], c: Omit<Case, "id" | "rq" | "neat">) {
  const count = 4;
  const cls = row.e.hazardClass!;
  const id = `${row.e.idPrefix}${row.e.idNumber}`;
  const line: PrintedPaperLine = {
    idText: id, psn: row.e.psnPrinted, hazardClass: cls, pg: row.pg, technicalName: null,
    quantity: { value: null, unit: null }, packageCount: count, packaging: `${count} DRUMS`,
    grossWeightLb: c.grossPerPackage * count, netWeightLb: c.perPackage == null ? null : c.perPackage * count,
    hmColumnMark: "X", marks: c.printedRq ? ["RQ"] : [],
    descriptionText: `${id}, ${row.e.psnPrinted}, ${cls}${row.pg ? `, PG${row.pg}` : ""}${c.pct == null ? "" : `, PRODUCT ${c.pct}%`}`,
  };
  const result = auditPrintedPaper(
    { identity: { pageOf: null }, hazmat: { lines: [line], emergencyPhone: "8004249300", shipperCertification: true } },
    { dataset: ds as never, lines: [{ resolution: { ok: true, entryId: row.e.entryId, pg: row.pg, matchedName: row.e.psnPrinted, findings: [] }, quantityUnit: null, packagingKind: "non_bulk" }] },
  ).results.find((r) => r.ruleId === "paper_rq")!;
  return result;
}

/** Every amount on both sides of the RQ: contents, gross, share. */
const AMOUNTS = (rq: number) => [
  { perPackage: 2 * rq, grossPerPackage: 2.1 * rq, pct: null },
  { perPackage: 2 * rq, grossPerPackage: 2.1 * rq, pct: 60 },
  { perPackage: 2 * rq, grossPerPackage: 2.1 * rq, pct: 10 },
  { perPackage: 2 * rq, grossPerPackage: 2.1 * rq, pct: 50 },
  { perPackage: 0.5 * rq, grossPerPackage: 0.6 * rq, pct: 90 },
  { perPackage: null, grossPerPackage: 0.6 * rq, pct: 90 },
  { perPackage: null, grossPerPackage: 2 * rq, pct: 90 },
];

describe("paper_rq over every Appendix A row, by net weight and printed concentration", () => {
  it("covers the rows Appendix A reaches, neat and solution", () => {
    expect(ROWS.filter((r) => r.neat).length).toBeGreaterThan(150);
    expect(ROWS.filter((r) => !r.neat).length).toBeGreaterThan(30);
  });

  it("never passes a package holding the RQ unless RQ is printed, and fails only at or over it", () => {
    const wrong: string[] = [];
    for (const row of ROWS) for (const a of AMOUNTS(row.rq)) for (const printedRq of [false, true]) {
      const r = audit(row, { ...a, printedRq });
      const share = a.pct ?? (row.neat ? 100 : null);
      const held = a.perPackage == null || share == null ? null : (a.perPackage * share) / 100;
      const clears = (a.perPackage ?? a.grossPerPackage) < row.rq || a.grossPerPackage < row.rq;
      const tag = `${row.e.entryId} ${JSON.stringify(a)} rq=${printedRq}: ${r.outcome}/${r.reason}`;
      if (r.outcome === "pass" && !printedRq && !clears) wrong.push(`false pass ${tag}`);
      if (r.outcome === "fail" && !(held != null && held >= row.rq && !printedRq)) wrong.push(`false fail ${tag}`);
      if (printedRq && r.outcome !== "pass") wrong.push(`missed printed RQ ${tag}`);
      if (!printedRq && clears && r.outcome !== "pass") wrong.push(`needless stop ${tag}`);
      if (!printedRq && held != null && held >= row.rq && r.outcome !== "fail") wrong.push(`missed owed RQ ${tag}`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it("answers the Mayo paper: both lines owe RQ by their net weight and printed concentration", () => {
    const by = (id: string) => ROWS.find((r) => r.e.entryId === id)!;
    expect(audit(by("UN1824-sodium-hydroxide-solution"), { perPackage: 3600, grossPerPackage: 3725, pct: 50, printedRq: false }))
      .toMatchObject({ outcome: "fail", reason: "rq_not_printed", facts: { concentrationPct: 50, substancePerPackage: 1800, rq: 1000 } });
    expect(audit(by("UN1830-sulfuric-acid"), { perPackage: 3250, grossPerPackage: 3375, pct: 93, printedRq: false }))
      .toMatchObject({ outcome: "fail", reason: "rq_not_printed", facts: { concentrationPct: 93, substancePerPackage: 3022.5 } });
  });
});
