import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutcomeStage } from "@silvicom/shared";
import { tooOldToSend, type FeedProvider, type OutcomeCandidate } from "./outcomeEvents.js";

/**
 * The outcome feed's ledger: `ads_outcome_events` (0537, stages 0570), its ONE writer (B6). Append-only and
 * pinned in `RETENTION_FORBIDDEN`, because it is what we told a platform about a person's progress. 0537's
 * guard lets a row move only from `queued` or `failed` to a send result, touching only `status`, `attempts`,
 * `response` and `sent_at`. A correction is a new row, which the unique `(org_id, provider, source_event_ref)`
 * allows only under a new ref, so a stage can never be told twice.
 *
 *   queued   inserted, not yet sent
 *   skipped  never sent, final: older than Meta takes (7 days), or no longer recorded when its turn came
 *   sent     Meta counted it (`events_received`), final
 *   failed   not sent. `attempts` < MAX_ATTEMPTS is retried on the next run. A refusal is written with
 *            attempts = MAX_ATTEMPTS, so it is never picked again: §4R's "never retried forever".
 *
 * Every query filters `org_id` itself (the service role bypasses RLS). An `.in()` list goes in chunks of 100
 * (memory in-list-overflows-node22), and every read is paged past PostgREST's 1,000 (memory postgrest-caps).
 * Writes are INSERTs and UPDATEs, never an upsert (`lint:upserts`).
 */

export const MAX_ATTEMPTS = 5;
const CHUNK = 100;
const PAGE = 1000;

export interface DueRow {
  id: string;
  source_event_ref: string;
  platform_lead_ref: string;
  stage: OutcomeStage;
  attempts: number;
}

export interface Queued {
  queued: number;
  skipped: number;
  already: number;
}

/** Inserts every candidate not yet on the ledger: `queued`, or `skipped` when it is already too old to send. */
export async function queueOutcomes(admin: SupabaseClient, orgId: string, provider: FeedProvider, candidates: readonly OutcomeCandidate[], now: Date): Promise<Queued> {
  const result: Queued = { queued: 0, skipped: 0, already: 0 };
  const known = new Set<string>();
  const refs = candidates.map((c) => c.source_event_ref);
  for (let i = 0; i < refs.length; i += CHUNK) {
    const { data, error } = await admin.from("ads_outcome_events").select("source_event_ref")
      .eq("org_id", orgId).eq("provider", provider).in("source_event_ref", refs.slice(i, i + CHUNK));
    if (error) throw new Error(`ads_outcome_events: ${error.message}`);
    for (const r of (data ?? []) as Array<{ source_event_ref: string }>) known.add(r.source_event_ref);
  }
  for (const c of candidates) {
    if (known.has(c.source_event_ref)) {
      result.already += 1;
      continue;
    }
    const old = tooOldToSend(c.event_time, now);
    const { error } = await admin.from("ads_outcome_events").insert({
      org_id: orgId, campaign_id: c.campaign_id, provider: c.provider, platform_lead_ref: c.platform_lead_ref, stage: c.stage,
      source_event_ref: c.source_event_ref, status: old ? "skipped" : "queued",
      response: old ? { reason: "older_than_7_days", event_time: c.event_time } : null,
    });
    // Another run inserted it between our read and this write: it is on the ledger, which is all this asks.
    if (error && (error as { code?: string }).code === "23505") {
      result.already += 1;
      continue;
    }
    if (error) throw new Error(`ads_outcome_events: ${error.message}`);
    known.add(c.source_event_ref);
    if (old) result.skipped += 1;
    else result.queued += 1;
  }
  return result;
}

/** Every row still to send, oldest first. */
export async function dueRows(admin: SupabaseClient, orgId: string, provider: FeedProvider): Promise<DueRow[]> {
  const out: DueRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("ads_outcome_events")
      .select("id, source_event_ref, platform_lead_ref, stage, attempts")
      .eq("org_id", orgId).eq("provider", provider).in("status", ["queued", "failed"]).lt("attempts", MAX_ATTEMPTS)
      .order("created_at").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`ads_outcome_events: ${error.message}`);
    const rows = (data ?? []) as DueRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export type SendResult =
  | { status: "sent"; at: Date; response: Record<string, unknown> }
  | { status: "skipped"; response: Record<string, unknown> }
  | { status: "failed"; final: boolean; response: Record<string, unknown> };

/** One row's result. Only from `queued`/`failed` (the guard's own rule, stated in the filter too). */
export async function recordSend(admin: SupabaseClient, orgId: string, row: DueRow, r: SendResult): Promise<void> {
  const patch = r.status === "sent"
    ? { status: "sent", attempts: row.attempts + 1, response: r.response, sent_at: r.at.toISOString() }
    : r.status === "skipped"
      ? { status: "skipped", response: r.response }
      : { status: "failed", attempts: r.final ? MAX_ATTEMPTS : row.attempts + 1, response: r.response };
  const { error } = await admin.from("ads_outcome_events").update(patch)
    .eq("org_id", orgId).eq("id", row.id).in("status", ["queued", "failed"]);
  if (error) throw new Error(`ads_outcome_events: ${error.message}`);
}

/** The newest row Meta refused for good (`recordSend` marks it `refused`), or null: what the refusal bell is keyed by. */
export async function newestRefusal(admin: SupabaseClient, orgId: string, provider: FeedProvider): Promise<string | null> {
  const { data, error } = await admin.from("ads_outcome_events").select("id")
    .eq("org_id", orgId).eq("provider", provider).eq("status", "failed").eq("response->>refused", "true")
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`ads_outcome_events: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
}
