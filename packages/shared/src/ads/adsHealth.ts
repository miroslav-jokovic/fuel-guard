import { formatDisplayDate } from "../displayDate.js";
import { JOB_KIND_CATALOGUE } from "../jobKindCatalogue.js";
import { AD_AI_AGENTS, type AdAiAgent } from "./contracts.js";
import { TOKEN_WARN_DAYS, tokenDaysLeft, type AdsConnectionReport, type AdsTokenExpiry } from "./connectionContract.js";

/**
 * The ads health read (ADS-PLATFORM-V2-PLAN V8; audit 2026-11-18 A-9): is the machinery running, and what is it
 * costing — on one screen, before anything is wrong enough to ring a bell. Four parts, each read from a row we
 * already hold; nothing here is estimated:
 *
 *   connections  each platform connection's state, its last test, and its token's expiry (A-8, `token_expiry`).
 *   lead webhook when Meta last told us of a lead: each delivery that names a form of ours queues one `ads_lead_fetch`
 *                (`leads/leadgenWebhook.ts`), so the newest such job IS the last delivery we acted on. A delivery
 *                naming nothing of ours queues nothing and is not counted — the read says "last lead webhook".
 *   jobs         every ads job kind (the job catalogue's `area: "ads"`, derived, never listed here) over the last
 *                `HEALTH_JOB_DAYS`: how many finished, how many failed, the last failure and its reason.
 *   agents       each AI agent this month: calls made, answers in the tool's shape, calls that failed and why,
 *                calls the budget refused, tokens. "In shape" means the answer parsed — not that a later check
 *                passed it (the copy check, the plan check): that is each worker's own baseline (§4R).
 * Pure: the reader (`apps/api/src/modules/ads/health/healthView.ts`) hands in rows; this folds them.
 */

export const HEALTH_JOB_DAYS = 7;

/** The ads job kinds, from the catalogue's own area: a kind added there is on the health read without an edit here. */
export const ADS_JOB_KINDS: readonly string[] = Object.entries(JOB_KIND_CATALOGUE)
  .filter(([, e]) => (e as { area: string }).area === "ads").map(([k]) => k).sort();

export type HealthTone = "ok" | "warn" | "bad" | "unknown";

export interface AdsHealthConnection {
  id: string;
  provider: string;
  is_sandbox: boolean;
  status: "connected" | "failing";
  last_test_at: string | null;
  last_error: string | null;
  token: { expiry: AdsTokenExpiry | null; days_left: number | null; tone: HealthTone; words: string };
}

export interface AdsHealthJob {
  kind: string;
  label: string;
  done: number;
  failed: number;
  running: number;
  last_done_at: string | null;
  last_failed_at: string | null;
  last_error: string | null;
  tone: HealthTone;
}

export interface AdsHealthAgent {
  agent: AdAiAgent;
  enabled: boolean;
  calls: number;
  in_shape: number;
  failed: number;
  budget_refused: number;
  /** In-shape answers over calls that reached the model (budget refusals asked nothing); null when none did. */
  in_shape_share: number | null;
  /** The failure codes, most frequent first. */
  failures: Array<{ code: string; count: number }>;
  /**
   * Tokens billed (Claude) or US dollars (Higgsfield since Q-APX16; `credits` on rows written before it), from the
   * ledger's own unit. Only rows in that one unit are summed: a month that holds both a simulator's old credits and
   * dollars shows the dollars, because adding the two would print a figure in neither.
   */
  cost_units: number;
  cost_unit: "tokens" | "credits" | "usd" | null;
}

export interface AdsHealthView {
  checked_at: string;
  month: string;
  connections: AdsHealthConnection[];
  lead_webhook: { last_at: string | null };
  jobs: AdsHealthJob[];
  agents: AdsHealthAgent[];
}

// ── the folds ────────────────────────────────────────────────────────────────────────────────────────
export interface HealthConnectionRow { id: string; provider: string; is_sandbox: boolean; status: string; last_test_at: string | null; last_error: string | null; last_test: AdsConnectionReport | null }
export interface HealthJobRow { kind: string; status: string; error: string | null; created_at: string; finished_at: string | null }
export interface HealthGenerationRow { agent: string; status: string; error_code: string | null; cost_units: number | string | null; cost_unit: string | null }


export function tokenHealth(expiry: AdsTokenExpiry | null | undefined, now: Date): AdsHealthConnection["token"] {
  const e = expiry ?? null;
  const days = tokenDaysLeft(e, now);
  if (!e) return { expiry: null, days_left: null, tone: "unknown", words: "Not read yet: test the connection." };
  if (!e.read) {
    const why = e.why === "no_app_id" ? "the Meta app id is not set on this server (META_APP_ID)"
      : e.why === "simulator" ? "a simulator connection has no Meta token" : `Meta did not answer (${e.error_code ?? "error"})`;
    return { expiry: e, days_left: null, tone: e.why === "simulator" ? "ok" : "unknown", words: `Expiry not read: ${why}.` };
  }
  if (!e.valid) return { expiry: e, days_left: days, tone: "bad", words: "Meta says this token is no longer valid." };
  if (e.never_expires) return { expiry: e, days_left: null, tone: "ok", words: "Issued not to expire." };
  if (days === null) return { expiry: e, days_left: null, tone: "unknown", words: "Meta gave no expiry date." };
  if (days < 0) return { expiry: e, days_left: days, tone: "bad", words: `Expired on ${formatDisplayDate(e.expires_at)}.` };
  return { expiry: e, days_left: days, tone: days <= TOKEN_WARN_DAYS ? "warn" : "ok", words: `Expires on ${formatDisplayDate(e.expires_at)}, in ${days} day${days === 1 ? "" : "s"}.` };
}

export function foldConnections(rows: readonly HealthConnectionRow[], now: Date): AdsHealthConnection[] {
  return rows.filter((r) => r.status === "connected" || r.status === "failing").map((r) => ({
    id: r.id, provider: r.provider, is_sandbox: r.is_sandbox, status: r.status as "connected" | "failing",
    last_test_at: r.last_test_at, last_error: r.last_error, token: tokenHealth(r.last_test?.token_expiry, now),
  }));
}

export function foldJobs(rows: readonly HealthJobRow[]): AdsHealthJob[] {
  return ADS_JOB_KINDS.map((kind) => {
    const mine = rows.filter((r) => r.kind === kind);
    const newest = (s: string) => mine.filter((r) => r.status === s).map((r) => r.finished_at ?? r.created_at).sort().at(-1) ?? null;
    const lastFailedAt = newest("failed");
    const lastDoneAt = newest("done");
    const lastFailure = mine.filter((r) => r.status === "failed").sort((a, b) => ((a.finished_at ?? a.created_at) < (b.finished_at ?? b.created_at) ? 1 : -1))[0];
    const failed = mine.filter((r) => r.status === "failed").length;
    // A kind whose newest finish is a failure is failing now; one that failed and has since finished is a warning.
    const tone: HealthTone = failed === 0 ? "ok" : lastDoneAt !== null && lastDoneAt > lastFailedAt! ? "warn" : "bad";
    return {
      kind, label: (JOB_KIND_CATALOGUE as Record<string, { label: string }>)[kind]!.label,
      done: mine.filter((r) => r.status === "done").length, failed, running: mine.filter((r) => r.status === "queued" || r.status === "running").length,
      last_done_at: lastDoneAt, last_failed_at: lastFailedAt, last_error: lastFailure?.error?.slice(0, 500) ?? null, tone,
    };
  });
}

export function foldAgents(rows: readonly HealthGenerationRow[], enabled: Partial<Record<AdAiAgent, boolean>>): AdsHealthAgent[] {
  return AD_AI_AGENTS.map((agent) => {
    const mine = rows.filter((r) => r.agent === agent);
    const inShape = mine.filter((r) => r.status === "succeeded").length;
    const failed = mine.filter((r) => r.status === "failed");
    const refused = mine.filter((r) => r.status === "budget_exhausted").length;
    const codes = new Map<string, number>();
    for (const f of failed) codes.set(f.error_code ?? "unknown", (codes.get(f.error_code ?? "unknown") ?? 0) + 1);
    const asked = inShape + failed.length;
    const units = new Set(mine.map((r) => r.cost_unit).filter((u): u is string => Boolean(u)));
    const unit = units.has("usd") ? "usd" : [...units][0];
    return {
      agent, enabled: enabled[agent] === true, calls: mine.length, in_shape: inShape, failed: failed.length, budget_refused: refused,
      in_shape_share: asked === 0 ? null : Math.round((inShape / asked) * 1000) / 1000,
      failures: [...codes].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1)),
      cost_units: mine.reduce((n, r) => n + (r.cost_units === null || r.cost_unit !== unit ? 0 : Number(r.cost_units)), 0),
      cost_unit: unit === "tokens" || unit === "credits" || unit === "usd" ? unit : null,
    };
  });
}
