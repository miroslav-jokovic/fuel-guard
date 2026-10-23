import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdmin, localHourMinute, type UserRole } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { chatDirectory } from "./chat.js";
import { notify } from "./notify.js";

/**
 * The nightly check that office chat's history has not been rewritten (OFFICE-CHAT-PLAN CHA1,
 * D-CHAT12, §5.1).
 *
 * `chat_ledger` (0511) is hash-chained per org and WORM, so no role can UPDATE or DELETE a row. That
 * protects against the app. It does not protect against a service-role bug or a person with database
 * access who disables a trigger, rewrites a message and puts the trigger back, which RLS cannot see.
 * `chat_ledger_verify` (0512) is the answer to that case: it recomputes the org's chain link by link,
 * and checks every live message's text against the hash of its latest ledger entry. A chain nobody
 * re-reads proves nothing, so this job re-reads it every night.
 *
 * ── WHAT A PROBLEM MEANS ────────────────────────────────────────────────────────────────────────
 * The function returns one row: how many links it checked, and the FIRST problem (null = intact).
 * The SQL measures and this file decides who hears about it (the repo's split: SQL returns a
 * measurement, TS owns the verdict). Every problem is `critical`: a broken chain is evidence that
 * somebody changed company records outside the product. A message with no ledger entry at all is
 * the one innocent case: a message written before 0511 created the ledger. Production and staging
 * had 0 messages when CHA1 was written (measured 2026-10-23), so even that one is worth a look.
 *
 * ── WHEN ────────────────────────────────────────────────────────────────────────────────────────
 * Once a night at 05:00 Central, the `storageReconcileScheduler.ts` shape and for its reason: the api
 * process rarely lives 24 h (810 restarts in 40 days, measured 2026-10-02), so `setInterval(24h)`
 * would almost never fire. 05:00 is after the 01:00 release and the 03:00 nightly reconcile's usual
 * end, and before the office starts. The check is a read, and its alert is deduped per org per day
 * (`chat_ledger:<org>:<day>`), so a second process crossing 05:00 the same day costs one query and
 * sends nothing twice.
 */

export const CHAT_LEDGER_VERIFY_HOUR = 5;
export const CHAT_LEDGER_VERIFY_TZ = "America/Chicago";
const TICK_MS = 15 * 60_000;

export interface LedgerVerdict {
  checked: number;
  firstBadSeq: number | null;
  problem: string | null;
  messageId: string | null;
}

/** The Central calendar day to stamp when a verify is due now, or null when it is not. Pure. */
export function chatLedgerVerifyDueDay(nowMs: number, lastRanDay: string | null): string | null {
  const now = new Date(nowMs);
  if (localHourMinute(now.toISOString(), CHAT_LEDGER_VERIFY_TZ).h !== CHAT_LEDGER_VERIFY_HOUR) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CHAT_LEDGER_VERIFY_TZ }).format(now);
  return day === lastRanDay ? null : day;
}

/** What the admins are told about a verdict, or null when there is nothing to tell. Pure. */
export function chatLedgerAlert(
  orgId: string,
  verdict: LedgerVerdict,
  day: string,
): { title: string; body: string; dedupeKey: string } | null {
  if (!verdict.problem) return null;
  const where = [
    verdict.firstBadSeq !== null ? `ledger entry ${verdict.firstBadSeq}` : null,
    verdict.messageId ? `message ${verdict.messageId}` : null,
  ].filter(Boolean).join(", ");
  return {
    title: "Office chat history failed its integrity check",
    body:
      `Tonight's check of the office chat record found: ${verdict.problem}${where ? ` (${where})` : ""}, ` +
      `after ${verdict.checked} entries that checked out. This means a message or its record was changed ` +
      `outside Silvicom 360. Nothing has been changed or hidden because of it. Keep this notice and ` +
      `contact Silvicom 360 support, so the record can be compared with the database's history.`,
    dedupeKey: `chat_ledger:${orgId}:${day}`,
  };
}

/** One org's verdict. THROWS on a read error: an unread chain is not an intact one. */
export async function verifyChatLedger(admin: SupabaseClient, orgId: string): Promise<LedgerVerdict> {
  const { data, error } = await admin.rpc("chat_ledger_verify", { p_org: orgId, p_after_seq: 0 });
  if (error) throw new Error(`chat_ledger_verify: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { checked: number | string; first_bad_seq: number | string | null; problem: string | null; message_id: string | null }
    | undefined;
  if (!row) throw new Error("chat_ledger_verify returned no row");
  return {
    checked: Number(row.checked),
    firstBadSeq: row.first_bad_seq === null ? null : Number(row.first_bad_seq),
    problem: row.problem,
    messageId: row.message_id,
  };
}

/**
 * ⚠ WORKAROUND (labelled, per CLAUDE.md "No workarounds"): the people told are the org's ADMINS.
 * The plan's answer (Q-CHAT2, D-CHAT14) is the holders of the `chat.compliance` permission. That
 * permission does not exist until CHA2 builds the compliance console. Admins hold it by default
 * there (`startsOnFor: []`), so today the two sets are the same. They differ only once an admin
 * grants it to somebody else, which CHA2 makes possible. CHA2 replaces this list with that
 * permission's resolved holders, and this note goes with it.
 *
 * Read from chat's own directory (`chat_people`, 0512: the org's unsuspended office members with their
 * role), filtered by `isAdmin`, never a typed role list. Messaging may not import `org` — `org`
 * depends on messaging, and `lint:boundaries` keeps that one way.
 */
async function interimRecipients(admin: SupabaseClient, orgId: string): Promise<string[]> {
  return (await chatDirectory(admin, orgId)).filter((p) => isAdmin(p.role as UserRole)).map((p) => p.user_id);
}

/** Verify one org and tell its admins about a problem. Returns the verdict and how many were told. */
export async function runChatLedgerVerifyOnce(
  admin: SupabaseClient,
  orgId: string,
  day: string,
): Promise<LedgerVerdict & { notified: number }> {
  const verdict = await verifyChatLedger(admin, orgId);
  const alert = chatLedgerAlert(orgId, verdict, day);
  if (!alert) return { ...verdict, notified: 0 };
  console.error(
    `[chat-ledger] org ${orgId}: ${verdict.problem} (first bad seq ${verdict.firstBadSeq ?? "—"}, ` +
      `message ${verdict.messageId ?? "—"}, ${verdict.checked} checked)`,
  );
  let notified = 0;
  for (const userId of await interimRecipients(admin, orgId)) {
    const id = await notify(admin, { orgId, userId, category: "system", severity: "critical", ...alert });
    if (id) notified++;
  }
  return { ...verdict, notified };
}

/** Nightly, every org, each in its own try. Runs in EXACTLY ONE process: the `general` lane's lease. */
export function startChatLedgerVerifyScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let inFlight = false;
  const run = async (day: string): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      const { data, error } = await admin.from("organizations").select("id");
      if (error) throw new Error(error.message);
      for (const org of (data ?? []) as { id: string }[]) {
        try {
          const r = await runChatLedgerVerifyOnce(admin, org.id, day);
          if (!r.problem && r.checked > 0) console.log(`[chat-ledger] org ${org.id}: ${r.checked} entries intact`);
        } catch (e) {
          console.error(`[chat-ledger] org ${org.id}: verify failed — ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      console.error(`[chat-ledger] run failed — ${e instanceof Error ? e.message : e}`);
    } finally {
      inFlight = false;
    }
  };

  let lastRanDay: string | null = null;
  const timer = setInterval(() => {
    const due = chatLedgerVerifyDueDay(Date.now(), lastRanDay);
    if (!due) return;
    lastRanDay = due;
    void run(due);
  }, TICK_MS);
  timer.unref?.();
  console.log("[chat-ledger] nightly ledger verify enabled (05:00 Central)");
}
