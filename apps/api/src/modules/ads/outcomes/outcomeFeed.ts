import type { SupabaseClient } from "@supabase/supabase-js";
import { leadOutcomeSchema, type LeadOutcome, type LeadOutcomes } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { sendAdsAlert } from "../alerts/adsAlerts.js";
import { alertIfTokenRefused } from "../alerts/connectionAlerts.js";
import { isNoSuchObject } from "../monitor/recordedGone.js";
import type { GraphFailure, MetaGraph } from "../platforms/meta/graphClient.js";
import { graphForConnection, type ConnectionForGraph, type GraphForConnection } from "../platforms/registry.js";
import type { OutcomeFeedTargets } from "./feedTarget.js";
import { CAPI_MAX_BATCH, capiEvent, outcomeCandidates, tooOldToSend, type FeedProvider, type OutcomeCandidate } from "./outcomeEvents.js";
import { dueRows, newestRefusal, queueOutcomes, recordSend, type DueRow } from "./outcomeLedger.js";

/**
 * One Meta connection's outcome feed run (B6; D-AD14): read which stages the carrier's ad leads reached, from
 * recruiting's `LeadOutcomes` (Q-AD34, injected; ads never reads a recruiting table, D-AD17), put each new
 * stage on the ledger, and send what is due to the carrier's Conversions API dataset. The pure half and
 * Meta's rules are in `outcomeEvents.ts`; the ledger's states in `outcomeLedger.ts`.
 *
 * ── HOW EACH ANSWER IS RECORDED (§4R, Outcome feed L2) ────────────────────────────────────────────
 *   accepted (events_received = the batch)   every row `sent`
 *   the batch refused (invalid request)      each event is sent ALONE, so one bad event cannot hold the rest
 *                                            back. That is right under both of Meta's pages (fakeMetaEvents.ts
 *                                            header), because a resend of an accepted event is dropped as a
 *                                            duplicate by its `event_id`.
 *   one event refused alone                  `failed`, final (never retried), marked `refused`, and the admins
 *                                            told ONCE: one `ads_rejected` bell per newest refused row
 *   the dataset does not exist (100/33)      nothing written; the run fails, listed: a setup fault, not an event's
 *   429 / 5xx / timeout                      the client's own retries (`graphClient.ts`), then `failed` with
 *                                            attempts + 1, retried tomorrow up to MAX_ATTEMPTS; the run fails
 *   token refused                            as above, and `alertIfTokenRefused` (Track G #2085): the same bell
 *                                            a pause or a pull meeting the token rings, once a day
 *   a due row older than 7 days, or a stage no longer recorded (an earlier contact back-dated is the same ref,
 *                                            so this means the stage itself is gone)  `skipped`, final
 *
 * A send is idempotent at Meta (dedup by `event_id` + `event_name`), so the Graph client may retry it.
 * Meta and SIMULATOR connections run (0571, Q-AD40 (2)), each with its own platform's leads only. A simulator
 * connection opens only where `simulatorGate` allows (`graphForConnection`), and its target is refused there
 * first (`settingsFeedTargets`), so a production host never ledgers or sends a simulator event. The optimisation switch (Conversion Leads) is not here: it stays hidden until
 * V3 is answered in the sandbox.
 */

/** How far back leads are read: a hire can come months after the lead; anything sent must still be ≤ 7 days old. */
export const OUTCOME_LOOKBACK_DAYS = 90;

export interface OutcomeFeedDeps {
  admin: SupabaseClient;
  env: Env;
  now: () => Date;
  outcomes: LeadOutcomes;
  targets: OutcomeFeedTargets;
  /** The process environment the simulator gate reads (the registry's); injectable so a test can be production. */
  processEnv?: NodeJS.ProcessEnv;
  /** The connection's Graph client; the registry's by default, FakeMeta's in tests. */
  openGraph?: (c: ConnectionForGraph) => Promise<GraphForConnection>;
  batchSize?: number;
}

export interface OutcomeFeedResult {
  connection_id: string;
  ran: boolean;
  queued: number;
  skipped: number;
  sent: number;
  refused: number;
  /** The platform the run spoke for, once it knew (null when it stopped before reading the connection). */
  provider: FeedProvider | null;
  failures: Array<{ reason: string }>;
}

export async function runOutcomeFeed(deps: OutcomeFeedDeps, orgId: string, connectionId: string): Promise<OutcomeFeedResult> {
  const r = await runOnce(deps, orgId, connectionId);
  if (r.ran) await alertRefused(deps, orgId, connectionId, r.provider);
  await alertIfTokenRefused(deps.admin, deps.now(), { org_id: orgId, connection_id: connectionId }, r.failures.map((f) => f.reason), "outcomes");
  return r;
}

async function runOnce(deps: OutcomeFeedDeps, orgId: string, connectionId: string): Promise<OutcomeFeedResult> {
  const result: OutcomeFeedResult = { connection_id: connectionId, ran: false, queued: 0, skipped: 0, sent: 0, refused: 0, provider: null, failures: [] };
  const target = await deps.targets.targetFor(orgId, connectionId);
  if (!target) return result;
  const { data, error } = await deps.admin.from("ads_platform_connections")
    .select("id, org_id, provider, is_sandbox, token_sealed, status").eq("org_id", orgId).eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const c = data as (ConnectionForGraph & { provider: FeedProvider | string; status: string }) | null;
  if (!c || (c.provider !== "meta" && c.provider !== "simulator")) return result;
  const provider = c.provider;
  result.provider = provider;
  if (c.status === "disconnected") return { ...result, failures: [{ reason: "connection:disconnected" }] };
  result.ran = true;

  const now = deps.now();
  const since = new Date(now.getTime() - OUTCOME_LOOKBACK_DAYS * 86_400_000).toISOString();
  const read = await deps.outcomes.outcomesSince(orgId, since);
  const outcomes: LeadOutcome[] = [];
  for (const o of read) {
    const parsed = leadOutcomeSchema.safeParse(o);
    if (parsed.success) outcomes.push(parsed.data);
    else result.failures.push({ reason: "outcomes:malformed" });
  }
  const candidates = outcomeCandidates(outcomes, provider);
  const q = await queueOutcomes(deps.admin, orgId, provider, candidates, now);
  result.queued = q.queued;
  result.skipped = q.skipped;

  const due = await dueRows(deps.admin, orgId, provider);
  if (due.length === 0) return result;
  const opened = await (deps.openGraph ?? ((x) => graphForConnection(deps, x)))(c);
  if (!opened.ok) return { ...result, failures: [...result.failures, { reason: `graph:${opened.error_code}` }] };

  const byRef = new Map(candidates.map((x) => [x.source_event_ref, x]));
  const sendable: Array<{ row: DueRow; c: OutcomeCandidate }> = [];
  for (const row of due) {
    const cand = byRef.get(row.source_event_ref);
    const why = !cand ? "stage_no_longer_recorded" : tooOldToSend(cand.event_time, now) ? "older_than_7_days" : null;
    if (why) {
      await recordSend(deps.admin, orgId, row, { status: "skipped", response: { reason: why } });
      result.skipped += 1;
    } else sendable.push({ row, c: cand! });
  }

  const size = Math.min(deps.batchSize ?? CAPI_MAX_BATCH, CAPI_MAX_BATCH);
  const send = new Sender(deps, orgId, opened.graph, target, result);
  for (let i = 0; i < sendable.length; i += size) {
    if (!(await send.batch(sendable.slice(i, i + size)))) break;
  }
  return result;
}

type Item = { row: DueRow; c: OutcomeCandidate };
type Answer = { events_received?: unknown; fbtrace_id?: unknown };

const errorOf = (e: GraphFailure): Record<string, unknown> => ({ error_code: e.error_code, code: e.code, subcode: e.subcode, message: e.message, fbtrace_id: e.fbtrace_id });

class Sender {
  constructor(
    private readonly deps: OutcomeFeedDeps, private readonly orgId: string, private readonly graph: MetaGraph,
    private readonly target: { dataset_id: string; test_event_code?: string }, private readonly result: OutcomeFeedResult,
  ) {}

  /** Sends one batch; false when the run must stop (Meta unreachable, throttled, the token or the dataset refused). */
  async batch(items: Item[], alone = false): Promise<boolean> {
    const r = await this.graph.post<Answer>(`${this.target.dataset_id}/events`, {
      data: items.map((x) => capiEvent(x.c)), test_event_code: this.target.test_event_code,
    }, { idempotent: true });
    if (r.ok && r.data?.events_received === items.length) {
      const at = this.deps.now();
      for (const x of items) await recordSend(this.deps.admin, this.orgId, x.row, { status: "sent", at, response: { events_received: items.length, fbtrace_id: r.data.fbtrace_id ?? null } });
      this.result.sent += items.length;
      return true;
    }
    const failure = r.ok ? null : r.error;
    if (failure && isNoSuchObject(failure)) {
      this.result.failures.push({ reason: "dataset:not_found" });
      return false;
    }
    if (!failure || failure.kind === "invalid_request") {
      if (!alone && items.length > 1) {
        for (const x of items) if (!(await this.batch([x], true))) return false;
        return true;
      }
      const response = failure ? errorOf(failure) : { error_code: "events_not_counted", answer: r.ok ? r.data : null };
      await recordSend(this.deps.admin, this.orgId, items[0]!.row, { status: "failed", final: true, response: { ...response, refused: true } });
      this.result.refused += 1;
      return true;
    }
    for (const x of items) await recordSend(this.deps.admin, this.orgId, x.row, { status: "failed", final: false, response: errorOf(failure) });
    this.result.failures.push({ reason: `send:${failure.error_code}` });
    return false;
  }
}

/**
 * The refusal bell, read from the LEDGER, not from this run's tally (found by the L3 sweep, 2026-11-06). A run killed
 * between recording a refusal and ringing would otherwise never ring: the next run sees that row as final, and
 * its own count is 0. So every run that ran asks for the newest refused row, and rings keyed by THAT row. A
 * repeat is dropped by the bell's dedupe, and a later refusal is a new key and a new bell.
 */
async function alertRefused(deps: OutcomeFeedDeps, orgId: string, connectionId: string, provider: FeedProvider | null): Promise<void> {
  if (!provider) return;
  const newest = await newestRefusal(deps.admin, orgId, provider);
  if (!newest) return;
  await sendAdsAlert(deps.admin, orgId, {
    category: "ads_rejected",
    title: "Meta refused lead progress updates",
    body: "Meta refused one or more updates on how ad leads progressed (contacted, converted, applied, hired). They will not be sent again. Ads keep running; Meta only learns less about which leads became drivers.",
    severity: "warning",
    entityType: "ads_platform_connection",
    entityId: connectionId,
    dedupeKey: `ads_outcome_refused:${connectionId}:${newest}`,
  });
}
