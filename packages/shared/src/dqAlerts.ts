import type { DriverOverviewRow } from "./dqFile.js";
import type { FileAttentionItem } from "./fileEngine.js";
import type { NotificationCategory, NotificationSeverity } from "./notificationsContract.js";
import { isInServiceVehicleStatus } from "./constants.js";
import type { UnitSubjectType } from "./equipmentFileCatalogue.js";
import type { UnitFileRow } from "./unitFileContract.js";

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
 *
 * Since UNIT-FILES-PLAN UF6 the same schedule runs over a truck's or trailer's file: `planFileAlerts`
 * takes a subject-generic row (`FileAlertRow`), and `driverAlertRows` / `unitAlertRows` are the two
 * adapters. A driver's keys, titles and categories are what they were byte for byte, so nothing
 * already announced is announced again; a unit's keys carry their subject type
 * (`unit:{tractor|trailer}:{id}:{itemKey}:{goodUntil}:{threshold}`) and its categories are
 * `unit_file_expiring` / `unit_file_expired` (0503), muted separately from the driver file's.
 *
 * A unit's 90 and 60 never fire, and that is the rollup's answer, not this function's: the unit-files
 * rollup judges on equipment's own 30-day window (`INSPECTION_EXPIRY_WARNING_DAYS`, the Vehicles
 * list's cells), so an item further out is `current` and not in `attention`. The bell calls a truck
 * "expiring" on the day its row does. A unit item that is missing but carries McLeod's date
 * (`dateOnly`, D-UF3) has no `goodUntil` and so does not alert either — the same rule as above.
 */

export const DQ_ALERT_THRESHOLDS = [90, 60, 30, 14, 0] as const;

/**
 * How far back an old-format key still speaks for the current cycle. A threshold key is sent no
 * earlier than 90 days before its expiry, and a dated item is planned only while today is on or
 * before that expiry — so every key of the CURRENT cycle was first sent within the last 90 days.
 * One more day absorbs the scheduler's six-hour cadence crossing midnight.
 */
export const DQ_LEGACY_KEY_DAYS = 91;

/** Whose file an alert is about. */
export type FileAlertSubject = "driver" | UnitSubjectType;

/** The slice of a driver's or a unit's rollup row the planner reads. */
export interface FileAlertRow {
  subjectType: FileAlertSubject;
  subjectId: string;
  /** How a title names the subject: "Marcus Reyes", "Truck 1042", "Trailer 5310". */
  name: string;
  /**
   * Whether the subject is still the carrier's to keep papered: an employed driver (active or on
   * leave), an in-service unit. Alerting on a terminated driver or a sold truck is never right.
   */
  inService: boolean;
  attention: readonly FileAttentionItem[];
}

export interface FileAlert {
  subjectType: FileAlertSubject;
  subjectId: string;
  subjectName: string;
  itemKey: string;
  label: string;
  goodUntil: string | null;
  daysRemaining: number;
  threshold: number | "overdue";
  category: Extract<NotificationCategory, "dq_expiring" | "dq_expired" | "unit_file_expiring" | "unit_file_expired">;
  severity: NotificationSeverity;
  dedupeKey: string;
  /**
   * The pre-2026-10-05 key for the same crossing, without the expiry date. TRANSITION ONLY, and a
   * driver's only — a unit's keys never had that format. It counts as sent when first sent within
   * `DQ_LEGACY_KEY_DAYS`, so the format change does not re-alert every item already announced this
   * cycle. Nothing writes this format any more, so once the window has passed (after 2027-01-05) no
   * legacy key can match and this field can be deleted.
   */
  legacyDedupeKey?: string;
  /** One line, office-facing: "Marcus Reyes — Medical examiner's certificate expires in 14 days". */
  title: string;
}

/** The driver overview's rows. The overview already drops non-employed drivers; the guard is the planner's contract for any caller. */
export const driverAlertRows = (rows: readonly DriverOverviewRow[]): FileAlertRow[] =>
  rows.map((d) => ({
    subjectType: "driver",
    subjectId: d.driver_id,
    name: d.driver_name,
    inService: d.driver_status === "active" || d.driver_status === "on_leave",
    attention: d.attention,
  }));

const UNIT_NOUN: Record<UnitSubjectType, string> = { tractor: "Truck", trailer: "Trailer" };

/**
 * The unit-files rollup's rows (UF2). In service is the operating fleet's own definition, read rather
 * than spelled out (`lint:vehicle-status`); `trailers.status` is the same enum (constants.ts). The
 * rollup keeps ordered and retired units for the lists' status filter, and none of them alerts.
 */
export const unitAlertRows = (rows: readonly UnitFileRow[]): FileAlertRow[] =>
  rows.map((u) => ({
    subjectType: u.subject_type,
    subjectId: u.subject_id,
    name: `${UNIT_NOUN[u.subject_type]} ${u.unit_number}`,
    inService: isInServiceVehicleStatus(u.status),
    attention: u.attention,
  }));

const DAY_MS = 86_400_000;
const weekBucket = (todayIso: string): number =>
  Math.floor(Date.parse(`${todayIso}T00:00:00.000Z`) / (7 * DAY_MS));

/** A driver's key prefix is the one the ledger has held since C3; a unit's names its subject type. */
const keyPrefix = (r: FileAlertRow): string =>
  r.subjectType === "driver" ? `dq:${r.subjectId}` : `unit:${r.subjectType}:${r.subjectId}`;

export function planFileAlerts(
  rows: readonly FileAlertRow[],
  today: string,
  alreadySentKeys: ReadonlySet<string>,
): FileAlert[] {
  const out: FileAlert[] = [];
  for (const r of rows) {
    if (!r.inService) continue;
    const isDriver = r.subjectType === "driver";
    const prefix = keyPrefix(r);
    const subject = { subjectType: r.subjectType, subjectId: r.subjectId, subjectName: r.name };

    for (const a of r.attention) {
      if (a.daysRemaining == null) continue; // undated (missing) — see the header

      if (a.daysRemaining < 0) {
        const key = `${prefix}:${a.key}:overdue:${weekBucket(today)}`;
        if (alreadySentKeys.has(key)) continue;
        const days = Math.abs(a.daysRemaining);
        out.push({
          ...subject,
          itemKey: a.key,
          label: a.label,
          goodUntil: a.goodUntil,
          daysRemaining: a.daysRemaining,
          threshold: "overdue",
          category: isDriver ? "dq_expired" : "unit_file_expired",
          severity: "warning",
          dedupeKey: key,
          title: `${r.name} — ${a.label} expired ${days} ${days === 1 ? "day" : "days"} ago`,
        });
        continue;
      }

      const threshold = [...DQ_ALERT_THRESHOLDS].reverse().find((t) => a.daysRemaining! <= t);
      if (threshold === undefined) continue; // beyond 90 days — not yet news
      const key = `${prefix}:${a.key}:${a.goodUntil ?? "undated"}:${threshold}`;
      const legacyKey = isDriver ? `${prefix}:${a.key}:${threshold}` : undefined;
      if (alreadySentKeys.has(key) || (legacyKey !== undefined && alreadySentKeys.has(legacyKey))) continue;
      out.push({
        ...subject,
        itemKey: a.key,
        label: a.label,
        goodUntil: a.goodUntil,
        daysRemaining: a.daysRemaining,
        threshold,
        category: isDriver ? "dq_expiring" : "unit_file_expiring",
        severity: threshold <= 14 ? "warning" : "info",
        dedupeKey: key,
        ...(legacyKey !== undefined ? { legacyDedupeKey: legacyKey } : {}),
        title:
          a.daysRemaining === 0
            ? `${r.name} — ${a.label} expires today`
            : `${r.name} — ${a.label} expires in ${a.daysRemaining} ${a.daysRemaining === 1 ? "day" : "days"}`,
      });
    }
  }
  // Worst first, the same instinct as the queue: overdue, then soonest.
  return out.sort((x, y) => x.daysRemaining - y.daysRemaining);
}
