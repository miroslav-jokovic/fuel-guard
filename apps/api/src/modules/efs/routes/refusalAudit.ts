import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "../../../lib/audit.js";

/**
 * A refused card action leaves a record (EFS audit, 2026-09-30).
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
 * The owner tried to change prompts and "got errors". Production held no trace of it: a refusal is
 * decided before any `efs_card_mutations` row exists, it wrote no audit row, and Railway keeps logs
 * per deployment, so nine merges that afternoon had already discarded whatever the API printed.
 * The cause had to be reconstructed from code (prompts_set was `denied` for the org) instead of read.
 * A refusal is exactly the event somebody asks about later — "why could I not lock that card?" — so
 * it is recorded like the acts it prevents.
 *
 * ── WHAT IT NEVER DOES ──────────────────────────────────────────────────────────────────────────
 * Change the answer. It is best effort in every direction: a missing Supabase configuration, a failed
 * insert, even a throw from the client factory are swallowed, because the refusal the caller is
 * waiting for is the product and this row is its shadow. `writeAudit` already retries once and logs.
 *
 * `step_up_required` is NOT recorded: it is the password prompt, the normal path to a fresh sign-in,
 * not a refusal of the action.
 */
export interface CardRefusal {
  orgId: string;
  userId: string;
  /** The `efs_cards.id` from the URL. Stored as-is; `writeAudit` moves a non-uuid into meta. */
  efsCardId: string;
  capabilityKey: string | null;
  scope: string;
  /** The API error code the caller received, e.g. `card_control_not_promoted`. */
  code: string;
  /** Which gate said no — `not_promoted`, `kill_switch`, `fresh_document`… */
  blockedBy: string | null;
  /**
   * What the gate saw, when that is the diagnosis. Since 2026-10-08 a `card_state_changed` refusal
   * carries the PATHS that moved (never values) — the one refusal whose cause is a fact about the
   * vendor's document rather than about this product's configuration.
   */
  evidence?: Record<string, unknown>;
}

export async function recordCardRefusal(getAdmin: () => SupabaseClient, refusal: CardRefusal): Promise<void> {
  try {
    await writeAudit(getAdmin(), {
      orgId: refusal.orgId,
      actorId: refusal.userId,
      action: "card.action_refused",
      entity: "efs_cards",
      entityId: refusal.efsCardId,
      meta: {
        capability: refusal.capabilityKey,
        scope: refusal.scope,
        code: refusal.code,
        blockedBy: refusal.blockedBy,
        ...(refusal.evidence ?? {}),
      },
    });
  } catch (e) {
    console.error(`[card-control] could not record a refusal (${refusal.code}): ${e instanceof Error ? e.message : e}`);
  }
}
