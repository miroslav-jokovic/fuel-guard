import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionKind } from "@silvicom/shared";

/**
 * `ads_actions` (0537) — the money audit trail: every act that moves money or delivery, every refusal,
 * and (A6) every state transition. Every ads write to that table goes through this file.
 *
 * Its guards allow three shapes and these functions are exactly those:
 *   - `recordFinished` — a row born terminal: a guard's `refused` (written precisely when there is no
 *     approval, so AX020 lets it through), or an act with no vendor call (`kill`);
 *   - `startAction` — `started`, BEFORE the vendor call, so a crash after the platform acted still
 *     leaves a row saying something was attempted (the reconcile's and failed-jobs page's read);
 *   - `completeAction` — that row's one move to `succeeded` / `failed` (AX011).
 * `unique (org_id, idempotency_key)` makes a second start of the same act a `"duplicate"`, which the
 * caller turns into "already attempted", never a second vendor call.
 *
 * The database fences a launch or raise twice more at insert (AX020 standing approval, AX021 kill
 * switch), so a code path that skipped the guard fails loudly here instead of spending. Those two
 * come back as `{ refusedBy }`, not as a throw: the switch can be pressed between the guard's read and
 * this write, and that race is a refusal to report, not a crash.
 */

export type ActorKind = "person" | "agent" | "platform";

export interface ActionRow {
  org_id: string;
  campaign_id: string | null;
  creative_id?: string | null;
  connection_id?: string | null;
  kind: ActionKind;
  actor_kind: ActorKind;
  /** Required exactly when `actor_kind` is `person` (0537's CHECK). */
  actor_id: string | null;
  actor_name: string;
  approval_id?: string | null;
  cause?: string | null;
  idempotency_key?: string | null;
  /** What was (or would have been) sent — redacted by the caller; never a token. */
  request: Record<string, unknown>;
}

const DB_FENCES = { AX020: "no_standing_approval", AX021: "kill_switch_on" } as const;
type DbFence = (typeof DB_FENCES)[keyof typeof DB_FENCES];

function fenceOf(error: unknown): DbFence | null {
  const code = (error as { code?: string } | null)?.code;
  return code && code in DB_FENCES ? DB_FENCES[code as keyof typeof DB_FENCES] : null;
}

export async function recordFinished(
  admin: SupabaseClient,
  row: ActionRow,
  outcome: { status: "refused" | "succeeded" | "failed"; error_code?: string | null; response?: unknown; at: string },
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("ads_actions")
    .insert({ ...row, status: outcome.status, error_code: outcome.error_code ?? null, response: outcome.response ?? null, started_at: outcome.at, finished_at: outcome.at })
    .select("id")
    .single();
  if (error) throw new Error(`ads_actions insert: ${error.message}`);
  return data as { id: string };
}

export async function startAction(
  admin: SupabaseClient,
  row: ActionRow,
  at: string,
): Promise<{ id: string } | "duplicate" | { refusedBy: DbFence }> {
  const { data, error } = await admin
    .from("ads_actions")
    .insert({ ...row, status: "started", started_at: at, finished_at: null })
    .select("id")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return "duplicate";
    const fence = fenceOf(error);
    if (fence) return { refusedBy: fence };
    throw new Error(`ads_actions start: ${error.message}`);
  }
  return data as { id: string };
}

export async function completeAction(
  admin: SupabaseClient,
  orgId: string,
  id: string,
  outcome: { status: "succeeded" | "failed"; response?: unknown; error_code?: string | null; platform_refs?: unknown; at: string },
): Promise<void> {
  const { error } = await admin
    .from("ads_actions")
    .update({
      status: outcome.status,
      response: outcome.response ?? null,
      error_code: outcome.error_code ?? null,
      platform_refs: outcome.platform_refs ?? null,
      finished_at: outcome.at,
    })
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("status", "started");
  if (error) throw new Error(`ads_actions complete: ${error.message}`);
}
