import { describe, expect, it } from "vitest";
import { CARD_OVERRIDE_STEP_UP_ABOVE_USES } from "../cardWriteLimits.js";
import {
  CAPABILITIES_WITH_STEP_UP_GATE,
  CARD_UNLOCK_STEP_UP,
  OVERRIDE_GRANT_STEP_UP,
  PROMPT_REMOVAL_STEP_UP,
  cardUnlockNeedsStepUp,
  overrideGrantNeedsStepUp,
  promptRemovalNeedsStepUp,
} from "./stepUp.js";
import { overrideStepUpMessage } from "./capabilities/overrideGrant.contract.js";

/**
 * The rules the API refuses with and the drawer warns from — asserted once, because there is one
 * copy. Each case is named for the defect it prevents.
 */

describe("override grant", () => {
  it("lets the threshold itself through — an off-by-one here demands a password for the allowed case", () => {
    expect(overrideGrantNeedsStepUp(CARD_OVERRIDE_STEP_UP_ABOVE_USES)).toBe(false);
    expect(overrideGrantNeedsStepUp(CARD_OVERRIDE_STEP_UP_ABOVE_USES + 1)).toBe(true);
  });

  it("stays quiet across the ordinary range, so the warning still means something at 4", () => {
    expect(overrideGrantNeedsStepUp(1)).toBe(false);
    expect(overrideGrantNeedsStepUp(2)).toBe(false);
  });

  /**
   * `overrideStepUpMessage` is the name `overrideGrant.behaviour.ts` and its test import. If it ever
   * stops being the same string, the drawer warns with one sentence and the server refuses with
   * another — the exact drift Step 6.1 moved this rule to prevent.
   */
  it("says the same sentence under both of its names", () => {
    expect(overrideStepUpMessage).toBe(OVERRIDE_GRANT_STEP_UP);
  });

  it("names the threshold in the sentence, so the operator is told what would avoid the prompt", () => {
    expect(OVERRIDE_GRANT_STEP_UP).toContain(String(CARD_OVERRIDE_STEP_UP_ABOVE_USES));
  });
});

describe("card unlock", () => {
  /**
   * The 2026-08-12 incident: this account reports statuses upper-cased, and an `===` comparison
   * waved the unlock of a fraud-flagged card straight past the gate that exists to demand a password.
   */
  it("recognises FRAUD however this account happens to case it", () => {
    expect(cardUnlockNeedsStepUp("Fraud")).toBe(true);
    expect(cardUnlockNeedsStepUp("FRAUD")).toBe(true);
    expect(cardUnlockNeedsStepUp("fraud")).toBe(true);
  });

  it("leaves the ordinary unlock alone — a password on every unlock trains people to type it", () => {
    expect(cardUnlockNeedsStepUp("Hold")).toBe(false);
    expect(cardUnlockNeedsStepUp("HOLD")).toBe(false);
    expect(cardUnlockNeedsStepUp("Inactive")).toBe(false);
  });

  it("does not demand a password for a status it cannot read — that is not a fraud flag", () => {
    expect(cardUnlockNeedsStepUp(null)).toBe(false);
    expect(cardUnlockNeedsStepUp("")).toBe(false);
  });

  it("says why, not just that — a bare 'confirm your password' sends nobody anywhere", () => {
    expect(CARD_UNLOCK_STEP_UP).toContain("fraud");
  });
});

describe("prompt removal", () => {
  /**
   * EVERY removal, not only DRID. `assertPromptRemovalAllowed` demands a password for all of them,
   * and a predicate that special-cased the driver ID would let a unit-prompt removal reach the
   * server with no warning shown.
   */
  it("covers a removal that is not the driver ID", () => {
    expect(promptRemovalNeedsStepUp(["UNIT"])).toBe(true);
    expect(promptRemovalNeedsStepUp(["DRID"])).toBe(true);
    expect(promptRemovalNeedsStepUp(["DRID", "UNIT"])).toBe(true);
  });

  it("stays quiet when nothing is being removed — editing a value is not a removal", () => {
    expect(promptRemovalNeedsStepUp([])).toBe(false);
  });

  it("names the act, so somebody clearing a text box is not told they are removing a prompt", () => {
    expect(PROMPT_REMOVAL_STEP_UP).toContain("remove a prompt");
  });
});

describe("the gate pin", () => {
  /**
   * Not a restatement of the constant: this asserts the one membership question the pin exists to
   * answer. `card_lock` is the 2am safety action, and a step-up on it has a cost measured in stolen
   * fuel — see the docblock in `cardLock.behaviour.ts`.
   */
  it("never gates a lock", () => {
    expect(CAPABILITIES_WITH_STEP_UP_GATE).not.toContain("card_lock");
  });

  it("gates nothing it has no rule for — every name here has a predicate above", () => {
    expect([...CAPABILITIES_WITH_STEP_UP_GATE].sort())
      .toEqual(["card_unlock", "override_grant", "prompts_set"]);
  });
});
