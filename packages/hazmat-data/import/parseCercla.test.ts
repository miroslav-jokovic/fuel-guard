import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cerclaName, parseCerclaTable, parseCerclaTableGovInfo } from "./parseCercla.js";
import { hazSubstanceSchema } from "../src/schema.js";

// The committed captures of 40 CFR 302.4 (captureCercla.ts): eCFR 2026-10-07, GovInfo CFR-2025-title40-vol30.
const rd = (n: string): string => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const ecfr = parseCerclaTable(rd("section-40-302-4.xml"));
const gov = parseCerclaTableGovInfo(rd("govinfo/cercla-302-4.xml"));
const find = (name: string, cas?: string) => ecfr.substances.filter((s) => s.name === name && (cas === undefined || s.casNumber === cas));

describe("parseCerclaTable — 40 CFR 302.4 Table 302.4 (eCFR)", () => {
  it("parses 1,340 schema-valid rows with an lb+kg RQ and keeps 50 rows without one", () => {
    expect(ecfr.substances).toHaveLength(1340);
    expect(ecfr.withoutRq).toHaveLength(50);
    for (const s of ecfr.substances) expect(() => hazSubstanceSchema.parse(s)).not.toThrow();
  });

  it("reads name, CAS, pounds and kilograms, dropping the footnote superscript", () => {
    // <TD>Benzene <sup>a</sup></TD><TD>71-43-2</TD><TD>1,2,3,4</TD><TD>U019</TD><TD>10 (4.54)</TD>
    expect(find("Benzene")).toEqual([{ name: "Benzene", nameNormalized: "benzene", casNumber: "71-43-2", rqPounds: 10, rqKg: 4.54 }]);
    expect(find("Antimony")).toEqual([{ name: "Antimony", nameNormalized: "antimony", casNumber: "7440-36-0", rqPounds: 5000, rqKg: 2270 }]);
  });

  it("keeps both DDE rows apart by CAS (Table 302.4 lists the name twice)", () => {
    expect(find("DDE").map((s) => [s.casNumber, s.rqPounds, s.rqKg])).toEqual([["72-55-9", 1, 0.454], ["3547-04-4", 5000, 2270]]);
  });

  it("names a waste stream by its code, and reads 'N.A.' and a blank CAS as null", () => {
    expect(find("F001")).toEqual([{ name: "F001", nameNormalized: "f001", casNumber: null, rqPounds: 10, rqKg: 4.54 }]);
    expect(find("K174")).toHaveLength(1);
    expect(find("Unlisted Hazardous Wastes Characteristic of Ignitability")[0]).toMatchObject({ casNumber: null, rqPounds: 100, rqKg: 45.4 });
  });

  it("carries the 2024 PFOA/PFOS designation Appendix A never had", () => {
    expect(find("Perfluorooctanoic acid", "335-67-1")[0]).toMatchObject({ rqPounds: 1, rqKg: 0.454 });
    expect(find("Perfluorooctanesulfonic acid", "1763-23-1")[0]).toMatchObject({ rqPounds: 1, rqKg: 0.454 });
  });

  it("keeps out, with their reason, the rows that print no lb+kg RQ", () => {
    const tally = ecfr.withoutRq.reduce<Record<string, number>>((a, r) => ({ ...a, [r.reason]: (a[r.reason] ?? 0) + 1 }), {});
    expect(tally).toEqual({ no_rq_assigned: 47, radionuclide_appendix_b: 1, heading: 1, statutory_rq_no_kg: 1 });
    expect(ecfr.withoutRq.find((r) => r.name === "K181")).toEqual({ name: "K181", casNumber: null, rqCell: "(##)", reason: "statutory_rq_no_kg" });
    expect(ecfr.withoutRq.find((r) => r.name === "ANTIMONY AND COMPOUNDS")).toMatchObject({ rqCell: "**", reason: "no_rq_assigned" });
    expect(ecfr.withoutRq.find((r) => r.reason === "radionuclide_appendix_b")?.name).toBe("Radionuclides (including radon)");
    expect(ecfr.withoutRq.find((r) => r.reason === "heading")?.name).toBe("Unlisted Hazardous Wastes Characteristic of Toxicity");
    expect(ecfr.substances.some((s) => s.name === "K181" || s.name === "ANTIMONY AND COMPOUNDS")).toBe(false);
  });

  it("refuses an RQ cell it does not recognise rather than guessing", () => {
    const xml = `<TABLE><TR><TH>Hazardous substance</TH><TH>CASRN</TH><TH>Statutory code</TH><TH>RCRA waste No.</TH><TH>Final RQ [pounds (kg)]</TH></TR>
      <TR><TD>Widgetane</TD><TD>1-2-3</TD><TD>1</TD><TD></TD><TD>see note</TD></TR></TABLE>`;
    expect(() => parseCerclaTable(xml)).toThrow(/unrecognised RQ cell "see note" for "Widgetane"/);
    // A blank RQ is a heading only when the whole row is blank; beside a CAS number it is a missing RQ.
    expect(() => parseCerclaTable(xml.replace("see note", "").replace("1-2-3", "50-00-0"))).toThrow(/unrecognised RQ cell "" for "Widgetane"/);
    expect(() => parseCerclaTable("<TABLE><TR><TH>Radionuclide</TH></TR></TABLE>")).toThrow(/no Table 302.4/);
  });
});

describe("cerclaName — the name-cell rules", () => {
  it("joins a subscript to its formula in both renderings", () => {
    expect(cerclaName("Calcium cyanide Ca(CN)<sub>2</sub>")).toBe("Calcium cyanide Ca(CN)2");
    expect(cerclaName('\n  Chromic acid H\n  <E T="0732">2</E>\n   CrO\n  <E T="0732">4</E>\n  , calcium salt\n')).toBe("Chromic acid H2 CrO4, calcium salt");
  });
  it("drops <sup>/<SU> footnote markers and reduces a stream paragraph to its code", () => {
    expect(cerclaName("Fine mineral fibers <sup>c</sup>")).toBe("Fine mineral fibers");
    expect(cerclaName("Asbestos <SU>IV</SU>")).toBe("Asbestos");
    expect(cerclaName("K169 —Crude oil storage tank sediment from petroleum refining operations")).toBe("K169");
    expect(cerclaName("(a) Tetrachloroethylene")).toBe("(a) Tetrachloroethylene");
  });
});

describe("parseCerclaTableGovInfo — the GovInfo 2025 edition", () => {
  it("parses the same rows as the eCFR, including the three-cell heading row GPO prints", () => {
    expect(gov.substances).toEqual(ecfr.substances);
    expect(gov.withoutRq).toEqual(ecfr.withoutRq);
  });
});
