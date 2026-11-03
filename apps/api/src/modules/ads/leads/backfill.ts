import type { SupabaseClient } from "@supabase/supabase-js";
import { platformLeadSchema, type LeadSink, type PlatformLead } from "@silvicom/shared";
import type { MetaGraph } from "../platforms/meta/graphClient.js";
import { pageGraphForConnection, type RegistryDeps } from "../platforms/registry.js";

/**
 * The hourly leads backfill (ADS-AGENT-BUILD-WORKFLOW.md B4a; §4R Lead intake: "webhook lost — the backfill
 * must bring it"). For one connection: every campaign of ours with a Meta form, its leads since a time, read
 * with the Page's token, each handed to the `LeadSink` (D-AD17 — recruiting's; this module never names it).
 *
 * ── WHY IT EXISTS BEFORE THE WEBHOOK ─────────────────────────────────────────────────────────────
 * The webhook (B4b) needs the Meta app secret to check signatures, which is owner track (Stage 2). This
 * needs only the Page token Connect already holds, so it is the path that works first — and once the
 * webhook exists it stays as the net under it.
 *
 * ── A WINDOW, REACHING BACK TO THE LAST RUN THAT BROUGHT EVERYTHING IN ──────────────────────────
 * Every run reads at least the last `BACKFILL_WINDOW_HOURS` (48), and the sink stores a lead once by
 * (provider, lead id) (`ingest_lead`, 0554), so a lead read again is free. The window alone was not enough
 * (2026-11-03 audit of the lead path, H1): a Page token that died on Friday and was fixed on Monday left
 * Friday's leads outside every later window, for good, and nothing said so. So the job handler reaches
 * further back when it must — to the last run of this connection that finished with nothing missing,
 * less an hour (`catchUpSince`). That fact is the jobs ledger's own (`status = 'done'`, kept 90 days —
 * as long as Meta keeps leads), not a "read up to" column we write: a failed, crashed or released run is
 * never `done`, so the next one reaches back past it by construction. With no such run on record (a new
 * connection, or 90 days of failures) it reads everything Meta still keeps. `since` is held to 90 days.
 *
 * ── WHAT IS NEVER SILENT ─────────────────────────────────────────────────────────────────────────
 * A form that cannot be read, a form with more leads in the window than `PAGES_MAX` pages, and a lead the
 * sink refused are each reported in the result; the job handler (B4a2) fails the job on any of them, so it
 * is listed and the next hour tries again. A lead is never skipped quietly: §4R's bar is "0 lost".
 */

export const BACKFILL_WINDOW_HOURS = 48;
export const META_LEAD_RETENTION_DAYS = 90;
const PAGE_SIZE = 100;
/** 50 pages × 100 = 5,000 leads in one form's window — far past any carrier's volume; past it is reported. */
export const PAGES_MAX = 50;
const LEAD_FIELDS = "id,created_time,field_data,ad_id,campaign_id";
/** `platformLeadSchema` holds an answer to 2,000 characters; the raw payload keeps the whole value. */
const ANSWER_MAX = 2000;

export interface MetaLead {
  id: string;
  created_time: string;
  field_data?: Array<{ name: string; values?: string[] }>;
  ad_id?: string;
  campaign_id?: string;
}

export interface BackfillCampaign {
  id: string;
  brief_source: string;
  brief_ref: string;
  form_id: string;
}

export interface BackfillFailure {
  /** Absent on a failure of the whole connection (`connection:<status>`). */
  campaign_id?: string;
  form_id?: string;
  /** `graph:<error_code>`, `truncated`, `sink`, `shape`, `connection:<status>` — what the job's failure line names. */
  reason: string;
  lead_id?: string;
}

export interface BackfillResult {
  connection_id: string;
  since: string;
  forms: number;
  read: number;
  stored_new: number;
  duplicates: number;
  failures: BackfillFailure[];
}

/** Margin before the last complete run's start: Meta's own delay in listing a lead, and clock skew. */
export const CATCH_UP_MARGIN_HOURS = 1;

/**
 * How far back a run reads (header): the 48-hour window, or further, back to an hour before the last run
 * that brought everything in; everything Meta keeps when there was none. Pure.
 */
export function catchUpSince(now: Date, lastCompleteStartedAt: Date | null): Date {
  const floor = new Date(now.getTime() - META_LEAD_RETENTION_DAYS * 86_400_000);
  if (!lastCompleteStartedAt) return floor;
  const window = now.getTime() - BACKFILL_WINDOW_HOURS * 3_600_000;
  const resume = lastCompleteStartedAt.getTime() - CATCH_UP_MARGIN_HOURS * 3_600_000;
  return new Date(Math.max(floor.getTime(), Math.min(window, resume)));
}

/** Meta's `+0000` offset as ISO's `+00:00`, which the lead contract reads. */
export const isoFromMeta = (t: string): string => t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

/** One Meta lead as the platform-neutral lead the sink takes. Pure. */
export function platformLeadFromMeta(
  lead: MetaLead,
  campaign: Pick<BackfillCampaign, "id" | "brief_source" | "brief_ref">,
  provider: "meta" | "simulator",
): PlatformLead | null {
  const answers: Record<string, string> = {};
  for (const f of lead.field_data ?? []) {
    if (typeof f?.name !== "string" || !f.name) continue;
    answers[f.name] = (f.values ?? []).join(", ").slice(0, ANSWER_MAX);
  }
  const parsed = platformLeadSchema.safeParse({
    provider,
    platform_lead_ref: lead.id,
    campaign_id: campaign.id,
    brief_source: campaign.brief_source,
    brief_ref: campaign.brief_ref,
    created_at: isoFromMeta(lead.created_time ?? ""),
    answers,
    raw: lead,
  });
  return parsed.success ? parsed.data : null;
}

type Listing = { data?: MetaLead[]; paging?: { cursors?: { after?: string }; next?: string } };

/** Every lead on one form since `since`, page by page; `truncated` when the window holds more than PAGES_MAX pages. */
export async function readFormLeads(
  graph: MetaGraph,
  formId: string,
  since: Date,
): Promise<{ ok: true; leads: MetaLead[]; truncated: boolean } | { ok: false; error_code: string }> {
  const leads: MetaLead[] = [];
  const filtering = [{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(since.getTime() / 1000) }];
  let after: string | undefined;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const r = await graph.get<Listing>(`${formId}/leads`, { fields: LEAD_FIELDS, filtering, limit: PAGE_SIZE, after });
    if (!r.ok) return { ok: false, error_code: r.error.error_code };
    leads.push(...(r.data.data ?? []));
    after = r.data.paging?.cursors?.after;
    if (!r.data.paging?.next || !after) return { ok: true, leads, truncated: false };
  }
  return { ok: true, leads, truncated: true };
}

export interface BackfillDeps extends RegistryDeps {
  admin: SupabaseClient;
  sink: LeadSink;
  now: () => Date;
}

/** The campaigns of this connection that have a Meta form, org-scoped (the service role bypasses RLS). */
async function campaignsWithForms(admin: SupabaseClient, orgId: string, connectionId: string): Promise<BackfillCampaign[]> {
  const out: BackfillCampaign[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("ads_campaigns")
      .select("id, brief_source, brief_ref, platform_refs")
      .eq("org_id", orgId)
      .eq("connection_id", connectionId)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`ads_campaigns: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; brief_source: string; brief_ref: string; platform_refs: Record<string, unknown> | null }>;
    for (const r of rows) {
      const form = r.platform_refs?.meta_form_id;
      if (typeof form === "string" && form) out.push({ id: r.id, brief_source: r.brief_source, brief_ref: r.brief_ref, form_id: form });
    }
    if (rows.length < 1000) return out;
  }
}

export async function backfillConnectionLeads(
  deps: BackfillDeps,
  orgId: string,
  connectionId: string,
  opts: { since?: Date } = {},
): Promise<BackfillResult> {
  const now = deps.now();
  const floor = new Date(now.getTime() - META_LEAD_RETENTION_DAYS * 86_400_000);
  const asked = opts.since ?? new Date(now.getTime() - BACKFILL_WINDOW_HOURS * 3_600_000);
  const since = asked < floor ? floor : asked;
  const result: BackfillResult = { connection_id: connectionId, since: since.toISOString(), forms: 0, read: 0, stored_new: 0, duplicates: 0, failures: [] };

  const { data: conn, error } = await deps.admin
    .from("ads_platform_connections")
    .select("id, org_id, provider, is_sandbox, token_sealed, page_token_sealed, status")
    .eq("org_id", orgId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const c = conn as { id: string; org_id: string; provider: string; is_sandbox: boolean; token_sealed: string | null; page_token_sealed: string | null; status: string } | null;
  if (!c || (c.provider !== "meta" && c.provider !== "simulator")) return result;

  const campaigns = await campaignsWithForms(deps.admin, orgId, connectionId);
  if (campaigns.length === 0) return result;
  // A `failing` connection is still read (audit H1): a scope or limit its test flagged does not stop a
  // Page token reading leads, and a token that really is dead fails below, per form, loudly. Only a
  // person's disconnect (tokens cleared) cannot be read — and with forms still on it, that is said too.
  if (c.status === "disconnected") {
    result.failures.push({ reason: "connection:disconnected" });
    return result;
  }
  const opened = await pageGraphForConnection(deps, c);
  if (!opened.ok) {
    for (const k of campaigns) result.failures.push({ campaign_id: k.id, form_id: k.form_id, reason: `graph:${opened.error_code}` });
    return result;
  }

  const provider = c.provider === "simulator" ? "simulator" : "meta";
  for (const k of campaigns) {
    result.forms += 1;
    const read = await readFormLeads(opened.graph, k.form_id, since);
    if (!read.ok) {
      result.failures.push({ campaign_id: k.id, form_id: k.form_id, reason: `graph:${read.error_code}` });
      continue;
    }
    if (read.truncated) result.failures.push({ campaign_id: k.id, form_id: k.form_id, reason: "truncated" });
    for (const lead of read.leads) {
      result.read += 1;
      const platformLead = platformLeadFromMeta(lead, k, provider);
      if (!platformLead) {
        result.failures.push({ campaign_id: k.id, form_id: k.form_id, reason: "shape", lead_id: String(lead?.id ?? "") });
        continue;
      }
      try {
        const r = await deps.sink.accept(orgId, platformLead);
        if (r.stored === "new") result.stored_new += 1;
        else result.duplicates += 1;
      } catch {
        // The sink's message may carry the person's details (a CHECK violation names the value); the
        // failure line says which lead, and the sink's own error is logged by the sink's owner.
        result.failures.push({ campaign_id: k.id, form_id: k.form_id, reason: "sink", lead_id: lead.id });
      }
    }
  }
  return result;
}
