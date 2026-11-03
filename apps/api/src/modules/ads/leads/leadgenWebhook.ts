import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { safeEqual } from "../../../lib/secretBox.js";

/**
 * Meta's leadgen webhook, the receiving half (ADS-AGENT-BUILD-WORKFLOW.md B4b; §4R Lead intake). The route
 * (`routes/metaWebhook.ts`) is a thin Express wrapper over the two functions here.
 *
 * ── WHAT META SENDS (read 2026-11-03) ──────────────────────────────────────────────────────────────
 *   GET  ?hub.mode=subscribe&hub.verify_token=<ours>&hub.challenge=<int>   answer the challenge as sent.
 *   POST `X-Hub-Signature-256: sha256=<hex>` — "a SHA256 signature using the payload and your app's App
 *        Secret"; answer `200 OK`. Retries: "immediately, then … a few more times with decreasing frequency
 *        over the next 36 hours … Your server should handle deduplication". Batches: up to 1000 updates,
 *        "batching cannot be guaranteed". https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
 *   body `{ object: "page", entry: [{ id, time, changes: [{ field: "leadgen", value: { leadgen_id, page_id,
 *        form_id, adgroup_id, ad_id, created_time } }] }] }` — ids only, never the answers.
 *        https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/
 *   "We generate the signature using an escaped unicode version of the payload, with lowercase hex digits"
 *        (Messenger Platform webhooks page): so the HMAC is checked over the RAW bytes as received, and — only
 *        when those contain non-ASCII — over the same bytes with each non-ASCII character written `\uXXXX`.
 *        Both are transforms of the bytes Meta sent; neither is a re-serialised `req.body`, which would
 *        verify by luck on simple bodies and fail on real ones (`routes/webhooks.ts`, the SMS receiver).
 *
 * ── WHY THE REQUEST DOES SO LITTLE ─────────────────────────────────────────────────────────────────
 * Meta retries anything that is not a quick 200, so the POST never calls Meta or the sink: it checks the
 * signature, finds which carrier owns each form, and queues one `ads_lead_fetch` job per lead with
 * `dedup_key` = `ads_lead_fetch:<org>:<leadgen_id>`. A duplicate delivery while the first is queued is then
 * the queue's own "already on it"; one after it finished is fetched again and the sink stores it once
 * (`ingest_lead`, 0554). The org is in the key because the dedup index is global across carriers.
 *
 * ── FAIL-CLOSED, AND SAID SO ────────────────────────────────────────────────────────────────────────
 * No `META_APP_SECRET` → 503 for every POST: nothing unsigned is believed "for now". No verify token → the
 * subscribe GET answers 503. Every refusal is counted (`leadgenWebhookCounts`) and logged by reason, never
 * with the body. A form no carrier of ours owns is answered 200 (so Meta stops retrying) and logged by id.
 * The hourly backfill (B4a) is the net under all of it: a delivery we refused or never got is read there.
 *
 * ── THE ONE QUERY THAT IS NOT ORG-SCOPED ────────────────────────────────────────────────────────────
 * A delivery names a Page and a form, not a carrier, so the org is FOUND here: `ads_campaigns` by
 * `platform_refs->>meta_form_id`. That is the lookup's whole purpose, and it runs only after the signature
 * proved Meta sent the ids. Everything after it is org-scoped again (`leadFetch.ts`).
 */

export const META_WEBHOOK_PATH = "/api/webhooks/meta";

/**
 * Said at boot, as Samsara's receiver learned to (`samsaraWebhookBootWarning`): a fail-closed receiver and
 * one nobody calls look the same — both are silence. Null when both halves are configured.
 */
export function metaWebhookBootWarning(env: Pick<Env, "META_APP_SECRET" | "META_WEBHOOK_VERIFY_TOKEN">): string | null {
  const missing = [!env.META_APP_SECRET && "META_APP_SECRET", !env.META_WEBHOOK_VERIFY_TOKEN && "META_WEBHOOK_VERIFY_TOKEN"].filter(Boolean);
  if (!missing.length) return null;
  return `[meta-webhook] ${missing.join(" and ")} not set — ${META_WEBHOOK_PATH} answers 503 (fail-closed); the hourly ads leads backfill still brings every lead in.`;
}
export const SIGNATURE_HEADER = "x-hub-signature-256";
/** Meta's object ids are decimal strings; anything else in a signed body is not a lead we can fetch. */
const META_ID = /^\d{1,32}$/;
const LOOKUP_CHUNK = 100;

export type WebhookCount = "no_secret" | "bad_signature" | "bad_json" | "accepted" | "queued" | "already_queued" | "unknown_form" | "malformed";
const counts: Record<WebhookCount, number> = { no_secret: 0, bad_signature: 0, bad_json: 0, accepted: 0, queued: 0, already_queued: 0, unknown_form: 0, malformed: 0 };
const bump = (k: WebhookCount, n = 1) => {
  counts[k] += n;
};
/** Since boot, per process. What a status line or a test reads. */
export const leadgenWebhookCounts = (): Readonly<Record<WebhookCount, number>> => ({ ...counts });
/** For tests only. */
export function resetLeadgenWebhookCountsForTests(): void {
  for (const k of Object.keys(counts) as WebhookCount[]) counts[k] = 0;
}

const hmacHex = (secret: string, bytes: Buffer): string => createHmac("sha256", secret).update(bytes).digest("hex");

/** The same bytes with every non-ASCII UTF-16 unit written as Meta signs it: `ä`, lowercase hex. */
export function escapeUnicodeLikeMeta(raw: Buffer): Buffer {
  return Buffer.from(raw.toString("utf8").replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`), "utf8");
}

/** True only when `header` is `sha256=<64 hex>` and matches the raw bytes (or their escaped form). */
export function verifyMetaSignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header ?? "");
  if (!m) return false;
  const given = m[1]!.toLowerCase();
  if (safeEqual(hmacHex(secret, raw), given)) return true;
  const ascii = raw.every((b) => b < 0x80);
  return !ascii && safeEqual(hmacHex(secret, escapeUnicodeLikeMeta(raw)), given);
}

export interface LeadgenChange {
  leadgen_id: string;
  form_id: string;
  page_id: string;
}

/** Every leadgen change in one delivery, in order; `malformed` counts the ones without usable ids. */
export function leadgenChanges(body: unknown): { changes: LeadgenChange[]; malformed: number } {
  const out: LeadgenChange[] = [];
  let malformed = 0;
  const b = body as { object?: unknown; entry?: unknown } | null;
  if (!b || b.object !== "page" || !Array.isArray(b.entry)) return { changes: out, malformed: 1 };
  for (const e of b.entry as Array<{ changes?: unknown }>) {
    for (const c of Array.isArray(e?.changes) ? (e.changes as Array<{ field?: unknown; value?: Record<string, unknown> }>) : []) {
      if (c?.field !== "leadgen") continue;
      const v = c.value ?? {};
      const ids = [v.leadgen_id, v.form_id, v.page_id].map((x) => (typeof x === "number" ? String(x) : x));
      if (ids.every((x) => typeof x === "string" && META_ID.test(x))) out.push({ leadgen_id: ids[0] as string, form_id: ids[1] as string, page_id: ids[2] as string });
      else malformed += 1;
    }
  }
  return { changes: out, malformed };
}

export const adsLeadFetchDedupKey = (orgId: string, leadgenId: string): string => `ads_lead_fetch:${orgId}:${leadgenId}`;

export type LeadFetchEnqueue = (orgId: string, payload: { leadgenId: string; formId: string }) => Promise<"queued" | "conflict">;

export interface ReceiveDeps {
  env: Pick<Env, "META_APP_SECRET">;
  admin: SupabaseClient;
  enqueue: LeadFetchEnqueue;
}

export interface WebhookAnswer {
  status: number;
  body: Record<string, unknown> | string;
}

/** Which carrier owns each form — see the header: the one lookup that is not org-scoped, by design. */
async function ownersOfForms(admin: SupabaseClient, formIds: string[]): Promise<Map<string, Set<string>>> {
  const owners = new Map<string, Set<string>>();
  for (let i = 0; i < formIds.length; i += LOOKUP_CHUNK) {
    const { data, error } = await admin
      .from("ads_campaigns")
      .select("org_id, platform_refs->>meta_form_id")
      .in("platform_refs->>meta_form_id", formIds.slice(i, i + LOOKUP_CHUNK));
    if (error) throw new Error(`ads_campaigns: ${error.message}`);
    for (const r of (data ?? []) as Array<{ org_id: string; meta_form_id: string | null }>) {
      if (!r.meta_form_id) continue;
      const set = owners.get(r.meta_form_id) ?? new Set<string>();
      set.add(r.org_id);
      owners.set(r.meta_form_id, set);
    }
  }
  return owners;
}

export async function receiveLeadgenDelivery(deps: ReceiveDeps, raw: Buffer | undefined, signature: string | undefined): Promise<WebhookAnswer> {
  const secret = deps.env.META_APP_SECRET;
  if (!secret) {
    bump("no_secret");
    console.warn(`[meta-webhook] refused: META_APP_SECRET is not set (${counts.no_secret} since boot); the hourly backfill brings the leads in`);
    return { status: 503, body: { ok: false } };
  }
  if (!raw || !verifyMetaSignature(secret, raw, signature)) {
    bump("bad_signature");
    console.warn(`[meta-webhook] refused: signature ${signature ? "does not match" : "missing"} (${counts.bad_signature} since boot)`);
    return { status: 401, body: { ok: false } };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    // Signed by Meta yet unreadable: a retry would be the same bytes, so it is acknowledged and counted.
    bump("bad_json");
    console.warn("[meta-webhook] a signed delivery was not JSON; acknowledged so it is not retried");
    return { status: 200, body: { ok: true } };
  }
  bump("accepted");
  const { changes, malformed } = leadgenChanges(body);
  if (malformed) {
    bump("malformed", malformed);
    console.warn(`[meta-webhook] ${malformed} change(s) without usable leadgen ids`);
  }
  const owners = await ownersOfForms(deps.admin, [...new Set(changes.map((c) => c.form_id))]);
  let queued = 0;
  for (const c of changes) {
    const orgs = owners.get(c.form_id);
    if (!orgs?.size) {
      bump("unknown_form");
      console.warn(`[meta-webhook] lead ${c.leadgen_id} on form ${c.form_id} (Page ${c.page_id}): no campaign of ours has this form; dropped`);
      continue;
    }
    for (const orgId of orgs) {
      const r = await deps.enqueue(orgId, { leadgenId: c.leadgen_id, formId: c.form_id });
      if (r === "queued") {
        queued += 1;
        bump("queued");
      } else bump("already_queued");
    }
  }
  return { status: 200, body: { ok: true, queued } };
}

/**
 * Meta documents the challenge as "an int"; it is echoed, so it is held to a plain token shape and the
 * route answers it as `text/plain` — a reflected value never becomes markup.
 */
const CHALLENGE = /^[A-Za-z0-9_-]{1,128}$/;

/** The subscribe handshake. `hub.challenge` goes back exactly as Meta sent it. */
export function answerSubscribe(env: Pick<Env, "META_WEBHOOK_VERIFY_TOKEN">, q: Record<string, unknown>): WebhookAnswer {
  const ours = env.META_WEBHOOK_VERIFY_TOKEN;
  if (!ours) return { status: 503, body: { ok: false } };
  const mode = q["hub.mode"];
  const token = q["hub.verify_token"];
  const challenge = q["hub.challenge"];
  if (mode !== "subscribe" || typeof token !== "string" || !safeEqual(token, ours) || typeof challenge !== "string" || !CHALLENGE.test(challenge)) {
    return { status: 403, body: { ok: false } };
  }
  return { status: 200, body: challenge };
}
