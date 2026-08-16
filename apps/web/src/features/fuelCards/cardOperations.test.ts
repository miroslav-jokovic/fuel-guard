import { describe, expect, it } from "vitest";
import { CARD_CAPABILITY_CONTRACTS } from "@fuelguard/shared";
import {
  CARD_OPERATIONS,
  blockedSentence,
  operationBlockedBy,
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
  canLock: true, canUnlock: true, canOverride: true, canSetPrompts: true,
  writeEntitlement: "confirmed", blockedBy: null,
  capabilityStates: {
    card_lock: null, card_unlock: null, override_grant: null,
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
      const body = op.body({
        lockStatus: "Hold", uses: 1, scopeKind: "all", location: null,
        prompts: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-1", reportValue: null, remove: false }],
      } as never);
      expect(operationConfirmation(op, body, { maskedRef: "••••7671", card }), `${op.id} confirmation`).not.toBeNull();
      expect(Array.isArray(operationDiff(op, card, body)), `${op.id} diff`).toBe(true);
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
