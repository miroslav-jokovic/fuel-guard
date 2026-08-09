import type { SupabaseClient } from "@supabase/supabase-js";
import { deepLinkFor, type NotificationCategory, type NotificationSeverity } from "@fuelguard/shared";

/**
 * Notification emission + Expo Push delivery (Phase 5N, D53).
 *
 * Every emitter goes through `notify()` rather than inserting a row, because the SQL function behind
 * it applies three things a hand-rolled INSERT would skip: the tenant's module entitlement, the
 * user's category mutes and quiet hours, and the dedupe key. A retried worker or a double-clicked
 * Release must not buzz a phone twice for the same fact.
 *
 * Delivery is Expo Push (D33 — the transport was already decided; this is what finally uses it).
 */

export interface NotifyInput {
  orgId: string;
  /** The LOGIN to address. Office users get notified too — a decline, an amendment. */
  userId: string;
  category: NotificationCategory;
  title: string;
  body?: string;
  severity?: NotificationSeverity;
  entityType?: string;
  entityId?: string | null;
  /** Encodes the *instance* of a transition, so a retry dedupes but a genuine repeat does not. */
  dedupeKey?: string;
}

/**
 * Org-level category governance (hardening plan Phase 6, D-PM7): the tenant's `notifications`
 * feature row can switch the whole channel off, or pin the active categories via
 * `config.categories`. Sits ABOVE the per-user layer (mutes/quiet hours, applied in
 * `emit_notification`): the org decides what the fleet gets, the driver narrows within that.
 * FAIL-OPEN on read errors — a governance lookup must never decide whether a load gets released,
 * and a wrongly-delivered notification is more recoverable than a silently-suppressed channel.
 */
async function orgAllowsCategory(
  admin: SupabaseClient,
  orgId: string,
  category: NotificationCategory,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("driver_app_features")
      .select("enabled, config")
      .eq("org_id", orgId)
      .eq("feature_key", "notifications")
      .maybeSingle();
    if (error || !data) return true; // no row (or read hiccup) = catalog default = all categories
    const row = data as { enabled: boolean; config: Record<string, unknown> };
    if (!row.enabled) return false;
    const cats = row.config["categories"];
    if (Array.isArray(cats) && cats.length > 0) return cats.includes(category);
    return true;
  } catch {
    return true;
  }
}

/** Emit one notification. Returns the row id, or null when it was suppressed or deduped. */
export async function notify(admin: SupabaseClient, input: NotifyInput): Promise<string | null> {
  if (!(await orgAllowsCategory(admin, input.orgId, input.category))) return null;
  const { data, error } = await admin.rpc("emit_notification", {
    p_org: input.orgId,
    p_user: input.userId,
    p_category: input.category,
    p_title: input.title,
    p_body: input.body ?? null,
    p_severity: input.severity ?? "info",
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
    p_deep_link: deepLinkFor(input.category, input.entityId),
    p_dedupe_key: input.dedupeKey ?? null,
  });
  if (error) {
    // A notification is never worth failing the action that caused it — a released load must still
    // be released even if telling someone about it fails.
    console.error(`[notify] ${input.category} failed: ${error.message}`);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Resolve a driver's login id — notifications address a user, drivers are a roster concept. */
export async function loginForDriver(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("drivers")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("id", driverId)
    .maybeSingle();
  return (data as { user_id: string | null } | null)?.user_id ?? null;
}

/** Revoke every push token for a user — sign-out and offboarding (D14/D53). */
export async function revokePushTokens(admin: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await admin.rpc("revoke_push_tokens", { p_user: userId });
  if (error) {
    console.error(`[notify] token revocation failed for ${userId}: ${error.message}`);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

// ── Expo Push delivery ────────────────────────────────────────────────────────
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts up to 100 messages per request. */
const BATCH = 100;

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface PushResult {
  sent: number;
  failed: number;
  revoked: number;
}

type Fetcher = typeof fetch;

interface PendingRow {
  id: string;
  org_id: string;
  audience_user_id: string;
  title: string;
  body: string | null;
  category: string;
  deep_link: string | null;
  severity: string;
}

/**
 * Deliver everything not yet pushed. Called on an interval by the worker; safe to run concurrently
 * with itself because each row is stamped `pushed_at` immediately after its batch resolves, and a
 * duplicate send is far less harmful than a lost one.
 *
 * `DeviceNotRegistered` is the important failure: it means the app was uninstalled or the token
 * rotated, and the token must be revoked or the fleet accumulates dead endpoints that fail forever.
 */
export async function deliverPending(
  admin: SupabaseClient,
  opts: { limit?: number; fetcher?: Fetcher } = {},
): Promise<PushResult> {
  const doFetch = opts.fetcher ?? fetch;
  const { data: pending } = await admin
    .from("notification_events")
    .select("id, org_id, audience_user_id, title, body, category, deep_link, severity")
    .is("pushed_at", null)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 500);

  const rows = (pending ?? []) as unknown as PendingRow[];
  if (rows.length === 0) return { sent: 0, failed: 0, revoked: 0 };

  const userIds = [...new Set(rows.map((r) => r.audience_user_id))];
  const { data: tokenRows } = await admin
    .from("device_push_tokens")
    .select("token, user_id")
    .in("user_id", userIds)
    .is("revoked_at", null);

  const byUser = new Map<string, string[]>();
  for (const t of (tokenRows ?? []) as unknown as { token: string; user_id: string }[]) {
    byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);
  }

  interface Message { to: string; title: string; body: string; data: Record<string, unknown>; priority: string }
  const messages: Message[] = [];
  const tokenOf: string[] = [];
  for (const row of rows) {
    for (const token of byUser.get(row.audience_user_id) ?? []) {
      messages.push({
        to: token,
        title: row.title,
        body: row.body ?? "",
        // The deep link travels in `data` so tapping opens the exact load or thread.
        data: { id: row.id, category: row.category, deep_link: row.deep_link },
        priority: row.severity === "critical" ? "high" : "default",
      });
      tokenOf.push(token);
    }
  }

  let sent = 0;
  let failed = 0;
  const failureReasons = new Set<string>();
  const deadTokens = new Set<string>();

  for (let i = 0; i < messages.length; i += BATCH) {
    const slice = messages.slice(i, i + BATCH);
    try {
      const res = await doFetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(slice),
      });
      const payload = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = payload.data ?? [];
      tickets.forEach((ticket, n) => {
        if (ticket.status === "ok") {
          sent += 1;
          return;
        }
        failed += 1;
        failureReasons.add(ticket.message ?? ticket.details?.error ?? "push_ticket_failed");
        if (ticket.details?.error === "DeviceNotRegistered") {
          const token = tokenOf[i + n];
          if (token) deadTokens.add(token);
        }
      });
    } catch (e) {
      failed += slice.length;
      const message = e instanceof Error ? e.message : String(e);
      failureReasons.add(message);
      console.error("[push] batch failed:", message);
    }
  }

  // Keep attempted events visible in the in-app centre, but persist the delivery failure so operations can
  // distinguish a delivered push from an attempted/failed push instead of losing the reason in logs.
  const ids = rows.map((r) => r.id);
  const pushError = failureReasons.size ? [...failureReasons].slice(0, 5).join("; ").slice(0, 2000) : null;
  await admin.from("notification_events").update({ pushed_at: new Date().toISOString(), push_error: pushError }).in("id", ids);

  if (deadTokens.size > 0) {
    await admin
      .from("device_push_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .in("token", [...deadTokens]);
  }

  return { sent, failed, revoked: deadTokens.size };
}
