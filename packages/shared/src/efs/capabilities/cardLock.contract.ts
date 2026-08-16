import type { z } from "zod";
import { EFS_LOCK_STATUSES } from "../../efsCardCatalog.js";
import { lockCardSchema } from "../../cardControlContract.js";
import { defineContract } from "../types.js";

/**
 * Lock a card — the first capability migrated to the registry (plan Step 3.5, docs/27 §10 step 2).
 *
 * The pilot is deliberately the operation that already works. Migrating a working one is how you
 * find out whether the registry, the orchestrator, the router and the drawer actually compose,
 * before betting a new feature on it. Its exit criterion is that
 * `fuelCardsControl.characterisation.test.ts` still produces the same `setCardv2` bytes.
 *
 * Every field below already existed somewhere — the route path in `control.ts`, the bucket in
 * `cardWriteLimits.ts`, the audit action in the handler, the schema in `cardControlContract.ts`, the
 * confirmation prose in `cardControlModel.ts`. None of it is new policy. What is new is that they
 * are now ONE declaration that the router, the limiter fitness test, the promotion table and the
 * drawer all read, instead of five places that agree by hand.
 */
export const cardLockContract = defineContract({
  key: "card_lock",
  /** Coarse, CHECK-constrained, persisted. `card_lock` is the fine key; `lock` is the audit key. */
  intent: "lock",
  scope: "lock",
  route: { method: "POST", path: "/:id/lock" },
  /**
   * MUST equal what `cardWriteBucket()` resolves for the mounted path. The fitness test asserts
   * EQUALITY, not existence: `cardWriteBucket` returns null on a miss and the limiter treats null as
   * ALLOW, so a typo here would be an unmetered write route rather than a broken one.
   */
  writeBucket: "card_status",
  auditAction: "card.locked",
  schema: lockCardSchema,
  carriesSecret: false,
  /**
   * The one vendor string this capability sends. The Phase 4 config scanner compares these against
   * what the account's own cards actually spell — this account returns `ACTIVE` and `HOLD` where the
   * guide says `Active` and `Hold` (incident 2026-08-12), which is why the write is spelled from the
   * fresh read's casing rather than from `emittableValues`.
   */
  vocabularyFields: ["status"],
  emittableValues: { status: EFS_LOCK_STATUSES },
  /** `matchStatusCasing` spells the write from the fresh read — see the comment above. */
  casingAdaptiveFields: ["status"],
  ui: {
    title: "Lock this card",
    verb: "Lock card",
    /**
     * `danger`, matching what the drawer renders today. A lock is reversible and is the SAFE
     * direction, but it stops fuel at every location the moment it lands, and a driver stranded at a
     * pump is a real cost — the confirmation should read like it.
     */
    tone: "danger",
    inputs: [
      {
        name: "status",
        control: "radio",
        label: "How to stop the card",
        // NOT the full writable set. `Active` reachable through the lock route was an unlock that
        // skipped the fraud step-up and recorded itself as `card.locked` (audit P0-3).
        options: EFS_LOCK_STATUSES,
      },
    ],
    diffRows: ["status"],
  },
});

export type CardLockBody = z.infer<typeof lockCardSchema>;
