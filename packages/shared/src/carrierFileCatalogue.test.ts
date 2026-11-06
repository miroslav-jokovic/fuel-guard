import { describe, expect, it } from "vitest";
import {
  CARRIER_GROUPS,
  CARRIER_ITEMS,
  buildCarrierFile,
  carrierFileSpecs,
} from "./carrierFileCatalogue.js";
import { ORGANIZATION_CERT_KINDS } from "./complianceContract.js";
import { EQUIPMENT_ITEMS } from "./equipmentFileCatalogue.js";
import { fileSectionFor } from "./fileSections.js";

const TODAY = "2026-11-06";
const keys = (specs: readonly { key: string }[]) => specs.map((s) => s.key);

describe("the carrier's file catalogue (D-DQ23)", () => {
  it("names every organization kind exactly once, and nothing else", () => {
    const kinds = CARRIER_ITEMS.flatMap((i) => i.evidenceKinds);
    expect([...kinds].sort()).toEqual([...ORGANIZATION_CERT_KINDS].sort());
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("reads the fleet papers from the truck file's catalogue instead of restating them", () => {
    for (const unit of EQUIPMENT_ITEMS.filter((i) => i.fleetWide)) {
      const mine = CARRIER_ITEMS.find((i) => i.key === unit.key);
      expect(mine).toMatchObject({ label: unit.label, citation: unit.citation, recurrence: unit.recurrence, retention: unit.retention });
      expect(CARRIER_GROUPS).toContain(mine?.group);
    }
  });

  it("splits its rows between the two sections the API files them under", () => {
    const sections = new Set(CARRIER_ITEMS.map((i) => fileSectionFor("organization", i.evidenceKinds[0])));
    expect(sections).toEqual(new Set(["roster", "equipment"]));
  });

  it("asks for the hazmat records only of a carrier running HazmatGuard", () => {
    expect(keys(carrierFileSpecs({ includeHazmat: false }))).toEqual(["operating_authority", "insurance", "ifta"]);
    expect(keys(carrierFileSpecs({ includeHazmat: true }))).toEqual(expect.arrayContaining(["phmsa_registration", "financial_responsibility", "security_plan", "hazmat_safety_permit"]));
  });
});

describe("buildCarrierFile", () => {
  const empty = { certs: [], documentIds: new Set<string>(), today: TODAY };

  it("opens a hazmat carrier with nothing filed on five missing rows, the conditional two hidden", () => {
    const file = buildCarrierFile({ ...empty, includeHazmat: true });
    expect(file.state).toBe("not_started");
    expect(keys(file.items.map((i) => i.spec))).toEqual(["operating_authority", "insurance", "financial_responsibility", "ifta", "phmsa_registration"]);
    expect(file.items.every((i) => i.state === "missing")).toBe(true);
  });

  it("dates a record by its expiry and cites its scan only when the scan is on file", () => {
    const file = buildCarrierFile({
      certs: [
        { kind: "phmsa_registration", issuedAt: "2026-07-01", expiresAt: "2027-06-30", documentId: "doc-1" },
        { kind: "insurance", issuedAt: null, expiresAt: "2026-11-20", documentId: "doc-gone" },
      ],
      documentIds: new Set(["doc-1"]),
      today: TODAY,
      includeHazmat: true,
    });
    const phmsa = file.items.find((i) => i.spec.key === "phmsa_registration");
    expect(phmsa).toMatchObject({ state: "current", goodUntil: "2027-06-30", documentId: "doc-1" });
    expect(file.items.find((i) => i.spec.key === "insurance")).toMatchObject({ state: "expiring", documentId: null });
  });

  it("shows a security plan once one is filed, and never as missing before", () => {
    const filed = buildCarrierFile({
      ...empty,
      certs: [{ kind: "security_plan", issuedAt: "2026-01-10", expiresAt: "2025-12-31", documentId: null }],
      includeHazmat: true,
    });
    expect(filed.items.find((i) => i.spec.key === "security_plan")?.state).toBe("expired");
    expect(filed.items.some((i) => i.spec.key === "hazmat_safety_permit")).toBe(false);
  });

  it("keeps operating authority current with no expiry, since it does not lapse", () => {
    const file = buildCarrierFile({
      ...empty,
      certs: [{ kind: "operating_authority", issuedAt: "2019-03-01", expiresAt: null, documentId: null }],
      includeHazmat: false,
    });
    expect(file.items.find((i) => i.spec.key === "operating_authority")).toMatchObject({ state: "current", expiryUnknown: false });
  });
});
