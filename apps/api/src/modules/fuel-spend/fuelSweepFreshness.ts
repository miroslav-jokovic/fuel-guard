import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";
import { notify } from "../messaging/index.js";
import { usersWhoManage } from "../org/index.js";
import { recentFailedJobs, type FailedJobRow } from "../../queue/metrics.js";
import { SWEEP_CRITICAL_AFTER_MS, SWEEP_STALE_AFTER_MS } from "./fuelSweepCadence.js";

/**
 * Silence is a state the system reports, never a state it assumes — the fuel half (queue item 3 of
 * DATA-PRECISION-AUDIT-2026-09-20.md; the finance half is `financialFreshness.ts`, D-FIN3).
 *
 * ── WHAT THIS EXISTS TO HAVE CAUGHT ────────────────────────────────────────────────────────────
 * Between 2026-09-13 and 2026-09-20, `allocate()` handed the rollup a day-slice whose miles rounded
 * to 0.00 while its gallons survived at three decimals. `buildFuelSpendRollup` threw on it, the
 * scheduler caught it, wrote ONE line to `console.error`, and moved on — every six hours, for seven
 * days. `last_fuel_sweep_at` sat at 2026-09-15 08:55 for 136 hours. Nothing else, anywhere, said a
 * word. The defect was found by eye, on a dashboard tile that read 8.61 MPG against a trend chart
 * drawing 6.8, by the owner, a week in.
 *
 * Queue items 1 and 2 removed that bug and made its effect visible on the card. Neither of them
 * stops the NEXT one-line bug doing the same thing, because the thing that failed was not the
 * allocation — it was that a scheduler is allowed to die quietly. This is the part that fixes that.
 *
 * ── TWO FINDINGS, BECAUSE THEY NEED TWO DIFFERENT ACTIONS ──────────────────────────────────────
 *   • **an attempt FAILED** — read off the ledger row the sweep now writes, carrying the database's
 *     own error text. It retries within six hours, so it is a warning and says so.
 *   • **the marker is STALE** — nothing has completed in `SWEEP_STALE_AFTER_MS`. This is the one
 *     that catches a failure with no error text at all: a process that never started the scheduler
 *     (`RUN_SCHEDULERS_IN_PROCESS` is false by default on every service but `api`), a sweep hung on
 *     an await, a slot wedged by a crashed run. No job row can express those; only the absence of a
 *     completion can.
 *
 * ⚠ The residual hole, stated rather than discovered later: this pass rides the fuel-spend
 * scheduler's own timer, so a scheduler that is not running cannot report that it is not running.
 * That is survivable here for one measured reason — the schedulers live in the `api` service, which
 * is also the thing serving `/api/version`, so "the scheduler process is gone" is not a silent
 * state. The case it genuinely cannot see is `RUN_SCHEDULERS_IN_PROCESS=false` on `api` itself, and
 * the reader-facing half of THAT is already covered: since queue item 2 the MPG card clamps its
 * window to the roll-up's watermark and prints the dates it actually measured.
 *
 * ── WHY THE OFFICE AND NOT AN OPS CHANNEL ──────────────────────────────────────────────────────
 * The consequence of a dead rollup is a WRONG NUMBER on a carrier's fuel pages, and the person who
 * needs to know not to quote August's cost-per-mile in a rate negotiation is the person holding
 * `fuel` manage. Same ruling as D-FIN3, same delivery: `notify()` rows are the ledger and carry the
 * dedupe keys, and the office gets ONE email per run however many findings it holds.
 */

/** The ledger kind the sweep runs under. */
export const FUEL_SWEEP_JOB_KIND = "fuel_spend_rollup" as const;

/** How far back to look for a failed attempt. A week — long enough to cover the outage this fixes. */
const FAILED_JOB_LOOKBACK_MS = 7 * 86_400_000;

export interface FuelSweepFinding {
  title: string;
  body: string;
  severity: "warning" | "critical";
  dedupeKey: string;
  entityType: "integration" | "job";
  entityId: string | null;
}

export interface FuelSweepState {
  /** `organizations.last_fuel_sweep_at` — stamped ONLY on a sweep that completed without throwing. */
  lastSweptAt: string | null;
  /** `organizations.created_at`, so a carrier onboarded this morning is not told its sweep is late. */
  orgCreatedAt: string | null;
}

const stamp = (iso: string): string => iso.slice(0, 16).replace("T", " ");

const humanAge = (ms: number): string => {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `${hours} hours`;
  return `${Math.floor(hours / 24)} days`;
};

/**
 * What to say about a sweep marker and a set of failed attempts, as of `now`. Pure; exported for its
 * test, which is where the thresholds are pinned.
 */
export function planFuelSweepFindings(
  orgId: string,
  state: FuelSweepState,
  failed: readonly FailedJobRow[],
  now: Date,
): FuelSweepFinding[] {
  const findings: FuelSweepFinding[] = [];
  const day = now.toISOString().slice(0, 10);
  const swept = state.lastSweptAt ? Date.parse(state.lastSweptAt) : NaN;

  if (!Number.isFinite(swept)) {
    /*
     * Never swept — but an org created an hour ago has not missed anything, and telling its first
     * admin that their fuel data has "never been rebuilt" on day one is a false alarm that teaches
     * people to ignore the real one. The org's own age is the only thing that tells the two apart.
     */
    const born = state.orgCreatedAt ? Date.parse(state.orgCreatedAt) : NaN;
    const old = !Number.isFinite(born) || now.getTime() - born > SWEEP_STALE_AFTER_MS;
    if (old) {
      findings.push({
        title: "Fuel spend figures have never been rebuilt",
        body:
          "Nothing has ever derived this organisation's daily fuel spend, so the Fuel Spend page, the " +
          "cost-per-mile figures and fleet MPG have nothing behind them. The nightly rebuild has either " +
          "never run or has never finished.",
        severity: "critical",
        dedupeKey: `fuel:never-swept:${orgId}:${day}`,
        entityType: "integration",
        entityId: null,
      });
    }
  } else {
    const age = now.getTime() - swept;
    if (age > SWEEP_STALE_AFTER_MS) {
      findings.push({
        title: `Fuel spend figures last rebuilt ${humanAge(age)} ago`,
        body:
          `The last completed rebuild finished ${stamp(new Date(swept).toISOString())} UTC. Fuel spend, ` +
          `cost per mile and fleet MPG are measured only as far as that moment — anything bought or ` +
          `driven since is not in them, and fleet MPG will quietly shorten the window you ask for.`,
        severity: age > SWEEP_CRITICAL_AFTER_MS ? "critical" : "warning",
        // Keyed by the DAY, so a rebuild that stays down re-alerts once a day rather than once every
        // six hours (which is noise) or exactly once ever (which is how a week goes by).
        dedupeKey: `fuel:stale:${orgId}:${day}`,
        entityType: "integration",
        entityId: null,
      });
    }
  }

  for (const job of failed) {
    findings.push({
      title: "Fuel spend rebuild failed",
      body: job.error
        ? `The nightly rebuild ended with: ${job.error}. It retries within six hours; if it keeps failing the figures will start to age.`
        : "The nightly rebuild ended in failure with no error text. It retries within six hours.",
      // Not critical on its own: one failed attempt is repaired by the next check, and the staleness
      // finding above is what escalates when it is not.
      severity: "warning",
      // Keyed by the job id, so a retry that also fails is a new finding rather than a suppressed one.
      dedupeKey: `fuel:rollup-failed:${job.id}`,
      entityType: "job",
      entityId: job.id,
    });
  }
  return findings;
}

async function alreadySent(admin: SupabaseClient, orgId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { data, error } = await admin
    .from("notification_events")
    .select("dedupe_key")
    .eq("org_id", orgId)
    .in("dedupe_key", keys);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { dedupe_key: string | null }[]).map((r) => r.dedupe_key ?? ""));
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One pass for one org. Returns the findings that were NEW this run. Exported for its test. */
export async function runFuelSweepFreshnessOnce(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  state: FuelSweepState,
  now: Date = new Date(),
): Promise<FuelSweepFinding[]> {
  const since = new Date(now.getTime() - FAILED_JOB_LOOKBACK_MS).toISOString();
  const failed = await recentFailedJobs(admin, orgId, [FUEL_SWEEP_JOB_KIND], since);
  const planned = planFuelSweepFindings(orgId, state, failed, now);
  if (!planned.length) return [];
  const sent = await alreadySent(admin, orgId, planned.map((f) => f.dedupeKey));
  const fresh = planned.filter((f) => !sent.has(f.dedupeKey));
  if (!fresh.length) return [];

  const users = await usersWhoManage(admin, orgId, "fuel");
  for (const f of fresh) {
    for (const userId of users) {
      // emit_notification applies entitlement, mutes, quiet hours and the dedupe key — the same key
      // to every recipient, one row each (uq_notification_dedupe is per org, user, key).
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
    const subject = `Fuel data: ${fresh.length} ${fresh.length === 1 ? "finding" : "findings"} need attention`;
    const intro = "The fuel pages are reading from figures that need attention:";
    const outro =
      "Open Silvicom 360 → Fuel Spend to see how far the figures reach, and Settings → Data & sync for the rebuild's own history.";
    const text = [intro, "", ...fresh.map((f) => `  • ${f.title} — ${f.body}`), "", outro].join("\n");
    const html = [
      `<p>${intro}</p>`,
      "<ul>",
      ...fresh.map((f) => `<li><strong>${escapeHtml(f.title)}</strong> — ${escapeHtml(f.body)}</li>`),
      "</ul>",
      `<p>${outro}</p>`,
    ].join("\n");
    await sendEmail(env, { to: emails, subject, text, html });
  }
  return fresh;
}
