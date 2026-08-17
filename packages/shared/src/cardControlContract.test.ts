import { describe, expect, it } from "vitest";
import { deactivateCardSchema, grantOverrideSchema, lockCardSchema, setPromptsSchema, unlockCardSchema } from "./cardControlContract.js";
import { EFS_DYNAMIC_INFO_IDS, EFS_INFO_LABELS, EFS_VALIDATION_TYPES } from "./efsCardCatalog.js";
// The permission vocabulary and the settings shapes moved here in Step 3.7's split. Imported from
// the module rather than the package index, so this file keeps saying which one owns each symbol.
import {
  CARD_CONTROL_AUDIT_ACTIONS,
  CARD_CONTROL_SCOPES,
  CARD_SCOPE_DESCRIPTIONS,
  CARD_SCOPE_LABELS,
  cardApproverGrantSchema,
  cardControlSettingsPatchSchema,
  isCardControlScope,
} from "./cardControlLedger.js";
import { canonicalEfsStatus, efsStatusEquals } from "./efsCardCatalog.js";

/**
 * The permission vocabulary, tested where it is defined. These strings are load-bearing in three
 * places that cannot see each other — a Postgres array, the capability gate, and a checkbox — so the
 * only thing keeping them honest is a test that names them.
 */
describe("card control scopes — the permission vocabulary", () => {
  it("keeps every scope and its labels in step", () => {
    // Three surfaces read these exact strings: the `scopes` array in 0173, the capability gate, and
    // the settings UI. A scope with no label is a checkbox with no name.
    for (const scope of CARD_CONTROL_SCOPES) {
      expect(CARD_SCOPE_LABELS[scope]).toBeTruthy();
      expect(CARD_SCOPE_DESCRIPTIONS[scope]).toBeTruthy();
    }
    // Five since Phase 8.1 added `deactivate`. A count, so a scope added with no label fails here
    // rather than rendering as an unnamed checkbox on the settings screen.
    expect(CARD_CONTROL_SCOPES).toHaveLength(5);
  });

  it("recognises only the declared scopes", () => {
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

  /**
   * Narrowed by Step 8.1, and narrowed is the only direction this may ever move.
   *
   * `Inactive` used to be accepted here, which made `card_lock` the route to BOTH a pause and a
   * retirement — recorded under one intent and one audit action, so `CardChangeLog.vue` rendered
   * "Locked card" for a retirement. That is the audit-mislabelling half of the same P0-3 this
   * describe block is named for; `card_deactivate` now owns the status, the scope and the label.
   */
  it("accepts Hold alone, and defaults to it", () => {
    expect(lockCardSchema.parse({ ...base }).status).toBe("Hold");
    expect(lockCardSchema.parse({ ...base, status: "Hold" }).status).toBe("Hold");
  });

  it("refuses status Inactive — deactivate is the only path that retires a card", () => {
    // The pair with the `Active` case above: BOTH of the other two writable statuses are now
    // somebody else's, so this schema can express exactly one thing.
    expect(lockCardSchema.safeParse({ ...base, status: "Inactive" }).success).toBe(false);
  });

  it("refuses Deleted and Fraud outright", () => {
    for (const status of ["Deleted", "Fraud", "HOLD "]) {
      expect(lockCardSchema.safeParse({ ...base, status }).success).toBe(false);
    }
  });
});

describe("deactivateCardSchema (Step 8.1)", () => {
  const base = { expectedVersion: "0123456789abcdef0123456789abcdef" };

  it("carries no status field at all, so no other status is representable", () => {
    // Not "rejects Active" — there is nothing to reject WITH. A `z.enum(["Inactive"])` would be a
    // validated constraint; an absent field is an unrepresentable one, and P0-3 happened because a
    // schema that COULD carry `Active` eventually did.
    expect(deactivateCardSchema.parse({ ...base })).toEqual({ expectedVersion: base.expectedVersion });
    for (const status of ["Active", "Hold", "Inactive", "Deleted"]) {
      // Zod strips what it does not declare, so a caller cannot smuggle one through either.
      expect(deactivateCardSchema.parse({ ...base, status })).not.toHaveProperty("status");
    }
  });

  it("still demands the optimistic-concurrency token", () => {
    // The one field it does have. Without this the case above would pass on a schema that accepted
    // literally anything.
    expect(deactivateCardSchema.safeParse({}).success).toBe(false);
    expect(deactivateCardSchema.safeParse({ expectedVersion: "too-short" }).success).toBe(false);
  });
});

// ─── Phase 2 contract tripwires (audit P1-6, B1) ────────────────────────────────────────────────
describe("promptInputSchema / setPromptsSchema (audit P1-6)", () => {
  const base = { expectedVersion: "0123456789abcdef0123456789abcdef", replaceAll: true as const };

  it("refuses EXACT_MATCH with an empty match value — that combination bricks the pump", () => {
    for (const matchValue of ["", null]) {
      const parsed = setPromptsSchema.safeParse({
        ...base, prompts: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue, reportValue: null }],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("accepts REPORT_ONLY with an empty value — reporting nothing is legal", () => {
    expect(setPromptsSchema.safeParse({
      ...base, prompts: [{ infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "" }],
    }).success).toBe(true);
  });

  it("refuses duplicate infoIds — a full-replace with two DRID records is a vendor shape EFS never emits", () => {
    expect(setPromptsSchema.safeParse({
      ...base,
      prompts: [
        { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "111", reportValue: null },
        { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "222", reportValue: null },
      ],
    }).success).toBe(false);
  });

  // ─── Step 9.2: seven validation types, the accrual, and the bounds ──────────────────────────
  const one = (prompt: Record<string, unknown>) =>
    setPromptsSchema.safeParse({ ...base, prompts: [{ matchValue: null, reportValue: null, ...prompt }] });

  it("accepts all SEVEN validation types the card pages list", () => {
    // p36, p135, p138. The POLICY pages (p84, p146) list six and omit DYNAMIC — this is a card
    // write, so seven is right here, and the asymmetry is the vendor's rather than a transcription
    // slip. EXACT_MATCH and ACCRUAL_CHECK carry their own required companion field.
    const companions: Record<string, Record<string, unknown>> = {
      EXACT_MATCH: { matchValue: "D-1" },
      ACCRUAL_CHECK: { value: 1800 },
      DYNAMIC: { infoId: "CNTN" },
    };
    for (const validationType of EFS_VALIDATION_TYPES) {
      const parsed = one({ infoId: "DRID", validationType, ...(companions[validationType] ?? {}) });
      expect(parsed.success, `${validationType} should be accepted`).toBe(true);
    }
  });

  it("refuses a validation type the guide does not name", () => {
    expect(one({ infoId: "DRID", validationType: "FUZZY_MATCH" }).success).toBe(false);
  });

  it("refuses DYNAMIC on anything but CNTN, PPIN and DRID", () => {
    // "DYNAMIC can only be used with CNTN, PPIN and DRID" (p36, p136).
    for (const infoId of EFS_DYNAMIC_INFO_IDS) {
      expect(one({ infoId, validationType: "DYNAMIC" }).success, `${infoId} pairs with DYNAMIC`).toBe(true);
    }
    for (const infoId of ["UNIT", "ODRD", "NAME"]) {
      expect(one({ infoId, validationType: "DYNAMIC" }).success, `${infoId} does not`).toBe(false);
    }
  });

  it("refuses ACCRUAL_CHECK without an accrual above zero", () => {
    // A zero accrual is the guide's own "not configured" sentinel — production carries exactly that
    // on both policies (docs/25 Q3). Accepting it from an operator who has just chosen odometer
    // following would record a decision that does nothing.
    expect(one({ infoId: "ODRD", validationType: "ACCRUAL_CHECK" }).success).toBe(false);
    expect(one({ infoId: "ODRD", validationType: "ACCRUAL_CHECK", value: 0 }).success).toBe(false);
    expect(one({ infoId: "ODRD", validationType: "ACCRUAL_CHECK", value: 1800 }).success).toBe(true);
  });

  it("refuses bounds without the flag that makes EFS check them", () => {
    // "Only checked if lengthCheck is true" (p36, p135). Sending bounds without it is not a weaker
    // version of the feature — it is a no-op the vendor accepts and ignores (audit W3).
    expect(one({ infoId: "UNIT", validationType: "NUMERIC", minimum: 4 }).success).toBe(false);
    expect(one({ infoId: "UNIT", validationType: "NUMERIC", maximum: 8 }).success).toBe(false);
    expect(one({ infoId: "UNIT", validationType: "NUMERIC", lengthCheck: true, minimum: 4, maximum: 8 }).success).toBe(true);
    expect(one({ infoId: "UNIT", validationType: "NUMERIC", lengthCheck: true, minimum: 9, maximum: 8 }).success).toBe(false);
  });

  it("takes an infoId the OLD enum would have refused, and still refuses a malformed one", () => {
    // The widening itself. `ODRD` is in the guide's table and in both accounts; whether THIS account
    // offers it is a runtime fact, answered by the resolved set rather than at parse time.
    expect(one({ infoId: "ODRD", validationType: "REPORT_ONLY" }).success).toBe(true);
    for (const infoId of ["DR", "DRIDX", "dr1d", ""]) {
      expect(one({ infoId, validationType: "REPORT_ONLY" }).success, `${infoId} is not an Info ID`).toBe(false);
    }
  });

  it("no longer caps the array at two, and still refuses more than the vendor defines", () => {
    // The old cap was EFS_EDITABLE_INFO_IDS.length — a compile-time guess at a per-account fact that
    // would have refused a legitimate five-prompt card the moment Step 9.1 widened the set.
    const five = ["DRID", "UNIT", "ODRD", "TRIP", "TRLR"].map((infoId) => ({
      infoId, validationType: "REPORT_ONLY" as const, matchValue: null, reportValue: null,
    }));
    expect(setPromptsSchema.safeParse({ ...base, prompts: five }).success).toBe(true);

    const tooMany = Object.keys(EFS_INFO_LABELS).concat("ZZZZ").map((infoId) => ({
      infoId, validationType: "REPORT_ONLY" as const, matchValue: null, reportValue: null,
    }));
    expect(setPromptsSchema.safeParse({ ...base, prompts: tooMany }).success).toBe(false);
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

describe("reason is gone from the write path (decision B1, restated 2026-08-16)", () => {
  const version = "0123456789abcdef0123456789abcdef";

  it("parses a mutation that carries no reason, and produces no reason field", () => {
    const parsed = unlockCardSchema.parse({ expectedVersion: version });
    expect(parsed).not.toHaveProperty("reason");
  });

  /**
   * A browser cached from before this change still sends one. Zod strips unknown keys rather than
   * rejecting, so the old client keeps working and simply stops being listened to — which is the
   * behaviour that lets this ship without a coordinated deploy.
   */
  it("ignores a reason an older client still sends, rather than refusing the write", () => {
    const parsed = unlockCardSchema.safeParse({ expectedVersion: version, reason: "stolen from the yard" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).not.toHaveProperty("reason");
  });

  it("no longer rejects a short reason, because there is no reason to reject", () => {
    // The old rule refused fewer than three characters. Nothing should now care.
    expect(unlockCardSchema.safeParse({ expectedVersion: version, reason: "ab" }).success).toBe(true);
  });
});
