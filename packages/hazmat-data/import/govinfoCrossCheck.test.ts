import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { crossCheckAll, crossCheckDefault, crossCheckHmt, govInfoEntryToSourceB } from "./govinfoCrossCheck.js";
import { parseHmtGovInfoSection } from "./parseHmtGovInfo.js";
import { compareEntry } from "./diff.js";

// The full GovInfo captures are gitignored (large); regenerate via `pnpm tsx import/captureGovInfo.ts`.
// Skip (never fail) when absent — e.g. a fresh CI checkout — so triangulation stays an integration test.
const has = (p: string) => existsSync(new URL(p, import.meta.url));
const PRESENT = has("./fixtures/govinfo/hmt-172-101.xml") && has("./fixtures/govinfo/placardTables-172-504.xml") && has("./fixtures/govinfo/segregation-177-848.xml");
if (!PRESENT) console.warn("[hazmat-data] SKIP govinfoCrossCheck — captured GovInfo fixtures absent (run import/captureGovInfo.ts)");

describe.skipIf(!PRESENT)("govinfoCrossCheck — automated eCFR↔GovInfo triangulation (D5 v7)", () => {
  it("the in-scope fuel gate is CLEAN against the real fixtures", () => {
    const r = crossCheckDefault();
    expect(r.inScope.missing).toEqual([]);
    expect(r.inScope.clean).toBe(true);
    expect(r.inScope.rows.every((row) => row.status === "match")).toBe(true);
  });

  it("the full table triangulates with zero disagreements and identical key sets", () => {
    const r = crossCheckDefault();
    expect(r.totals.aEntries).toBe(2479);
    expect(r.totals.bEntries).toBe(2479);
    expect(r.full.disagree).toBe(0);
    expect(r.full.aOnly).toBe(0);
    expect(r.full.bOnly).toBe(0);
    expect(r.full.matched).toBe(r.totals.aKeys); // every distinct key matched
  });

  // NEGATIVE CONTROL: prove the comparison is not vacuously passing — a single injected field change
  // (an amendment/parse-drift simulation) MUST surface as a disagreement.
  it("detects an injected field drift (comparison is not vacuous)", () => {
    const gov = parseHmtGovInfoSection(readFileSync(new URL("./fixtures/govinfo/hmt-172-101.xml", import.meta.url), "utf8"));
    const gasoline = gov.find((e) => e.idPrefix === "UN" && e.idNumber === "1203" && e.psnPrinted === "Gasoline")!;
    // Same entry vs itself: no diff.
    expect(compareEntry(gasoline, govInfoEntryToSourceB(gasoline, "self")).length).toBe(0);
    // Mutate the hazard class → must be flagged.
    const drifted = { ...gasoline, hazardClass: "9" };
    const diffs = compareEntry(gasoline, govInfoEntryToSourceB(drifted, "drift"));
    expect(diffs.map((d) => d.field)).toContain("hazardClass");
  });

  it("all three verified tables (HMT, placards, segregation) triangulate CLEAN", () => {
    const t = crossCheckAll();
    expect(t.placards.clean).toBe(true);
    expect(t.placards.valueDiffs).toEqual([]);
    expect(t.segregation.clean).toBe(true);
    expect(t.segregation.valueDiffs).toEqual([]);
    expect(t.allClean).toBe(true);
  });

  it("a count mismatch under a shared key cannot hide (collision safety)", () => {
    // Two eCFR entries share a key; GovInfo has only one → reported as a disagreement, not silently matched.
    const ecfr = `
      <TABLE><TR><TD>Hazardous materials descriptions</TD><TD>Identification Numbers</TD></TR>
      ${row("", "Widget, n.o.s.", "3", "UN9999", "II")}
      ${row("", "Widget, n.o.s.", "3", "UN9999", "III")}
      </TABLE>`;
    const govinfo = `<GPOTABLE><BOXHD><CHED>Hazardous materials descriptions</CHED><CHED>Identification Numbers</CHED></BOXHD>
      ${grow("", "Widget, n.o.s.", "3", "UN9999", "II")}
      </GPOTABLE>`;
    const r = crossCheckHmt(ecfr, govinfo, "synthetic");
    const key = r.disagreements.find((d) => d.idNumber === "9999");
    expect(key).toBeTruthy();
    expect(key!.fieldDiffs.some((f) => /entry-count/.test(f.field))).toBe(true);
  });
});

// helpers to synthesize the 14-column rows for the collision-safety test
function row(sym: string, psn: string, cls: string, id: string, pg: string): string {
  const c = [sym, psn, cls, id, pg, cls, "", "", "", "242", "", "", "", ""];
  return `<TR>${c.map((x) => `<TD>${x}</TD>`).join("")}</TR>`;
}
function grow(sym: string, psn: string, cls: string, id: string, pg: string): string {
  const c = [sym, psn, cls, id, pg, cls, "", "", "", "242", "", "", "", ""];
  return `<ROW>${c.map((x) => `<ENT>${x}</ENT>`).join("")}</ROW>`;
}
