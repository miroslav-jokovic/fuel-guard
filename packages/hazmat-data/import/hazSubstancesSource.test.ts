import { describe, expect, it } from "vitest";
import { APPENDIX_A_REPLACED_ON, cerclaSourceNote, hazSubstancesSourceFor, loadHazSubstances, readImportFixture } from "./hazSubstancesSource.js";
import { diffHazSubstanceSources, pairKey } from "./hazSubstancesDiff.js";
import { compareCerclaTables, crossCheckCerclaDefault } from "./cerclaCrossCheck.js";
import { parseCerclaTable } from "./parseCercla.js";

describe("hazSubstancesSourceFor — the list in force on the dataset's effective date (91 FR 49305)", () => {
  it("is Appendix A the day before 2026-12-02 and 40 CFR 302.4 from that day", () => {
    expect(APPENDIX_A_REPLACED_ON).toBe("2026-12-02");
    expect(hazSubstancesSourceFor({ effectiveDate: "2026-12-01" })).toBe("49cfr172.101-appA");
    expect(hazSubstancesSourceFor({ effectiveDate: "2026-12-02" })).toBe("40cfr302.4");
    expect(hazSubstancesSourceFor({ effectiveDate: "2027-03-01" })).toBe("40cfr302.4");
  });

  it("takes the effective date over the source date, and the source date when that is all there is", () => {
    // 2026.08.0's own dates — it must keep reading Appendix A.
    expect(hazSubstancesSourceFor({ effectiveDate: "2026-08-15", sourceEcfrDate: "2026-07-28" })).toBe("49cfr172.101-appA");
    expect(hazSubstancesSourceFor({ effectiveDate: "2026-12-15", sourceEcfrDate: "2026-10-07" })).toBe("40cfr302.4");
    expect(hazSubstancesSourceFor({ sourceEcfrDate: "2026-12-03" })).toBe("40cfr302.4");
  });

  it("refuses a cut with no date, or a date it cannot read", () => {
    expect(() => hazSubstancesSourceFor({})).toThrow(/effectiveDate or sourceEcfrDate/);
    expect(() => hazSubstancesSourceFor({ effectiveDate: "12/02/2026" })).toThrow(/YYYY-MM-DD/);
  });
});

describe("loadHazSubstances — parses the selected capture", () => {
  it("reads 1,351 Appendix A rows before the date and 1,340 Table 302.4 rows from it", () => {
    const before = loadHazSubstances({ effectiveDate: "2026-12-01" });
    expect(before.source).toBe("49cfr172.101-appA");
    expect(before.substances).toHaveLength(1351);
    expect(cerclaSourceNote(before)).toBe("");
    const after = loadHazSubstances({ effectiveDate: "2026-12-02" });
    expect(after.source).toBe("40cfr302.4");
    expect(after.substances).toHaveLength(1340);
    expect(cerclaSourceNote(after)).toMatch(/1340 rows with lb\+kg RQ, 50 without \(no_rq_assigned 47, radionuclide_appendix_b 1, heading 1, statutory_rq_no_kg 1\)/);
  });

  it("names the capture script when the 302.4 capture is missing (never falls back to Appendix A)", () => {
    const onlyTitle49 = (n: string) => (n === "section-40-302-4.xml" ? null : readImportFixture(n));
    expect(() => loadHazSubstances({ effectiveDate: "2026-12-02" }, onlyTitle49)).toThrow(/captureCercla\.ts/);
  });
});

describe("cerclaCrossCheck — eCFR vs GovInfo CFR-2025-title40-vol30", () => {
  it("is CLEAN on the committed captures: 1,340/1,340 rows and the same 50 rows without an RQ", () => {
    const r = crossCheckCerclaDefault();
    expect(r).toMatchObject({ aCount: 1340, bCount: 1340, matched: 1340, onlyA: [], onlyB: [], withoutRqOnlyA: [], withoutRqOnlyB: [], clean: true });
    expect(r.sourceRef).toBe("GovInfo CFR-2025-title40-vol30, §302.4 (2025-07-01)");
  });

  it("catches a single changed RQ, a dropped duplicate row and a moved no-RQ row (not vacuous)", () => {
    const a = parseCerclaTable(readImportFixture("section-40-302-4.xml")!);
    const benzene = a.substances.findIndex((s) => s.name === "Benzene");
    const changed = { ...a, substances: a.substances.map((s, i) => (i === benzene ? { ...s, rqKg: 4.5 } : s)) };
    const r1 = compareCerclaTables(a, changed, "drift");
    expect([r1.onlyA, r1.onlyB, r1.clean]).toEqual([["Benzene | 71-43-2 | 10 (4.54)"], ["Benzene | 71-43-2 | 10 (4.5)"], false]);
    // "(a) Tetrachloroethylene" appears twice (under F001 and F002): losing one copy must show.
    const dup = a.substances.findIndex((s) => s.name === "(a) Tetrachloroethylene");
    const r2 = compareCerclaTables(a, { ...a, substances: a.substances.filter((_, i) => i !== dup) }, "drop");
    expect(r2.onlyA).toEqual(["(a) Tetrachloroethylene | 127-18-4 | 100 (45.4)"]);
    const r3 = compareCerclaTables(a, { ...a, withoutRq: a.withoutRq.slice(1) }, "no-rq");
    expect([r3.withoutRqOnlyA, r3.clean]).toEqual([["no_rq_assigned | ANTIMONY AND COMPOUNDS | **"], false]);
  });
});

describe("diffHazSubstanceSources — Appendix A today vs Table 302.4", () => {
  const appA = loadHazSubstances({ effectiveDate: "2026-12-01" }).substances;
  const cercla = loadHazSubstances({ effectiveDate: "2026-12-02" }).substances;
  const d = diffHazSubstanceSources(appA, cercla);
  const onlyA = d.onlyAppendixA.map((s) => s.name);
  const onlyB = d.onlyCercla.map((s) => s.name);

  it("pairs 1,316 rows with the same RQ, finds no RQ that differs, and 35 / 24 rows only in one list", () => {
    expect([d.appendixACount, d.cerclaCount, d.matched, d.rqDiffs.length, onlyA.length, onlyB.length]).toEqual([1351, 1340, 1316, 0, 35, 24]);
  });

  it("loses PHMSA's eleven '@' synonyms — names that are HMT proper shipping names", () => {
    expect(onlyA.filter((n) => n.endsWith("@"))).toEqual([
      "Ammonium dichromate @", "Copper chloride @", "Dimethylhydrazine, unsymmetrical @", "Dinitrogen tetroxide @",
      "Ethyl methyl ketone @", "Methylamine @", "Methyl chloroformate @", "Methyl chloromethyl ether @",
      "Perchloromethyl mercaptan @", "Phenyl mercaptan @", "Sulfur chlorides @",
    ]);
  });

  it("gains PFOA/PFOS and 1-bromopropane, and drops the K064–K066/K090–K091 streams 302.4 no longer lists", () => {
    expect(onlyB).toEqual(expect.arrayContaining(["Perfluorooctanoic acid", "Perfluorooctanesulfonic acid", "1-Bromopropane (1-BP)", "n-Propyl bromide (nPB)"]));
    expect(onlyA).toEqual(expect.arrayContaining(["K064", "K065", "K066", "K090", "K091", "K181"]));
  });

  it("pairs Appendix A's 'DDE (CAS) #' with 302.4's DDE of that CAS", () => {
    expect(onlyA.some((n) => n.startsWith("DDE"))).toBe(false);
    expect(pairKey("DDE (72-55-9) #")).toBe(pairKey("DDE (72-55-9)"));
  });

  it("reports Appendix A's 'RADIONUCLIDES' row, whose 100-lb RQ its parser inherited from the row above ('See Table 2')", () => {
    expect(d.onlyAppendixA.find((s) => s.name === "RADIONUCLIDES")).toMatchObject({ rqPounds: 100, rqKg: 45.4 });
  });
});
