import type { SupabaseClient } from "@supabase/supabase-js";
import { tenstreetDrawerView, type TenstreetLeadPost } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { open, secretAad } from "../../../lib/secretBox.js";
import { TENSTREET_SEAL_PURPOSE } from "./receive.js";
import { readTenstreetXml } from "./tenstreetXml.js";

/**
 * "From Tenstreet" in the lead drawer (TENSTREET-INTAKE-PLAN TS5): the newest post that became this lead, unsealed,
 * read by the receiver's own parser and cut to the drawer's view (`tenstreetDrawerView`). The newest, because
 * Tenstreet re-sends the whole application as it changes and every later post lands on the same lead (D-TS8).
 *
 * A purged lead answers nothing: the person asked for their details to go, and `leadPurge.ts` has emptied the posts
 * too (`purgeTenstreetPosts`). A post whose body was purged, or that was never processed, is never the source.
 */
export type LeadPostAnswer = { ok: true; post: TenstreetLeadPost | null } | { ok: false; status: number; code: string; message: string };

export async function readLeadTenstreetPost(admin: SupabaseClient, env: Env, orgId: string, leadId: string): Promise<LeadPostAnswer> {
  const { data: leadRow, error: le } = await admin
    .from("recruiting_leads").select("id, channel, purged_at").eq("org_id", orgId).eq("id", leadId).maybeSingle();
  if (le) throw new Error(`recruiting_leads: ${le.message}`);
  const lead = leadRow as { id: string; channel: string; purged_at: string | null } | null;
  if (!lead) return { ok: false, status: 404, code: "not_found", message: "Lead not found" };
  if (lead.purged_at !== null) return { ok: true, post: null };

  const { data, error } = await admin
    .from("tenstreet_posts")
    .select("id, received_at, body_sealed")
    .eq("org_id", orgId)
    .eq("lead_id", leadId)
    .eq("reply_status", "ACCEPTED")
    .not("processed_at", "is", null)
    .not("body_sealed", "is", null)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`tenstreet_posts: ${error.message}`);
  const row = data as { id: string; received_at: string; body_sealed: string } | null;
  if (!row) return { ok: true, post: null };

  let body: string;
  try {
    body = open(env, row.body_sealed, secretAad(orgId, TENSTREET_SEAL_PURPOSE));
  } catch {
    return { ok: false, status: 503, code: "tenstreet_unreadable", message: "Tenstreet's application could not be opened on this server." };
  }
  const xml = readTenstreetXml(body);
  if (!xml.ok) return { ok: false, status: 502, code: "tenstreet_unreadable", message: "Tenstreet's application could not be read." };
  return { ok: true, post: { receivedAt: row.received_at, view: tenstreetDrawerView(xml.root) } };
}

/**
 * Empty every kept Tenstreet post of a lead whose details are being deleted (0640's purge: `body_sealed` null,
 * `purged_at` set — the one change its guard allows to the body). Returns how many were emptied, for the audit row.
 */
export async function purgeTenstreetPosts(admin: SupabaseClient, orgId: string, leadId: string, now: Date): Promise<number> {
  const { data, error } = await admin
    .from("tenstreet_posts")
    .update({ body_sealed: null, purged_at: now.toISOString() })
    .eq("org_id", orgId)
    .eq("lead_id", leadId)
    .not("body_sealed", "is", null)
    .select("id");
  if (error) throw new Error(`Could not empty the lead's Tenstreet posts: ${error.message}`);
  return (data ?? []).length;
}
