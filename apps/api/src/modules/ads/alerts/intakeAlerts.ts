import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAdsAlert, type AdsAlert } from "./adsAlerts.js";

/**
 * `lead_intake_failing` (workflow D2d): leads have stopped reaching us on time. The plan measures this apart
 * from a recruiter's delay ("the second never excuses the first"), and the fix is a person repairing a
 * connection, so the fallback is `sendAdsAlert`'s, the admins, and not recruiting's managers.
 *
 * It is a `warning`, not `critical`: the backfill reaches back up to Meta's 90 days, so the leads are late,
 * not lost, and it can wait out somebody's quiet hours. Once a day per connection and per cause: the outage
 * is the finding, not its every failed run (`financialFreshness.ts`' lesson, measured there at 90 alerts).
 *
 * An alert never changes a job's outcome: a run that failed still fails with its own error, and a lead that
 * was stored late is still stored. So every failure here is logged and stops here.
 */

/**
 * The backfill runs hourly and one run dies in any deploy, so two missed runs are noise and a third is an
 * outage. Until the webhook is live this job is the only way a lead arrives, which is why it is hours, not a day.
 */
export const BACKFILL_STALE_HOURS = 3;
/** The plan's line: target under a minute, alert at five (ADS-AGENT-PLAN, "speed to lead"). */
export const WEBHOOK_LATE_MS = 5 * 60_000;

const day = (now: Date): string => now.toISOString().slice(0, 10);

async function sendIntakeAlert(admin: SupabaseClient, orgId: string, connectionId: string, alert: Pick<AdsAlert, "title" | "body" | "dedupeKey">): Promise<void> {
  try {
    await sendAdsAlert(admin, orgId, {
      ...alert, category: "lead_intake_failing", severity: "warning", entityType: "ads_platform_connections", entityId: connectionId,
    });
  } catch (err) {
    console.error(`[intake-alerts] org ${orgId}: connection ${connectionId} rang nobody: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Called after a failed run with the connection's last `done` run. None on record has never worked: that rings too. */
export async function alertBackfillStale(admin: SupabaseClient, orgId: string, connectionId: string, lastDoneAt: Date | null, now: Date): Promise<void> {
  const hours = lastDoneAt ? Math.floor((now.getTime() - lastDoneAt.getTime()) / 3_600_000) : null;
  if (hours !== null && hours < BACKFILL_STALE_HOURS) return;
  await sendIntakeAlert(admin, orgId, connectionId, {
    title: "Ad leads are not arriving",
    body: `${hours === null ? "Reading this ad connection's leads has not worked yet." : `Reading this ad connection's leads has failed for ${hours} hours.`} They will arrive once the connection works again.`,
    dedupeKey: `lead_intake_failing:backfill:${connectionId}:${day(now)}`,
  });
}

export async function alertWebhookLate(admin: SupabaseClient, orgId: string, connectionId: string, latencyMs: number, now: Date): Promise<void> {
  await sendIntakeAlert(admin, orgId, connectionId, {
    title: "Ad leads are arriving late",
    body: `A lead took ${Math.round(latencyMs / 60_000)} minutes to reach the queue. The target is under one.`,
    dedupeKey: `lead_intake_failing:webhook:${connectionId}:${day(now)}`,
  });
}
