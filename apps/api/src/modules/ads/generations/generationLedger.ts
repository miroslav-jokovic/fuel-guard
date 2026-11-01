import type { SupabaseClient } from "@supabase/supabase-js";
import { monthContext } from "@silvicom/shared";

/**
 * `ad_generations` (0537) — the ads module's AI provenance (D-AD13; workflow §1.2-6). Every write the
 * ads module makes to that table goes through this file.
 *
 * The table's own guard (AX011) allows exactly two shapes, and these functions are the only two:
 *   - INSERT a row, either `started` (before the call) or already terminal (`budget_exhausted`,
 *     written INSTEAD of a call);
 *   - UPDATE a `started` row once, to `succeeded` or `failed`, touching only the outcome columns.
 * `unique (org_id, idempotency_key)` is what makes a replay spend nothing: the key is the purpose of
 * the call, so a second insert under it is refused (23505) and the caller reads the first row instead.
 */

export type GenerationStatus = "started" | "succeeded" | "failed" | "budget_exhausted";

export interface GenerationRow {
  id: string;
  status: GenerationStatus;
  output: unknown;
  error_code: string | null;
  started_at: string;
}

const ROW_COLUMNS = "id, status, output, error_code, started_at";

export async function generationByKey(admin: SupabaseClient, orgId: string, key: string): Promise<GenerationRow | null> {
  const { data, error } = await admin
    .from("ad_generations")
    .select(ROW_COLUMNS)
    .eq("org_id", orgId)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) throw new Error(`ad_generations: ${error.message}`);
  return (data as GenerationRow | null) ?? null;
}

export interface NewGeneration {
  org_id: string;
  campaign_id: string | null;
  creative_id: string | null;
  agent: string;
  provider: "anthropic" | "higgsfield" | "internal";
  model: string | null;
  prompt_version: string | null;
  input_hash: string | null;
  idempotency_key: string;
  request: Record<string, unknown>;
  status: "started" | "budget_exhausted";
  error_code: string | null;
  started_at: string;
  /** Null exactly when `status` is `started` (0537's CHECK). */
  finished_at: string | null;
}

/** Inserts the row; `"duplicate"` when the key is already taken (the replay case — read that row). */
export async function insertGeneration(admin: SupabaseClient, row: NewGeneration): Promise<{ id: string } | "duplicate"> {
  const { data, error } = await admin.from("ad_generations").insert(row).select("id").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return "duplicate";
    throw new Error(`ad_generations insert: ${error.message}`);
  }
  return { id: (data as { id: string }).id };
}

export interface GenerationCompletion {
  status: "succeeded" | "failed";
  output: unknown;
  provider_request_id: string | null;
  /** Tokens the call was billed, whatever its outcome — an off-schema answer still cost them. */
  cost_units: number | null;
  error_code: string | null;
  finished_at: string;
}

/** The one move AX011 allows. Filtered on `status = started` so a second completion matches nothing. */
export async function completeGeneration(admin: SupabaseClient, orgId: string, id: string, c: GenerationCompletion): Promise<void> {
  const { error } = await admin
    .from("ad_generations")
    .update({ ...c, cost_unit: c.cost_units == null ? null : "tokens" })
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("status", "started");
  if (error) throw new Error(`ad_generations complete: ${error.message}`);
}

/** PostgREST returns at most 1,000 rows per response; the fold pages until a page comes back short. */
export const TOKEN_FOLD_PAGE = 1000;

/**
 * Anthropic tokens the ads module was billed in the carrier's current month (Central time, the same
 * `monthContext` the spend caps use, so "this month" means one thing on the settings page).
 *
 * A paged fold over the month's rows (`ix_ad_generations_month`), not the one-row counter the document
 * reader and hazmat read (`org_usage_month`, 0130): that counter is their shared budget, and ads tokens
 * counted there would spend the document reader's month. Ads volume is a few hundred calls a month per
 * carrier; if it ever is not, the fix is a counter of its own maintained in the completion's
 * transaction, not a row cap — a capped fold would under-count and let the budget overshoot silently.
 */
export async function anthropicTokensThisMonth(admin: SupabaseClient, orgId: string, now: Date): Promise<number> {
  const month = monthContext(now);
  let total = 0;
  // Keyset, not offset: a generation completing mid-fold shifts no page boundary.
  for (let after: string | null = null; ; ) {
    let q = admin
      .from("ad_generations")
      .select("id, cost_units")
      .eq("org_id", orgId)
      .eq("provider", "anthropic")
      .eq("cost_unit", "tokens")
      .gte("started_at", month.start)
      .lt("started_at", month.end);
    if (after !== null) q = q.gt("id", after);
    const { data, error } = await q.order("id", { ascending: true }).limit(TOKEN_FOLD_PAGE);
    if (error) throw new Error(`ad_generations month: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; cost_units: number | string | null }>;
    for (const r of rows) total += Number(r.cost_units ?? 0);
    if (rows.length < TOKEN_FOLD_PAGE) return total;
    after = rows[rows.length - 1]!.id;
  }
}
