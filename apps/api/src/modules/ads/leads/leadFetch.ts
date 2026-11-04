import type { LeadSink } from "@silvicom/shared";
import { pageGraphForConnection, type RegistryDeps } from "../platforms/registry.js";
import { platformLeadFromMeta, type MetaLead } from "./backfill.js";
import { alertWebhookLate, WEBHOOK_LATE_MS } from "../alerts/intakeAlerts.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FORM_ID_PATHS } from "./formRefs.js";

/**
 * One lead a leadgen webhook named, read by id and handed to the sink (B4b; the `ads_lead_fetch` job). The
 * webhook carries ids only, so this is where the answers are read: `GET /{leadgen_id}` with the PAGE's
 * token ("A Page or User access token requested by a person who can advertise on the ad account and on the
 * Page" — https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/, read 2026-11-03).
 *
 * The mapping is the backfill's `platformLeadFromMeta`, not a second one: a lead the webhook brings and the
 * same lead the hourly backfill brings must be the same `PlatformLead`, or the sink's "stored once" would
 * be comparing two shapes. `form_id` is asked for as well and must match the delivery's: a signed delivery
 * naming a lead on a form that is not the one it says is not stored.
 *
 * Everything here is org-scoped (the service role bypasses RLS); the org came from `leadgenWebhook.ts`.
 * It THROWS on anything that did not bring the lead in, so the job is failed, retried with backoff, and
 * listed — and the hourly backfill reads the same lead regardless.
 *
 * ── WEBHOOK-TO-LEDGER LATENCY (ADS-AGENT-PLAN "speed to lead"; workflow D2d) ───────────────────────
 * A new lead's `latency_ms` is from Meta's `created_time` to the sink's answer, and it rides on the job's
 * stats, so it is measured from the jobs ledger. It is taken here and nowhere else: this is the only place
 * that knows a lead came by webhook (a lead row does not say), and a backfilled lead is an hour late by design.
 * Meta's clock and ours are not the same clock, so a small negative reads as zero.
 */

const LEAD_FIELDS = "id,created_time,field_data,ad_id,campaign_id,form_id";

export interface LeadFetchDeps extends RegistryDeps {
  admin: SupabaseClient;
  sink: LeadSink;
  /** Required, not optional as in `RegistryDeps`: `MetaGraph` takes it as given, and an absent clock throws. */
  now: () => Date;
}

export type LeadFetchResult =
  | { outcome: "stored"; lead_id: string; campaign_id: string; latency_ms: number }
  | { outcome: "duplicate"; lead_id: string; campaign_id: string }
  /** No campaign of this org has the form (any more): acknowledged, nothing to store. */
  | { outcome: "not_ours"; lead_id: string; form_id: string };

export class LeadFetchError extends Error {
  constructor(readonly reason: string, leadId: string) {
    super(`ads_lead_fetch: lead ${leadId} not brought in — ${reason}`);
  }
}

export async function fetchWebhookLead(deps: LeadFetchDeps, orgId: string, ask: { leadgenId: string; formId: string }): Promise<LeadFetchResult> {
  // The form is one of the campaign's, in whichever language (`formRefs.ts`).
  let campaign: { id: string; connection_id: string | null; brief_source: string; brief_ref: string } | undefined;
  for (const { path } of FORM_ID_PATHS) {
    const { data: rows, error } = await deps.admin
      .from("ads_campaigns")
      .select("id, connection_id, brief_source, brief_ref")
      .eq("org_id", orgId)
      .eq(path, ask.formId)
      .order("id")
      .limit(1);
    if (error) throw new Error(`ads_campaigns: ${error.message}`);
    campaign = ((rows ?? []) as Array<NonNullable<typeof campaign>>)[0];
    if (campaign) break;
  }
  if (!campaign) return { outcome: "not_ours", lead_id: ask.leadgenId, form_id: ask.formId };
  if (!campaign.connection_id) throw new LeadFetchError("campaign has no connection", ask.leadgenId);

  const { data: conn, error: cErr } = await deps.admin
    .from("ads_platform_connections")
    .select("id, org_id, provider, is_sandbox, token_sealed, page_token_sealed, status")
    .eq("org_id", orgId)
    .eq("id", campaign.connection_id)
    .maybeSingle();
  if (cErr) throw new Error(`ads_platform_connections: ${cErr.message}`);
  const c = conn as { id: string; org_id: string; provider: string; is_sandbox: boolean; token_sealed: string | null; page_token_sealed: string | null; status: string } | null;
  // `failing` is still read: a flagged check (a scope, the spending limit) does not stop the Page token
  // reading a lead. Only a connection with no tokens left cannot.
  if (!c || c.status === "disconnected") throw new LeadFetchError(`connection:${c ? "disconnected" : "missing"}`, ask.leadgenId);
  if (c.provider !== "meta" && c.provider !== "simulator") throw new LeadFetchError(`connection:${c.provider}`, ask.leadgenId);

  const opened = await pageGraphForConnection(deps, c);
  if (!opened.ok) throw new LeadFetchError(`graph:${opened.error_code}`, ask.leadgenId);
  const r = await opened.graph.get<MetaLead & { form_id?: string }>(ask.leadgenId, { fields: LEAD_FIELDS });
  if (!r.ok) throw new LeadFetchError(`graph:${r.error.error_code}`, ask.leadgenId);
  if (r.data.id !== ask.leadgenId || r.data.form_id !== ask.formId) throw new LeadFetchError("form_mismatch", ask.leadgenId);

  const lead = platformLeadFromMeta(r.data, campaign, c.provider === "simulator" ? "simulator" : "meta");
  if (!lead) throw new LeadFetchError("shape", ask.leadgenId);
  let stored: "new" | "duplicate";
  try {
    stored = (await deps.sink.accept(orgId, lead)).stored;
  } catch {
    // The sink's message may carry the person's details; the failure names the lead by id only.
    throw new LeadFetchError("sink", ask.leadgenId);
  }
  if (stored !== "new") return { outcome: "duplicate", lead_id: ask.leadgenId, campaign_id: campaign.id };
  const now = deps.now();
  const latencyMs = Math.max(0, now.getTime() - Date.parse(lead.created_at));
  if (latencyMs > WEBHOOK_LATE_MS) await alertWebhookLate(deps.admin, orgId, c.id, latencyMs, now);
  return { outcome: "stored", lead_id: ask.leadgenId, campaign_id: campaign.id, latency_ms: latencyMs };
}
