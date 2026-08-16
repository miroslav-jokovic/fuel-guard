import { describe, expect, it } from "vitest";
import { CARD_CAPABILITY_CONTRACTS } from "@fuelguard/shared";
import {
  CARD_OPERATIONS,
  blockedSentence,
  emptyDraft,
  operationBlockedBy,
  editableInfoIds,
  missingEditableInfoIds,
  operationById,
  operationConfirmation,
  operationDiff,
  operationFromQuery,
  operationLink,
  operationUi,
} from "./cardOperations";
import type { CardCapabilities } from "@fuelguard/shared";

/**
 * The catalogue's own fitness checks.
 *
 * Step 6.3 put an operation id into a URL: three surfaces build one with `operationLink` and
 * `FuelCardDetailPage.vue` reads it back with `operationFromQuery`. That is a vocabulary shared by
 * four files with a query string in the middle, and the failure mode is silent — a link that
 * resolves to nothing opens the card page with no drawer, which reads as a slow page rather than a
 * broken one.
 */

const card = {
  status: "Active", infos: [], limits: [],
  overrideUses: 0, overrideAllLocations: false, locationOverrideId: null,
};

const caps = (over: Partial<CardCapabilities> = {}): CardCapabilities => ({
  canLock: true, canUnlock: true, canDeactivate: true, canOverride: true, canSetPrompts: true,
  writeEntitlement: "confirmed", blockedBy: null,
  capabilityStates: {
    card_lock: null, card_unlock: null, card_deactivate: null, override_grant: null,
    override_clear: null, delete_override: null, prompts_set: null,
  },
  environment: "production", ...over,
});

describe("the ?action= vocabulary round-trips", () => {
  it("found the catalogue — without this every loop below is vacuous", () => {
    expect(CARD_OPERATIONS.length).toBeGreaterThan(0);
  });

  /**
   * The BUILDER's output through the PARSER — the two ends of the query string, not one function
   * asked whether it can find its own input. `operationLink` is what the kebab, the exceptions panel
   * and the effective-config table all render; `operationFromQuery` is what the detail page reads.
   */
  it("parses back every link the three surfaces can render", () => {
    for (const op of CARD_OPERATIONS) {
      const href = operationLink("card-1", op);
      const action = new URL(href, "https://example.test").searchParams.get("action");
      expect(operationFromQuery(action), href).toBe(op);
    }
  });

  it("points every link at the card it was built for", () => {
    for (const op of CARD_OPERATIONS) {
      expect(operationLink("card-9", op), op.id).toContain("/fuel-cards/card-9");
    }
  });

  it("returns null for an id nobody declared, rather than a default operation", () => {
    // A drawer that fell back to "lock" on an unrecognised `?action=` would open the most
    // destructive status change in the product on a link somebody mistyped.
    expect(operationById("teleport" as never)).toBeNull();
    expect(operationFromQuery("teleport")).toBeNull();
    expect(operationFromQuery(undefined)).toBeNull();
    // A repeated `?action=` arrives as an array; it is not a string and must not be coerced into one.
    expect(operationFromQuery(["lock", "deactivate"])).toBeNull();
  });

  it("gives every operation a unique id, so two links cannot mean the same thing", () => {
    const ids = CARD_OPERATIONS.map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("every operation is renderable end to end", () => {
  it("names a capability the shared registry actually carries", () => {
    // The key indexes `capabilityStates`, so a typo here reads as `not_approver` for an operation
    // the operator is in fact approved for — a permission problem invented by a spelling mistake.
    for (const op of CARD_OPERATIONS) {
      expect(CARD_CAPABILITY_CONTRACTS[op.capabilityKey], op.id).toBeDefined();
    }
  });

  it("declares a scope its contract agrees with", () => {
    for (const op of CARD_OPERATIONS) {
      expect(CARD_CAPABILITY_CONTRACTS[op.capabilityKey]!.scope, op.id).toBe(op.scope);
    }
  });

  it("has a title, a confirmation and a diff — the drawer renders all three", () => {
    for (const op of CARD_OPERATIONS) {
      expect(operationUi(op)?.title, `${op.id} ui`).toBeTruthy();
      // Built through `emptyDraft`, not hand-written. The literal this replaced said `lockStatus`,
      // a field `OperationDraft` has not had since Step 6.5 renamed it `targetStatus` — and `as never`
      // hid it, so `capabilityFor` was resolving from `undefined` and reaching `card_lock` only
      // because the old ternary had no third branch. A fixture that cannot name a field the type
      // does not have is the only version of this that stays true.
      const body = op.body({
        ...emptyDraft("Hold"),
        prompts: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-1", reportValue: null, remove: false }],
      });
      expect(operationConfirmation(op, body, { maskedRef: "••••7671", card }), `${op.id} confirmation`).not.toBeNull();
      expect(Array.isArray(operationDiff(op, card, body)), `${op.id} diff`).toBe(true);
    }
  });
});

describe("adding a prompt to a card that has none (Step 6.5.4)", () => {
  const bare = { ...card, infos: [] };
  const withBoth = { ...card, infos: [
    { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-1", reportValue: null },
    { infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "3182" },
  ] } as never;

  /**
   * The gap Miki found. Every prompt path this product had EDITED or REMOVED records the card
   * already carried, so a card with an empty `<infos>` could never be given a Driver ID prompt —
   * which is the whole of FuelGuard's attribution signal for an unassigned card.
   */
  it("offers Add on a card with no prompts, and Edit on one that has some", () => {
    expect(operationById("promptAdd")!.applies(bare)).toBe(true);
    expect(operationById("prompts")!.applies(bare)).toBe(false);
    expect(operationById("prompts")!.applies(withBoth)).toBe(true);
  });

  it("stops offering Add once the card carries every prompt this product can set", () => {
    expect(operationById("promptAdd")!.applies(withBoth)).toBe(false);
    expect(missingEditableInfoIds(withBoth)).toEqual([]);
  });

  it("offers only the prompts the card is missing", () => {
    const onlyDrid = { ...card, infos: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-1", reportValue: null }] } as never;
    expect(missingEditableInfoIds(onlyDrid)).toEqual(["UNIT"]);
    expect(editableInfoIds(onlyDrid)).toEqual(["DRID"]);
  });

  /**
   * `replaceAll` means the array in the request IS the card's prompts afterwards (guide p137). An
   * add that sent only the new record would DELETE every other prompt — the deletion the whole
   * characterisation suite exists to catch.
   */
  it("sends every existing record back alongside the new one", () => {
    const draft = {
      targetStatus: "Active" as const, uses: 1, scopeKind: "all" as const, location: null,
      addInfoId: "UNIT" as const,
      prompts: [
        { infoId: "DRID" as const, validationType: "EXACT_MATCH" as const, matchValue: "D-1", reportValue: null, remove: false },
        { infoId: "UNIT" as const, validationType: "EXACT_MATCH" as const, matchValue: "3182", reportValue: null, remove: false },
      ],
    };
    const body = operationById("promptAdd")!.body(draft) as { prompts: unknown[]; allowRemoveDriverId: boolean };
    expect(body.prompts).toHaveLength(2);
    // An add can never remove anything, so the DRID opt-in must never be asserted from here.
    expect(body.allowRemoveDriverId).toBe(false);
  });

  it("refuses an EXACT_MATCH with no value — a prompt that validates nothing stops nobody", () => {
    const draft = {
      targetStatus: "Active" as const, uses: 1, scopeKind: "all" as const, location: null,
      addInfoId: "UNIT" as const,
      prompts: [{ infoId: "UNIT" as const, validationType: "EXACT_MATCH" as const, matchValue: "  ", reportValue: null, remove: false }],
    };
    expect(operationById("promptAdd")!.blocker!(draft)).toContain("value the driver must type");
  });
});

describe("the two sections the card page renders (Step 6.5.3)", () => {
  it("puts every operation in one of exactly two sections", () => {
    for (const op of CARD_OPERATIONS) {
      expect(["Current card", "Prompts"], op.id).toContain(op.group);
    }
  });

  it("gives each section at least one operation, so neither renders an empty menu", () => {
    for (const group of ["Current card", "Prompts"]) {
      expect(CARD_OPERATIONS.filter((op) => op.group === group).length, group).toBeGreaterThan(0);
    }
  });
});

describe("blocked operations always have something to say", () => {
  it("gives every reason the server can send a sentence of its own", () => {
    // `blockedSentence`'s default is a real fallback and must never be the answer for a reason the
    // API actually emits: "this is not available" sends nobody anywhere, which is the whole of
    // invariant 6.
    const fallback = blockedSentence("__unknown__");
    const reasons = [
      "kill_switch", "not_enabled", "not_entitled", "role", "not_approver",
      "no_credentials", "endpoint_changed", "not_promoted", "capability_suspended",
    ];
    for (const reason of reasons) {
      expect(blockedSentence(reason), reason).not.toBe(fallback);
    }
  });

  it("reads the per-capability map before falling back to the scope list", () => {
    const op = operationById("grant")!;
    const blocked = caps({ capabilityStates: { override_grant: "capability_suspended" } });
    expect(operationBlockedBy(op, blocked, ["override"])).toBe("capability_suspended");
  });

  it("refuses rather than opening everything when an older API sends no map at all", () => {
    // Fail closed: an absent `capabilityStates` is not permission. The scope list is the second
    // line, and with neither present every operation is blocked.
    const legacy = { ...caps(), capabilityStates: undefined } as unknown as CardCapabilities;
    for (const op of CARD_OPERATIONS) {
      expect(operationBlockedBy(op, legacy, []), op.id).toBe("not_approver");
    }
  });
});
