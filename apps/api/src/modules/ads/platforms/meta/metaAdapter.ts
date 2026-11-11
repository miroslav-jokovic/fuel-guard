import { adAreaSchema, type AdArea } from "@silvicom/shared";
import { NOT_ON_PLATFORM, type LaunchCall, type PlatformAdapter, type PlatformCampaignRef, type PlatformOutcome, type SpendCall } from "../adapter.js";
import type { GraphFailure, MetaGraph } from "./graphClient.js";
import { META_CUSTOM_LOCATION_MAX_MILES, META_EMPLOYMENT_MIN_MILES } from "./publisher.js";

/**
 * The Meta adapter (ADS-AGENT-BUILD-WORKFLOW.md B3): the two halves `adapter.ts` defines, over
 * `MetaGraph`. The safe half (read the account limit, pause) is handed to the orchestrator as it is;
 * the spend half (launch, raise, widen) only to `guard/budgetGuard.ts`, through `guardPlatform`.
 *
 * ── THE CAMPAIGN IS THE MASTER SWITCH ────────────────────────────────────────────────────────────
 * Delivery needs the campaign, the ad set and an ad all ACTIVE; any one PAUSED stops it. So:
 *   · pause = the campaign to PAUSED, alone. One call, idempotent at Meta (pausing a paused campaign
 *     succeeds), the fewest things that can fail on the kill switch's path.
 *   · launch = the amounts first (ad set `daily_budget`, campaign `spend_cap`), then the ads and the ad
 *     set ACTIVE, and the campaign ACTIVE LAST. A failure anywhere before that last call leaves the
 *     campaign paused, so a half-done launch delivers nothing. Every write here SETS a value, so
 *     `MetaGraph` may retry it (`idempotent: true`): twice is once.
 * Each launch and pause reads the campaign back and answers from what Meta says, not from the 200.
 *
 * The amounts are the APPROVED ones the guard passes (`SpendCall`), never the campaign row's: the
 * approval is what a person agreed to, and it is what the guard measured against the caps.
 *
 * `platform_refs` carry the ids the publisher recorded: `meta_campaign_id`, `meta_adset_id` (B2a),
 * `meta_ad_ids` (B2c). A launch with no ad is refused: an ACTIVE campaign with no ad spends nothing
 * and tells the owner it is running. A launch turns on only the ads the guard does not name as retired
 * (`LaunchCall.retired_ad_ids`, CQ9b), so a pause and relaunch never revives a tired ad.
 */

type Write = Record<string, string | number | Record<string, unknown>>;

export interface MetaAdapterDeps {
  graph: MetaGraph;
  accountId: string;
}

interface Refs {
  campaign: string;
  adset: string;
  ads: string[];
}

function refs(c: PlatformCampaignRef, needAds: boolean): Refs | PlatformOutcome {
  const r = c.platform_refs;
  const campaign = typeof r.meta_campaign_id === "string" ? r.meta_campaign_id : null;
  const adset = typeof r.meta_adset_id === "string" ? r.meta_adset_id : null;
  const ads = Array.isArray(r.meta_ad_ids) ? r.meta_ad_ids.filter((x): x is string => typeof x === "string") : [];
  if (!campaign || !adset) return { ok: false, error_code: NOT_ON_PLATFORM };
  if (needAds && ads.length === 0) return { ok: false, error_code: "no_ad_on_platform" };
  return { campaign, adset, ads };
}

const isRefs = (x: Refs | PlatformOutcome): x is Refs => "campaign" in x;

const fail = (f: GraphFailure, step: string): PlatformOutcome => ({
  ok: false, error_code: f.error_code, response: { step, kind: f.kind, code: f.code, subcode: f.subcode, fbtrace_id: f.fbtrace_id, message: f.message },
});

export function metaAdapter(deps: MetaAdapterDeps): PlatformAdapter {
  const { graph } = deps;
  const set = (id: string, params: Write) => graph.post<{ success?: boolean }>(id, params, { idempotent: true });

  /** One write after another; the first failure stops the rest and names its step. */
  async function steps(list: Array<[string, string, Write]>): Promise<PlatformOutcome | null> {
    for (const [step, id, params] of list) {
      const r = await set(id, params);
      if (!r.ok) return fail(r.error, step);
    }
    return null;
  }

  async function statusOf(id: string): Promise<{ ok: true; status: string; effective: string } | { ok: false; outcome: PlatformOutcome }> {
    const r = await graph.get<{ status?: string; effective_status?: string }>(id, { fields: "status,effective_status" });
    if (!r.ok) return { ok: false, outcome: fail(r.error, "read_back") };
    return { ok: true, status: String(r.data.status ?? ""), effective: String(r.data.effective_status ?? "") };
  }

  return {
    safe: {
      async readAccountHeadroomCents() {
        const r = await graph.get<{ spend_cap?: string; amount_spent?: string }>(`act_${deps.accountId}`, { fields: "spend_cap,amount_spent" });
        if (!r.ok) return null;
        // Meta's own rule: "0" is no limit — which the guard must read as unknown, never as unlimited.
        // Both are cents, and both are lifetime totals: what is left is the difference (adapter.ts).
        const cap = Number(r.data.spend_cap);
        const spent = Number(r.data.amount_spent);
        if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(spent) || spent < 0) return null;
        return Math.max(0, cap - spent);
      },

      async readSpendCents({ since, until }) {
        // Insights `spend` is the account currency's MAJOR unit as a decimal string — unlike the
        // account's `spend_cap` and `amount_spent`, which are cents. `data: []` means nothing was spent.
        const r = await graph.get<{ data?: Array<{ spend?: string }> }>(`act_${deps.accountId}/insights`, {
          fields: "spend", level: "account", time_range: JSON.stringify({ since, until }),
        });
        if (!r.ok || !Array.isArray(r.data.data)) return null;
        const row = r.data.data[0];
        if (!row) return 0;
        const units = Number(row.spend);
        return Number.isFinite(units) && units >= 0 ? Math.round(units * 100) : null;
      },

      async pause({ campaign }) {
        const ids = refs(campaign, false);
        if (!isRefs(ids)) return ids;
        const failed = await steps([["campaign_paused", ids.campaign, { status: "PAUSED" }]]);
        if (failed) return failed;
        const back = await statusOf(ids.campaign);
        if (!back.ok) return back.outcome;
        return back.status === "PAUSED" ? { ok: true, response: { status: back.status, effective_status: back.effective } } : { ok: false, error_code: "pause_not_applied", response: back };
      },

      // CQ9: one ad PAUSED, read back like the campaign's pause; an ad id the campaign's refs do not hold is refused
      // before any call — this adapter pauses only what this campaign made.
      async pauseAd({ campaign, ad }) {
        const ids = refs(campaign, false);
        if (!isRefs(ids)) return ids;
        if (!ids.ads.includes(ad)) return { ok: false, error_code: "ad_not_in_campaign", response: { ad } };
        const failed = await steps([["ad_paused", ad, { status: "PAUSED" }]]);
        if (failed) return failed;
        const back = await statusOf(ad);
        if (!back.ok) return back.outcome;
        return back.status === "PAUSED" ? { ok: true, response: { ad, status: back.status, effective_status: back.effective } } : { ok: false, error_code: "pause_not_applied", response: back };
      },

      // Q-AD68: a retired ad's approved replacement turned ACTIVE, read back the same way. Only an ad this campaign's
      // refs hold — the refresh step adds the new ads to the refs before it asks — and nothing else is written: not the
      // ad set's budget, not the campaign's cap, not the campaign's status.
      async activateAd({ campaign, ad }) {
        const ids = refs(campaign, false);
        if (!isRefs(ids)) return ids;
        if (!ids.ads.includes(ad)) return { ok: false, error_code: "ad_not_in_campaign", response: { ad } };
        const failed = await steps([["ad_active", ad, { status: "ACTIVE" }]]);
        if (failed) return failed;
        const back = await statusOf(ad);
        if (!back.ok) return back.outcome;
        return back.status === "ACTIVE" ? { ok: true, response: { ad, status: back.status, effective_status: back.effective } } : { ok: false, error_code: "activate_not_applied", response: back };
      },
    },

    spend: {
      async launch(call: LaunchCall) {
        const ids = refs(call.campaign, true);
        if (!isRefs(ids)) return ids;
        // Only the ads the monitor has not retired (CQ9b): a retired ad stays PAUSED through a pause and relaunch.
        // Every ad retired = nothing to deliver, refused before any write, as a launch with no ad is.
        const retired = new Set(call.retired_ad_ids);
        const live = ids.ads.filter((ad) => !retired.has(ad));
        if (live.length === 0) return { ok: false, error_code: "every_ad_retired", response: { retired: [...retired] } };
        const failed = await steps([
          ["adset_budget", ids.adset, { daily_budget: call.daily_budget_cents }],
          ["campaign_cap", ids.campaign, { spend_cap: call.lifetime_cap_cents }],
          ...live.map((ad): [string, string, Write] => ["ad_active", ad, { status: "ACTIVE" }]),
          ["adset_active", ids.adset, { status: "ACTIVE" }],
          ["campaign_active", ids.campaign, { status: "ACTIVE" }],
        ]);
        if (failed) return failed;
        const back = await statusOf(ids.campaign);
        if (!back.ok) return back.outcome;
        return back.status === "ACTIVE"
          ? { ok: true, platform_refs: { meta_launched_status: back.effective }, response: { status: back.status, effective_status: back.effective } }
          : { ok: false, error_code: "launch_not_applied", response: back };
      },

      async raiseDailyBudget(call: SpendCall) {
        const ids = refs(call.campaign, false);
        if (!isRefs(ids)) return ids;
        return (await steps([["adset_budget", ids.adset, { daily_budget: call.daily_budget_cents }]])) ?? { ok: true };
      },

      async changeArea({ campaign, area }: { campaign: PlatformCampaignRef; area: AdArea }) {
        const ids = refs(campaign, false);
        if (!isRefs(ids)) return ids;
        if (!adAreaSchema.safeParse(area).success || area.radius_miles < META_EMPLOYMENT_MIN_MILES || area.radius_miles > META_CUSTOM_LOCATION_MAX_MILES) {
          return { ok: false, error_code: "area_outside_meta_limits" };
        }
        const targeting = { geo_locations: { custom_locations: [{ latitude: area.latitude, longitude: area.longitude, radius: area.radius_miles, distance_unit: "mile" }] } };
        return (await steps([["adset_area", ids.adset, { targeting }]])) ?? { ok: true };
      },
    },
  };
}
