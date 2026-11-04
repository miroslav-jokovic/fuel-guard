import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdsAlertCategory, NotificationCategory, NotificationSeverity } from "@silvicom/shared";
import { notify } from "../../messaging/index.js";
import { settingsInForce } from "../settings/settingsVersions.js";

/**
 * The ads module's alerts (2026-11-03 audit, finding H2: "nothing in `modules/ads` notifies anyone").
 * Until this file, every failure on the pause path was a row in `ads_actions` and a line in a log: a
 * revoked token, an ad account Meta disabled, a key this deploy cannot open — each retried every minute,
 * none ever reaching a person, while the ad kept spending up to the platform's own caps.
 *
 * Who hears it is the carrier's setting, not a role list written here: `alerts.recipients[category]` on
 * Settings › Ads control (plan §4b), and when that is empty, the org's admins — the people who hold
 * `ads.spend` and `ads.connection`, so the people who can pause an ad in Meta's own tool. A configured
 * id that is no longer an active member of this org is dropped, and if that leaves nobody, the admins
 * hear it: an alert addressed to nobody is the failure this file exists to end. Settings that cannot be
 * read fall back the same way, for the same reason.
 */

export interface AdsAlert {
  category: Extract<NotificationCategory, `ads_${string}`>;
  title: string;
  body: string;
  severity: NotificationSeverity;
  entityType: string;
  entityId: string;
  /** One bell item per fact (`notify`'s dedupe): a retried step must not alert twice. */
  dedupeKey: string;
}

type ActiveMember = { user_id: string; role: string };

async function activeMembers(admin: SupabaseClient, orgId: string): Promise<ActiveMember[]> {
  const { data, error } = await admin.from("memberships").select("user_id, role").eq("org_id", orgId).is("suspended_at", null);
  if (error) throw new Error(`memberships: ${error.message}`);
  return (data ?? []) as ActiveMember[];
}

async function chosenFrom(admin: SupabaseClient, orgId: string, category: AdsAlertCategory, members: ActiveMember[]): Promise<string[]> {
  let configured: string[];
  try {
    configured = (await settingsInForce(admin, orgId)).settings.alerts.recipients[category] ?? [];
  } catch {
    configured = [];
  }
  const active = new Set(members.map((m) => m.user_id));
  return configured.filter((id) => active.has(id));
}

/**
 * The carrier's own list for a category, active members only, with no fallback: for a caller whose fallback
 * is not the admins. Recruiting's lead alerts are that caller, handed this at the composition root (D-AD17).
 */
export async function configuredAlertRecipients(admin: SupabaseClient, orgId: string, category: AdsAlertCategory): Promise<string[]> {
  return chosenFrom(admin, orgId, category, await activeMembers(admin, orgId));
}

export async function alertRecipients(admin: SupabaseClient, orgId: string, category: AdsAlert["category"]): Promise<string[]> {
  const members = await activeMembers(admin, orgId);
  const chosen = await chosenFrom(admin, orgId, category, members);
  return chosen.length > 0 ? chosen : members.filter((m) => m.role === "admin").map((m) => m.user_id);
}

/** Send one alert to its recipients. Returns how many bell items were made (deduped ones are not). */
export async function sendAdsAlert(admin: SupabaseClient, orgId: string, alert: AdsAlert): Promise<number> {
  const users = await alertRecipients(admin, orgId, alert.category);
  if (users.length === 0) console.error(`[ads-alerts] org ${orgId}: ${alert.category} has nobody to tell — no admin is active`);
  const made = await Promise.all(users.map((userId) => notify(admin, {
    orgId, userId, category: alert.category, title: alert.title, body: alert.body, severity: alert.severity,
    entityType: alert.entityType, entityId: alert.entityId, dedupeKey: alert.dedupeKey,
  })));
  return made.filter((id) => id !== null).length;
}
