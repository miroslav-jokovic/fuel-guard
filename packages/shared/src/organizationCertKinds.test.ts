import { describe, expect, it } from "vitest";
import {
  CARRIER_ONLY_CERT_KINDS,
  FLEET_WIDE_UNIT_KINDS,
  ORGANIZATION_CERT_KINDS,
  certificationCreateSchema,
} from "./index.js";

/**
 * Which certifications the carrier itself may hold (DQ-INTO-DRIVERS-PLAN DD3). Until 2026-11-05 the
 * schema kept its own list without `ifta`, so the unit rollup read an organization IFTA nobody could
 * write and every tractor's file read "missing" on it for good.
 */
const cert = (subjectType: string, kind: string) =>
  certificationCreateSchema.safeParse({
    id: "11111111-1111-4111-8111-111111111111",
    subjectType,
    subjectId: "22222222-2222-4222-8222-222222222222",
    kind,
    expiresAt: "2027-06-30",
  });

describe("ORGANIZATION_CERT_KINDS", () => {
  it("holds every fleet-wide unit paper, so a fleet policy can be filed once for the whole fleet (D-UF6)", () => {
    for (const kind of FLEET_WIDE_UNIT_KINDS) expect(ORGANIZATION_CERT_KINDS).toContain(kind);
    expect(ORGANIZATION_CERT_KINDS).toContain("ifta");
  });

  it("lets the carrier file every one of them", () => {
    for (const kind of ORGANIZATION_CERT_KINDS) expect(cert("organization", kind).success, kind).toBe(true);
  });

  it("still refuses a person's credential on the carrier", () => {
    expect(cert("organization", "cdl").success).toBe(false);
    expect(cert("organization", "medical_card").success).toBe(false);
  });

  it("still refuses a carrier-only record on a driver or a truck", () => {
    for (const kind of CARRIER_ONLY_CERT_KINDS) {
      expect(cert("driver", kind).success, kind).toBe(false);
      expect(cert("tractor", kind).success, kind).toBe(false);
    }
  });

  it("leaves insurance and IFTA fileable on a single truck too", () => {
    expect(cert("tractor", "ifta").success).toBe(true);
    expect(cert("tractor", "insurance").success).toBe(true);
  });
});
