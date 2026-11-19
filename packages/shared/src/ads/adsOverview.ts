import { CAMPAIGN_TRANSITIONS, type CampaignEvent } from "./campaignMachine.js";
import type { ActionKind, AdPlatform, CampaignState } from "./contracts.js";
import type { AdsHealthConnection } from "./adsHealth.js";
import { isRecordId } from "../recordId.js";

/**
 * The Ads workspace's Overview read (ADS-PLATFORM-V2-PLAN §0.3 step 3, V6 "Overview"): `GET /api/ads/overview`.
 * Four parts, each read from rows we already hold and folded by code that already gates on them — nothing here is
 * estimated, and no figure is computed twice:
 *
 *   totals     month-to-date spend is the guard's own platform fold (`platformSpend`, through `adsSpendView`), so the
 *              Overview cannot show a spend the launch check disagrees with; leads are the platform's count on our
 *              hourly rows (`ads_spend_hourly.leads`, D-AD5's fold) — what Meta says the ads produced, not what reached
 *              the Leads page (that is Recruitment's ledger, which ads does not read: D-AD17).
 *   campaigns  every campaign not archived, with its month figures.
 *   needs_you  what is waiting on a person, derived below — never a hand-written list of states.
 *   ledger     `ads_actions`, newest first, a page at a time: the append-only record of every act and refusal.
 *
 * Pure: the reader (`apps/api/src/modules/ads/overview/overviewView.ts`) hands in rows; this folds them.
 */

// ── which states wait on a person — DERIVED from the machine ───────────────────────────────────────────
/**
 * The moves that say nothing about who must act next: the kill switch and archive are open from nearly everywhere
 * (the safe direction, `campaignMachine.ts`), and a platform row mirrors a fact we do not choose.
 */
const NOT_A_NEXT_STEP: ReadonlySet<CampaignEvent> = new Set<CampaignEvent>(["kill", "archive"]);

/**
 * A state waits on a person when it has a next step and no agent may take any of them: the orchestrator will not
 * move it, so it sits until someone does. Derived from `CAMPAIGN_TRANSITIONS`, so a row added there moves a state in
 * or out of "Needs you" without an edit here (pinned by "the states that wait on a person are the machine's").
 */
export const CAMPAIGN_STATES_AWAITING_PERSON: readonly CampaignState[] = (() => {
  const steps = new Map<CampaignState, Array<(typeof CAMPAIGN_TRANSITIONS)[number]>>();
  for (const t of CAMPAIGN_TRANSITIONS) {
    if (NOT_A_NEXT_STEP.has(t.event) || t.by.every((b) => b === "platform")) continue;
    steps.set(t.from, [...(steps.get(t.from) ?? []), t]);
  }
  return [...steps].filter(([, ts]) => ts.every((t) => !t.by.includes("agent"))).map(([s]) => s).sort();
})();

/**
 * The moves that do not carry a campaign forward on their own. Besides the kill switch and archive, a pause:
 * it is open from every state that may be delivering (`CAN_DELIVER`, "the safe direction") to agent and person
 * alike, so it would make `live` read as "being worked on" when nobody is about to move it.
 */
const NOT_A_FORWARD_STEP: ReadonlySet<CampaignEvent> = new Set<CampaignEvent>([...NOT_A_NEXT_STEP, "pause"]);

/**
 * A state is the agent's to leave when it has a forward step and an agent may take every one of them: the
 * orchestrator moves it without anyone pressing anything, so a page watching it reads it again until it stops
 * (the web's `isWorking`). The mirror of `CAMPAIGN_STATES_AWAITING_PERSON`, derived from the same table, so a
 * row added to `CAMPAIGN_TRANSITIONS` cannot leave a screen polling a state that waits on a person, or still on a
 * state the agent is moving (pinned by "the states the agent is moving are the machine's"). `live`, `paused`,
 * `archived` and the person's states are neither: they sit until something outside the orchestrator happens.
 */
export const CAMPAIGN_STATES_AGENT_WORKING: readonly CampaignState[] = (() => {
  const steps = new Map<CampaignState, Array<(typeof CAMPAIGN_TRANSITIONS)[number]>>();
  for (const t of CAMPAIGN_TRANSITIONS) {
    if (NOT_A_FORWARD_STEP.has(t.event) || t.by.every((b) => b === "platform")) continue;
    steps.set(t.from, [...(steps.get(t.from) ?? []), t]);
  }
  return [...steps].filter(([, ts]) => ts.every((t) => t.by.includes("agent"))).map(([s]) => s).sort();
})();

// ── the contract ────────────────────────────────────────────────────────────────────────────────────────
export interface AdsOverviewCampaign {
  id: string;
  name: string;
  state: CampaignState;
  state_changed_at: string;
  /** Null until the campaign reached a platform (drafts and ones in review have none). */
  platform: AdPlatform | null;
  daily_budget_cents: number | null;
  month_spend_cents: number;
  month_leads: number;
}

export type NeedsYouKind =
  | "kill_switch_on"
  | "no_monthly_cap"
  | "connection"
  | "plan_review"
  | "ads_review"
  | "ready_to_launch"
  | "paused_not_by_person"
  | "failed"
  | "waiting";

export interface NeedsYouItem {
  kind: NeedsYouKind;
  /** "bad" stops spend or delivery now; "warn" is a decision waiting. */
  tone: "bad" | "warn";
  title: string;
  detail: string;
  campaign_id: string | null;
  connection_id: string | null;
  /** When it started waiting; null when the rows do not say. */
  since: string | null;
}

export interface AdsLedgerEntry {
  id: string;
  kind: ActionKind;
  status: "started" | "succeeded" | "failed" | "refused";
  actor_kind: "person" | "agent" | "platform";
  actor_name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  /** For a `transition`: the move, from the row's own request. */
  from_state: string | null;
  event: string | null;
  cause: string | null;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface AdsOverviewView {
  checked_at: string;
  month: string;
  kill_switch: { on: boolean; reason: string | null };
  totals: {
    running: number;
    month_spend_cents: number;
    month_leads: number;
    /** Null with no lead: "spend / 0" is not a number to show. */
    month_cost_per_lead_cents: number | null;
  };
  campaigns: AdsOverviewCampaign[];
  needs_you: NeedsYouItem[];
  /**
   * A page of the log addressed by its cursor, as the Audit log is (D-US12): `older` is the `?before=` of the page
   * after this one, `newer` the `?after=` of the page before it; null where there is none. No page numbers: a log
   * grows at its newest end, so "page 3" names different rows every hour and a link to it would not reopen them.
   */
  ledger: { entries: AdsLedgerEntry[]; older: string | null; newer: string | null };
}

export const OVERVIEW_LEDGER_PAGE = 50;
/** The campaign states that are delivering or about to — the Overview's "running". */
export const RUNNING_CAMPAIGN_STATES: readonly CampaignState[] = ["launching", "live"];

// ── a paused campaign: decided by the newest transitions that put it there ─────────────────────────────
export interface TransitionRow { event: string | null; actor_kind: string; actor_name: string; cause: string | null; started_at: string }

/**
 * `paused` is in `CAMPAIGN_STATES_AWAITING_PERSON` (only an approver launches), but a person who paused a campaign
 * has already decided — listing it would teach the office to ignore the list. So a paused campaign waits on a person
 * unless its newest move into `paused` was a pause or kill a PERSON asked for. `rows` are its succeeded transition
 * rows, newest first (at least the last two: `pausing → paused` is the agent confirming, the one before it says who
 * asked). No row at all is read as waiting: a quiet list must never hide one.
 */
export function pausedReading(rows: readonly TransitionRow[]): { waits: false } | { waits: true; kind: "ready_to_launch" | "paused_not_by_person"; detail: string; since: string | null } {
  const [last, before] = rows;
  if (!last) return { waits: true, kind: "paused_not_by_person", detail: "Paused. No record says who paused it.", since: null };
  if (last.event === "created") return { waits: true, kind: "ready_to_launch", detail: "Created on the platform, paused. Launching needs an approver.", since: last.started_at };
  if (last.event === "launch_failed") return { waits: true, kind: "paused_not_by_person", detail: `The launch failed${last.cause ? `: ${last.cause}` : "."}`, since: last.started_at };
  if (last.event === "platform_paused" || last.event === "platform_rejected") {
    return { waits: true, kind: "paused_not_by_person", detail: `${last.event === "platform_rejected" ? "The platform rejected it" : "Paused on the platform, outside Silvicom"}${last.cause ? `: ${last.cause}` : "."}`, since: last.started_at };
  }
  if (last.event === "paused" && before && (before.event === "pause" || before.event === "kill") && before.actor_kind === "person") return { waits: false };
  const by = before?.actor_name ?? last.actor_name;
  return { waits: true, kind: "paused_not_by_person", detail: `Paused by ${by}${before?.cause ? `: ${before.cause}` : "."}`, since: last.started_at };
}

// ── the "Needs you" fold ────────────────────────────────────────────────────────────────────────────────
export interface NeedsYouInput {
  kill_switch: { on: boolean; reason: string | null };
  /** Platforms connected, each with its saved monthly cap (null: none saved, so nothing there can launch). */
  caps: ReadonlyArray<{ platform: AdPlatform; cap_cents: number | null }>;
  connections: readonly AdsHealthConnection[];
  campaigns: ReadonlyArray<{ id: string; name: string; state: CampaignState; state_changed_at: string }>;
  /** Ads ready for review, per campaign id. */
  ready_ads: ReadonlyMap<string, number>;
  /** Per paused campaign: `pausedReading` of its transitions. */
  paused: ReadonlyMap<string, ReturnType<typeof pausedReading>>;
}

export function foldNeedsYou(i: NeedsYouInput): NeedsYouItem[] {
  const out: NeedsYouItem[] = [];
  const item = (x: Omit<NeedsYouItem, "campaign_id" | "connection_id"> & Partial<Pick<NeedsYouItem, "campaign_id" | "connection_id">>) =>
    out.push({ campaign_id: null, connection_id: null, ...x });
  if (i.kill_switch.on) item({ kind: "kill_switch_on", tone: "bad", title: "The kill switch is on", detail: i.kill_switch.reason ?? "Nothing launches or spends more until an admin clears it.", since: null });
  for (const c of i.caps) {
    if (c.cap_cents === null) item({ kind: "no_monthly_cap", tone: "warn", title: `No monthly cap for ${c.platform}`, detail: "Nothing launches on this platform until an admin saves a monthly cap in Ads › Settings.", since: null });
  }
  for (const c of i.connections) {
    if (c.status === "failing") item({ kind: "connection", tone: "bad", title: `${c.provider} connection failing`, detail: c.last_error ?? "The last test failed.", connection_id: c.id, since: c.last_test_at });
    else if (c.token.tone === "bad" || c.token.tone === "warn") item({ kind: "connection", tone: c.token.tone, title: `${c.provider} token`, detail: c.token.words, connection_id: c.id, since: c.last_test_at });
  }
  const awaiting = new Set<CampaignState>(CAMPAIGN_STATES_AWAITING_PERSON);
  for (const c of i.campaigns) {
    if (!awaiting.has(c.state)) continue;
    const base = { campaign_id: c.id, since: c.state_changed_at };
    if (c.state === "plan_review") item({ ...base, kind: "plan_review", tone: "warn", title: c.name, detail: "The plan is written. Approve it or ask for a new one." });
    else if (c.state === "review") {
      const n = i.ready_ads.get(c.id) ?? 0;
      item({ ...base, kind: "ads_review", tone: "warn", title: c.name, detail: n > 0 ? `${n} ad${n === 1 ? "" : "s"} ready for your review.` : "The ads are made. Review them." });
    } else if (c.state === "failed") item({ ...base, kind: "failed", tone: "bad", title: c.name, detail: "Stopped on an error. Try the step again or archive it." });
    else if (c.state === "paused") {
      const r = i.paused.get(c.id) ?? pausedReading([]);
      if (r.waits) item({ ...base, kind: r.kind, tone: "warn", title: c.name, detail: r.detail, since: r.since ?? c.state_changed_at });
    } else {
      // A state the machine newly hands to a person and this fold has no words for yet: listed, never dropped.
      item({ ...base, kind: "waiting", tone: "warn", title: c.name, detail: `Waiting on a person (${c.state}).` });
    }
  }
  const rank = (x: NeedsYouItem) => (x.tone === "bad" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || (a.since ?? "").localeCompare(b.since ?? ""));
}

// ── the ledger page ────────────────────────────────────────────────────────────────────────────────────
export interface LedgerRow {
  id: string; kind: string; status: string; actor_kind: string; actor_name: string; campaign_id: string | null;
  cause: string | null; error_code: string | null; request: unknown; started_at: string; finished_at: string | null;
}

export function ledgerEntry(r: LedgerRow, names: ReadonlyMap<string, string>): AdsLedgerEntry {
  const req = r.kind === "transition" && r.request && typeof r.request === "object" ? (r.request as { from?: unknown; event?: unknown }) : null;
  return {
    id: r.id, kind: r.kind as ActionKind, status: r.status as AdsLedgerEntry["status"], actor_kind: r.actor_kind as AdsLedgerEntry["actor_kind"],
    actor_name: r.actor_name, campaign_id: r.campaign_id, campaign_name: r.campaign_id ? names.get(r.campaign_id) ?? null : null,
    from_state: typeof req?.from === "string" ? req.from : null, event: typeof req?.event === "string" ? req.event : null,
    cause: r.cause, error_code: r.error_code, started_at: r.started_at, finished_at: r.finished_at,
  };
}

/**
 * The ledger's keyset cursor: `started_at` alone is not unique (a kill writes a row per campaign in one instant), so
 * the cursor carries the id too and a page boundary inside one instant neither repeats nor skips a row.
 */
export function ledgerCursor(e: Pick<AdsLedgerEntry, "started_at" | "id">): string {
  return `${e.started_at}|${e.id}`;
}

/** A timestamp as PostgREST writes one; nothing else may reach the filter string the cursor is spliced into. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** Where a ledger page starts: the newest rows, the rows older than a cursor, or the rows newer than one. */
export type LedgerPosition = { kind: "newest" } | { kind: "before"; at: { started_at: string; id: string } } | { kind: "after"; at: { started_at: string; id: string } };

/**
 * The page's two cursors, from the rows read (ONE more than a page, newest first, so whether another page lies
 * beyond in the direction read is known without a count). Reading older, the newer side always exists — the cursor's
 * own row is there — and the same holds the other way; the ledger is append-only (AX010), so no row it named is gone.
 */
export function ledgerPageCursors(position: LedgerPosition, page: readonly Pick<AdsLedgerEntry, "started_at" | "id">[], more: boolean): { older: string | null; newer: string | null } {
  const first = page[0];
  const last = page.at(-1);
  if (!first || !last) return { older: null, newer: null };
  return {
    older: position.kind === "after" || more ? ledgerCursor(last) : null,
    newer: position.kind === "newest" ? null : position.kind === "before" || more ? ledgerCursor(first) : null,
  };
}

/** The cursor read back; null for anything that is not one (the route answers 400 rather than guess). */
export function parseLedgerCursor(s: string): { started_at: string; id: string } | null {
  const [at, id, ...rest] = s.split("|");
  if (rest.length > 0 || !at || !id || !isRecordId(id) || !TIMESTAMP.test(at) || Number.isNaN(Date.parse(at))) return null;
  // Kept as written, never re-serialised: Postgres holds microseconds and a JS Date keeps milliseconds, so a
  // round-trip would move the boundary inside the instant and repeat or skip rows there.
  return { started_at: at, id };
}
