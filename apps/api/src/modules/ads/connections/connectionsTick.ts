import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 500;

/** What a scheduler does with one connection: queue its job, or learn the last one is still running. */
export type ConnectionEnqueue = (orgId: string, connectionId: string) => Promise<"queued" | "conflict">;

/**
 * Every Meta (or simulator) connection that is `connected` or `failing`, across carriers, handed to `enqueue`.
 * The ONE tenant-wide read of the ads scheduled jobs: the leads backfill (`leads/backfillTick.ts`), the insights
 * pull and the reconcile (`monitor/`) and the morning brief (`workers/analyst/briefTick.ts`) all start from it, so
 * they cannot disagree on which connections run.
 *
 * It lives with the connections and not with lead intake, where it was written (B4a2): it reads connection ids
 * and nothing of a lead, and the analyst's scheduler importing it from `leads/` read as an agent reaching lead
 * intake — which Q-APX2's boundary test (`security/adsAgentInputBoundary.test.ts`) refuses (2026-11-15).
 */
export async function metaConnectionsTick(admin: SupabaseClient, enqueue: ConnectionEnqueue): Promise<{ connections: number; queued: number; conflicts: number }> {
  const result = { connections: 0, queued: 0, conflicts: 0 };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("ads_platform_connections")
      .select("id, org_id")
      .in("provider", ["meta", "simulator"])
      // `failing` too (2026-11-03 audit H1): skipping it made a dead token's lost leads silent — no job,
      // so no failed job. Now its job runs, and fails loudly every hour until the token is fixed.
      .in("status", ["connected", "failing"])
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ads_platform_connections: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; org_id: string }>;
    for (const c of rows) {
      result.connections += 1;
      if ((await enqueue(c.org_id, c.id)) === "queued") result.queued += 1;
      else result.conflicts += 1;
    }
    if (rows.length < PAGE) return result;
  }
}
