import { describe, expect, it } from "vitest";
import { FIRST_VERSION_WITH_GROUP_FLAG, assembleDataset, compareDatasetVersions, cutDataset, datasetChecksum, entriesForVersion, verifyChecksum } from "./buildDataset.js";
import { capturedEcfrDate } from "./govinfoCrossCheck.js";
import { LATEST_DATASET_VERSION, listDatasetVersions, loadDataset, loadDatasetAsCut } from "../src/index.js";
import { parseDataset, type HmtEntry } from "../src/schema.js";

function fuelEntry(over: Partial<HmtEntry> = {}): HmtEntry {
  return {
    entryId: "UN1203-gasoline",
    symbols: [],
    psnPrinted: "Gasoline",
    psnAlternates: [],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1203",
    pgRows: [
      {
        pg: "II",
        labelCodes: ["3"],
        specialProvisions: ["144", "177", "B1", "B33", "IB2", "T4"],
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "5 L", cargoAircraft: "60 L" },
        vesselStowage: { location: "E", other: [] },
      },
    ],
    ...over,
  };
}

describe("assembleDataset", () => {
  it("produces a schema-valid dataset with the given parts", () => {
    const ds = assembleDataset({
      version: "2026.08.0",
      entries: [fuelEntry()],
      erg: [{ idNumber: "1203", guideNumber: "128" }],
      provisional: true,
      sourceEcfrDate: "2026-07-28",
    });
    expect(() => parseDataset(ds)).not.toThrow();
    expect(ds.version).toBe("2026.08.0");
    expect(ds.provisional).toBe(true);
    expect(ds.entries).toHaveLength(1);
    expect(ds.erg).toHaveLength(1);
    // tables without parsers assemble as empty, never undefined
    expect(ds.placards).toEqual([]);
    expect(ds.segregation).toEqual([]);
    expect(ds.specialProvisions).toEqual([]);
  });

  it("stamps a sha256 checksum that round-trips via verifyChecksum", () => {
    const ds = assembleDataset({ version: "v", entries: [fuelEntry()], provisional: false });
    expect(ds.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verifyChecksum(ds)).toBe(true);
  });

  it("checksum is deterministic and independent of property order", () => {
    const a = assembleDataset({ version: "v", entries: [fuelEntry()], provisional: true, sourceEcfrDate: "2026-07-28" });
    const b = assembleDataset({ version: "v", entries: [fuelEntry()], provisional: true, sourceEcfrDate: "2026-07-28" });
    expect(a.checksum).toBe(b.checksum);
  });

  it("checksum changes when any content changes", () => {
    const base = assembleDataset({ version: "v", entries: [fuelEntry()], provisional: true });
    const changed = assembleDataset({ version: "v", entries: [fuelEntry({ hazardClass: "Comb liq" })], provisional: true });
    expect(changed.checksum).not.toBe(base.checksum);
  });

  it("provisional is part of the checksummed content (flipping it re-checksums)", () => {
    const prov = assembleDataset({ version: "v", entries: [fuelEntry()], provisional: true });
    const real = assembleDataset({ version: "v", entries: [fuelEntry()], provisional: false });
    expect(real.checksum).not.toBe(prov.checksum);
  });

  it("detects a tampered dataset via verifyChecksum", () => {
    const ds = assembleDataset({ version: "v", entries: [fuelEntry()], provisional: false });
    const tampered = { ...ds, entries: [fuelEntry({ hazardClass: "9" })] };
    expect(verifyChecksum(tampered)).toBe(false);
  });

  it("datasetChecksum ignores the checksum field itself", () => {
    const ds = assembleDataset({ version: "v", entries: [fuelEntry()], provisional: false });
    const { checksum: _drop, ...content } = ds;
    expect("sha256:" + "".padEnd(0)).not.toBe(ds.checksum); // sanity
    expect(datasetChecksum(content)).toBe(ds.checksum);
  });
});

describe("the namesChemicalGroup version gate (Q-DR17)", () => {
  it("orders YYYY.MM.n numerically, not as strings", () => {
    expect(compareDatasetVersions("2026.08.10", "2026.08.9")).toBeGreaterThan(0);
    expect(compareDatasetVersions("2026.08.0", "2026.08.0")).toBe(0);
    expect(compareDatasetVersions("2026.10.0", "2027.01.0")).toBeLessThan(0);
  });

  it("starts after 2026.08.0, so the attested re-cut of 2026.08.0 rewrites its reviewed content unchanged", () => {
    expect(FIRST_VERSION_WITH_GROUP_FLAG).toBe("2026.09.0");
    expect(compareDatasetVersions("2026.08.0", FIRST_VERSION_WITH_GROUP_FLAG)).toBeLessThan(0);
    expect(compareDatasetVersions("2026.10.0", FIRST_VERSION_WITH_GROUP_FLAG)).toBeGreaterThanOrEqual(0);
    const nos = fuelEntry({ symbols: ["G"], psnPrinted: "Flammable liquids, n.o.s.", idNumber: "1993" });
    expect(entriesForVersion("2026.08.0", [nos])[0]).not.toHaveProperty("namesChemicalGroup");
    expect(entriesForVersion("2026.09.0", [nos])[0]).toHaveProperty("namesChemicalGroup", false);
  });
});

describe("a cut names the eCFR text it was cut from", () => {
  // 2026.08.0 was cut from the 2026-07-28 capture; the fixtures now hold 2026-10-09. Re-running its cut
  // (the old PROMOTION-CHECKLIST §3 command) must refuse instead of attesting text nobody reviewed.
  it.skipIf(!capturedEcfrDate())("refuses a sourceEcfrDate that is not the captured eCFR date, before writing anything", () => {
    expect(capturedEcfrDate()).toBe("2026-10-09");
    expect(() => cutDataset({ version: "2099.01.0", sourceEcfrDate: "2026-07-28", effectiveDate: "2026-08-15" })).toThrow(
      /sourceEcfrDate 2026-07-28 is not the captured eCFR date 2026-10-09/,
    );
  });
});

describe("the registered datasets are the files their cuts wrote", () => {
  it("every registered dataset's stored checksum matches its content (no hand edit since its cut)", () => {
    for (const v of listDatasetVersions()) {
      // The checksum attests the file as minted; what consumers load adds the derived subsidiary classes (D-PC1).
      const ds = loadDatasetAsCut(v);
      if (ds.checksum) expect(verifyChecksum(ds), v).toBe(true);
    }
  });

  // TC1.3 (2026-10-29) added each row's derived `subsidiaryLabels`; it is the only other field loading may add.
  it("what consumers load is the minted file plus the derived subsidiary classes, and nothing else", () => {
    const bare = (e: ReturnType<typeof loadDataset>["entries"][number]) =>
      ({ ...e, subsidiaryClasses: [], pgRows: e.pgRows.map(({ subsidiaryLabels: _derived, ...r }) => r) });
    for (const v of listDatasetVersions()) {
      const cut = loadDatasetAsCut(v);
      const loaded = loadDataset(v);
      expect(loaded.entries.map(bare)).toEqual(cut.entries.map(bare));
      expect({ ...loaded, entries: [] }).toEqual({ ...cut, entries: [] });
    }
  });

  it("2026.10.0 and 2026.12.0 are one text, Appendix A against Table 302.4, both waiting on attestation", () => {
    const oct = loadDataset("2026.10.0");
    const dec = loadDataset("2026.12.0");
    for (const ds of [oct, dec]) {
      expect(ds).toMatchObject({ provisional: true, sourceEcfrDate: "2026-10-09" });
      expect(ds.sourceSecondaryRef).toMatch(/ALL CLEAN.*explained by 91 FR 51098/);
    }
    expect(oct.effectiveDate).toBe("2026-10-14");
    expect(dec.effectiveDate).toBe("2026-12-02");
    expect(oct.hazSubstances).toHaveLength(1351);
    expect(dec.hazSubstances).toHaveLength(1340);
    expect(dec.sourceSecondaryRef).toMatch(/hazSubstances from 40 CFR 302\.4/);
    expect(JSON.stringify(dec.entries)).toBe(JSON.stringify(oct.entries));
    expect(LATEST_DATASET_VERSION).toBe("2026.07.1");
  });
});
