import type { z } from "zod";
import { EFS_DEACTIVATE_STATUSES } from "../../efsCardCatalog.js";
import { deactivateCardSchema } from "../../cardControlContract.js";
import { defineContract } from "../types.js";

/**
 * Retire a card — the only path that writes `Inactive` (plan Step 8.1).
 *
 * ── What Phase 8.1 was for, and what it turned out to be for ────────────────────────────────────
 * The plan justifies this capability with a user-facing gap: "today retiring a held card requires
 * unlocking first, momentarily re-enabling fuel purchases." That was true when it was written and
 * was closed before it was executed — Phase 6.5 (PR #67, 2026-08-16) replaced the Lock / Deactivate /
 * Unlock trio with one three-row status control, so a card on Hold could already be set straight to
 * Inactive in a single write. Verified before any of this was built: `statusRows("HOLD")` offers the
 * Inactive row routed through `card_lock`, and 8.1's stated Verify already passed.
 *
 * What did NOT close is the audit trail, and that is why this exists. While `card_lock` could write
 * both statuses, retiring a card was recorded as intent `lock` and audit action `card.locked`, so
 * `CardChangeLog.vue` — the one screen an operator opens to find out what happened to a card —
 * rendered "Locked card" for a retirement. That is the audit-mislabelling half of audit **P0-3**:
 * "an unlock reachable through the lock route … while the audit row said `card.locked`". The
 * reachability half was fixed in Phase 3; this is the other half, on the other end of the range.
 *
 * ── The two questions the Phase 8 handoff demanded be answered before a line was written ────────
 * **Can it reach any status other than `Inactive`?** No, and not by validation: `deactivateCardSchema`
 * has no `status` field to carry one. `card_lock` narrowed to `["Hold"]` in the same change, so there
 * is exactly ONE route to `Inactive` — two routes with two audit actions is the shape P0-3 named.
 *
 * **Which scope approves it?** Its own, `deactivate`. That was not the first answer: `lock` grants no
 * less power over fuel (deactivating STOPS fuel, the safe direction) and needs no migration. It was
 * overruled by migration `0190`'s own closing note, which reserved this exact decision — "The first
 * genuinely new scope arrives with `card_deactivate` in Phase 8.1. … Phase 8.1 must widen it, in the
 * same migration that adds the capability and its grant statement." Migration 0199 does both, and
 * backfills `deactivate` onto everyone holding `lock` so no existing approver loses an ability.
 *
 * ── No step-up, and that is an assertion ────────────────────────────────────────────────────────
 * Step 8.1 specifies one. It is deliberately absent, with Miki's decision on 2026-08-16: this is the
 * fuel-STOPPING direction, the same as `card_lock`, whose own contract records that friction there
 * "has a cost measured in stolen fuel". A password defends against a hijacked session, and an
 * attacker holding one can already lock every card in the fleet. The failure this operation actually
 * has is the wrong card, or meaning to pause and retiring instead — which is what the view's typed
 * last-four confirmation is for. `CAPABILITIES_WITH_STEP_UP_GATE` therefore does not list it, and
 * both registries' fitness tests hold that claim to the code.
 */
export const cardDeactivateContract = defineContract({
  key: "card_deactivate",
  /** New in migration 0199, and the entire point of the capability — see the header. */
  intent: "deactivate",
  scope: "deactivate",
  route: { method: "POST", path: "/:id/deactivate" },
  /** Same bucket as lock and unlock: alternating verbs must not buy three times the status budget. */
  writeBucket: "card_status",
  auditAction: "card.deactivated",
  schema: deactivateCardSchema,
  carriesSecret: false,
  vocabularyFields: ["status"],
  /**
   * One value, and unlike `card_lock` this is not a subset of anything — it is the capability. The
   * write is still spelled from the fresh read's own casing (this account answers `INACTIVE`), so
   * this is what the Step 8.3 config scanner compares against, not what goes on the wire.
   */
  emittableValues: { status: EFS_DEACTIVATE_STATUSES },
  /** `matchStatusCasing` spells the write from the fresh read, same as lock and unlock. */
  casingAdaptiveFields: ["status"],
  ui: {
    title: "Deactivate this card",
    verb: "Deactivate card",
    tone: "danger",
    /** Nothing to choose. The status is the capability, and the confirmation is the decision. */
    inputs: [],
    diffRows: ["status"],
  },
});

export type CardDeactivateBody = z.infer<typeof deactivateCardSchema>;
