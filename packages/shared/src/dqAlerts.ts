import type { DriverOverviewRow } from "./dqFile.js";
import type { NotificationCategory, NotificationSeverity } from "./notificationsContract.js";

/**
 * The DQ alert schedule — PURE (DQF execution plan C3). Consumes the same `DqAttentionItem` ranking
 * every UI shows (G19), computed at the scheduler's 91-day horizon (C2), and decides which
 * threshold-crossings deserve a notification TODAY given what was already sent.
 *
 * The dedupe design carries the whole correctness burden:
 *   - A dated item emits once per crossed threshold PER EXPIRY DATE: the key is
 *     `dq:{driverId}:{itemKey}:{goodUntil}:{threshold}`, and only the SMALLEST crossed threshold
 *     emits — an item first seen at 10 days out sends ONE alert (the 14 key), not five. The date is
 *     in the key since 2026-10-05: before it, a renewed medical card kept last cycle's keys and was
 *     never alerted on again (found by the Q11 audit, DATA-LIFECYCLE-PLAN.md).
 *   - An overdue item re-emits weekly, not daily: the key carries the ISO week bucket, so six
 *     scheduler runs in a week produce one emission and a restart produces none.
 *   - `alreadySentKeys` comes from the dedupe ledger (0432) — the planner never trusts in-memory
 *     state, so the scheduler is stateless and a crash loses nothing.
 *
 * MISSING items deliberately do not alert (dq_missing stays a vocabulary for manual/inbox use):
 * a fleet mid-onboarding has sixteen missing items per driver, and a channel that opens with
 * thousands of "missing" pings is a channel everyone mutes by Friday. The C5 attention strip and
 * the weekly digest are where "not started" belongs.
 */

export const DQ_ALERT_THRESHOLDS = [90, 60, 30, 14, 0] as const;

/**
 * How far back an old-format key still speaks for the current cycle. A threshold key is sent no
 * earlier than 90 days before its expiry, and a dated item is planned only while today is on or
 * before that expiry — so every key of the CURRENT cycle was first sent within the last 90 days.
 * One more day absorbs the scheduler's six-hour cadence crossing midnight.
 */
export const DQ_LEGACY_KEY_DAYS = 91;

export interface DqAlert {
  driverId: string;
  driverName: string;
  itemKey: string;
  label: string;
  goodUntil: string | null;
  daysRemaining: number;
  threshold: number | "overdue";
  category: Extract<NotificationCategory, "dq_expiring" | "dq_expired">;
  severity: NotificationSeverity;
  dedupeKey: string;
  /**
   * The pre-2026-10-05 key for the same crossing, without the expiry date. TRANSITION ONLY: it counts
   * as sent when first sent within `DQ_LEGACY_KEY_DAYS`, so the format change does not re-alert
   * every item already announced this cycle. Nothing writes this format any more, so once the
   * window has passed (after 2027-01-05) no legacy key can match and this field can be deleted.
   */
  legacyDedupeKey?: string;
  /** One line, office-facing: "Marcus Reyes — Medical examiner's certificate expires in 14 days". */
  title: string;
}

const DAY_MS = 86_400_000;
const weekBucket = (todayIso: string): number =>
  Math.floor(Date.parse(`${todayIso}T00:00:00.000Z`) / (7 * DAY_MS));

export function planDqAlerts(
  rows: readonly DriverOverviewRow[],
  today: string,
  alreadySentKeys: ReadonlySet<string>,
): DqAlert[] {
  const out: DqAlert[] = [];
  for (const d of rows) {
    // The overview already excludes non-employed drivers; the guard stays because this function's
    // contract must hold for ANY caller, and alerting on a terminated driver is never right.
    if (d.driver_status !== "active" && d.driver_status !== "on_leave") continue;

    for (const a of d.attention) {
      if (a.daysRemaining == null) continue; // undated (missing) — see the header

      if (a.daysRemaining < 0) {
        const key = `dq:${d.driver_id}:${a.key}:overdue:${weekBucket(today)}`;
        if (alreadySentKeys.has(key)) continue;
        const days = Math.abs(a.daysRemaining);
        out.push({
          driverId: d.driver_id,
          driverName: d.driver_name,
          itemKey: a.key,
          label: a.label,
          goodUntil: a.goodUntil,
          daysRemaining: a.daysRemaining,
          threshold: "overdue",
          category: "dq_expired",
          severity: "warning",
          dedupeKey: key,
          title: `${d.driver_name} — ${a.label} expired ${days} ${days === 1 ? "day" : "days"} ago`,
        });
        continue;
      }

      const threshold = [...DQ_ALERT_THRESHOLDS].reverse().find((t) => a.daysRemaining! <= t);
      if (threshold === undefined) continue; // beyond 90 days — not yet news
      const key = `dq:${d.driver_id}:${a.key}:${a.goodUntil ?? "undated"}:${threshold}`;
      const legacyKey = `dq:${d.driver_id}:${a.key}:${threshold}`;
      if (alreadySentKeys.has(key) || alreadySentKeys.has(legacyKey)) continue;
      out.push({
        driverId: d.driver_id,
        driverName: d.driver_name,
        itemKey: a.key,
        label: a.label,
        goodUntil: a.goodUntil,
        daysRemaining: a.daysRemaining,
        threshold,
        category: "dq_expiring",
        severity: threshold <= 14 ? "warning" : "info",
        dedupeKey: key,
        legacyDedupeKey: legacyKey,
        title:
          a.daysRemaining === 0
            ? `${d.driver_name} — ${a.label} expires today`
            : `${d.driver_name} — ${a.label} expires in ${a.daysRemaining} ${a.daysRemaining === 1 ? "day" : "days"}`,
      });
    }
  }
  // Worst first, the same instinct as the queue: overdue, then soonest.
  return out.sort((x, y) => x.daysRemaining - y.daysRemaining);
}
