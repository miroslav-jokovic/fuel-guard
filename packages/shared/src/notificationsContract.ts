import { z } from "zod";

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
  id: z.uuid(),
  category: z.enum(NOTIFICATION_CATEGORIES),
  title: z.string(),
  body: z.string().nullable(),
  severity: z.enum(NOTIFICATION_SEVERITIES),
  entity_type: z.string().nullable(),
  entity_id: z.uuid().nullable(),
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
  ids: z.array(z.uuid()).max(200).optional(),
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
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The badge cap — a bell reading "99+" is more useful than one reading "1,284". */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
