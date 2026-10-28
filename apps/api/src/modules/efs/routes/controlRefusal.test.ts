import { describe, expect, it } from "vitest";
import { CARD_BLOCKED_SENTENCES, cardBlockedBySchema } from "@silvicom/shared";
import { KILL_SWITCH_REFUSAL, refusal } from "./controlRefusal.js";

/**
 * CCF4 (2026-10-28): the API refuses with the same sentence the drawer showed beside the disabled
 * button. Before it, `refusal()` kept its own copy and the two had drifted (plan W7).
 */
describe("a card-control refusal", () => {
  it("says what the drawer said, for every reason", () => {
    for (const reason of cardBlockedBySchema.options) {
      expect(refusal(reason, "lock")[1], reason).toBe(CARD_BLOCKED_SENTENCES[reason]);
    }
    expect(KILL_SWITCH_REFUSAL[1]).toBe(CARD_BLOCKED_SENTENCES.kill_switch);
  });

  it("keeps each reason's error code", () => {
    expect(refusal("not_promoted", "lock")[0]).toBe("card_control_not_promoted");
    expect(refusal("capability_suspended", "lock")[0]).toBe("card_control_suspended");
    expect(refusal("endpoint_changed", "lock")[0]).toBe("card_control_not_entitled");
    expect(refusal("no_credentials", "lock")[0]).toBe("efs_not_configured");
  });

  it("never prints the raw scope code to the operator (plan W6)", () => {
    const [, message] = refusal("something_new", "deactivate");
    expect(message).not.toContain('"deactivate"');
    expect(message).toBe("You are not approved for this action on fuel cards.");
  });
});
