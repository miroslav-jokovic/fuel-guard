import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lumperBellKey,
  lumperLineKey,
  lumperReminderAlertFor,
  lumperReminderBellTitle,
  lumperReminderDay,
  lumperReminderLine,
  lumperSweepStaleSince,
  LUMPER_REMINDER_ALERTS,
  LUMPER_REMINDER_SEVERITY,
  type LumperReminderAlert,
  type LumperReminderStatus,
} from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { sendAlerts, type AlertEvent } from "../../messaging/index.js";
import { orgTimezone } from "../../org/index.js";
import { readFleetDispatchers } from "../dispatchLinks.js";
import { listLumperCases } from "./lumperCases.js";

/**
 * The daily lumper reminder — LUMPER-REVISED-RC-PLAN LRC4 (D-LRC4, D-LRC6, D-LRC7, D-LRC9, Q-LRC2).
 *
 * ── ONE MORNING, ONCE ────────────────────────────────────────────────────────────────────────────
 * Every fifteen minutes the job asks, per carrier: is the reminder switched on (`lumper_reminder_settings`,
 * no row = off: the silent weeks), and is it a weekday at or after 08:00 on the carrier's clock
 * (`lumperReminderDay`)? If so it CLAIMS the day by inserting `lumper_reminder_runs (org, day)`; the
 * insert that loses the race, or finds the day already claimed, sends nothing. So the morning goes once
 * whatever restarts or second processes there are, and a server down at 08:00 still sends it when it
 * comes back that day. A run that fails removes its claim and the next tick tries again; the dedupe
 * ledger (0432) keeps any line that did go from going twice.
 *
 * ── WHAT IT SENDS ────────────────────────────────────────────────────────────────────────────────
 * The open cases, read through the page's own reader (`listLumperCases`), so the reminder names exactly
 * what the page shows open. Each case falls in at most one of three alerts (`lumperReminderAlertFor`),
 * each routed on Settings › Notifications (D-LRC7) — by default the order's dispatcher (`operations_user`
 * linked to a 360 account, Q-LRC5), accounting and the admins. A person gets ONE bell item per alert
 * naming how many loads, one email listing them, and one text when Text is switched on for them (D-LRC6).
 * A case whose dispatcher is not linked reaches the routes' roles; when those reach nobody, the admins.
 *
 * Nothing is sent before the first McLeod read (there are no cases), and when the last read is older than
 * a day the bell says when it was, so nobody works a stale list believing it current (plan §4).
 *
 * Started from `SCHEDULERS`, so the general lane's lease runs it in exactly one process
 * (`docs/WORKER-DEPLOYMENT.md`). A carrier without the Dispatch module is skipped: the page is behind it.
 */

const TICK_MS = 15 * 60_000;
const BOOT_DELAY_MS = 180_000;

export interface LumperReminderRun {
  /** The carrier's day that was sent, or why nothing was. */
  sent: string | null;
  skipped?: "off" | "not_due" | "already_sent" | "no_module" | "never_read";
  cases: number;
  bells: number;
  emails: number;
  texts: number;
}

/** Is the reminder on for this carrier? No row = off (D-LRC9). */
export async function readLumperRemindersOn(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await admin.from("lumper_reminder_settings").select("reminders_on").eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(`lumper_reminder_settings: ${error.message}`);
  return (data as { reminders_on: boolean } | null)?.reminders_on === true;
}

/** The switch for the Settings card: who set it, and the last morning it ran. */
export async function readLumperReminderStatus(admin: SupabaseClient, orgId: string): Promise<LumperReminderStatus> {
  const [setting, runs] = await Promise.all([
    admin.from("lumper_reminder_settings").select("reminders_on, updated_by, updated_at").eq("org_id", orgId).maybeSingle(),
    admin.from("lumper_reminder_runs").select("run_on, cases, bells, emails, texts").eq("org_id", orgId).not("finished_at", "is", null).order("run_on", { ascending: false }).limit(1),
  ]);
  if (setting.error) throw new Error(`lumper_reminder_settings: ${setting.error.message}`);
  if (runs.error) throw new Error(`lumper_reminder_runs: ${runs.error.message}`);
  const row = setting.data as { reminders_on: boolean; updated_by: string | null; updated_at: string } | null;
  let updatedByName: string | null = null;
  if (row?.updated_by) {
    // `user_profiles` is keyed by the person; the id comes from this org's own row.
    const { data } = await admin.from("user_profiles").select("full_name").eq("user_id", row.updated_by).maybeSingle();
    updatedByName = (data as { full_name: string | null } | null)?.full_name ?? null;
  }
  const last = ((runs.data ?? []) as { run_on: string; cases: number | null; bells: number | null; emails: number | null; texts: number | null }[])[0];
  return {
    remindersOn: row?.reminders_on === true,
    updatedAt: row?.updated_at ?? null,
    updatedByName,
    lastRun: last ? { runOn: last.run_on, cases: last.cases, bells: last.bells, emails: last.emails, texts: last.texts } : null,
  };
}

/** The switch, as a whole row on its primary key (never a partial upsert: every column is written). */
export async function saveLumperRemindersOn(admin: SupabaseClient, orgId: string, actorId: string, on: boolean, now: Date): Promise<void> {
  const { error } = await admin
    .from("lumper_reminder_settings")
    .upsert({ org_id: orgId, reminders_on: on, updated_by: actorId, updated_at: now.toISOString() }, { onConflict: "org_id" });
  if (error) throw new Error(`lumper_reminder_settings: ${error.message}`);
}

/** Claim the carrier's day. False when it is already claimed — by an earlier tick, or another process. */
async function claimDay(admin: SupabaseClient, orgId: string, day: string, now: Date): Promise<boolean> {
  const { error } = await admin.from("lumper_reminder_runs").insert({ org_id: orgId, run_on: day, started_at: now.toISOString() });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`lumper_reminder_runs: ${error.message}`);
}

async function releaseDay(admin: SupabaseClient, orgId: string, day: string): Promise<void> {
  const { error } = await admin.from("lumper_reminder_runs").delete().eq("org_id", orgId).eq("run_on", day).is("finished_at", null);
  if (error) console.error(`[lumper-reminders] org ${orgId}: could not release ${day}: ${error.message}`);
}

/** One carrier, one tick. Exported for the tests; the scheduler below calls it for every org. */
export async function runLumperRemindersOnce(admin: SupabaseClient, env: Env, orgId: string, now: Date = new Date()): Promise<LumperReminderRun> {
  const run: LumperReminderRun = { sent: null, cases: 0, bells: 0, emails: 0, texts: 0 };
  if (!(await readLumperRemindersOn(admin, orgId))) return { ...run, skipped: "off" };
  const zone = await orgTimezone(admin, orgId);
  const day = lumperReminderDay(now, zone);
  if (!day) return { ...run, skipped: "not_due" };
  const { data: entitled, error: moduleError } = await admin.rpc("org_module_enabled", { p_org: orgId, p_module: "dispatch" });
  if (moduleError) throw new Error(`org_module_enabled: ${moduleError.message}`);
  if (entitled !== true) return { ...run, skipped: "no_module" };
  if (!(await claimDay(admin, orgId, day, now))) return { ...run, skipped: "already_sent" };

  try {
    const [list, links] = await Promise.all([listLumperCases(admin, orgId, "open"), readFleetDispatchers(admin, orgId)]);
    if (!list.sweptAt) {
      await releaseDay(admin, orgId, day);
      return { ...run, skipped: "never_read" };
    }
    const staleSince = lumperSweepStaleSince(list.sweptAt, now);
    /** McLeod login → 360 account, for the order's dispatcher (Q-LRC5). A system login is nobody. */
    const accountOf = new Map(links.dispatchers.filter((d) => d.isActive && !d.isSystem && d.userId).map((d) => [d.id, d.userId!]));

    const byAlert = new Map<LumperReminderAlert, AlertEvent[]>();
    for (const c of list.cases) {
      const alert = lumperReminderAlertFor(c.state, c.factsCurrent);
      if (!alert) continue;
      run.cases += 1;
      byAlert.set(alert, [
        ...(byAlert.get(alert) ?? []),
        {
          dedupeKey: lumperLineKey(alert, day, c.id),
          line: lumperReminderLine(c),
          severity: LUMPER_REMINDER_SEVERITY[alert],
          entityType: "lumper_case",
          entityId: c.id,
          relations: { order_dispatcher: c.dispatcherUserId ? (accountOf.get(c.dispatcherUserId) ?? null) : null },
        },
      ]);
    }
    for (const alert of LUMPER_REMINDER_ALERTS) {
      const events = byAlert.get(alert) ?? [];
      if (events.length === 0) continue;
      const sent = await sendAlerts(admin, env, orgId, alert, events, { zone, now }, {
        bellDigest: (mine) => ({ title: lumperReminderBellTitle(alert, mine.length, staleSince), dedupeKey: lumperBellKey(alert, day), severity: LUMPER_REMINDER_SEVERITY[alert] }),
      });
      run.bells += sent.bells;
      run.emails += sent.emails;
      run.texts += sent.texts;
    }
  } catch (e) {
    await releaseDay(admin, orgId, day);
    throw e;
  }

  const { error } = await admin
    .from("lumper_reminder_runs")
    .update({ finished_at: new Date().toISOString(), cases: run.cases, bells: run.bells, emails: run.emails, texts: run.texts })
    .eq("org_id", orgId)
    .eq("run_on", day);
  if (error) console.error(`[lumper-reminders] org ${orgId}: could not record the run's counts: ${error.message}`);
  return { ...run, sent: day };
}

export function startLumperReminderScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let inFlight = false;
  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      // Only the carriers that switched it on: one small read, and a carrier in its silent weeks costs nothing.
      const { data, error } = await admin.from("lumper_reminder_settings").select("org_id").eq("reminders_on", true);
      if (error) throw new Error(error.message);
      for (const { org_id: orgId } of (data ?? []) as { org_id: string }[]) {
        try {
          const now = new Date();
          const r = await runLumperRemindersOnce(admin, env, orgId, now);
          // A text is never held here: 08:00 is outside every quiet window the page offers by default, and
          // one an admin moved past 08:00 is sent by the home-time job's drain, which runs every carrier's
          // queue every fifteen minutes (unless HOME_TIME_ALERT_MINUTES=0). A second drain here could race that
          // one in the same process and text a person twice.
          if (r.sent) console.log(`[lumper-reminders] org ${orgId} ${r.sent}: ${r.cases} case(s); ${r.bells} bell item(s), ${r.emails} email(s), ${r.texts} text(s)`);
        } catch (e) {
          console.error(`[lumper-reminders] run failed for org ${orgId}:`, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.error("[lumper-reminders] run failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };
  const boot = setTimeout(() => void tick(), BOOT_DELAY_MS);
  boot.unref?.();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  console.log("[lumper-reminders] daily lumper reminder job enabled (weekdays 08:00 on each carrier's clock, for carriers that switched it on)");
}
