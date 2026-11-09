import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadCloseReason, LeadClosureRecord, LeadStatus } from "@silvicom/shared";

/**
 * A recruiter's verdict on a lead — close with a reason, qualify, reopen (ADS-LEAD-INTAKE-PLAN LQ5b; the
 * database half is 0578). The three functions decide and write; this file calls them in the session's name,
 * turns their refusals into words the drawer can show, and reads the acts back.
 *
 * ── WHY THE RULES ARE IN THE DATABASE AND NOT HERE ───────────────────────────────────────────────
 * "`unreachable` needs three attempts" is a fact about rows in `recruiting_contacts`; checked here it would
 * be a read, a decision and a write that a second request could slip between. The functions lock the lead
 * and check the ledger in the same transaction, so the evidence a reason needs is the evidence on record
 * at the moment the status moves. What this file adds is the refusal in words (0578's RL register, one
 * HTTP status each) and the audit row — by lead id and reason, never the note, which may name the person.
 *
 * ── THE NOTE ON A PURGED LEAD ────────────────────────────────────────────────────────────────────
 * `purge_lead` empties every closure note (0578), so unlike a contact's note (`leadContacts.ts`, withheld
 * pending counsel) there is nothing left to withhold; `note_withheld` is still answered, so the drawer can
 * say "note removed" rather than show an act that seems to have had none.
 */

export type LeadActOutcome =
  | { kind: "done"; closure_id: string | null; status: LeadStatus; already: boolean; verdict_written: boolean }
  | { kind: "refused"; status: number; code: string; message: string };

/** 0578's SQLSTATE register → an HTTP status and a code; the message is the function's own sentence. */
const REFUSALS: Record<string, { status: number; code: string }> = {
  RL050: { status: 400, code: "invalid_request" },
  RL051: { status: 404, code: "not_found" },
  RL052: { status: 409, code: "lead_purged" },
  RL053: { status: 409, code: "lead_converted" },
  RL054: { status: 400, code: "unknown_reason" },
  RL055: { status: 409, code: "needs_contact" },
  RL056: { status: 409, code: "needs_attempts" },
  RL057: { status: 409, code: "needs_duplicate" },
  RL058: { status: 409, code: "lead_closed" },
  RL059: { status: 409, code: "not_closed" },
};

/** The function's own words, without its `close_lead: ` prefix. */
const words = (message: string): string => message.replace(/^[a-z_]+_lead: /, "");

function refusal(error: { code?: string; message?: string }): LeadActOutcome | null {
  const known = error.code ? REFUSALS[error.code] : undefined;
  if (!known) return null;
  const msg = error.message ? words(error.message) : "";
  return { kind: "refused", ...known, message: known.code === "not_found" ? "Lead not found" : msg || "Refused" };
}

type Answer = {
  closure_id?: string; status: LeadStatus; already?: boolean; verdict_written?: boolean;
  closed?: boolean; qualified?: boolean; reopened?: boolean;
};

async function act(admin: SupabaseClient, fn: "close_lead" | "qualify_lead" | "reopen_lead", args: Record<string, unknown>): Promise<LeadActOutcome> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    const r = refusal(error);
    if (r) return r;
    throw new Error(`${fn} failed: ${error.message}`);
  }
  const a = data as Answer | null;
  if (!a) throw new Error(`${fn} gave no answer`);
  return { kind: "done", closure_id: a.closure_id ?? null, status: a.status, already: a.already === true, verdict_written: a.verdict_written === true };
}

export interface Actor { userId: string; name: string }

export function closeLead(admin: SupabaseClient, orgId: string, actor: Actor, leadId: string, reason: LeadCloseReason, note: string | null): Promise<LeadActOutcome> {
  return act(admin, "close_lead", { p_org: orgId, p_lead: leadId, p_reason: reason, p_note: note, p_actor: actor.userId, p_actor_name: actor.name });
}
export function qualifyLead(admin: SupabaseClient, orgId: string, actor: Actor, leadId: string, note: string | null): Promise<LeadActOutcome> {
  return act(admin, "qualify_lead", { p_org: orgId, p_lead: leadId, p_note: note, p_actor: actor.userId, p_actor_name: actor.name });
}
export function reopenLead(admin: SupabaseClient, orgId: string, actor: Actor, leadId: string, note: string | null): Promise<LeadActOutcome> {
  return act(admin, "reopen_lead", { p_org: orgId, p_lead: leadId, p_note: note, p_actor: actor.userId, p_actor_name: actor.name });
}

const LEAD_CLOSURES_MAX = 100;

export type LeadClosuresRead =
  | { kind: "ok"; closures: LeadClosureRecord[] }
  | { kind: "refused"; status: number; code: string; message: string };

/** Every act on one lead, newest first (`seq`, never the clock — 0578 says why). */
export async function readLeadClosures(admin: SupabaseClient, orgId: string, leadId: string): Promise<LeadClosuresRead> {
  const { data, error } = await admin
    .from("recruiting_leads").select("id, purged_at").eq("org_id", orgId).eq("id", leadId).maybeSingle();
  if (error) throw new Error(`Could not read the lead: ${error.message}`);
  const lead = data as { id: string; purged_at: string | null } | null;
  if (!lead) return { kind: "refused", status: 404, code: "not_found", message: "Lead not found" };
  const { data: rows, error: ce } = await admin
    .from("recruiting_lead_closures")
    .select("id, kind, reason, status_after, note, actor_name, recorded_at")
    .eq("org_id", orgId).eq("lead_id", leadId)
    .order("seq", { ascending: false })
    .limit(LEAD_CLOSURES_MAX);
  if (ce) throw new Error(`Could not read the lead's closures: ${ce.message}`);
  const closures = ((rows ?? []) as Array<Omit<LeadClosureRecord, "note_withheld">>).map((row) => ({
    ...row,
    // On a purged lead every note was emptied; whether an act ever had one is no longer known, so every act says so.
    note_withheld: lead.purged_at !== null,
  }));
  return { kind: "ok", closures };
}
