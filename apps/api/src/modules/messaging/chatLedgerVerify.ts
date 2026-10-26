import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdmin, localHourMinute, type UserRole } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { chatDirectory } from "./chat.js";
import {
  judgeAnchor,
  readLatestAnchor,
  writeAnchor,
  type AnchorStore,
  type LedgerAnchor,
  type LedgerHead,
} from "./chatLedgerAnchor.js";
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
 * ── AND THE ANCHOR (CHA4, 2026-10-23) ───────────────────────────────────────────────────────────
 * A chain that only checks against itself cannot see a `postgres`-role rewrite that recomputed every
 * hash, nor a tail cut off. So each night, BEFORE trusting the chain, this reads the anchor it wrote
 * the night before from the storage backup's S3 bucket (`chatLedgerAnchor.ts`) and checks that the
 * anchored row is still there with the anchored hash and that the head has not moved back. AFTER the
 * chain verifies intact it writes tonight's head as the new anchor. With no bucket configured
 * (staging) it says so and self-checks only; it never pretends to have anchored.
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

/** How the anchor went tonight, for the log line and the tests. */
export type AnchorOutcome =
  | { state: "off" }
  | { state: "first"; wrote: LedgerAnchor | null }
  | { state: "checked"; against: LedgerAnchor; wrote: LedgerAnchor | null }
  | { state: "skipped"; why: string };

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

/** The org's newest ledger row, or null for an empty ledger. THROWS on a read error. */
export async function readLedgerHead(admin: SupabaseClient, orgId: string): Promise<LedgerHead | null> {
  const { data, error } = await admin.from("chat_ledger").select("seq, hash").eq("org_id", orgId)
    .order("seq", { ascending: false }).limit(1);
  if (error) throw new Error(`chat_ledger head: ${error.message}`);
  const row = (data ?? [])[0] as { seq: number | string; hash: string } | undefined;
  return row ? { seq: Number(row.seq), hash: row.hash } : null;
}

/** The ledger's row at one seq as it stands now, or null when there is none. THROWS on a read error. */
export async function readLedgerLink(admin: SupabaseClient, orgId: string, seq: number): Promise<{ hash: string } | null> {
  const { data, error } = await admin.from("chat_ledger").select("hash").eq("org_id", orgId).eq("seq", seq).limit(1);
  if (error) throw new Error(`chat_ledger link ${seq}: ${error.message}`);
  const row = (data ?? [])[0] as { hash: string } | undefined;
  return row ? { hash: row.hash } : null;
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
 * Who is told: the holders of the `chat.compliance` permission (Q-CHAT2, D-CHAT14) — resolved by the
 * composition root from the org module's access tables (`surfaceHolders`), because messaging may not
 * import org. Until CHA2 this was a labelled interim of "the org's admins"; admins hold the permission
 * by default, so for an org that has not changed the grant the two sets are the same.
 */
export type RecipientsResolver = (admin: SupabaseClient, orgId: string) => Promise<string[]>;

/**
 * The fallback when no resolver is given (tests, a caller without the org module): the org's admins
 * from chat's own directory, filtered by `isAdmin`, never a typed role list.
 */
export async function adminRecipients(admin: SupabaseClient, orgId: string): Promise<string[]> {
  return (await chatDirectory(admin, orgId)).filter((p) => isAdmin(p.role as UserRole)).map((p) => p.user_id);
}

/**
 * Verify one org, against its anchor when there is one, and tell its admins about a problem. Returns
 * the verdict, how many were told, and what happened to the anchor.
 *
 * The HEAD is read before the chain is verified, so the verification covers at least everything the
 * anchor will name; tonight's anchor is written only when the chain and yesterday's anchor both
 * checked out, so an anchor always points at a head that was known good when it was written.
 */
export async function runChatLedgerVerifyOnce(
  admin: SupabaseClient,
  orgId: string,
  day: string,
  anchors: AnchorStore | null = null,
  recipients: RecipientsResolver = adminRecipients,
): Promise<LedgerVerdict & { notified: number; anchor: AnchorOutcome }> {
  const head = anchors ? await readLedgerHead(admin, orgId) : null;
  let verdict = await verifyChatLedger(admin, orgId);
  let anchor: AnchorOutcome = { state: "off" };

  if (anchors) {
    const previous = await readLatestAnchor(anchors, orgId);
    if (previous) {
      const link = await readLedgerLink(admin, orgId, previous.seq);
      const problem = judgeAnchor(previous, head, link);
      // The chain's own first problem is the more specific one and comes first; the anchor's is
      // reported when the chain looked fine, which is exactly the case the anchor exists for.
      if (problem && !verdict.problem) verdict = { ...verdict, problem, firstBadSeq: previous.seq, messageId: null };
    }
    if (verdict.problem) {
      anchor = { state: "skipped", why: "the chain did not verify, so last night's anchor stands" };
    } else {
      // An empty ledger has no head to anchor; the first message's night writes the first anchor.
      const wrote = head ? { day, seq: head.seq, hash: head.hash } : null;
      if (wrote) await writeAnchor(anchors, orgId, wrote, { checked: verdict.checked, previous, writtenAt: new Date().toISOString() });
      anchor = previous ? { state: "checked", against: previous, wrote } : { state: "first", wrote };
    }
  }

  const alert = chatLedgerAlert(orgId, verdict, day);
  if (!alert) return { ...verdict, notified: 0, anchor };
  console.error(
    `[chat-ledger] org ${orgId}: ${verdict.problem} (first bad seq ${verdict.firstBadSeq ?? "—"}, ` +
      `message ${verdict.messageId ?? "—"}, ${verdict.checked} checked)`,
  );
  let notified = 0;
  for (const userId of await recipients(admin, orgId)) {
    const id = await notify(admin, { orgId, userId, category: "system", severity: "critical", ...alert });
    if (id) notified++;
  }
  return { ...verdict, notified, anchor };
}

/** One line per org per night, so the anchor's state is in the log whether or not anything is wrong. */
export function describeAnchor(a: AnchorOutcome): string {
  switch (a.state) {
    case "off": return "no anchor store (STORAGE_BACKUP_* not set): chain self-checked only";
    case "first": return a.wrote ? `first anchor written at seq ${a.wrote.seq}` : "ledger empty, nothing to anchor yet";
    case "checked": return `anchor from ${a.against.day} (seq ${a.against.seq}) holds` + (a.wrote ? `; anchored tonight at seq ${a.wrote.seq}` : "");
    case "skipped": return `anchor not written: ${a.why}`;
  }
}

/** Nightly, every org, each in its own try. Runs in EXACTLY ONE process: the `general` lane's lease. */
export function startChatLedgerVerifyScheduler(
  env: Env,
  anchors: AnchorStore | null = null,
  recipients: RecipientsResolver = adminRecipients,
): void {
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
          const r = await runChatLedgerVerifyOnce(admin, org.id, day, anchors, recipients);
          if (!r.problem && r.checked > 0) console.log(`[chat-ledger] org ${org.id}: ${r.checked} entries intact; ${describeAnchor(r.anchor)}`);
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
  console.log(`[chat-ledger] nightly ledger verify enabled (05:00 Central); anchors ${anchors ? "to the storage backup bucket" : "off"}`);
}
