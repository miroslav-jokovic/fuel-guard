import { z } from "zod";
import { recordId } from "./recordId.js";
import { formatDisplayDayShort } from "./displayDate.js";

/**
 * Notifications (Phase 5N, decision D53).
 *
 * The module that closes the loop opened by the approval gate: dispatch releasing a load is
 * otherwise invisible until the driver next happens to open the app.
 *
 * The suppression rules below are PURE and mirrored exactly by `notification_allowed()` in migration
 * 0089. Two copies is deliberate — the server decides what to send (a device preference cannot be
 * trusted to keep a phone dark at 03:00), and the client uses the same rules to explain *why*
 * something was or was not delivered without a round trip.
 */

export const NOTIFICATION_CATEGORIES = [
  "load_offered",
  "load_changed",
  "load_canceled",
  "message_received",
  "duty_auto_closed",
  "performance_week",
  "training_due",
  "system",
  // HazmatGuard (plan H7): a load needing a trained reviewer, and the driver-facing outcome.
  "hazmat_review",
  "hazmat_cleared",
  "hazmat_rejected",
  "fuel_alert",
  "declined_alert",
  "efs_processing_failed",
  "efs_feed_stale",
  // Driver qualification (DQF plan C1). The first three are our own clock (dqAlerts.ts); the last
  // two are what Phase E's SambaSafety webhook emits — a licence status change, and a monitoring
  // MVR with its reason. All five are office-facing (D-DQ13: the DQ file is company-only), mutable
  // (an office user who triages by email may silence the in-app copy), and mirrored in the
  // notification_events CHECK (0207).
  "dq_expiring",
  "dq_expired",
  "dq_missing",
  "dq_license_status",
  "dq_mvr_received",
  /**
   * A10: an applicant started the §391.21 form, stopped, and has not come back. Office-facing and
   * mutable, like the DQ five — a recruiter working their pipeline from a spreadsheet may silence the
   * in-app copy, and nothing about a stalled application is urgent enough to be non-mutable. Mirrored
   * in the notification_events CHECK (0232).
   */
  "application_stalled",
  /**
   * The opposite news (APPLICATION-FLOW-V2-PLAN Q-AW56): an applicant has finished everything they can
   * do alone — Part 1 and all six permissions — and the office's screening is now the next move.
   * Measured on production 2026-10-20: two applicants reached this point on 10-01, nothing said so,
   * zero were screened, both links expired. Sent once per invitation, when the last permission lands,
   * to the members who manage the recruitment section. Office-facing and mutable like the stall — a
   * recruiter may mute one and keep the other, which is why it is not the same category. Mirrored in
   * the notification_events CHECK (0499).
   */
  "application_ready_to_screen",
  /**
   * A fuel card's status changed at EFS without us — the WEX portal, or EFS's own hold (EFS audit,
   * 2026-09-30; the status poll in efsCardStatusPoll.ts). Office-facing and mutable: somebody who
   * works in the WEX portal all day may silence it. Mirrored in the notification_events CHECK (0397).
   */
  "card_status_changed",
  /**
   * A Med-Stop test closed POSITIVE, as a REFUSAL, NEGATIVE-DILUTE, or in a wording nobody classified
   * (MEDSTOP-PLAN.md §6 F-5; `isMedstopDerAlert`). Sent to admin + safety_manager only — the roles
   * that may read testing records (§382.401(a)). Mutable like the other office categories: it is not
   * the only safeguard, because a violation also stops dispatch until return-to-duty is filed.
   * Mirrored in the notification_events CHECK (0465).
   */
  "drug_alcohol_result",
  /**
   * Our FMCSA roadside record has stopped refreshing (INSPECTION-CHALLENGE-PLAN §4.1, IC1c): the
   * inspections list and the Roadside card would otherwise go on showing the last good record as
   * today's. Safety readers, at most once a day per org. Mirrored in the CHECK (0470).
   */
  "roadside_feed_stale",
  /**
   * The Med-Stop connection is about to stop or has stopped (MEDSTOP-PLAN §7A.20): the API key nears
   * its expiry, or the hourly sweep has failed or not run. Without the sweep a positive result is not
   * alerted and a violation does not stop dispatch, while every screen still shows the last good read.
   * Sent to the admins who can paste a new key. Mirrored in the CHECK (0477).
   */
  "medstop_connection",
  /**
   * A roadside vehicle violation with no repair recorded as its 396.9(d) due day nears or passes
   * (INSPECTION-CHALLENGE-PLAN IC11, D-IC14). Maintenance managers. Mirrored in the CHECK (0483).
   */
  "roadside_repair_due",
  /**
   * An officer's report whose check disagreed with the record (IC10 `needs_review`, IC14): the driver
   * card says why. Safety managers. Mirrored in the CHECK (0483).
   */
  "roadside_report_needs_review",
  /**
   * A truck's or trailer's paper nears or passes its end date (UNIT-FILES-PLAN UF6): the unit-files
   * rollup's verdicts, planned inside the DQ alert timer. Equipment managers. Separate from `dq_*`
   * because those are the driver qualification file and go to a different section's managers, and the
   * mute is per category. Mirrored in the CHECK (0503); nothing writes them until UF6b.
   */
  "unit_file_expiring",
  "unit_file_expired",
  /**
   * Office chat (OFFICE-CHAT-PLAN D-CHAT23): somebody named you with `<@you>`, or replied to a channel
   * post you wrote or replied to. One bell item per conversation per unread stretch — the dedupe key
   * carries your read boundary — and never in a conversation you muted `all`. Two categories so either
   * can be muted here. Mirrored in the CHECK (0521); nothing writes them until CH6b-2.
   */
  "chat_mention",
  "chat_reply",
  /**
   * The ads agent (ADS-AGENT-PLAN §4.3; module `ads`, D-AD17). Office-facing and mutable; who receives
   * each is a setting on Settings › Ads control (§4b "Alerts"), not a role list. Spend past a cap, an ad
   * the platform rejected, spend with no lead, a change made in the platform's own tool, a connection
   * token near its expiry, and the morning brief. Mirrored in the CHECK (0537); nothing writes them
   * until the B/F steps.
   */
  "ads_overspend",
  "ads_rejected",
  "ads_no_leads",
  "ads_external_change",
  "ads_token_expiring",
  "ads_brief",
  /**
   * A platform lead reached the queue, and one nobody has contacted past the threshold (recruiting's
   * `leads/`, workflow D2). Mirrored in the CHECK (0537); nothing writes them until D2.
   */
  "lead_new",
  "lead_uncontacted",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  load_offered: "New loads",
  load_changed: "Load changes",
  load_canceled: "Cancellations",
  message_received: "Messages",
  duty_auto_closed: "Shift closed automatically",
  performance_week: "Weekly score",
  training_due: "Training reminders",
  system: "Service updates",
  hazmat_review: "Hazmat reviews",
  hazmat_cleared: "Hazmat cleared",
  hazmat_rejected: "Hazmat rejected",
  fuel_alert: "Fuel alerts",
  declined_alert: "Declined-card alerts",
  efs_processing_failed: "EFS processing failures",
  efs_feed_stale: "EFS feed freshness",
  dq_expiring: "Qualification expirations",
  dq_expired: "Qualification lapses",
  dq_missing: "Qualification gaps",
  dq_license_status: "Licence status changes",
  dq_mvr_received: "New driving records",
  application_stalled: "Stalled applications",
  application_ready_to_screen: "Applicants ready to screen",
  card_status_changed: "Fuel card status changes",
  drug_alcohol_result: "Drug & alcohol results",
  roadside_feed_stale: "FMCSA record freshness",
  medstop_connection: "Med-Stop connection",
  roadside_repair_due: "Roadside repairs due",
  roadside_report_needs_review: "Inspection reports to review",
  unit_file_expiring: "Truck & trailer paper expirations",
  unit_file_expired: "Truck & trailer paper lapses",
  chat_mention: "Chat mentions",
  chat_reply: "Replies to your chat posts",
  ads_overspend: "Ad spend over a limit",
  ads_rejected: "Ads rejected by the platform",
  ads_no_leads: "Ads spending without leads",
  ads_external_change: "Ads changed outside Silvicom",
  ads_token_expiring: "Ad account connection expiring",
  ads_brief: "Daily ads brief",
  lead_new: "New ad leads",
  lead_uncontacted: "Ad leads waiting for contact",
};

/**
 * Categories a driver may NOT mute. A load being canceled while they are driving toward it is not a
 * preference — it is something they have to know. Everything else is theirs to switch off.
 */
export const NON_MUTABLE_CATEGORIES: readonly NotificationCategory[] = ["load_canceled", "system"];

export function isMutable(category: NotificationCategory): boolean {
  return !NON_MUTABLE_CATEGORIES.includes(category);
}

// ── read shapes ───────────────────────────────────────────────────────────────
export const notificationEventSchema = z.object({
  id: recordId(),
  category: z.enum(NOTIFICATION_CATEGORIES),
  title: z.string(),
  body: z.string().nullable(),
  severity: z.enum(NOTIFICATION_SEVERITIES),
  entity_type: z.string().nullable(),
  entity_id: recordId().nullable(),
  deep_link: z.string().nullable(),
  created_at: z.string(),
  read_at: z.string().nullable().default(null),
});
export type NotificationEvent = z.infer<typeof notificationEventSchema>;

export const notificationPreferencesSchema = z.object({
  muted_categories: z.array(z.string()).default([]),
  quiet_hours_start: z.string().nullable().default(null),
  quiet_hours_end: z.string().nullable().default(null),
  timezone: z.string().default("UTC"),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const meNotificationsResponseSchema = z.object({
  notifications: z.array(notificationEventSchema),
  unread: z.number().int().nonnegative(),
  preferences: notificationPreferencesSchema,
});
export type MeNotificationsResponse = z.infer<typeof meNotificationsResponseSchema>;

// ── write shapes ──────────────────────────────────────────────────────────────
export const registerPushTokenRequestSchema = z.object({
  token: z.string().min(10).max(400),
  platform: z.enum(["ios", "android", "unknown"]).default("unknown"),
  app_version: z.string().max(40).optional(),
});
export type RegisterPushTokenRequest = z.infer<typeof registerPushTokenRequestSchema>;

export const markReadRequestSchema = z.object({
  /** Omit to mark everything read — the "clear the badge" action. */
  ids: z.array(recordId()).max(200).optional(),
});
export type MarkReadRequest = z.infer<typeof markReadRequestSchema>;

export const updatePreferencesRequestSchema = z.object({
  muted_categories: z.array(z.enum(NOTIFICATION_CATEGORIES)).optional(),
  /** "HH:MM" or null to clear. Both ends must be set together to take effect. */
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  timezone: z.string().max(60).optional(),
});
export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesRequestSchema>;

// ── deep links ────────────────────────────────────────────────────────────────
/**
 * Where a notification opens. A notification that lands on Home has wasted the one moment it had the
 * driver's attention, so every category that concerns a specific thing routes to that thing.
 */
export function deepLinkFor(
  category: NotificationCategory,
  entityId: string | null | undefined,
): string | null {
  switch (category) {
    case "load_offered":
    case "load_changed":
    case "load_canceled":
      return entityId ? `/loads/${entityId}` : "/loads";
    case "hazmat_review":
      return entityId ? `/hazmat/loads/${entityId}` : "/hazmat/review";
    case "hazmat_cleared":
    case "hazmat_rejected":
      return entityId ? `/hazmat/loads/${entityId}` : "/hazmat/loads";
    case "fuel_alert":
      return "/anomalies";
    case "declined_alert":
      return "/rejections";
    case "efs_processing_failed":
    case "efs_feed_stale":
      return "/settings/efs-soap";
    case "message_received":
      return entityId ? `/messages/${entityId}` : "/messages";
    case "performance_week":
      return "/score";
    case "training_due":
      return "/more";
    case "duty_auto_closed":
      return "/home";
    default:
      return null;
  }
}

// ── suppression, mirrored by notification_allowed() in 0089 ───────────────────
/** Minutes past local midnight for "HH:MM", or null when unparseable. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `localMinutes` inside the quiet window? Handles the wrapping case (22:00 → 06:00), which is the
 * normal one — a non-wrapping quiet window is the exception, not the rule.
 */
export function inQuietHours(
  localMinutes: number,
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  const s = parseClock(start);
  const e = parseClock(end);
  if (s === null || e === null) return false;
  if (s === e) return false; // a zero-width window means "no quiet hours", not "always quiet"
  return s < e ? localMinutes >= s && localMinutes < e : localMinutes >= s || localMinutes < e;
}

export type SuppressionReason = "muted" | "quiet_hours" | null;

/**
 * Would this be delivered? Returns the REASON rather than a boolean, so the preferences screen can
 * say "you have muted this" instead of leaving a driver wondering why they missed a load.
 * `critical` bypasses quiet hours but still respects an explicit mute of a mutable category.
 */
export function suppressionReason(
  category: NotificationCategory,
  severity: NotificationSeverity,
  prefs: Pick<NotificationPreferences, "muted_categories" | "quiet_hours_start" | "quiet_hours_end">,
  localMinutes: number,
): SuppressionReason {
  if (isMutable(category) && prefs.muted_categories.includes(category)) return "muted";
  if (severity === "critical") return null;
  if (inQuietHours(localMinutes, prefs.quiet_hours_start, prefs.quiet_hours_end)) return "quiet_hours";
  return null;
}

// ── inbox derivations ─────────────────────────────────────────────────────────
export function unreadCount(events: readonly NotificationEvent[]): number {
  return events.filter((e) => e.read_at === null).length;
}

/** "Today" / "Yesterday" / a date — the grouping a notification centre reads best in. */
export function notificationDayGroup(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Earlier";
  const day = (ms: number) => Math.floor(ms / 86_400_000);
  const diff = day(nowMs) - day(t);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return formatDisplayDayShort(new Date(t), iso);
}

/** The badge cap — a bell reading "99+" is more useful than one reading "1,284". */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
