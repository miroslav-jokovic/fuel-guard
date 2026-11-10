import type { SupabaseClient } from "@supabase/supabase-js";
import { MANUAL_LEAD_CHANNELS } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { keysAlreadySent } from "../../messaging/index.js";
import { suppressedPhones } from "../smsSuppressions.js";
import { leadAlertKey, ringLead, type ConfiguredRecipients } from "./leadNotify.js";
import { readLeadVerdicts } from "./verdicts.js";

/**
 * `lead_uncontacted` (workflow D2c): a platform lead still `new`, with no contact on record, past
 * `alerts.uncontacted_lead_minutes`. It rings the same people as `lead_new` (`leadNotify.ts`), once per lead.
 *
 * ANY HOUR (owner, 2026-11-04): no business-hours rule. A person's own quiet hours and mutes still apply,
 * inside `notify`, and that is why this is `warning`: `critical` would ring through them. A person in quiet
 * hours is not marked sent, so when nobody could be rung the next sweep tries again.
 *
 * ── WHO IS LEFT OUT ───────────────────────────────────────────────────────────────────────────────
 *   · Leads a person typed in (`MANUAL_LEAD_CHANNELS`): the same reason as `lead_new`, somebody already
 *     spoke to them or holds their details.
 *   · A lead with a contact row: the contact is written before the status moves (`leadContacts.ts`), so a
 *     failed move leaves a lead `new` that somebody did call. The row is the evidence, not the status.
 *   · A number held from contact (`doNotContact.ts`): this alarm tells a person to call, and that person
 *     asked not to be called.
 *   · A lead whose own answer fails a hard requirement (LQ6, Q-AD63 (a)): the same reading the queue sorts by
 *     and the quality alert counts; it was never rung as `lead_new` either (`leadSink.ts`). Counted, so the
 *     brief can say how many the form turned away.
 *   · A lead with neither a phone nor an e-mail (LR3): the alarm says "call", and there is nothing to call. It
 *     was not rung as `lead_new` either; the intake alert told the admins the form may have changed.
 *
 * The clock is `received_at`, when WE stored the lead: a lead the backfill brought in hours late gets its full
 * window, because nobody could have called it before it arrived. No age ceiling: the first sweep after
 * switch-on rings every old lead still waiting, once.
 */

const PAGE = 100;
const SKIPPED_CHANNELS: readonly string[] = MANUAL_LEAD_CHANNELS;

export interface UncontactedSweep { overdue: number; rung: number; contacted: number; held: number; disqualified_by_answer: number; no_contact_detail: number }

export async function sweepUncontactedLeads(
  admin: SupabaseClient,
  orgId: string,
  now: Date,
  deps: { minutes: number; configured: ConfiguredRecipients },
): Promise<UncontactedSweep> {
  const cutoff = new Date(now.getTime() - deps.minutes * 60_000).toISOString();
  const result: UncontactedSweep = { overdue: 0, rung: 0, contacted: 0, held: 0, disqualified_by_answer: 0, no_contact_detail: 0 };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("recruiting_leads")
      .select("id, channel, phone_e164, email_lower")
      .eq("org_id", orgId)
      .eq("status", "new")
      .lte("received_at", cutoff)
      .order("received_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read the uncontacted leads: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; channel: string; phone_e164: string | null; email_lower: string | null }>;
    await sweepPage(admin, orgId, rows.filter((l) => !SKIPPED_CHANNELS.includes(l.channel)), deps.configured, result);
    if (rows.length < PAGE) return result;
  }
}

async function sweepPage(
  admin: SupabaseClient,
  orgId: string,
  leads: Array<{ id: string; phone_e164: string | null; email_lower: string | null }>,
  configured: ConfiguredRecipients,
  result: UncontactedSweep,
): Promise<void> {
  if (leads.length === 0) return;
  result.overdue += leads.length;
  const { data, error } = await admin
    .from("recruiting_contacts").select("lead_id").eq("org_id", orgId).in("lead_id", leads.map((l) => l.id));
  if (error) throw new Error(`Could not read the leads' contacts: ${error.message}`);
  const contacted = new Set(((data ?? []) as Array<{ lead_id: string }>).map((c) => c.lead_id));
  const held = await suppressedPhones(admin, orgId, leads.map((l) => l.phone_e164 ?? ""));
  const sent = await keysAlreadySent(admin, orgId, leads.map((l) => leadAlertKey("lead_uncontacted", l.id)));
  const verdicts = await readLeadVerdicts(admin, orgId, leads.map((l) => l.id));
  for (const lead of leads) {
    if (contacted.has(lead.id)) result.contacted += 1;
    else if (lead.phone_e164 !== null && held.has(lead.phone_e164)) result.held += 1;
    else if ((verdicts.get(lead.id)?.summary.hardUnmet ?? 0) > 0) result.disqualified_by_answer += 1;
    else if (!lead.phone_e164 && !lead.email_lower) result.no_contact_detail += 1;
    else if (!sent.has(leadAlertKey("lead_uncontacted", lead.id))) {
      await ringLead(admin, orgId, lead.id, {
        category: "lead_uncontacted", title: "Ad lead still waiting", severity: "warning",
        body: "A lead has had no first contact yet.",
      }, configured);
      result.rung += 1;
    }
  }
}

// ── the scheduler ────────────────────────────────────────────────────────────────────────────────
/** Five minutes: the lowest threshold the setting allows, so an alarm is never more than one tick late. */
export const LEAD_UNCONTACTED_MS = 5 * 60_000;
const FIRST_TICK_MS = 6 * 60_000;
const TICK_PAGE = 500;

export const leadUncontactedDedupKey = (orgId: string): string => `lead_uncontacted:${orgId}`;
export type UncontactedEnqueue = (orgId: string) => Promise<"queued" | "conflict">;

/** The scheduler's one tenant-wide read: every carrier holding a `new` lead, each handed to `enqueue` once. */
export async function leadUncontactedTick(admin: SupabaseClient, enqueue: UncontactedEnqueue): Promise<{ orgs: number; queued: number }> {
  const orgs = new Set<string>();
  for (let from = 0; ; from += TICK_PAGE) {
    const { data, error } = await admin
      .from("recruiting_leads").select("id, org_id").eq("status", "new").order("id").range(from, from + TICK_PAGE - 1);
    if (error) throw new Error(`recruiting_leads: ${error.message}`);
    const rows = (data ?? []) as Array<{ org_id: string }>;
    for (const r of rows) orgs.add(r.org_id);
    if (rows.length < TICK_PAGE) break;
  }
  let queued = 0;
  for (const org of orgs) if ((await enqueue(org)) === "queued") queued += 1;
  return { orgs: orgs.size, queued };
}

export function startLeadUncontacted(env: Env): void {
  if (!env.ADS_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      await leadUncontactedTick(admin, async (orgId) => {
        const r = await dispatchJob(admin, env, "lead_uncontacted", { orgId, dedupKey: leadUncontactedDedupKey(orgId) });
        return "conflict" in r ? "conflict" : "queued";
      });
    } catch (error) {
      console.error(`[lead-uncontacted] tick failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), FIRST_TICK_MS);
  setInterval(() => void run(), LEAD_UNCONTACTED_MS);
}
