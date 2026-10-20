import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DQ_LEGACY_KEY_DAYS,
  driverAlertRows,
  organizationTimezone,
  planFileAlerts,
  todayInZone,
  UNIT_SUBJECT_TYPES,
  unitAlertRows,
  type FileAlert,
  type FileAlertRow,
  type UnitSubjectType,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { sendEmail } from "../../lib/mailer.js";
import { getComplianceOverview } from "./complianceOverview.js";
import { getUnitFiles } from "./unitFiles.js";
import { keysAlreadySent, notify } from "../messaging/index.js";
import { runApplicationNudgesOnce } from "../recruiting/index.js";
import { usersWhoManage } from "../org/index.js";

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

/**
 * The keys among today's candidates that were already sent (0432). This used to read EVERY `dq:%`
 * row from `notification_events` — 400 on 2026-10-05, one per recipient — and PostgREST stops at
 * 1,000, so within weeks the set would have come back truncated and the office re-sent expiries. It
 * now asks only about the candidates, through the ledger, in one uncapped answer.
 *
 * Old-format keys (no expiry date, before 2026-10-05) count only when first sent within
 * DQ_LEGACY_KEY_DAYS — exactly the current cycle — so the format change re-alerts nothing already
 * announced, and last year's key can no longer silence this year's renewal.
 */
async function sentKeys(admin: SupabaseClient, orgId: string, candidates: FileAlert[], today: string): Promise<Set<string>> {
  const legacySince = new Date(Date.parse(`${today}T00:00:00.000Z`) - DQ_LEGACY_KEY_DAYS * 86_400_000);
  const [current, legacy] = await Promise.all([
    keysAlreadySent(admin, orgId, candidates.map((a) => a.dedupeKey)),
    keysAlreadySent(admin, orgId, candidates.flatMap((a) => (a.legacyDedupeKey ? [a.legacyDedupeKey] : [])), legacySince),
  ]);
  return new Set([...current, ...legacy]);
}

/** Who hears a qualification finding: every member holding `roster` manage (D-DQ13). */
const officeUserIds = (admin: SupabaseClient, orgId: string): Promise<string[]> =>
  usersWhoManage(admin, orgId, "roster");

/** What one run's email calls its items, and where it sends the reader. */
interface AlertMail {
  subject: string;
  items: string;
  open: string;
}

const DRIVER_MAIL: AlertMail = {
  subject: "Driver qualification",
  items: "driver qualification items",
  open: "Open Driver Qualification in Silvicom 360 to record renewals.",
};

/** UF6: one email per subject type per run, named for the file it is about. */
const UNIT_MAIL: Record<UnitSubjectType, AlertMail> = {
  tractor: { subject: "Truck file", items: "truck file items", open: "Open Vehicles in Silvicom 360 to file the renewals." },
  trailer: { subject: "Trailer file", items: "trailer file items", open: "Open Trailers in Silvicom 360 to file the renewals." },
};

function alertEmail(alerts: FileAlert[], mail: AlertMail): { subject: string; text: string; html: string } {
  const lines = alerts.map((a) => `  • ${a.title}${a.goodUntil ? ` (good until ${a.goodUntil})` : ""}`);
  const expired = alerts.filter((a) => a.threshold === "overdue").length;
  const subject =
    expired > 0
      ? `${mail.subject}: ${expired} expired, ${alerts.length - expired} expiring`
      : `${mail.subject}: ${alerts.length} ${alerts.length === 1 ? "item" : "items"} expiring`;
  const text = [
    `The following ${mail.items} crossed an alert threshold:`,
    "",
    ...lines,
    "",
    mail.open,
  ].join("\n");
  const html = [
    `<p>The following ${mail.items} crossed an alert threshold:</p>`,
    "<ul>",
    ...alerts.map(
      (a) => `<li>${escapeHtml(a.title)}${a.goodUntil ? ` <em>(good until ${a.goodUntil})</em>` : ""}</li>`,
    ),
    "</ul>",
    `<p>${mail.open}</p>`,
  ].join("\n");
  return { subject, text, html };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type OrgRow = { notifications_enabled?: boolean; notification_emails?: string[] | null; operating_hours?: object | null };

async function readOrg(admin: SupabaseClient, orgId: string): Promise<OrgRow | null> {
  const { data } = await admin
    .from("organizations")
    .select("notifications_enabled, notification_emails, operating_hours")
    .eq("id", orgId)
    .maybeSingle();
  return data as OrgRow | null;
}

/**
 * Plan, deliver, and send one email — the same for a driver's file and a unit's. Plan once with
 * nothing sent to learn the candidate keys, then again against what the ledger says was sent: the
 * planner stays pure, and the second pass is the one that decides.
 */
async function deliverFileAlerts(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  rows: FileAlertRow[],
  today: string,
  recipients: () => Promise<string[]>,
  mail: AlertMail,
): Promise<number> {
  const candidates = planFileAlerts(rows, today, new Set());
  if (candidates.length === 0) return 0;
  const alerts = planFileAlerts(rows, today, await sentKeys(admin, orgId, candidates, today));
  if (alerts.length === 0) return 0;

  const users = await recipients();
  for (const alert of alerts) {
    for (const userId of users) {
      // emit_notification applies org entitlement, per-user mutes, quiet hours and the dedupe key
      // (G14) — never insert a row by hand, and never pre-filter what it governs better. The SAME
      // key goes to every recipient: the dedupe ledger is per (org, user, key) (0432), so each office
      // user gets their row, and sentKeys() reads back exactly the keys the planner emits. The entity
      // is the subject itself — `driver`, or `tractor`/`trailer`, which the bell opens on the unit's
      // File section (UF6).
      await notify(admin, {
        orgId,
        userId,
        category: alert.category,
        title: alert.title,
        severity: alert.severity,
        entityType: alert.subjectType,
        entityId: alert.subjectId,
        dedupeKey: alert.dedupeKey,
      });
    }
  }

  const org = await readOrg(admin, orgId);
  const emails = (org?.notification_emails ?? []).filter(Boolean);
  if (org?.notifications_enabled !== false && emails.length > 0) {
    const { subject, text, html } = alertEmail(alerts, mail);
    await sendEmail(env, { to: emails, subject, text, html });
  }
  return alerts.length;
}

export async function runDqAlertsOnce(admin: SupabaseClient, env: Env, orgId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const overview = await getComplianceOverview(admin, orgId, today, { expiringWithinDays: 91 });
  return deliverFileAlerts(admin, env, orgId, driverAlertRows(overview.drivers), today, () => officeUserIds(admin, orgId), DRIVER_MAIL);
}

/**
 * Truck and trailer papers (UNIT-FILES-PLAN UF6): the unit-files rollup — the same rows the Vehicles
 * and Trailers lists' Files column draws — judged on the CARRIER's calendar day, as that route judges
 * them, so the bell and the list call a registration expired on the same night. Without papers:
 * nothing here draws a thumbnail. Heard by every member holding `equipment` manage, the section a
 * truck's papers belong to (D-UF5).
 *
 * The driver pass above still judges on the server's UTC day, as it has since C3. Moving it to the
 * carrier's day is right and is not UF6's change: it would move a driver's verdicts, which this step
 * promised to leave byte for byte.
 */
export async function runUnitFileAlertsOnce(admin: SupabaseClient, env: Env, orgId: string): Promise<number> {
  const org = await readOrg(admin, orgId);
  const today = todayInZone(new Date(), organizationTimezone(org?.operating_hours));
  let managers: Promise<string[]> | null = null;
  const recipients = () => (managers ??= usersWhoManage(admin, orgId, "equipment"));
  let sent = 0;
  for (const subjectType of UNIT_SUBJECT_TYPES) {
    const { units } = await getUnitFiles(admin, orgId, subjectType, today, { withPapers: false });
    sent += await deliverFileAlerts(admin, env, orgId, unitAlertRows(units), today, recipients, UNIT_MAIL[subjectType]);
  }
  return sent;
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
    // UF6, in its own try for the same reason: a truck file that throws must not silence the drivers'.
    try {
      const n = await runUnitFileAlertsOnce(admin, env, orgId);
      if (n > 0) console.log(`[unit-file-alerts] org ${orgId}: ${n} alert(s) emitted`);
    } catch (e) {
      console.error(`[unit-file-alerts] org ${orgId} failed:`, e instanceof Error ? e.message : e);
    }
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
 *  ⚠ Since UF6 it carries the truck and trailer file alerts too (`runUnitFileAlertsOnce`), and the flag
 *  turns those off with the rest — one timer, not a new scheduler (docs/WORKER-DEPLOYMENT.md).
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
