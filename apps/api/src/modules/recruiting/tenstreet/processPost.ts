import type { SupabaseClient } from "@supabase/supabase-js";
import { leadFromTenstreet } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { open, secretAad } from "../../../lib/secretBox.js";
import { acceptLeadProjection } from "../leads/leadSink.js";
import type { ConfiguredRecipients } from "../leads/leadNotify.js";
import { phoneLookupFor } from "../leads/phoneLookup.js";
import { TENSTREET_SEAL_PURPOSE } from "./receive.js";
import { readTenstreetXml } from "./tenstreetXml.js";

/**
 * `tenstreet_post_process` (TENSTREET-INTAKE-PLAN TS3): one kept post becomes a lead, after the receiver answered
 * Tenstreet. The sealed body is the cleaned post (no SSN, no EEO — `receive.ts`), read again by the same parser,
 * projected (`leadFromTenstreet`) and taken through the sink's own road (`acceptLeadProjection`: store once, owner,
 * bell, phone line). The post row is then marked processed with its lead, once (0640's guard, TS002).
 *
 * A post that cannot become a lead (unreadable after unsealing — which a kept post never should be) is marked
 * processed with the reason, not retried: the same bytes fail the same way. A store or a database fault throws,
 * and the queue retries. A post already processed is done: the job is a no-op, so a repeat delivery of the job is
 * harmless.
 *
 * D-TS8: a later post of the same applicant is the same lead (`ingest_lead` dedupes on DriverId); its Tenstreet
 * status is in the post, shown, and never moves our lead's status. Refreshing contact details from a later post is
 * not built (D-TS8's "only when no recruiter edited them" needs an edit record the lead does not keep).
 */
export interface ProcessPostResult { outcome: "processed" | "already" | "unreadable" | "not_found"; lead_id?: string; stored?: "new" | "duplicate" }

export async function processTenstreetPost(
  deps: { admin: SupabaseClient; env: Env; configured: ConfiguredRecipients; now?: () => Date },
  orgId: string,
  postId: string,
): Promise<ProcessPostResult> {
  const { data, error } = await deps.admin.from("tenstreet_posts")
    .select("id, body_sealed, processed_at, reply_status").eq("org_id", orgId).eq("id", postId).maybeSingle();
  if (error) throw new Error(`tenstreet_posts: ${error.message}`);
  const row = data as { id: string; body_sealed: string | null; processed_at: string | null; reply_status: string } | null;
  if (!row || row.reply_status !== "ACCEPTED") return { outcome: "not_found" };
  if (row.processed_at !== null) return { outcome: "already" };
  const now = deps.now ?? (() => new Date());

  const mark = async (fields: { lead_id?: string; process_error?: string }) => {
    const { error: e } = await deps.admin.from("tenstreet_posts").update({ processed_at: now().toISOString(), ...fields })
      .eq("org_id", orgId).eq("id", postId).is("processed_at", null);
    if (e) throw new Error(`tenstreet_posts: ${e.message}`);
  };

  const xml = row.body_sealed === null ? null : readTenstreetXml(open(deps.env, row.body_sealed, secretAad(orgId, TENSTREET_SEAL_PURPOSE)));
  const lead = xml?.ok ? leadFromTenstreet(xml.root) : null;
  if (!lead || !lead.ok) {
    await mark({ process_error: xml && !xml.ok ? `unreadable: ${xml.reason}` : "unreadable: no lead in the post" });
    return { outcome: "unreadable" };
  }
  const r = await acceptLeadProjection(deps.admin, deps.configured, now, phoneLookupFor(deps.env), orgId, lead.lead);
  await mark({ lead_id: r.ref });
  return { outcome: "processed", lead_id: r.ref, stored: r.stored };
}
