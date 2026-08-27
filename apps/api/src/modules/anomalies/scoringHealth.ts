import type { SupabaseClient } from "@supabase/supabase-js";
import { queueMetrics, type QueueMetrics } from "../../services/queue/metrics.js";

export interface ScoringHealth {
  windowDays: number;
  from: string;
  totalFills: number;
  reconciledFills: number;
  noDataFills: number;
  failedReconFills: number;
  blindFills: number;
  reconciledPct: number;
  scoringAttempts: { running: number; succeeded: number; failed: number };
  lastReconCheckedAt: string | null;
  queue: QueueMetrics;
  at: string;
}

const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0;

export async function scoringHealth(
  admin: SupabaseClient,
  orgId: string,
  windowDays = 7,
): Promise<ScoringHealth> {
  const days = Math.min(Math.max(Math.trunc(windowDays), 1), 30);
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();

  const fillBase = () => admin.from("fuel_transactions").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("fueled_at", from);
  const attemptsBase = () => admin.from("scoring_attempts").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("started_at", from);
  const [total, reconciled, noData, failedRecon, running, succeeded, failed, lastChecked, queue] = await Promise.all([
    fillBase(),
    fillBase().not("samsara_recon_at", "is", null),
    fillBase().eq("samsara_recon_status", "no_data"),
    fillBase().eq("samsara_recon_status", "failed"),
    attemptsBase().eq("status", "running"),
    attemptsBase().eq("status", "succeeded"),
    attemptsBase().eq("status", "failed"),
    admin.from("fuel_transactions").select("samsara_recon_checked_at").eq("org_id", orgId).not("samsara_recon_checked_at", "is", null).order("samsara_recon_checked_at", { ascending: false }).limit(1).maybeSingle(),
    queueMetrics(admin, orgId),
  ]);
  const results = [total, reconciled, noData, failedRecon, running, succeeded, failed];
  const dbError = results.find((r) => r.error);
  if (dbError?.error) throw new Error(`[scoring-health] ${dbError.error.message}`);
  if (lastChecked.error) throw new Error(`[scoring-health] ${lastChecked.error.message}`);

  const totalFills = total.count ?? 0;
  const reconciledFills = reconciled.count ?? 0;
  return {
    windowDays: days,
    from,
    totalFills,
    reconciledFills,
    noDataFills: noData.count ?? 0,
    failedReconFills: failedRecon.count ?? 0,
    blindFills: Math.max(0, totalFills - reconciledFills),
    reconciledPct: pct(reconciledFills, totalFills),
    scoringAttempts: { running: running.count ?? 0, succeeded: succeeded.count ?? 0, failed: failed.count ?? 0 },
    lastReconCheckedAt: ((lastChecked.data as { samsara_recon_checked_at?: string } | null)?.samsara_recon_checked_at ?? null),
    queue,
    at: now.toISOString(),
  };
}
