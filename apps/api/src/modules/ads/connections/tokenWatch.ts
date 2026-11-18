import type { SupabaseClient } from "@supabase/supabase-js";
import { TOKEN_WARN_DAYS, formatDisplayDate, tokenDaysLeft, type AdsConnectionReport, type AdsTokenExpiry } from "@silvicom/shared";
import { sendAdsAlert } from "../alerts/adsAlerts.js";
import { appAccessToken, readTokenExpiry } from "../platforms/meta/tokenExpiry.js";
import { recordTokenExpiry } from "./connections.js";
import { graphForConnection, type RegistryDeps } from "../platforms/registry.js";

/**
 * The daily look at a Meta connection's token (audit 2026-11-18 A-8): Meta's `debug_token` read once a day — the
 * reconcile job runs it, one connection at a time — written on the connection (`token_expires_on` and the last
 * report's `token_expiry`), and admins told once a day from `TOKEN_WARN_DAYS` before it lapses, or the day Meta says
 * it is no longer valid. A token issued never to expire is read and stays quiet.
 *
 * It tells; it does not stop anything. A token Meta refuses is already marked `failing` by the road that meets it
 * (`alerts/connectionAlerts.ts`), under the same alert category and the same daily dedupe, so one dead token is one
 * bell a day whichever road saw it first.
 */

export interface TokenWatchDeps extends RegistryDeps {
  admin: SupabaseClient;
  now: () => Date;
}

export type TokenWatchOutcome =
  | { kind: "read"; expiry: AdsTokenExpiry; days_left: number | null; alerted: boolean }
  | { kind: "skipped"; why: string };

export async function watchTokenExpiry(deps: TokenWatchDeps, orgId: string, connectionId: string): Promise<TokenWatchOutcome> {
  const { data, error } = await deps.admin.from("ads_platform_connections")
    .select("id, org_id, provider, is_sandbox, token_sealed, status, last_test")
    .eq("org_id", orgId).eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const row = data as { id: string; org_id: string; provider: string; is_sandbox: boolean; token_sealed: string | null; status: string; last_test: AdsConnectionReport | null } | null;
  if (!row) return { kind: "skipped", why: "no such connection" };
  if (row.provider !== "meta") return { kind: "skipped", why: `a ${row.provider} connection has no Meta token` };
  if (row.status === "disconnected") return { kind: "skipped", why: "disconnected" };
  const opened = await graphForConnection(deps, row);
  if (!opened.ok) return { kind: "skipped", why: opened.error_code };

  const now = deps.now();
  const expiry = await readTokenExpiry(opened.graph, appAccessToken(deps.env), now);
  await recordTokenExpiry(deps.admin, orgId, connectionId, expiry, row.last_test);

  const days = tokenDaysLeft(expiry, now);
  const lapsing = expiry.read && (!expiry.valid || (days !== null && days <= TOKEN_WARN_DAYS));
  if (lapsing) {
    const what = !expiry.valid ? "Meta says the token is no longer valid" : days! < 0 ? "its token has expired" : `its token expires on ${formatDisplayDate(expiry.expires_at)}`;
    await sendAdsAlert(deps.admin, orgId, {
      category: "ads_token_expiring",
      title: !expiry.valid || days! <= 0 ? "An ad account connection's token has lapsed" : "An ad account connection's token is about to expire",
      body: `The ${row.is_sandbox ? "sandbox " : ""}Meta connection: ${what}. Generate a new system-user token in Meta's Business settings and connect again on Settings › Ads control, before ads stop.`,
      severity: !expiry.valid || days! <= 3 ? "critical" : "warning",
      entityType: "ads_platform_connection",
      entityId: connectionId,
      dedupeKey: `ads_token_expiring:${connectionId}:${now.toISOString().slice(0, 10)}`,
    });
  }
  return { kind: "read", expiry, days_left: days, alerted: Boolean(lapsing) };
}
