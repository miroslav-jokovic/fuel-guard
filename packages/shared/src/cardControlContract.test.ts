import { describe, expect, it } from "vitest";
import {
  CARD_CONTROL_AUDIT_ACTIONS,
  CARD_CONTROL_SCOPES,
  CARD_SCOPE_DESCRIPTIONS,
  CARD_SCOPE_LABELS,
  cardApproverGrantSchema,
  cardControlSettingsPatchSchema,
  grantOverrideSchema,
  isCardControlScope,
  lockCardSchema,
  setPromptsSchema,
  unlockCardSchema,
} from "./cardControlContract.js";
import { canonicalEfsStatus, efsStatusEquals } from "./efsCardCatalog.js";

/**
 * The permission vocabulary, tested where it is defined. These strings are load-bearing in three
 * places that cannot see each other — a Postgres array, the capability gate, and a checkbox — so the
 * only thing keeping them honest is a test that names them.
 */
describe("card control scopes — the permission vocabulary", () => {
  it("keeps the four scopes and their labels in step", () => {
    // Three surfaces read these exact strings: the `scopes` array in 0173, the capability gate, and
    // the settings UI. A scope with no label is a checkbox with no name.
    for (const scope of CARD_CONTROL_SCOPES) {
      expect(CARD_SCOPE_LABELS[scope]).toBeTruthy();
      expect(CARD_SCOPE_DESCRIPTIONS[scope]).toBeTruthy();
    }
    expect(CARD_CONTROL_SCOPES).toHaveLength(4);
  });

  it("recognises only the four", () => {
    expect(isCardControlScope("override")).toBe(true);
    expect(isCardControlScope("delete_card")).toBe(false);
    expect(isCardControlScope("")).toBe(false);
  });

  it("refuses a grant with no scopes", () => {
    // An approver row with no scopes is a person who looks authorised and is not.
    expect(cardApproverGrantSchema.safeParse({ scopes: [] }).success).toBe(false);
    expect(cardApproverGrantSchema.safeParse({ scopes: ["lock"] }).success).toBe(true);
  });

  it("refuses an invented scope", () => {
    expect(cardApproverGrantSchema.safeParse({ scopes: ["lock", "wire_money"] }).success).toBe(false);
  });

  it("refuses a settings patch that changes nothing", () => {
    // A no-op PATCH would write an audit row saying a permission changed when none did.
    expect(cardControlSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(cardControlSettingsPatchSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(cardControlSettingsPatchSchema.safeParse({ requireApprover: false }).success).toBe(true);
  });

  it("names every audit action it will write", () => {
    // The vocabulary is asserted so a rename cannot silently orphan an auditor's saved search.
    expect(CARD_CONTROL_AUDIT_ACTIONS.controlEnabled).toBe("card.control_enabled");
    expect(CARD_CONTROL_AUDIT_ACTIONS.approverGranted).toBe("card.approver_granted");
    expect(CARD_CONTROL_AUDIT_ACTIONS.approverRevoked).toBe("card.approver_revoked");
    for (const action of Object.values(CARD_CONTROL_AUDIT_ACTIONS)) {
      expect(action).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
  });
});

describe("vendor status casing — what a production account actually sends", () => {
  it("treats HOLD and Hold as one state", () => {
    // Measured, not hypothetical: this fleet's 199 mirrored cards are ACTIVE / INACTIVE / HOLD, while
    // the guide documents Active / Inactive / Hold (p35).
    expect(efsStatusEquals("HOLD", "Hold")).toBe(true);
    expect(efsStatusEquals("ACTIVE", "Active")).toBe(true);
    expect(efsStatusEquals(" active ", "Active")).toBe(true);
  });

  it("does not treat a DIFFERENT state as the same one", () => {
    // Case is the only tolerance. Anything else and an unfamiliar state would be silently coerced
    // into a familiar one, which is the opposite of what migration 0176 decided.
    expect(efsStatusEquals("Held", "Hold")).toBe(false);
    expect(efsStatusEquals("", "Hold")).toBe(false);
    expect(efsStatusEquals(null, "Hold")).toBe(false);
    expect(efsStatusEquals(null, null)).toBe(true);
  });

  it("maps a vendor spelling back to the documented one for display, and leaves the rest alone", () => {
    expect(canonicalEfsStatus("ACTIVE")).toBe("Active");
    expect(canonicalEfsStatus("hold")).toBe("Hold");
    // An unrecognised status is news; showing it verbatim is the point.
    expect(canonicalEfsStatus("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(canonicalEfsStatus(null)).toBeNull();
  });
});

// ─── Audit P0-3 tripwire: the lock endpoint must never be able to activate a card ───────────────
describe("lockCardSchema (audit P0-3)", () => {
  const base = { expectedVersion: "0123456789abcdef0123456789abcdef", reason: "test lock" };

  it("refuses status Active — unlock is the only path that writes Active", () => {
    expect(lockCardSchema.safeParse({ ...base, status: "Active" }).success).toBe(false);
  });

  it("accepts Hold and Inactive, defaulting to Hold", () => {
    expect(lockCardSchema.parse({ ...base }).status).toBe("Hold");
    expect(lockCardSchema.parse({ ...base, status: "Inactive" }).status).toBe("Inactive");
  });

  it("refuses Deleted and Fraud outright", () => {
    for (const status of ["Deleted", "Fraud", "HOLD "]) {
      expect(lockCardSchema.safeParse({ ...base, status }).success).toBe(false);
    }
  });
});

// ─── Phase 2 contract tripwires (audit P1-6, B1) ────────────────────────────────────────────────
describe("promptInputSchema / setPromptsSchema (audit P1-6)", () => {
  const base = { expectedVersion: "0123456789abcdef0123456789abcdef", replaceAll: true as const };

  it("refuses EXACT_MATCH with an empty match value — that combination bricks the pump", () => {
    for (const matchValue of ["", null]) {
      const parsed = setPromptsSchema.safeParse({
        ...base, prompts: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue }],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("accepts REPORT_ONLY with an empty value — reporting nothing is legal", () => {
    expect(setPromptsSchema.safeParse({
      ...base, prompts: [{ infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null }],
    }).success).toBe(true);
  });

  it("refuses duplicate infoIds — a full-replace with two DRID records is a vendor shape EFS never emits", () => {
    expect(setPromptsSchema.safeParse({
      ...base,
      prompts: [
        { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "111" },
        { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "222" },
      ],
    }).success).toBe(false);
  });
});

describe("grantOverrideSchema locationId (audit P1-6c)", () => {
  const base = {
    expectedVersion: "0123456789abcdef0123456789abcdef",
    uses: 1,
  };

  it("refuses 0 in every width — that is the no-override sentinel, not a location", () => {
    for (const locationId of ["0", "0000000"]) {
      expect(grantOverrideSchema.safeParse({
        ...base, scope: { kind: "location", locationId },
      }).success).toBe(false);
    }
  });

  it("accepts a real location id", () => {
    expect(grantOverrideSchema.safeParse({
      ...base, scope: { kind: "location", locationId: "123456" },
    }).success).toBe(true);
  });
});

describe("reason is optional (product decision B1)", () => {
  it("a mutation without a reason parses, defaulting to empty", () => {
    const parsed = unlockCardSchema.parse({ expectedVersion: "0123456789abcdef0123456789abcdef" });
    expect(parsed.reason).toBe("");
  });

  it("a reason that IS given still has to say something", () => {
    expect(unlockCardSchema.safeParse({
      expectedVersion: "0123456789abcdef0123456789abcdef", reason: "ab",
    }).success).toBe(false);
  });
});
