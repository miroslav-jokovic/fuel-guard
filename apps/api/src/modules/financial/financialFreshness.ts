import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { sendEmail } from "../../lib/mailer.js";
import { notify } from "../messaging/index.js";
import { readFinancialSyncedAt } from "../mcleod/index.js";
import { recentFailedJobs, type FailedJobRow } from "../../queue/metrics.js";
import { officeUserIds } from "./officeRecipients.js";
import { runMonthClosesOnce } from "./monthClose.js";

/**
 * Silence is a state the system reports, never a state it assumes (D-FIN3, FINANCE-GO-LIVE-PLAN
 * §1.3).
 *
 * Two facts the audit of 2026-09-03 measured: production's McLeod staging had not been swept for
 * six days and nothing said so; the EFS refetch that was supposed to repair $494k of April–May
 * fuel had failed the day it ran and nothing said that either. Both were visible in a table nobody
 * reads. This pass turns each into a finding in the office's inbox, the dqAlertScheduler shape:
 * `notify()` rows are the ledger and carry the dedupe keys, and the office gets ONE email per run.
 *
 * What counts as stale: no financial sweep in 26 hours — the agent runs daily (D-FIN4), so 26
 * leaves two hours of slack for a slow night and none for a missed one. The key carries the day,
 * so a sweep that stays down re-alerts once a day, not once every six hours and not never.
 *
 * Which jobs: the three that feed the finance pages. A failed job is keyed by its id, so it is
 * reported exactly once and a retry that also fails is a new finding, not a suppressed one.
 */
export const STALE_AFTER_HOURS = 26;
export const FINANCE_JOB_KINDS = ["financial_projection", "efs_window_refetch", "efs_soap_posted"] as const;
const CHECK_INTERVAL_MS = 6 * 3_600_000;

export interface FreshnessFinding {
  title: string;
  body: string;
  severity: "warning" | "critical";
  dedupeKey: string;
  entityType: "integration" | "job";
  entityId: string | null;
}

/** Pure: what to say about a sweep stamp and a set of failed jobs, as of `now`. Exported for its test. */
export function planFreshnessFindings(
  orgId: string,
  lastSweptAt: string | null,
  failed: FailedJobRow[],
  now: Date,
): FreshnessFinding[] {
  const findings: FreshnessFinding[] = [];
  const day = now.toISOString().slice(0, 10);
  const ageHours = lastSweptAt ? (now.getTime() - Date.parse(lastSweptAt)) / 3_600_000 : null;
  if (ageHours === null) {
    findings.push({
      title: "McLeod financial sweep has never run",
      body: "No settlements, billing or ledger totals have ever landed for this organisation. The finance pages are empty until the agent's --financial sweep runs.",
      severity: "critical",
      dedupeKey: `finance:never-swept:${orgId}:${day}`,
      entityType: "integration",
      entityId: null,
    });
  } else if (lastSweptAt !== null && ageHours > STALE_AFTER_HOURS) {
    const days = Math.floor(ageHours / 24);
    findings.push({
      title: `McLeod financial sweep is ${days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.floor(ageHours)} hours`} old`,
      body: `The last financial sweep landed ${lastSweptAt.slice(0, 16).replace("T", " ")} UTC. The fleet report and Revenue & margin show figures as of that moment; anything McLeod posted since is not in them.`,
      severity: ageHours > 72 ? "critical" : "warning",
      dedupeKey: `finance:stale:${orgId}:${day}`,
      entityType: "integration",
      entityId: null,
    });
  }
  for (const job of failed) {
    findings.push({
      title: `Finance job failed: ${job.kind.replace(/_/g, " ")}`,
      body: job.error ? `The job ended with: ${job.error}` : "The job ended in failure with no error text.",
      severity: "critical",
      dedupeKey: `finance:job-failed:${job.id}`,
      entityType: "job",
      entityId: job.id,
    });
  }
  return findings;
}

async function alreadySent(admin: SupabaseClient, orgId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { data, error } = await admin.from("notification_events").select("dedupe_key").eq("org_id", orgId).in("dedupe_key", keys);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { dedupe_key: string | null }[]).map((r) => r.dedupe_key ?? ""));
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One pass for one org. Returns the findings that were NEW this run. Exported for its test. */
export async function runFinancialFreshnessOnce(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  now: Date = new Date(),
): Promise<FreshnessFinding[]> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [lastSweptAt, failed] = await Promise.all([
    readFinancialSyncedAt(admin, orgId),
    recentFailedJobs(admin, orgId, FINANCE_JOB_KINDS, since),
  ]);
  const planned = planFreshnessFindings(orgId, lastSweptAt, failed, now);
  if (!planned.length) return [];
  const sent = await alreadySent(admin, orgId, planned.map((f) => f.dedupeKey));
  const fresh = planned.filter((f) => !sent.has(f.dedupeKey));
  if (!fresh.length) return [];

  const users = await officeUserIds(admin, orgId);
  for (const f of fresh) {
    for (const userId of users) {
      // emit_notification applies entitlement, mutes, quiet hours and the dedupe key — the same
      // key to every recipient, one row each (uq_notification_dedupe is per org, user, key).
      await notify(admin, {
        orgId,
        userId,
        category: "system",
        title: f.title,
        body: f.body,
        severity: f.severity,
        entityType: f.entityType,
        entityId: f.entityId,
        dedupeKey: f.dedupeKey,
      });
    }
  }

  const { data: org } = await admin
    .from("organizations")
    .select("notifications_enabled, notification_emails")
    .eq("id", orgId)
    .maybeSingle();
  const row = org as { notifications_enabled?: boolean; notification_emails?: string[] | null } | null;
  const emails = (row?.notification_emails ?? []).filter(Boolean);
  if (row?.notifications_enabled !== false && emails.length > 0) {
    const subject = `Finance data: ${fresh.length} ${fresh.length === 1 ? "finding" : "findings"} need attention`;
    const text = ["The finance pages are reading from data that needs attention:", "", ...fresh.map((f) => `  • ${f.title} — ${f.body}`), "", "Open Silvicom 360 → Finance to check the figures' date, and the Integrations page for the McLeod agent."].join("\n");
    const html = ["<p>The finance pages are reading from data that needs attention:</p>", "<ul>", ...fresh.map((f) => `<li><strong>${escapeHtml(f.title)}</strong> — ${escapeHtml(f.body)}</li>`), "</ul>", "<p>Open Silvicom 360 → Finance to check the figures' date, and the Integrations page for the McLeod agent.</p>"].join("\n");
    await sendEmail(env, { to: emails, subject, text, html });
  }
  return fresh;
}

/**
 * Six-hourly, every org, each in its own try. Runs in EXACTLY ONE process (see `startAllSchedulers`
 * and docs/WORKER-DEPLOYMENT.md); the dedupe keys make a re-run idempotent, so a second process
 * would waste queries rather than duplicate findings — but the invariant still holds.
 */
export function startFinancialFreshnessScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      const { data, error } = await admin.from("organizations").select("id");
      if (error) throw new Error(error.message);
      for (const org of (data ?? []) as { id: string }[]) {
        try {
          const fresh = await runFinancialFreshnessOnce(admin, env, org.id);
          if (fresh.length) console.log(`[finance-freshness] org ${org.id}: ${fresh.length} new finding(s) — ${fresh.map((f) => f.title).join("; ")}`);
        } catch (e) {
          console.error(`[finance-freshness] org ${org.id} failed: ${e instanceof Error ? e.message : e}`);
        }
        // The monthly close rides the same timer (D-FIN14; the D-APP15 shape — one process, one
        // clock, a second pass in its own try so one org's bad month never stops the next).
        try {
          const closes = await runMonthClosesOnce(admin, env, org.id);
          if (closes.length) console.log(`[finance-close] org ${org.id}: ${closes.map((c) => `${c.period_start.slice(0, 7)} ${c.company_id} ${c.status}`).join("; ")}`);
        } catch (e) {
          console.error(`[finance-close] org ${org.id} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    } finally {
      inFlight = false;
    }
  };
  setTimeout(() => void run(), 240_000); // after the sync schedulers settle
  setInterval(() => void run(), CHECK_INTERVAL_MS);
  console.log("[finance-freshness] financial freshness scheduler enabled");
}
