import { describe, expect, it } from "vitest";
import {
  CARD_BLOCKED_SENTENCES,
  CARD_LOCK_OVERRIDE_BLOCKED,
  CARD_CAPABILITY_CONTRACTS,
  CARD_MUTATION_INTENT_LABELS,
  CARD_SCOPE_DESCRIPTIONS,
  CARD_SCOPE_LABELS,
  overrideBlockedMessage,
  overrideGrantBlockedMessage,
  overrideGrantStatusMessage,
} from "./index.js";

/**
 * CCF5 (owner, 2026-10-28, Q-CCF1 (a) and Q-CCF2 (a)): the words are WEX's own — Hold and Override.
 *
 * Before it one status had three names (On hold / Lock / Locked) and one allowance two (exception /
 * override). These are every shared string a fleet manager reads about a card change; the codes
 * (`card_lock`, `card.locked`, `/lock`) are not words anybody reads and keep their names.
 */
const SHARED_COPY: string[] = [
  ...Object.values(CARD_CAPABILITY_CONTRACTS).flatMap((c) => [c.ui.title, c.ui.verb]),
  ...Object.values(CARD_MUTATION_INTENT_LABELS),
  ...Object.values(CARD_SCOPE_LABELS),
  ...Object.values(CARD_SCOPE_DESCRIPTIONS),
  ...Object.values(CARD_BLOCKED_SENTENCES),
  CARD_LOCK_OVERRIDE_BLOCKED,
  overrideBlockedMessage(2, "a status change"),
  overrideGrantBlockedMessage(2),
  overrideGrantStatusMessage("Hold"),
];

describe("card control speaks WEX's words: Hold and Override", () => {
  it("never says lock, unlock or exception", () => {
    for (const text of SHARED_COPY) expect(text, text).not.toMatch(/\b(un)?lock(s|ed|ing)?\b|\bexceptions?\b/i);
  });

  it("names the hold and the override where it describes them", () => {
    expect(CARD_SCOPE_LABELS.lock).toBe("Put a card on hold");
    expect(CARD_SCOPE_LABELS.override).toBe("Grant fuel overrides");
    expect(CARD_CAPABILITY_CONTRACTS.card_lock!.ui.verb).toBe("Put on hold");
    expect(CARD_CAPABILITY_CONTRACTS.override_grant!.ui.verb).toBe("Grant override");
  });
});
