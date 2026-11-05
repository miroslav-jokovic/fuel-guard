import type { CampaignState } from "./contracts.js";
import { parseAdName } from "./naming.js";

/**
 * The daily reconcile (ADS-AGENT-BUILD-WORKFLOW.md B5c; D-AD4 "Reconcile, never self-correct"). Pure: what we
 * hold and what Meta reports in, every mismatch out. The job (`apps/api/src/modules/ads/monitor/reconcile.ts`)
 * reads both sides and records each mismatch as one `external_change` row and alert; it never writes a
 * campaign, a budget or a status to make the two agree. Ads Manager stays usable (D-AD4): an edit there is
 * allowed, and seen.
 *
 * ── WHAT IS COMPARED ─────────────────────────────────────────────────────────────────────────────
 *   · `missing`      a campaign or ad set we recorded that Meta no longer has (or has deleted / archived) —
 *                    also what a simulator restart looks like, which is the honest answer (FakeMeta header);
 *   · `status`       the campaign's status against our state: `live` must be ACTIVE (its ad set too, since
 *                    delivery needs both); every settled state that is not live must be PAUSED. `launching`
 *                    and `pausing` are moves in flight, so either answer is expected there;
 *   · `daily_budget` the ad set's against our campaign's approved daily amount;
 *   · `spend_cap`    the campaign's lifetime cap against our approved lifetime amount (Meta's own fence,
 *                    plan §D-AD3.2 — a cap removed in Ads Manager is the most serious edit of all);
 *   · `overrun`      the campaign's lifetime spend (our copy of Meta's numbers) past its approved lifetime;
 *   · `not_ours`     a campaign on the account whose name does not parse as ours (`naming.ts`): someone made
 *                    it in Ads Manager. Reported, never adopted, never paused by us. It also spends against
 *                    the same account, which is why the guard reads the account's own spend (audit H4).
 *
 * ── SEVERITY ─────────────────────────────────────────────────────────────────────────────────────
 * `critical` when the edit can spend money nobody approved here: delivering where we hold it paused, a budget
 * or cap raised or removed, an overrun, an object of someone else's that is ACTIVE. Everything else (a pause
 * made in Ads Manager, a budget lowered, a missing object) is `warning`: it costs reach, not money.
 *
 * ── ONCE PER FACT ────────────────────────────────────────────────────────────────────────────────
 * Each mismatch carries a `key` built from the object, the field and the value Meta reports. The job uses it
 * as the ledger row's idempotency key, so the same edit is recorded and rung once, however many days it
 * stands — and a NEW value on the same field is a new fact, recorded again. A run that finds nothing new
 * writes nothing (§4R L3: "flags every planted mismatch and nothing else").
 */

export interface ReconcileOurCampaign {
  campaign_id: string;
  state: CampaignState;
  daily_budget_cents: number | null;
  lifetime_cap_cents: number | null;
  meta_campaign_id: string;
  meta_adset_id: string | null;
  lifetime_spend_cents: number;
}

/** What Meta reports for one object; `status: null` = it does not exist (a read refused with "does not exist"). */
export interface MetaObjectSeen {
  id: string;
  name: string | null;
  status: string | null;
  /** Campaign `spend_cap`, ad set `daily_budget` — cents, as Meta writes them; null when unset. */
  amount_cents: number | null;
}

export interface ReconcileInput {
  ours: ReconcileOurCampaign[];
  /** Our campaigns' and ad sets' objects as read by id, keyed by Meta id. */
  objects: Map<string, MetaObjectSeen>;
  /** Every campaign the account lists (status, name), ours or not. */
  account_campaigns: MetaObjectSeen[];
}

export const RECONCILE_FIELDS = ["missing", "status", "daily_budget", "spend_cap", "overrun", "not_ours"] as const;
export type ReconcileField = (typeof RECONCILE_FIELDS)[number];

export interface ReconcileMismatch {
  /** Our campaign, when the object is one of ours. */
  campaign_id: string | null;
  level: "campaign" | "adset";
  meta_id: string;
  field: ReconcileField;
  ours: string | number | null;
  theirs: string | number | null;
  severity: "critical" | "warning";
  /** Stable for one fact: object, field, Meta's value (header). */
  key: string;
}

const GONE = new Set(["DELETED", "ARCHIVED"]);
const IN_FLIGHT: readonly CampaignState[] = ["launching", "pausing"];

/** One fact's key (header). Exported because the monitor asks the ledger whether a `missing` is already recorded. */
export const mismatchKey = (m: Pick<ReconcileMismatch, "level" | "meta_id" | "field" | "theirs">): string =>
  `${m.level}:${m.meta_id}:${m.field}:${m.theirs ?? "none"}`;

function mismatch(m: Omit<ReconcileMismatch, "key">): ReconcileMismatch {
  return { ...m, key: mismatchKey(m) };
}

function checkOne(c: ReconcileOurCampaign, objects: Map<string, MetaObjectSeen>): ReconcileMismatch[] {
  const out: ReconcileMismatch[] = [];
  const camp = objects.get(c.meta_campaign_id);
  const base = { campaign_id: c.campaign_id };
  if (!camp || camp.status === null || GONE.has(camp.status)) {
    // An archived campaign of ours that Meta also archived or deleted is the same fact twice, not a mismatch.
    if (c.state !== "archived") out.push(mismatch({ ...base, level: "campaign", meta_id: c.meta_campaign_id, field: "missing", ours: c.state, theirs: camp?.status ?? null, severity: "warning" }));
    return out;
  }
  if (!IN_FLIGHT.includes(c.state)) {
    const want = c.state === "live" ? "ACTIVE" : "PAUSED";
    if (camp.status !== want) {
      out.push(mismatch({ ...base, level: "campaign", meta_id: camp.id, field: "status", ours: want, theirs: camp.status, severity: camp.status === "ACTIVE" ? "critical" : "warning" }));
    }
  }
  if (c.lifetime_cap_cents !== null && camp.amount_cents !== c.lifetime_cap_cents) {
    const looser = camp.amount_cents === null || camp.amount_cents > c.lifetime_cap_cents;
    out.push(mismatch({ ...base, level: "campaign", meta_id: camp.id, field: "spend_cap", ours: c.lifetime_cap_cents, theirs: camp.amount_cents, severity: looser ? "critical" : "warning" }));
  }
  if (c.lifetime_cap_cents !== null && c.lifetime_spend_cents > c.lifetime_cap_cents) {
    // Keyed on the cap, not the spend: an overrun is one fact however far past it the spend climbs.
    out.push({ ...mismatch({ ...base, level: "campaign", meta_id: camp.id, field: "overrun", ours: c.lifetime_cap_cents, theirs: c.lifetime_spend_cents, severity: "critical" }), key: `campaign:${camp.id}:overrun:${c.lifetime_cap_cents}` });
  }
  if (c.meta_adset_id) {
    const set = objects.get(c.meta_adset_id);
    if (!set || set.status === null || GONE.has(set.status)) {
      if (c.state !== "archived") out.push(mismatch({ ...base, level: "adset", meta_id: c.meta_adset_id, field: "missing", ours: c.state, theirs: set?.status ?? null, severity: "warning" }));
      return out;
    }
    // A pause stops the campaign alone (metaAdapter header), so the ad set's status is only owed while live.
    if (c.state === "live" && set.status !== "ACTIVE") {
      out.push(mismatch({ ...base, level: "adset", meta_id: set.id, field: "status", ours: "ACTIVE", theirs: set.status, severity: "warning" }));
    }
    if (c.daily_budget_cents !== null && set.amount_cents !== c.daily_budget_cents) {
      const looser = set.amount_cents === null || set.amount_cents > c.daily_budget_cents;
      out.push(mismatch({ ...base, level: "adset", meta_id: set.id, field: "daily_budget", ours: c.daily_budget_cents, theirs: set.amount_cents, severity: looser ? "critical" : "warning" }));
    }
  }
  return out;
}

export function reconcile(input: ReconcileInput): ReconcileMismatch[] {
  const out = input.ours.flatMap((c) => checkOne(c, input.objects));
  const recorded = new Set(input.ours.map((c) => c.meta_campaign_id));
  for (const k of input.account_campaigns) {
    if (recorded.has(k.id) || k.status === null || GONE.has(k.status)) continue;
    // A name that parses as ours with no row of ours (a create whose record was lost) is still not adopted:
    // it is reported, marked so a person can tell it from a stranger's campaign.
    const parsed = k.name ? parseAdName(k.name) : null;
    out.push(mismatch({
      campaign_id: null, level: "campaign", meta_id: k.id, field: "not_ours", ours: parsed ? "ours_by_name_unrecorded" : null,
      theirs: k.status, severity: k.status === "ACTIVE" ? "critical" : "warning",
    }));
  }
  return out;
}
