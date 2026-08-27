import type { SupabaseClient } from "@supabase/supabase-js";
import { planDqAlerts, rolesThatManage, type DqAlert } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { sendEmail } from "../../lib/mailer.js";
import { getComplianceOverview } from "./complianceOverview.js";
import { notify } from "../../services/notify.js";
import { runApplicationNudgesOnce } from "../recruiting/index.js";

/**
 * DQ expiry alerts (DQF execution plan C3) — the digestScheduler shape, applied to qualifications:
 * env flag, ~6h interval, stateless per-run.
 *
 * Two facts shape the delivery (G30, G31, D-DQ13/14):
 *   - The overview is computed at a 91-DAY horizon here and ONLY here — the 90/60-day thresholds
 *     are invisible at the UI's 30-day default (C2).
 *   - `notify()` is the LEDGER and the future inbox, not the delivery: notification_events rows are
 *     where the dedupe keys live and what C6's web inbox will render — but office users have no
 *     push tokens and no inbox yet, so what an office manager actually receives today is ONE email
 *     per run listing the newly-crossed items, worst first. Never one email per alert: a fleet
 *     crossing a renewal season must not send forty emails in an afternoon.
 *   - No driver notifications, ever (D-DQ13: the file is company-only).
 */
const CHECK_INTERVAL_MS = 6 * 3_600_000;
const OFFICE_ROLES = rolesThatManage("fleet"); // admin, fleet_manager, safety_manager

async function sentKeys(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("notification_events")
    .select("dedupe_key")
    .eq("org_id", orgId)
    .like("dedupe_key", "dq:%");
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { dedupe_key: string | null }[]).map((r) => r.dedupe_key ?? ""));
}

async function officeUserIds(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", OFFICE_ROLES);
  if (error) throw new Error(error.message);
  return [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
}

function alertEmail(alerts: DqAlert[]): { subject: string; text: string; html: string } {
  const lines = alerts.map((a) => `  • ${a.title}${a.goodUntil ? ` (good until ${a.goodUntil})` : ""}`);
  const expired = alerts.filter((a) => a.category === "dq_expired").length;
  const subject =
    expired > 0
      ? `Driver qualification: ${expired} expired, ${alerts.length - expired} expiring`
      : `Driver qualification: ${alerts.length} ${alerts.length === 1 ? "item" : "items"} expiring`;
  const text = [
    "The following driver qualification items crossed an alert threshold:",
    "",
    ...lines,
    "",
    "Open Driver Qualification in Silvicom 360 to record renewals.",
  ].join("\n");
  const html = [
    "<p>The following driver qualification items crossed an alert threshold:</p>",
    "<ul>",
    ...alerts.map(
      (a) => `<li>${escapeHtml(a.title)}${a.goodUntil ? ` <em>(good until ${a.goodUntil})</em>` : ""}</li>`,
    ),
    "</ul>",
    "<p>Open Driver Qualification in Silvicom 360 to record renewals.</p>",
  ].join("\n");
  return { subject, text, html };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function runDqAlertsOnce(admin: SupabaseClient, env: Env, orgId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const overview = await getComplianceOverview(admin, orgId, today, { expiringWithinDays: 91 });
  const alerts = planDqAlerts(overview.drivers, today, await sentKeys(admin, orgId));
  if (alerts.length === 0) return 0;

  const users = await officeUserIds(admin, orgId);
  for (const alert of alerts) {
    for (const userId of users) {
      // emit_notification applies org entitlement, per-user mutes, quiet hours and the dedupe key
      // (G14) — never insert a row by hand, and never pre-filter what it governs better. The SAME
      // key goes to every recipient: uq_notification_dedupe is per (org, user, key), so each office
      // user gets their row, and sentKeys() reads back exactly the keys the planner emits.
      await notify(admin, {
        orgId,
        userId,
        category: alert.category,
        title: alert.title,
        severity: alert.severity,
        entityType: "driver",
        entityId: alert.driverId,
        dedupeKey: alert.dedupeKey,
      });
    }
  }

  const { data: org } = await admin
    .from("organizations")
    .select("notifications_enabled, notification_emails")
    .eq("id", orgId)
    .maybeSingle();
  const emails = ((org as { notification_emails?: string[] | null } | null)?.notification_emails ?? []).filter(Boolean);
  if ((org as { notifications_enabled?: boolean } | null)?.notifications_enabled !== false && emails.length > 0) {
    const { subject, text, html } = alertEmail(alerts);
    await sendEmail(env, { to: emails, subject, text, html });
  }
  return alerts.length;
}

async function runAllOrgs(admin: SupabaseClient, env: Env): Promise<void> {
  const { data: orgs } = await admin.from("organizations").select("id");
  for (const o of orgs ?? []) {
    const orgId = o.id as string;
    try {
      const n = await runDqAlertsOnce(admin, env, orgId);
      if (n > 0) console.log(`[dq-alerts] org ${orgId}: ${n} alert(s) emitted`);
    } catch (e) {
      console.error(`[dq-alerts] org ${orgId} failed:`, e instanceof Error ? e.message : e);
    }
    /**
     * A10's abandonment sweep, as a SECOND PASS in this scheduler rather than a scheduler of its own
     * (D-APP15). Schedulers must run in exactly one process fleet-wide, and every new one adds an
     * invariant somebody has to keep — this one already runs per-org, already emits notification rows
     * and already sends one office email per run, which is the right shape and the right audience.
     * Its own selection (stale >48 h, nudged once) makes the six-hourly cadence harmless.
     *
     * In its own try: an org whose DQ alerts throw must still have its stalled applicants found, and
     * the reverse. They are independent answers to independent questions.
     */
    try {
      const sweep = await runApplicationNudgesOnce(admin, env, orgId, await officeUserIds(admin, orgId), new Date());
      if (sweep.stalled > 0) {
        console.log(
          `[application-nudge] org ${orgId}: ${sweep.stalled} stalled, ${sweep.emailed} emailed, `
            + `${sweep.messaged} texted`,
        );
      }
    } catch (e) {
      console.error(`[application-nudge] org ${orgId} failed:`, e instanceof Error ? e.message : e);
    }
  }
}

/** ~6h cadence; the dedupe keys make every re-run idempotent. Disable with DQ_ALERTS_ENABLED=false.
 *  ⚠ Since A10 this also carries the abandonment sweep — see `runAllOrgs`. DQ_ALERTS_ENABLED=false
 *  therefore turns BOTH off, which is the honest consequence of putting a second pass in one timer. */
export function startDqAlertScheduler(env: Env): void {
  if (!env.DQ_ALERTS_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runAllOrgs(getSupabaseAdmin(env), env);
    } catch (e) {
      console.error("[dq-alerts] scheduler run failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 180_000); // first check ~3 min after boot, after the sync schedulers settle
  setInterval(run, CHECK_INTERVAL_MS);
  console.log("[dq-alerts] DQ expiry alert scheduler enabled");
}
