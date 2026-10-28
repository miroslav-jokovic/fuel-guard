import { describe, expect, it } from "vitest";
import { CARD_BLOCKED_SENTENCES, cardBlockedBySchema, cardBlockedSentence } from "./cardCapabilitiesContract.js";

/**
 * CCF4 (D-CCF8, plan B7 and W6–W7): one sentence per reason a card change is unavailable, read by the
 * API's refusal, the drawer and the card page. These pin what the sentences must not say.
 */
describe("why a card change is unavailable, in one place", () => {
  it("has a sentence for every reason the server can send", () => {
    for (const reason of cardBlockedBySchema.options) {
      expect(cardBlockedSentence(reason), reason).toBe(CARD_BLOCKED_SENTENCES[reason]);
    }
    expect(cardBlockedSentence("__unknown__")).toBeNull();
    expect(cardBlockedSentence("toString")).toBeNull();
  });

  it("never sends an admin to a screen that does not exist, or names the deployment", () => {
    for (const sentence of Object.values(CARD_BLOCKED_SENTENCES)) {
      expect(sentence).not.toMatch(/prove it|test card|re-enable|diagnostic|deployment|service account|paused/i);
    }
  });

  it("names who to ask where the next step is the operator's command line", () => {
    for (const reason of ["kill_switch", "not_promoted", "capability_suspended"] as const) {
      expect(CARD_BLOCKED_SENTENCES[reason], reason).toContain("Ask your Silvicom 360 administrator.");
    }
  });

  it("names the screen where one exists, including who can add an approver", () => {
    expect(CARD_BLOCKED_SENTENCES.not_approver).toContain("Settings → Card control");
    expect(CARD_BLOCKED_SENTENCES.not_enabled).toContain("Settings → Card control");
    expect(CARD_BLOCKED_SENTENCES.no_credentials).toContain("Settings → EFS Integration");
  });
});
