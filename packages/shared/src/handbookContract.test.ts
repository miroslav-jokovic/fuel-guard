import { describe, it, expect } from "vitest";
import {
  HANDBOOK_CARRIER_PLACEMENT_ID,
  HANDBOOK_DRIVER_PLACEMENT_IDS,
  HANDBOOK_PLACEMENTS,
  handbookMarkSchema,
  handbookStatus,
  maskedSsn,
} from "./handbookContract.js";
import { APPLICATION_RELEASE_ORDER } from "./applicationIntake.js";

/**
 * The handbook's places and the one fold both screens read (HANDBOOK-SIGNING-PLAN.md).
 */
describe("the handbook's places", () => {
  it("are the carrier's five driver blocks and one countersignature, in the document's order", () => {
    expect(HANDBOOK_PLACEMENTS.map((p) => `${p.id}:${p.party}`)).toEqual([
      "h1:driver", "h2:driver", "h3:driver", "h4:driver", "h4c:carrier", "h5:driver",
    ]);
    expect(HANDBOOK_DRIVER_PLACEMENT_IDS).toEqual(["h1", "h2", "h3", "h4", "h5"]);
    expect(HANDBOOK_CARRIER_PLACEMENT_ID).toBe("h4c");
  });

  it("affirm the carrier's own sentence where its block has one", () => {
    const what = (id: string) => HANDBOOK_PLACEMENTS.find((p) => p.id === id)!.what;
    expect(what("h3")).toBe("By signing this, I agree to safety penalty policy.");
    expect(what("h5")).toMatch(/^I certify that I have passed a safety training at Silvicom Inc/);
  });

  it("never reach the applicant's remote permissions (D-HM10)", () => {
    for (const p of HANDBOOK_PLACEMENTS) {
      expect(APPLICATION_RELEASE_ORDER as readonly string[]).not.toContain(p.id);
    }
    expect(APPLICATION_RELEASE_ORDER as readonly string[]).not.toContain("handbook");
  });
});

describe("a driver's mark", () => {
  it("is accepted at a driver place with the e-sign consent", () => {
    expect(handbookMarkSchema.safeParse({ placement_id: "h3", esign_consent: true }).success).toBe(true);
  });

  it("is refused at the carrier's place, however it is asked for", () => {
    expect(handbookMarkSchema.safeParse({ placement_id: "h4c", esign_consent: true }).success).toBe(false);
  });

  it("is refused without the e-sign consent", () => {
    expect(handbookMarkSchema.safeParse({ placement_id: "h1", esign_consent: false }).success).toBe(false);
  });
});

describe("the SSN on the receipt (D-HB2)", () => {
  it("prints as •••1234", () => {
    expect(maskedSsn("1234")).toBe("•••1234");
  });

  it("prints nothing for anything that is not four digits", () => {
    for (const bad of [null, undefined, "", "123", "12345", "12a4", "123-45-6789"]) {
      expect(maskedSsn(bad)).toBe("");
    }
  });
});

describe("where a handbook stands", () => {
  const base = { submittedAt: "2026-09-25T10:00:00Z", openedAt: null, filedAt: null, signedPlacementIds: [] };

  it("can open only once the application is filed", () => {
    expect(handbookStatus(base).canOpen).toBe(true);
    expect(handbookStatus({ ...base, submittedAt: null }).canOpen).toBe(false);
  });

  it("is driver-complete on the five driver places, in order, whatever else is on the ledger", () => {
    const s = handbookStatus({ ...base, signedPlacementIds: ["h5", "h4c", "h1", "h2", "h3", "h4", "p25"] });
    expect(s.driverSigned).toEqual(["h1", "h2", "h3", "h4", "h5"]);
    expect(s.driverComplete).toBe(true);
  });

  it("is not driver-complete with one place left, even with the countersignature", () => {
    const s = handbookStatus({ ...base, signedPlacementIds: ["h1", "h2", "h3", "h4", "h4c"] });
    expect(s.driverComplete).toBe(false);
  });
});
