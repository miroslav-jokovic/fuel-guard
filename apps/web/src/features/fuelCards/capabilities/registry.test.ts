import { describe, expect, it } from "vitest";
import { CAPABILITIES_WITH_STEP_UP_GATE, CARD_CAPABILITY_CONTRACTS } from "@fuelguard/shared";
import { CARD_CAPABILITY_VIEWS } from "./registry.js";

/**
 * The third side of the cross-registry fitness test (docs/27 §7.2), which has to live here.
 *
 * `apps/api` cannot import `apps/web`, so the API's `registry.test.ts` can pair a contract with its
 * behaviour and its mount and stops there. A contract with a behaviour and NO view is a capability
 * the API will happily execute and the drawer cannot describe — and that asymmetry is invisible
 * until somebody opens the drawer on a real card, which is the worst moment to find it.
 */

describe("every capability the API can execute, the drawer can describe", () => {
  it("discovered both registries — without this, the loops below are vacuous", () => {
    expect(Object.keys(CARD_CAPABILITY_CONTRACTS).length).toBeGreaterThan(0);
    expect(Object.keys(CARD_CAPABILITY_VIEWS).length).toBeGreaterThan(0);
  });

  it("pairs every contract with exactly one view, and vice versa", () => {
    expect(Object.keys(CARD_CAPABILITY_VIEWS).sort())
      .toEqual(Object.keys(CARD_CAPABILITY_CONTRACTS).sort());
  });

  it("gives every view both halves — a confirmation and a diff", () => {
    for (const [key, view] of Object.entries(CARD_CAPABILITY_VIEWS)) {
      // A view without a confirmation is an operation that commits with no last screen. A view
      // without a diff is one that commits without showing what changes — and `diff` returning an
      // empty array is legitimate, so the check is that the function exists, not what it returns.
      expect(view.confirmation, `${key} confirmation`).toBeTypeOf("function");
      expect(view.diff, `${key} diff`).toBeTypeOf("function");
    }
  });

  it("names the tone the contract declared, so the copy cannot contradict the badge", () => {
    for (const [key, contract] of Object.entries(CARD_CAPABILITY_CONTRACTS)) {
      expect(["neutral", "warning", "danger"], `${key} ui.tone`).toContain(contract.ui.tone);
    }
  });

  /**
   * Step 6.1, invariant 5 — the web half of the pin.
   *
   * Derived from the view registry, compared against `CAPABILITIES_WITH_STEP_UP_GATE`. The API's
   * `registry.test.ts` derives the same set from its behaviours' governance hooks and compares it
   * against the same constant, which is the only way to bind two registries `lint:boundaries` keeps
   * apart. The defect this prevents is a drawer that promises no password and gets asked for one:
   * a gate added on the server with no warning on the client.
   */
  it("warns about every capability that has a step-up gate, and about no other", () => {
    const warns = Object.entries(CARD_CAPABILITY_VIEWS)
      .filter(([, view]) => view.stepUp !== undefined)
      .map(([key]) => key);
    expect(warns.sort()).toEqual([...CAPABILITIES_WITH_STEP_UP_GATE].sort());
  });
});
