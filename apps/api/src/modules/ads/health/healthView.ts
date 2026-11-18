import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADS_JOB_KINDS, HEALTH_JOB_DAYS, foldAgents, foldConnections, foldJobs, monthContext,
  type AdsHealthView, type HealthConnectionRow, type HealthGenerationRow, type HealthJobRow,
} from "@silvicom/shared";
import { settingsInForce } from "../settings/settingsVersions.js";

/**
 * `GET /api/ads/health` (ADS-PLATFORM-V2-PLAN V8; audit A-9): the reads behind `AdsHealthView` (shared
 * `adsHealth.ts` says what each part is and is not). Every query names the org: the service role bypasses RLS.
 * Reads page by keyset (`id`), so PostgREST's 1,000-row cap cannot cut a fold short — an hourly job per connection
 * is 168 rows a week, and a month of generations for a busy carrier is more than a thousand.
 */
const PAGE = 1000;

async function pages<T>(read: (after: string | null) => PromiseLike<{ data: unknown; error: { message: string } | null }>, table: string): Promise<T[]> {
  const out: T[] = [];
  for (let after: string | null = null; ; ) {
    const { data, error } = await read(after);
    if (error) throw new Error(`${table}: ${error.message}`);
    const got = (data ?? []) as Array<T & { id: string }>;
    out.push(...got);
    if (got.length < PAGE) return out;
    after = got[got.length - 1]!.id;
  }
}

export async function adsHealthView(admin: SupabaseClient, orgId: string, now: Date): Promise<AdsHealthView> {
  const month = monthContext(now);
  const since = new Date(now.getTime() - HEALTH_JOB_DAYS * 86_400_000).toISOString();

  const connections = admin.from("ads_platform_connections")
    .select("id, provider, is_sandbox, status, last_test_at, last_error, last_test").eq("org_id", orgId).order("created_at");
  const webhook = admin.from("jobs").select("created_at").eq("org_id", orgId).eq("kind", "ads_lead_fetch")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const jobs = pages<HealthJobRow>((after) => {
    let q = admin.from("jobs").select("id, kind, status, error, created_at, finished_at").eq("org_id", orgId).in("kind", [...ADS_JOB_KINDS]).gte("created_at", since);
    if (after) q = q.gt("id", after);
    return q.order("id").limit(PAGE);
  }, "jobs");
  const generations = pages<HealthGenerationRow>((after) => {
    let q = admin.from("ad_generations").select("id, agent, status, error_code, cost_units, cost_unit").eq("org_id", orgId).gte("started_at", month.start).lt("started_at", month.end);
    if (after) q = q.gt("id", after);
    return q.order("id").limit(PAGE);
  }, "ad_generations");

  const [c, w, j, g, s] = await Promise.all([connections, webhook, jobs, generations, settingsInForce(admin, orgId)]);
  if (c.error) throw new Error(`ads_platform_connections: ${c.error.message}`);
  if (w.error) throw new Error(`jobs: ${w.error.message}`);
  return {
    checked_at: now.toISOString(),
    month: month.month,
    connections: foldConnections((c.data ?? []) as HealthConnectionRow[], now),
    lead_webhook: { last_at: (w.data as { created_at: string } | null)?.created_at ?? null },
    jobs: foldJobs(j),
    agents: foldAgents(g, s.settings.budgets.agents_enabled),
  };
}
