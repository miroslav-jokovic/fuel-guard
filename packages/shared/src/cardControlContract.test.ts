import { describe, expect, it } from "vitest";
import {
  CARD_CONTROL_AUDIT_ACTIONS,
  CARD_CONTROL_SCOPES,
  CARD_SCOPE_DESCRIPTIONS,
  CARD_SCOPE_LABELS,
  cardApproverGrantSchema,
  cardControlSettingsPatchSchema,
  isCardControlScope,
} from "./cardControlContract.js";

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
