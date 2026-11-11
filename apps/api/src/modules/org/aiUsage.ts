import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Model tokens the organization has spent this month across every AI spender — `org_usage_month`, the
 * counter four writers feed (0130, 0451, 0549, 0584) and every budget gate reads, owned here.
 *
 * The month is the counter's own: `to_char(now(), 'YYYY-MM')` in the writers, so UTC. A carrier-clock
 * month here would read a row the writers never wrote to on the evening of the last day.
 *
 * ⚠ Two older private copies of this read live in `document-reading/read/executeRead.ts` and
 * `hazmat/hazmatExtraction/orchestrate.ts`. They predate this export; moving them is their modules' change.
 */
export async function aiTokensUsedThisMonth(admin: SupabaseClient, orgId: string, now: Date): Promise<number> {
  const { data, error } = await admin
    .from("org_usage_month")
    .select("input_tokens, output_tokens")
    .eq("org_id", orgId)
    .eq("yyyymm", now.toISOString().slice(0, 7))
    .maybeSingle();
  if (error) throw new Error(`org_usage_month: ${error.message}`);
  const row = data as { input_tokens: number | string; output_tokens: number | string } | null;
  return row ? Number(row.input_tokens) + Number(row.output_tokens) : 0;
}
