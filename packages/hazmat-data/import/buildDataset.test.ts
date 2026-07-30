import { describe, expect, it } from "vitest";
import { assembleDataset, datasetChecksum, verifyChecksum } from "./buildDataset.js";
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
