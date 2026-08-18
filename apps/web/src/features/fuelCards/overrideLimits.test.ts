import { describe, expect, it } from "vitest";
import { resolveLimitVocabulary } from "@fuelguard/shared";
import type { OperationDraft } from "./cardOperations";
import {
  ALLOW_HAND_ENTER_HELP,
  ALLOW_HAND_ENTER_LABEL,
  OVERRIDE_LIMIT_AMOUNT_HELP,
  OVERRIDE_LIMIT_AMOUNT_LABEL,
  handEnterClause,
  missingDieselPartner,
  overrideLimitsBlocker,
  overrideLimitsClause,
} from "./overrideLimits";

/**
 * Step 10.3's three portal rules, each asserted because each is a way to ship a screen that looks
 * right and grants the wrong thing. They come from WEX's own eManager Overrides guide, not from the
 * SOAP reference, which says nothing about any of them.
 */

/** The account, as `getProductGroups` reports it — DSL is a group and has no product record at all. */
const VOCABULARY = resolveLimitVocabulary([
  { groupId: "DSL", description: "DIESEL", isFuel: true },
  { groupId: "ULSD", description: "ULTRA LOW SULFUR DIESEL", isFuel: true },
  { groupId: "CADV", description: "CASH ADVANCE", isFuel: false },
]);

const draft = (over: Partial<OperationDraft> = {}): OperationDraft => ({
  targetStatus: "Active", clearException: false, uses: 1, scopeKind: "all", location: null,
  limits: [], allowHandEnter: false, prompts: [], addInfoId: null, removeInfoId: null, ...over,
});

const limit = (limitId: string, amount: number) => ({ limitId, limit: amount, hours: 1, minHours: 0 });

describe("RULE 1 — the amount is the TOTAL, not the increment", () => {
  /**
   * WEX: "Override limit does not 'add' to the existing limit; it is REPLACING the limit as a daily
   * total." A field labelled "additional gallons" grants LESS than the card already allowed, and the
   * driver is declined for asking for more than the exception meant to help him.
   *
   * Asserted on the COPY because the copy is the entire defence — there is no code path that can
   * tell a total from an increment, only a label that does or does not say which one to type.
   */
  it("says REPLACES, and never says additional", () => {
    expect(OVERRIDE_LIMIT_AMOUNT_HELP).toMatch(/replaces/i);
    expect(OVERRIDE_LIMIT_AMOUNT_HELP).not.toMatch(/\badditional\b/i);
    expect(OVERRIDE_LIMIT_AMOUNT_LABEL).not.toMatch(/\badditional\b|\bextra\b|\bmore\b/i);
    // The worked example, because "total" alone still reads as "the total you are adding".
    expect(OVERRIDE_LIMIT_AMOUNT_HELP).toContain("150");
  });
});

describe("RULE 2 — diesel is two codes and one of them is not enough", () => {
  it("refuses a grant that names DSL without ULSD", () => {
    const blocker = overrideLimitsBlocker(draft({ limits: [limit("DSL", 150)] }), VOCABULARY);
    expect(blocker).toContain("ULSD");
  });

  it("refuses the mirror case too — ULSD without DSL", () => {
    // p194's own example caps ULSD alone. It is an illustration of the request SHAPE, not an
    // operational recipe, and following it literally declines a driver at a DSL truck stop.
    const blocker = overrideLimitsBlocker(draft({ limits: [limit("ULSD", 150)] }), VOCABULARY);
    expect(blocker).toContain("DSL");
  });

  it("passes once both are named", () => {
    const both = draft({ limits: [limit("DSL", 150), limit("ULSD", 150)] });
    expect(overrideLimitsBlocker(both, VOCABULARY)).toBeNull();
  });

  /**
   * The control that keeps the rule from becoming an unfixable blocker. An account that does not
   * carry the partner code cannot satisfy a demand for it, and a Confirm button that can never
   * enable is worse than the decline it guards against.
   */
  it("does not demand a partner this account does not offer", () => {
    const ulsdOnly = resolveLimitVocabulary([{ groupId: "ULSD", description: "ULSD", isFuel: true }]);
    expect(missingDieselPartner([limit("ULSD", 150)], ulsdOnly)).toBeNull();
    expect(overrideLimitsBlocker(draft({ limits: [limit("ULSD", 150)] }), ulsdOnly)).toBeNull();
  });

  it("says nothing about diesel when no diesel is involved", () => {
    expect(missingDieselPartner([limit("CADV", 50)], VOCABULARY)).toBeNull();
  });
});

describe("RULE 3 — hours gets no asserted meaning", () => {
  /**
   * The portal's override screen calls `hours` "hours allowed between swipes"; its limits screen
   * calls it "when to refresh the limit"; the SOAP field table matches the second. Three sources,
   * two meanings — so nothing here names it, and a grant sends p194's own values.
   */
  it("never explains what hours means, in any copy this module owns", () => {
    const allCopy = [
      OVERRIDE_LIMIT_AMOUNT_HELP,
      OVERRIDE_LIMIT_AMOUNT_LABEL,
      overrideLimitsClause([limit("DSL", 150)], VOCABULARY),
      // DSL alone, so the diesel-pair sentence is in the sample too — that is the copy most likely
      // to grow an explanation of `hours` if somebody ever decides the window needs describing.
      overrideLimitsBlocker(draft({ limits: [limit("DSL", 150)] }), VOCABULARY) ?? "",
      overrideLimitsBlocker(draft({ limits: [limit("CADV", 0)] }), VOCABULARY) ?? "",
    ].join(" ");
    // The positive control, without which an empty string would satisfy every line below it —
    // `cardControlModel.test.ts`'s odometer block is the pattern (§4.2: assertions of absence need
    // positive ones beside them).
    expect(allCopy).toContain("REPLACES");
    expect(allCopy).toContain("ULSD");
    expect(allCopy.length).toBeGreaterThan(200);

    expect(allCopy).not.toMatch(/between swipes|refresh the limit|per hour|\bhours\b/i);
  });
});

describe("the blocker's other refusals", () => {
  it("refuses a product limit scoped to one location — a shape p194 never describes", () => {
    const located = draft({ limits: [limit("CADV", 50)], scopeKind: "location" });
    expect(overrideLimitsBlocker(located, VOCABULARY)).toContain("every location");
  });

  it("refuses an amount of zero, which declines the driver outright", () => {
    expect(overrideLimitsBlocker(draft({ limits: [limit("CADV", 0)] }), VOCABULARY)).toContain("CADV");
  });

  it("refuses a line with no product chosen", () => {
    expect(overrideLimitsBlocker(draft({ limits: [limit("", 50)] }), VOCABULARY)).toContain("product");
  });

  /** The control: a scope-only exception is the ordinary case and must stay unblocked. */
  it("says nothing at all when no products are capped", () => {
    expect(overrideLimitsBlocker(draft(), VOCABULARY)).toBeNull();
    expect(overrideLimitsBlocker(draft({ scopeKind: "location" }), VOCABULARY)).toBeNull();
  });
});

describe("the confirmation names the destruction, not just the grant", () => {
  /**
   * p194: "echo back your data … except remove the limits … add back the limits array with the
   * products and limits that you want for the override." The card's ordinary product limits are gone
   * for the duration, and that is the `clearExceptionClause` rule — a destruction is said out loud on
   * the screen with the button on it.
   */
  it("says the card's other limits are removed", () => {
    const clause = overrideLimitsClause([limit("DSL", 150), limit("ULSD", 150)], VOCABULARY);
    expect(clause).toMatch(/other product limits are removed/i);
  });

  it("names each product in the ACCOUNT's words and the ACCOUNT's unit", () => {
    const clause = overrideLimitsClause([limit("DSL", 150), limit("CADV", 50)], VOCABULARY);
    expect(clause).toContain("DIESEL at 150 gal");
    // Not "50 gal": the account says CADV is not fuel, and dollars is what it means.
    expect(clause).toContain("CASH ADVANCE at $50");
  });

  /** The control — a scope-only grant must not gain a sentence about limits it does not touch. */
  it("is empty when the exception caps nothing", () => {
    expect(overrideLimitsClause([], VOCABULARY)).toBe("");
  });

  it("promises nothing about restoration, which is unproven until Step 10.4", () => {
    const clause = overrideLimitsClause([limit("DSL", 150)], VOCABULARY);
    expect(clause).not.toMatch(/restored|put back|returned|afterwards/i);
  });
});

/**
 * `Allow Hand Enter` — the portal's control, and the sentence that keeps it honest.
 *
 * `handEnter` is `string (7) ALLOW / DISALLOW / POLICY` on getCard/setCard, with no override scope in
 * the guide or the WSDL. The portal places it under `Optional` beside `Product/Limit Override`, which
 * reads as "for these N uses". Every string this product shows about it has to say otherwise, and the
 * blast radius of getting it wrong is a card left hand-enterable indefinitely after one free tank.
 */
describe("Allow hand enter says it is PERMANENT", () => {
  it("states that it does not expire, in the help and in the confirmation", () => {
    expect(ALLOW_HAND_ENTER_HELP).toMatch(/does NOT expire/i);
    expect(ALLOW_HAND_ENTER_HELP).toMatch(/until somebody changes it back/i);
    expect(handEnterClause(true)).toMatch(/stays on after the exception is used up/i);
  });

  it("never implies the exception scopes it", () => {
    const copy = `${ALLOW_HAND_ENTER_LABEL} ${ALLOW_HAND_ENTER_HELP} ${handEnterClause(true)}`;
    // Positive control first — an empty string would satisfy every absence below it.
    expect(copy).toMatch(/hand-entered card numbers/i);
    expect(copy.length).toBeGreaterThan(120);
    // The phrasings that would make it sound temporary. "for this exception", "while", "during".
    expect(copy).not.toMatch(/for this exception|for these purchases|while the exception|temporar/i);
  });

  it("says nothing at all when the operator did not ask", () => {
    // The other half of never-inferred: an untouched grant must not mention hand entry, because an
    // unticked box does not write DISALLOW and nothing about the card's hand entry changes.
    expect(handEnterClause(false)).toBe("");
  });
});

/**
 * The arithmetic the two-line confirmation invites, and the vendor's own correction to it.
 *
 * WEX's Overrides guide: *"The system will not combine the gallon limit on DLS and ULSD as it
 * recognizes this as one product."* Rule 2 makes an operator name BOTH codes; without this sentence
 * the confirmation then reads as twice the fuel.
 */
describe("DSL and ULSD are one product, and the amounts do not add up", () => {
  it("says the amount is not doubled when both diesel codes are capped", () => {
    const clause = overrideLimitsClause(
      [limit("DSL", 150), limit("ULSD", 150)],
      VOCABULARY,
    );
    expect(clause).toMatch(/same product/i);
    expect(clause).toMatch(/NOT doubled/i);
  });

  /** The control: a single product must not gain a sentence about a pair that is not there. */
  it("says nothing about pairing when only one diesel code is capped", () => {
    const clause = overrideLimitsClause([limit("ULSD", 150)], VOCABULARY);
    expect(clause).not.toMatch(/same product|doubled/i);
  });
});
