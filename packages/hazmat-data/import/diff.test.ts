import { describe, expect, it } from "vitest";
import {
  diffAgainstTranscription,
  compareEntry,
  rowKey,
  IN_SCOPE_ENTRIES,
  type TranscribedRow,
} from "./diff.js";
import type { HmtEntry } from "../src/schema.js";

// --- synthetic builders (a matched, agreeing pair) ---------------------------------------------
function entryA(over: Partial<HmtEntry> = {}): HmtEntry {
  return {
    entryId: "UN1223-kerosene",
    symbols: [],
    psnPrinted: "Kerosene",
    psnAlternates: [],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1223",
    pgRows: [
      {
        pg: "III",
        labelCodes: ["3"],
        specialProvisions: ["144", "B1", "IB3", "T2", "TP2"],
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
    ...over,
  };
}
function rowB(over: Partial<TranscribedRow> = {}): TranscribedRow {
  return {
    status: "done",
    idPrefix: "UN",
    idNumber: "1223",
    psnPrinted: "Kerosene",
    symbols: [],
    psnAlternates: [],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    pgRows: [
      {
        pg: "III",
        labelCodes: ["3"],
        specialProvisions: ["144", "B1", "IB3", "T2", "TP2"],
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
    source: "GovInfo CFR-2025-title49-vol2 §172.101 p.214",
    transcriber: "tester",
    transcribedOn: "2026-08-01",
    notes: null,
    ...over,
  };
}
const KEY = rowKey({ idPrefix: "UN", idNumber: "1223", psnPrinted: "Kerosene" });

describe("compareEntry — field-level agreement", () => {
  it("reports no diffs when A and B agree exactly", () => {
    expect(compareEntry(entryA(), rowB())).toEqual([]);
  });

  it("treats symbols as an unordered set but label codes as ordered", () => {
    expect(compareEntry(entryA({ symbols: ["A", "W"] }), rowB({ symbols: ["W", "A"] }))).toEqual([]);
    const d = compareEntry(entryA(), rowB({ pgRows: [{ ...rowB().pgRows[0]!, labelCodes: ["3", "6.1"] }] }));
    expect(d.map((x) => x.field)).toContain("pgRows[III].labelCodes");
  });

  it("flags a hazardClass disagreement", () => {
    const d = compareEntry(entryA({ hazardClass: "3" }), rowB({ hazardClass: "Comb liq" }));
    expect(d).toHaveLength(1);
    expect(d[0]!.field).toBe("hazardClass");
  });

  it("flags a missing special provision", () => {
    const d = compareEntry(
      entryA(),
      rowB({ pgRows: [{ ...rowB().pgRows[0]!, specialProvisions: ["144", "B1", "IB3", "T2"] }] }),
    );
    expect(d.map((x) => x.field)).toEqual(["pgRows[III].specialProvisions"]);
  });

  it("flags a packing-group row present in only one source", () => {
    const twoPg = rowB({
      pgRows: [
        rowB().pgRows[0]!,
        { pg: "II", labelCodes: ["3"], specialProvisions: [], bulkPackagingRef: "242", quantityLimits: { passengerAircraftRail: null, cargoAircraft: null }, vesselStowage: { location: null, other: [] } },
      ],
    });
    const d = compareEntry(entryA(), twoPg);
    expect(d.map((x) => x.field)).toContain("pgRows[II] present");
  });

  it("normalizes whitespace before comparing", () => {
    expect(compareEntry(entryA({ hazardClass: "2.1" }), rowB({ hazardClass: "  2.1 " }))).toEqual([]);
  });
});

describe("diffAgainstTranscription — engine", () => {
  const oneKey = [KEY];

  it("is CLEAN when the single in-scope row matches with provenance", () => {
    const r = diffAgainstTranscription({ sourceA: [entryA()], sourceB: [rowB()], expectedKeys: oneKey });
    expect(r.clean).toBe(true);
    expect(r.summary).toMatchObject({ expected: 1, matched: 1, disagreements: 0, pending: 0, bOnly: 0 });
  });

  it("is NOT clean and lists the field when B disagrees", () => {
    const r = diffAgainstTranscription({
      sourceA: [entryA()],
      sourceB: [rowB({ hazardClass: "9" })],
      expectedKeys: oneKey,
    });
    expect(r.clean).toBe(false);
    expect(r.summary.disagreements).toBe(1);
    expect(r.rows[0]!.fieldDiffs[0]!.field).toBe("hazardClass");
  });

  it("marks pending rows and stays not-clean", () => {
    const r = diffAgainstTranscription({
      sourceA: [entryA()],
      sourceB: [rowB({ status: "pending" })],
      expectedKeys: oneKey,
    });
    expect(r.summary.pending).toBe(1);
    expect(r.clean).toBe(false);
  });

  it("flags a done row that has no matching parsed entry as b-only", () => {
    const r = diffAgainstTranscription({ sourceA: [], sourceB: [rowB()], expectedKeys: oneKey });
    expect(r.rows[0]!.status).toBe("b-only");
    expect(r.clean).toBe(false);
  });

  it("reports an in-scope key that was never transcribed", () => {
    const r = diffAgainstTranscription({ sourceA: [entryA()], sourceB: [], expectedKeys: oneKey });
    expect(r.expectedMissingFromB).toEqual(oneKey);
    expect(r.clean).toBe(false);
  });

  it("refuses to pass a done row with no audit provenance", () => {
    const r = diffAgainstTranscription({
      sourceA: [entryA()],
      sourceB: [rowB({ source: "", transcriber: "" })],
      expectedKeys: oneKey,
    });
    expect(r.rows[0]!.provenanceMissing).toBe(true);
    expect(r.clean).toBe(false);
  });
});

describe("diffAgainstTranscription — default wiring (real scaffold, all pending)", () => {
  it("loads Source A from the committed slice and Source B from the scaffold", () => {
    const r = diffAgainstTranscription();
    expect(r.summary.expected).toBe(IN_SCOPE_ENTRIES.length);
    expect(r.summary.pending).toBe(IN_SCOPE_ENTRIES.length); // every row starts un-transcribed
    expect(r.expectedMissingFromB).toEqual([]); // …but every in-scope key HAS a (pending) row
    expect(r.clean).toBe(false);
  });
});
