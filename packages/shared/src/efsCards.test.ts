import { describe, it, expect } from "vitest";
import { matchesCardFilters, type EfsCardFilters, type EfsCardSummary } from "./index.js";

/**
 * The card list's seven facets (FUEL-P2, D-FUI15).
 *
 * ── WHY THEY ARE TESTED HERE RATHER THAN THROUGH THE PAGE ───────────────────────────────────────
 * They used to be a block of `if`s inside a `computed` in `FuelCardsPage.vue`, which is a fine place
 * for a rule with one caller. P2 gave them a second — the CSV export applies this same function to the
 * same summary rows, rather than restating seven predicates in SQL where they would go stale the first
 * time somebody changed a filter and did not think about a file.
 *
 * Two of the seven distinguish a MISSING fact from a NEGATIVE one, and those are the ones worth
 * pinning: `override: "none"` must include a card with no exception at all (`overrideUses` null), and
 * `health: "ok"` must include a card that has never reported an error. A predicate that reads null as
 * "no answer" rather than as "no exception" hides exactly the cards an auditor is counting.
 */

const card = (over: Partial<EfsCardSummary> = {}): EfsCardSummary => ({
  id: "c1",
  last4: "1234",
  maskedRef: "•••• 1234",
  status: "ACTIVE",
  policyNumber: 12,
  driverIdPrompt: "D-9",
  unitPrompt: "654",
  driverName: "A Driver",
  overrideUses: null,
  overrideAllLocations: null,
  locationOverrideId: null,
  lastUsedDate: "2026-08-30",
  fuelCardId: null,
  syncedAt: "2026-09-04T00:00:00Z",
  syncError: null,
  ...over,
});

const keeps = (f: EfsCardFilters, over: Partial<EfsCardSummary> = {}) => matchesCardFilters(card(over), f);

describe("an absent facet does not narrow", () => {
  it("keeps every card when nothing is filtered", () => {
    expect(keeps({})).toBe(true);
  });

  // Empty string is what a cleared `FilterSelect` writes, and it must read as "no choice" rather than
  // as a value nothing matches — the whole list going blank when somebody clears a filter.
  it("treats an empty facet as no choice at all", () => {
    expect(keeps({ driver: "", unit: "", policy: "", override: "", linked: "", health: "" })).toBe(true);
  });
});

describe("the exact-match facets", () => {
  it("narrows to one driver, one unit and one policy", () => {
    expect(keeps({ driver: "A Driver" })).toBe(true);
    expect(keeps({ driver: "Someone Else" })).toBe(false);
    expect(keeps({ unit: "654" })).toBe(true);
    expect(keeps({ unit: "655" })).toBe(false);
    // The policy comes off the URL as text and off the row as a number.
    expect(keeps({ policy: "12" })).toBe(true);
    expect(keeps({ policy: "13" })).toBe(false);
  });

  it("matches a card with no policy against no policy, rather than against everything", () => {
    expect(keeps({ policy: "12" }, { policyNumber: null })).toBe(false);
  });
});

describe("the three yes/no facets, and what NULL means in each", () => {
  it("finds the cards that can currently buy fuel outside their limits", () => {
    expect(keeps({ override: "active" }, { overrideUses: 2 })).toBe(true);
    expect(keeps({ override: "active" }, { overrideUses: 0 })).toBe(false);
    expect(keeps({ override: "active" }, { overrideUses: null })).toBe(false);
  });

  /** ⚠ A card that has never had an exception HAS no exception. Null is the ordinary case, not unknown. */
  it("counts a card with no exception at all as having none", () => {
    expect(keeps({ override: "none" }, { overrideUses: null })).toBe(true);
    expect(keeps({ override: "none" }, { overrideUses: 0 })).toBe(true);
    expect(keeps({ override: "none" }, { overrideUses: 1 })).toBe(false);
  });

  it("separates the cards that resolve to a fleet vehicle from the ones that do not", () => {
    expect(keeps({ linked: "linked" }, { fuelCardId: "fc-1" })).toBe(true);
    expect(keeps({ linked: "linked" })).toBe(false);
    expect(keeps({ linked: "unlinked" })).toBe(true);
    expect(keeps({ linked: "unlinked" }, { fuelCardId: "fc-1" })).toBe(false);
  });

  /** 140 of this fleet's 199 cards carried a sync error at one point and nothing on screen said so. */
  it("separates the cards whose last sweep failed from the ones that are clean", () => {
    expect(keeps({ health: "errors" }, { syncError: "auth" })).toBe(true);
    expect(keeps({ health: "errors" })).toBe(false);
    expect(keeps({ health: "ok" })).toBe(true);
    expect(keeps({ health: "ok" }, { syncError: "auth" })).toBe(false);
  });
});

describe("facets combine", () => {
  it("requires every named facet, so two filters are an intersection and not a union", () => {
    const f: EfsCardFilters = { driver: "A Driver", health: "errors" };
    expect(matchesCardFilters(card({ syncError: "auth" }), f)).toBe(true);
    expect(matchesCardFilters(card({ syncError: null }), f)).toBe(false);
    expect(matchesCardFilters(card({ syncError: "auth", driverName: "Someone Else" }), f)).toBe(false);
  });
});
