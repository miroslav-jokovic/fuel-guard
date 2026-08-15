import type { z } from "zod";
import { unlockCardSchema } from "../../cardControlContract.js";
import { defineContract } from "../types.js";

/**
 * Put a card back to Active — the only path that writes that status (plan Step 3.6).
 *
 * `Active` is deliberately NOT reachable through `card_lock`. It was, once: `lockCardSchema.status`
 * accepted the full writable set, so an unlock could be driven through the lock route, skipping the
 * fraud step-up and recording itself in the audit trail as `card.locked` (audit P0-3). Two
 * capabilities with two scopes, two audit actions and two governance shapes is the fix, and the
 * registry makes the separation something you can read rather than something you have to remember.
 */
export const cardUnlockContract = defineContract({
  key: "card_unlock",
  intent: "unlock",
  scope: "unlock",
  route: { method: "POST", path: "/:id/unlock" },
  /** Same bucket as lock: a grant/clear loop must not get twice the budget by alternating. */
  writeBucket: "card_status",
  auditAction: "card.unlocked",
  schema: unlockCardSchema,
  /**
   * Optional, matching `card_lock`. Unlocking is the other half of the 2am sequence — the card was
   * recovered, the driver is waiting — and the gate that matters on this capability is the fraud
   * step-up, not a text box.
   */
  reason: "optional",
  carriesSecret: false,
  vocabularyFields: ["status"],
  /**
   * One value, and it is the point of the capability. The write is still spelled from the fresh
   * read's own casing — this account answers `ACTIVE` — so this is what the config scanner compares
   * against, not what goes on the wire.
   */
  emittableValues: { status: ["Active"] },
  /** `matchStatusCasing` spells the write from the fresh read, same as card_lock. */
  casingAdaptiveFields: ["status"],
  ui: {
    title: "Unlock this card",
    verb: "Unlock card",
    tone: "warning",
    inputs: [],
    diffRows: ["status"],
  },
});

export type CardUnlockBody = z.infer<typeof unlockCardSchema>;
