import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leadFromTenstreet, tenstreetEnvelope, tenstreetReply } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { isSecretBoxConfigured, seal, secretAad } from "../../../lib/secretBox.js";
import { readTenstreetXml } from "./tenstreetXml.js";

/**
 * Tenstreet's application post, the receiving half (TENSTREET-INTAKE-PLAN TS3, D-TS3, D-TS7; ADS-PLATFORM-V2-PLAN
 * Q-APX29/Q-APX30 (a), ruled 2026-11-20). The route (`routes/tenstreetWebhook.ts`) is a thin wrapper over this.
 *
 * ── THE ORDER (D-TS3: answer ACCEPTED once the post is durably kept; the work is the queue's) ────────
 *   1. The URL's secret, hashed, finds the connection — the ONE lookup not scoped to an org, since the secret is
 *      what names the carrier (as Meta's form ids do for `ownersOfForms`). Unknown, or the connection off → 401,
 *      nothing written: a stranger's body is not ours to keep.
 *   2. The body is read (`readTenstreetXml`: size, DOCTYPE, well-formed, root) and the SSN and the EEO answers are
 *      removed from it (D-TS4, D-TS5) — before step 5 keeps anything.
 *   3. `CompanyId` must be the connection's → else 401, nothing written: a leaked URL alone cannot post as another
 *      carrier (D-TS7's second check).
 *   4. What can never succeed is REJECTED with a fixed reason, logged without its body: not Tenstreet's XML, the
 *      other mode (a TEST post to a PROD connection, or the reverse), no usable DriverId.
 *   5. The cleaned post is sealed (secretBox, AAD org + `tenstreet.post`) and inserted; the job is queued
 *      (`tenstreet_post_process`, dedup = the post's id); THEN ACCEPTED. A failure before the insert is 503, so
 *      Tenstreet's own repeat ("repeated until … transferred successfully") brings it again.
 * A repeat of the same post is a new log row (the guide asks for every post and reply kept) and the same lead:
 * `ingest_lead` stores (org, `tenstreet`, DriverId) once.
 *
 * ── WHAT IS NOT DONE HERE, AND WHY ──────────────────────────────────────────────────────────────────
 * HTTP Basic auth and an IP allow-list wait on Tenstreet's answer (Q-TS1, the email in the plan's §2); the URL
 * secret plus the Company ID check is the evidence's default (§1a R3). The secret never reaches a log: the metrics
 * line collapses any path segment of 24+ characters to `:id` (`normalizeRoutePath`), and this file logs reasons only.
 */

export const TENSTREET_WEBHOOK_PATH = "/api/webhooks/tenstreet";
export const TENSTREET_SEAL_PURPOSE = "tenstreet.post";
export const tenstreetProcessDedupKey = (postId: string): string => `tenstreet_post_process:${postId}`;
export const hashTenstreetKey = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");

export interface TenstreetAnswer {
  status: number;
  /** XML for Tenstreet, or empty for a bare 401/503. */
  body: string;
  /** Set when a post was kept and queued: the route kicks the drain after answering. */
  queued?: string;
}

export interface ReceiveTenstreetDeps {
  env: Env;
  admin: SupabaseClient;
  enqueue: (orgId: string, postId: string) => Promise<"queued" | "conflict">;
  now?: () => Date;
}

interface Connection { id: string; org_id: string; company_id: string; mode: "test" | "prod"; enabled: boolean }

const bare = (status: number): TenstreetAnswer => ({ status, body: "" });

/** Said at boot: a receiver that cannot seal answers 503 to every post, and that is silence unless said. */
export function tenstreetBootWarning(env: Env): string | null {
  return isSecretBoxConfigured(env) ? null : `[tenstreet] SECRETS_ENCRYPTION_KEY not set — ${TENSTREET_WEBHOOK_PATH} answers 503 to every post (fail-closed).`;
}

export async function receiveTenstreetPost(deps: ReceiveTenstreetDeps, key: string, body: string | undefined): Promise<TenstreetAnswer> {
  const log = (reason: string) => console.warn(`[tenstreet] post ${reason}`);
  if (!isSecretBoxConfigured(deps.env)) return bare(503);
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
    log("refused: key_shape");
    return bare(401);
  }
  const { data, error } = await deps.admin.from("tenstreet_connections")
    .select("id, org_id, company_id, mode, enabled").eq("key_hash", hashTenstreetKey(key)).maybeSingle();
  if (error) return bare(503);
  const conn = data as Connection | null;
  if (!conn || !conn.enabled) {
    log(conn ? "refused: connection_off" : "refused: unknown_key");
    return bare(401);
  }

  const text = typeof body === "string" ? body : "";
  const sha = createHash("sha256").update(text, "utf8").digest("hex");
  const bytes = Buffer.byteLength(text, "utf8");
  const xml = readTenstreetXml(text);
  // The Company ID is read from what parsed; a body that did not parse has none, and is refused as not XML below.
  if (xml.ok && tenstreetEnvelope(xml.root).company_id !== conn.company_id) {
    log("refused: company_id");
    return bare(401);
  }

  const row = { org_id: conn.org_id, connection_id: conn.id, body_sha256: sha, bytes };
  const refuse = async (reason: string, driver: string | null, mode: string | null): Promise<TenstreetAnswer> => {
    log(`rejected: ${reason}`);
    const { error: e } = await deps.admin.from("tenstreet_posts").insert({ ...row, driver_ref: driver, mode, reply_status: "REJECTED", reply_reason: reason });
    if (e) return bare(503);
    return { status: 200, body: tenstreetReply("Rejected", REJECT_TEXT[reason] ?? "Rejected", driver) };
  };

  if (!xml.ok) return refuse(xml.reason, null, null);
  const env = tenstreetEnvelope(xml.root);
  const wanted = conn.mode === "prod" ? "PROD" : "TEST";
  if (env.mode !== wanted) return refuse("wrong_mode", env.driver_id, env.mode);
  const lead = leadFromTenstreet(xml.root);
  if (!lead.ok) return refuse("no_driver_id", null, env.mode);

  let sealed: string;
  try {
    sealed = seal(deps.env, xml.cleaned, secretAad(conn.org_id, TENSTREET_SEAL_PURPOSE));
  } catch {
    return bare(503);
  }
  const { data: ins, error: insErr } = await deps.admin.from("tenstreet_posts").insert({
    ...row, driver_ref: env.driver_id, mode: env.mode, body_sealed: sealed, removed: xml.removed, reply_status: "ACCEPTED", reply_reason: "accepted",
  }).select("id").single();
  if (insErr || !ins) return bare(503);
  const postId = (ins as { id: string }).id;
  await deps.admin.from("tenstreet_connections").update({ last_post_at: (deps.now ?? (() => new Date()))().toISOString(), last_error: null }).eq("org_id", conn.org_id).eq("id", conn.id);
  // A post kept but not queued would wait for nothing: answer 503 so Tenstreet repeats it. The repeat is a new log
  // row and the same lead (`ingest_lead` dedupes), and this row stays unprocessed in the log, saying so.
  try {
    await deps.enqueue(conn.org_id, postId);
  } catch {
    log("kept but not queued: answered 503 for a repeat");
    return bare(503);
  }
  return { status: 200, body: tenstreetReply("Accepted", "Success", env.driver_id), queued: postId };
}

/** The fixed sentences a REJECTED reply carries: never text from the post. */
export const REJECT_TEXT: Record<string, string> = {
  too_large: "The post is over 2 MB.",
  doctype: "The post carries a DOCTYPE, which this listener does not accept.",
  not_xml: "The post is not well-formed XML.",
  not_tenstreet: "The post is not TenstreetData.",
  wrong_mode: "This listener takes the other Mode (TEST or PROD).",
  no_driver_id: "The post has no DriverId.",
};
