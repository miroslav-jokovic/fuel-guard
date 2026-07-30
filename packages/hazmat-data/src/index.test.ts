import { describe, expect, it } from "vitest";
import {
  loadDataset,
  listDatasetVersions,
  LATEST_DATASET_VERSION,
  parseDataset,
  buildMatchRecords,
  resolveEntry,
  normalizePsn,
  type HmtEntry,
} from "./index";

// ── Synthetic fixtures (NOT regulatory data). entryId/idNumber are made up on purpose so these tests
// never depend on — or assert — real CFR content. Real rows come from the reviewed import (H1.6). ──
const gasoilUN: HmtEntry = {
  entryId: "T-UN0002",
  symbols: [],
  psnPrinted: "Test gas oil",
  psnAlternates: ["Test diesel fuel", "Test heating oil light"],
  italicText: null,
  hazardClass: "3",
  subsidiaryClasses: [],
  idPrefix: "UN",
  idNumber: "0002",
  pgRows: [{ pg: "III", labelCodes: ["3"], specialProvisions: [], bulkPackagingRef: null }],
};
const dieselNA: HmtEntry = {
  entryId: "T-NA0001",
  symbols: ["D"],
  psnPrinted: "Test diesel fuel",
  psnAlternates: [],
  italicText: null,
  hazardClass: "3",
  subsidiaryClasses: [],
  idPrefix: "NA",
  idNumber: "0001",
  pgRows: [{ pg: "III", labelCodes: ["3"], specialProvisions: [], bulkPackagingRef: null }],
};
const gasClass2: HmtEntry = {
  entryId: "T-UN0003",
  symbols: [],
  psnPrinted: "Test flammable gas",
  psnAlternates: [],
  italicText: null,
  hazardClass: "2.1",
  subsidiaryClasses: [],
  idPrefix: "UN",
  idNumber: "0003",
  pgRows: [{ pg: null, labelCodes: ["2.1"], specialProvisions: [], bulkPackagingRef: null }],
};
const synthetic = parseDataset({ version: "test", entries: [gasoilUN, dieselNA, gasClass2] });

describe("@hazmat/data — loader + schema (H1)", () => {
  it("ships the real §172.101 dataset, provisional until the two-source transcription lands", () => {
    const ds = loadDataset();
    expect(ds.version).toBe(LATEST_DATASET_VERSION);
    expect(ds.provisional).toBe(true); // real content, but not yet second-source-verified (H1.6)
    expect(ds.entries.length).toBeGreaterThan(1000);
    expect(ds.placards.length).toBeGreaterThan(0);
    expect(ds.erg.length).toBeGreaterThan(0);
    expect(listDatasetVersions()).toContain(LATEST_DATASET_VERSION);
  });

  it("throws on an unknown version rather than a silent empty set", () => {
    expect(() => loadDataset("1999.01")).toThrow(/Unknown hazmat dataset/);
  });

  it("rejects a malformed dataset (a PG outside I/II/III)", () => {
    expect(() =>
      parseDataset({ version: "x", entries: [{ ...gasoilUN, pgRows: [{ pg: "IV" }] }] }),
    ).toThrow();
  });

  it("allows a null PG (Class 2 gases have no packing group)", () => {
    expect(synthetic.entries[2]?.pgRows[0]?.pg).toBeNull();
  });
});

describe("buildMatchRecords — 'or'-alternates expand", () => {
  it("emits one record per (name × pg-row), alternates included", () => {
    const recs = buildMatchRecords([gasoilUN]);
    // 3 names (printed + 2 alternates) × 1 pg-row = 3
    expect(recs).toHaveLength(3);
    expect(recs.every((r) => r.entryId === "T-UN0002")).toBe(true);
    expect(recs.map((r) => r.normalizedPsn)).toContain(normalizePsn("Test diesel fuel"));
  });
});

describe("resolveEntry — 'resolves uniquely' = one entryId + one pg-row (fail-closed)", () => {
  it("a shared name across UN/NA self-ambiguates without an ID", () => {
    const r = resolveEntry(synthetic, { psn: "Test diesel fuel" });
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates).toHaveLength(2);
  });

  it("the ID prefix disambiguates to a unique entry", () => {
    const r = resolveEntry(synthetic, { psn: "Test diesel fuel", idPrefix: "UN" });
    expect(r).toEqual({ status: "unique", entryId: "T-UN0002", pg: "III" });
  });

  it("an unknown name resolves to not_found, never a guess", () => {
    expect(resolveEntry(synthetic, { psn: "nothing here" })).toEqual({ status: "not_found" });
  });
});
