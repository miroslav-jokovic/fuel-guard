import { adAreaSchema, type AdArea } from "@silvicom/shared";
import { NOT_ON_PLATFORM, type PlatformAdapter, type PlatformCampaignRef, type PlatformOutcome, type SpendCall } from "../adapter.js";
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
 * and tells the owner it is running.
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
      async readAccountLimitCents() {
        const r = await graph.get<{ spend_cap?: string }>(`act_${deps.accountId}`, { fields: "spend_cap" });
        if (!r.ok) return null;
        // Meta's own rule: "0" is no limit — which the guard must read as unknown, never as unlimited.
        const cents = Number(r.data.spend_cap);
        return Number.isFinite(cents) && cents > 0 ? cents : null;
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
    },

    spend: {
      async launch(call: SpendCall) {
        const ids = refs(call.campaign, true);
        if (!isRefs(ids)) return ids;
        const failed = await steps([
          ["adset_budget", ids.adset, { daily_budget: call.daily_budget_cents }],
          ["campaign_cap", ids.campaign, { spend_cap: call.lifetime_cap_cents }],
          ...ids.ads.map((ad): [string, string, Write] => ["ad_active", ad, { status: "ACTIVE" }]),
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
