import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_STATUSES, OPEN_LEAD_STATUSES, type LeadMatchSummary, type LeadMatchVerdict, type LeadStatus } from "@silvicom/shared";
import { createDriverRecord } from "../../roster/index.js";
import { readLeadVerdicts } from "./verdicts.js";

/**
 * The recruiter's lead queue and the conversion of a lead to an applicant (D1; 0554's functions).
 *
 * The queue is `recruiting_lead_queue`: one person per row, newest first, keyset-paged — an offset would
 * skip or repeat rows as leads arrive. Each row carries its newest verdicts and their summary; ordering BY
 * match is the queue screen's step (E-phase), because a sort by match cannot share a keyset with freshness.
 */

export interface LeadQueueRow {
  id: string;
  channel: string;
  source: string | null;
  campaign_ref: string | null;
  opening_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
  email_lower: string | null;
  status: LeadStatus;
  assigned_to: string | null;
  received_at: string;
  answers: Record<string, string>;
  also: Array<{ id: string; channel: string; campaign_ref: string | null; received_at: string }>;
  drivers: Array<{ id: string; status: string; archived: boolean }>;
  verdicts: LeadMatchVerdict[];
  summary: LeadMatchSummary | null;
}

export interface LeadQueuePage {
  leads: LeadQueueRow[];
  /** The cursor for the next page, or null when this page was the last. */
  next: { before_at: string; before_id: string } | null;
}

export const LEAD_QUEUE_MAX = 100;

export function parseQueueQuery(q: Record<string, unknown>):
  { statuses: LeadStatus[]; beforeAt: string | null; beforeId: string | null; limit: number } | { error: string } {
  const raw = typeof q.status === "string" && q.status.trim() ? q.status.split(",").map((s) => s.trim()) : [...OPEN_LEAD_STATUSES];
  const statuses = raw.filter((s): s is LeadStatus => (LEAD_STATUSES as readonly string[]).includes(s));
  if (statuses.length !== raw.length) return { error: "Unknown lead status." };
  const beforeAt = typeof q.before_at === "string" && q.before_at ? q.before_at : null;
  const beforeId = typeof q.before_id === "string" && q.before_id ? q.before_id : null;
  if ((beforeAt === null) !== (beforeId === null) || (beforeAt !== null && Number.isNaN(Date.parse(beforeAt)))) {
    return { error: "A page cursor needs both before_at and before_id." };
  }
  const n = Number(q.limit ?? 50);
  const limit = Number.isInteger(n) && n >= 1 ? Math.min(n, LEAD_QUEUE_MAX) : 50;
  return { statuses, beforeAt, beforeId, limit };
}

export async function readLeadQueue(
  admin: SupabaseClient,
  orgId: string,
  q: { statuses: LeadStatus[]; beforeAt: string | null; beforeId: string | null; limit: number },
): Promise<LeadQueuePage> {
  const { data, error } = await admin.rpc("recruiting_lead_queue", {
    p_org: orgId, p_statuses: q.statuses, p_before_at: q.beforeAt, p_before_id: q.beforeId, p_limit: q.limit,
  });
  if (error) throw new Error(`Could not read the lead queue: ${error.message}`);
  const rows = (data ?? []) as Array<Omit<LeadQueueRow, "verdicts" | "summary">>;
  const verdicts = await readLeadVerdicts(admin, orgId, rows.map((r) => r.id));
  const leads = rows.map((r) => ({ ...r, verdicts: verdicts.get(r.id)?.verdicts ?? [], summary: verdicts.get(r.id)?.summary ?? null }));
  const last = leads[leads.length - 1];
  return { leads, next: leads.length === q.limit && last ? { before_at: last.received_at, before_id: last.id } : null };
}

// ── a lead becomes an applicant ──────────────────────────────────────────────────────────────────
export interface ConvertError { status: number; code: string; message: string }
export const isConvertError = (v: unknown): v is ConvertError => typeof v === "object" && v !== null && "code" in v && "status" in v;

/**
 * Turn a lead into an applicant. With `driverId`, the lead is attached to an applicant already on the board
 * (the queue lists them as a match); without it, roster creates a new applicant from the lead's name, phone
 * and email (`createDriverRecord`, roster's one door) and the lead is attached to that.
 *
 * If the attach fails after roster's create, the applicant exists without the conversion. The next queue read
 * lists them as a match for this lead (same phone or email), and the recruiter attaches instead of creating a
 * second applicant — 0554's header has the reasoning.
 */
export async function convertLead(
  admin: SupabaseClient,
  orgId: string,
  actor: { userId: string; name: string },
  leadId: string,
  driverId: string | null,
): Promise<{ conversion_id: string; driver_id: string; created_applicant: boolean } | ConvertError> {
  const { data: lead, error } = await admin
    .from("recruiting_leads")
    .select("id, full_name, phone_e164, email_lower, status")
    .eq("org_id", orgId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the lead: ${error.message}`);
  const row = lead as { id: string; full_name: string | null; phone_e164: string | null; email_lower: string | null; status: string } | null;
  if (!row) return { status: 404, code: "not_found", message: "Lead not found" };

  let target = driverId;
  let created = false;
  if (!target) {
    if (row.status === "converted") {
      return { status: 409, code: "already_converted", message: "This lead is already an applicant." };
    }
    if (!row.full_name) return { status: 422, code: "name_required", message: "Add the person's name before making them an applicant." };
    const made = await createDriverRecord(admin, orgId, actor.userId, {
      full_name: row.full_name, phone: row.phone_e164, email: row.email_lower, status: "applicant",
    });
    if ("error" in made) throw new Error("Could not create the applicant");
    target = made.driver.id;
    created = true;
  }

  const { data: conv, error: ce } = await admin.rpc("convert_lead", {
    p_org: orgId, p_lead: leadId, p_driver: target, p_actor: actor.userId, p_actor_name: actor.name,
  });
  if (ce) {
    const code = (ce as { code?: string }).code;
    if (code === "RL020") return { status: 404, code: "not_found", message: "Lead not found" };
    if (code === "RL021") return { status: 409, code: "not_an_open_applicant", message: "That person is not an open applicant of this carrier." };
    if (code === "RL022") return { status: 409, code: "already_converted", message: "This lead is already another applicant." };
    throw new Error(`convert_lead failed: ${ce.message}`);
  }
  return { conversion_id: (conv as { conversion_id: string }).conversion_id, driver_id: target, created_applicant: created };
}
