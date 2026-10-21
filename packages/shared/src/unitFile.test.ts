import { describe, expect, it } from "vitest";
import { buildUnitFile, unitFileSpecs, type UnitFileInput } from "./unitFile.js";
import { FLEET_WIDE_UNIT_KINDS } from "./equipmentFileCatalogue.js";

const TODAY = "2026-10-19";

const base = (over: Partial<UnitFileInput> = {}): UnitFileInput => ({
  subjectType: "tractor",
  ownership: "owned",
  today: TODAY,
  certs: [],
  fleetCerts: [],
  documents: [],
  unitDates: {},
  ...over,
});
const item = (input: UnitFileInput, key: string) => buildUnitFile(input).items.find((i) => i.spec.key === key);

describe("unitFileSpecs — which papers a unit is asked for", () => {
  it("asks a tractor for IFTA and a trailer not", () => {
    expect(unitFileSpecs("tractor", "owned").specs.map((s) => s.key)).toContain("ifta");
    expect(unitFileSpecs("trailer", "owned").specs.map((s) => s.key)).not.toContain("ifta");
  });

  it("asks an owned unit for its title and a leased or owner-operator unit for its lease", () => {
    const owned = unitFileSpecs("tractor", "owned").specs.map((s) => s.key);
    expect(owned).toContain("title");
    expect(owned).not.toContain("lease");
    for (const o of ["leased", "owner_operator"] as const) {
      const keys = unitFileSpecs("trailer", o).specs.map((s) => s.key);
      expect(keys).toContain("lease");
      expect(keys).not.toContain("title");
    }
  });

  it("holds title and lease aside while ownership is unknown, rather than calling either missing (D-UF11)", () => {
    const { specs, ownershipUnknown } = unitFileSpecs("tractor", null);
    expect(specs.map((s) => s.key)).not.toContain("title");
    expect(specs.map((s) => s.key)).not.toContain("lease");
    expect(ownershipUnknown.map((s) => s.key).sort()).toEqual(["lease", "title"]);
    const file = buildUnitFile(base({ ownership: null }));
    expect(file.items.some((i) => i.spec.key === "title" || i.spec.key === "lease")).toBe(false);
    expect(file.ownershipUnknown.map((s) => s.key).sort()).toEqual(["lease", "title"]);
  });
});

describe("buildUnitFile — evidence", () => {
  it("reads a registration or an IRP cab card as the registration, whichever runs longer", () => {
    const r = item(base({
      certs: [
        { kind: "registration", issuedAt: null, expiresAt: "2026-12-01", documentId: null },
        { kind: "irp", issuedAt: null, expiresAt: "2027-03-31", documentId: null },
      ],
    }), "registration");
    expect(r?.state).toBe("current");
    expect(r?.goodUntil).toBe("2027-03-31");
  });

  it("lets the fleet's policy on the organization cover a unit with none of its own, and says so (D-UF6)", () => {
    const fleet = { kind: "insurance", issuedAt: null, expiresAt: "2027-01-01", documentId: "pol" };
    const ins = item(base({ fleetCerts: [fleet], documents: [{ id: "pol", kind: "insurance", datedAt: "2026-01-01" }] }), "insurance");
    expect(ins?.state).toBe("current");
    expect(ins?.fleetWide).toBe(true);
    // The cited fleet paper counts as filed when it is in the documents the rollup fetched.
    expect(ins?.documentId).toBe("pol");
  });

  it("prefers the unit's own paper to the fleet's, even when the unit's has lapsed", () => {
    const ins = item(base({
      certs: [{ kind: "insurance", issuedAt: null, expiresAt: "2026-09-01", documentId: null }],
      fleetCerts: [{ kind: "insurance", issuedAt: null, expiresAt: "2027-01-01", documentId: null }],
    }), "insurance");
    expect(ins?.state).toBe("expired");
    expect(ins?.fleetWide).toBe(false);
  });

  it("never lets a fleet paper satisfy an item that is not fleet-wide", () => {
    expect(FLEET_WIDE_UNIT_KINDS).not.toContain("registration");
    const reg = item(base({ fleetCerts: [{ kind: "registration", issuedAt: null, expiresAt: "2027-01-01", documentId: null }] }), "registration");
    expect(reg?.state).toBe("missing");
  });

  it("proves a title by its scan alone — it never expires", () => {
    const title = item(base({ documents: [{ id: "t", kind: "title", datedAt: "2021-04-02" }] }), "title");
    expect(title?.state).toBe("current");
    expect(title?.documentId).toBe("t");
    expect(title?.goodUntil).toBeNull();
  });

  it("reads a failed annual inspection's same-day expiry as expired, not as covered until next year", () => {
    const annual = item(base({
      certs: [{ kind: "annual_inspection", issuedAt: "2026-10-01", expiresAt: "2026-10-01", documentId: null }],
    }), "annual_inspection");
    expect(annual?.state).toBe("expired");
  });
});

describe("buildUnitFile — McLeod's typed dates (D-UF3)", () => {
  it("keeps an item with only a typed date missing, and shows what the date would mean beside it", () => {
    const reg = item(base({ unitDates: { registration_expires_at: "2026-11-01" } }), "registration");
    expect(reg?.state).toBe("missing");
    expect(reg?.dateOnly).toEqual({ goodUntil: "2026-11-01", state: "expiring" });
  });

  it("drops the typed date once a paper is on file — the paper is the answer", () => {
    const reg = item(base({
      certs: [{ kind: "registration", issuedAt: null, expiresAt: "2027-02-01", documentId: null }],
      unitDates: { registration_expires_at: "2026-11-01" },
    }), "registration");
    expect(reg?.dateOnly).toBeNull();
    expect(reg?.goodUntil).toBe("2027-02-01");
  });

  it("counts a date-only item against the file — a date with no paper is not a complete file", () => {
    const file = buildUnitFile(base({
      ownership: null,
      certs: [
        { kind: "annual_inspection", issuedAt: null, expiresAt: "2027-06-01", documentId: null },
        { kind: "insurance", issuedAt: null, expiresAt: "2027-06-01", documentId: null },
        { kind: "ifta", issuedAt: null, expiresAt: "2027-06-01", documentId: null },
      ],
      unitDates: { registration_expires_at: "2027-06-01" },
    }));
    expect(file.counts.missing).toBe(1);
    expect(file.state).toBe("incomplete");
  });
});

describe("buildUnitFile — a paper on file that nobody has dated (Q-UF13)", () => {
  // The McLeod import's shape: the unit's cab card filed, no certification, McLeod's date on the row.
  const cab = { id: "cab26", kind: "irp", datedAt: "2026-02-23" };
  const older = { id: "cab25", kind: "irp", datedAt: "2025-03-24" };

  it("keeps the item missing and names the newest scan of its kinds as the paper waiting for a date", () => {
    const reg = item(base({ documents: [older, cab], unitDates: { registration_expires_at: "2027-02-28" } }), "registration");
    expect(reg?.state).toBe("missing");
    expect(reg?.paperOnFile).toEqual({ documentId: "cab26", datedAt: "2026-02-23" });
    // McLeod's date still stands beside it — the office reads it against the paper.
    expect(reg?.dateOnly).toEqual({ goodUntil: "2027-02-28", state: "current" });
  });

  it("says nothing once a certification dates the item, or when no scan of its kinds is on file", () => {
    const dated = item(base({
      documents: [cab],
      certs: [{ kind: "irp", issuedAt: null, expiresAt: "2027-02-28", documentId: "cab26" }],
    }), "registration");
    expect(dated?.state).toBe("current");
    expect(dated?.paperOnFile).toBeNull();
    expect(item(base({ documents: [{ id: "a1", kind: "annual_inspection", datedAt: "2026-07-27" }] }), "registration")?.paperOnFile).toBeNull();
  });

  it("never applies to an item whose scan IS the evidence — a filed title is simply current", () => {
    const title = item(base({ documents: [{ id: "t1", kind: "title", datedAt: "2024-01-01" }] }), "title");
    expect(title?.state).toBe("current");
    expect(title?.paperOnFile).toBeNull();
  });
});

describe("buildUnitFile — the file's own state", () => {
  it("is not_started with nothing of the unit's own, even when a fleet policy covers it", () => {
    const file = buildUnitFile(base({ fleetCerts: [{ kind: "insurance", issuedAt: null, expiresAt: "2027-01-01", documentId: null }] }));
    expect(file.state).toBe("not_started");
  });

  it("is complete when every item that applies is current — a permit nobody holds is not missing", () => {
    const year = { issuedAt: null, expiresAt: "2027-06-01", documentId: null };
    const file = buildUnitFile(base({
      subjectType: "trailer",
      ownership: "leased",
      certs: ["registration", "lease", "insurance", "annual_inspection"].map((kind) => ({ kind, ...year })),
    }));
    expect(file.items.map((i) => i.spec.key)).not.toContain("permit");
    expect(file.state).toBe("complete");
  });
});
