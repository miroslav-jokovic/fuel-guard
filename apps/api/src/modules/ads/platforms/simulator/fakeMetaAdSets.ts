import type { FakeCampaign } from "./fakeMeta.js";
import { graphError, pick } from "./fakeMetaShapes.js";

/**
 * FakeMeta's ad sets (B2a) and ads (B3 changes their status; B2c will create them), apart from
 * `fakeMeta.ts` for the file budget. The shapes and Meta's employment rules are cited in
 * `fakeMeta.ts`'s header; updates follow the Ad Set reference: `POST /{id}` with `status`
 * (ACTIVE, PAUSED, DELETED, ARCHIVED), `daily_budget`, `targeting` → `{ success: true }`.
 * https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/
 */

type Answer = { status: number; body: unknown };
const STATUSES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"];

export interface FakeAdSet {
  id: string;
  account_id: string;
  campaign_id: string;
  name: string;
  status: FakeCampaign["status"];
  daily_budget: string;
  billing_event: string;
  optimization_goal: string;
  destination_type: string | null;
  promoted_object: Record<string, unknown> | null;
  targeting: Record<string, unknown>;
}

export interface FakeAd {
  id: string;
  adset_id: string;
  name: string;
  status: FakeCampaign["status"];
}

export class FakeAdSets {
  readonly adsets = new Map<string, FakeAdSet>();
  readonly ads = new Map<string, FakeAd>();

  constructor(
    private readonly ids: () => string,
    private readonly trace: () => string,
    private readonly campaign: (id: string) => FakeCampaign | undefined,
  ) {}

  /** `GET`/`POST /{id}` for an ad set or an ad; null when the id is neither (the caller routes on). */
  route(method: string, id: string, b: Record<string, string>): Answer | null {
    const row = this.adsets.get(id) ?? this.ads.get(id);
    if (!row) return null;
    if (method === "GET") return { status: 200, body: pick({ ...row, effective_status: row.status }, b.fields, ["id"]) };
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return graphError(400, 100, "OAuthException", "(#100) Invalid status", this.trace());
      row.status = b.status as FakeCampaign["status"];
    }
    if ("daily_budget" in row && b.daily_budget !== undefined) {
      if (!(Number(b.daily_budget) > 0)) return graphError(400, 100, "OAuthException", "(#100) daily_budget must be greater than 0", this.trace());
      row.daily_budget = b.daily_budget;
    }
    if ("targeting" in row && b.targeting !== undefined) row.targeting = JSON.parse(b.targeting) as Record<string, unknown>;
    return { status: 200, body: { success: true } };
  }

  create(accountId: string, b: Record<string, string>): Answer {
    const bad = (message: string, code = 100) => graphError(400, code, "OAuthException", `(#${code}) ${message}`, this.trace());
    const campaign = this.campaign(b.campaign_id ?? "");
    if (!campaign || campaign.account_id !== accountId) return bad("campaign_id is required and must belong to this ad account");
    if (!b.name || b.name.length > 400) return bad("name is required, at most 400 characters");
    if (!(Number(b.daily_budget) > 0)) return bad("Either daily_budget or lifetime_budget must be greater than 0");
    if (!b.billing_event || !b.optimization_goal) return bad("billing_event and optimization_goal are required");
    if (b.status !== "ACTIVE" && b.status !== "PAUSED") return bad("Only ACTIVE and PAUSED are valid during creation");
    const json = (k: string): Record<string, unknown> | null => {
      try {
        const v: unknown = b[k] === undefined ? null : JSON.parse(b[k]!);
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    const targeting = json("targeting");
    const promoted = json("promoted_object");
    if (!targeting) return bad("targeting is required");
    if (b.optimization_goal === "LEAD_GENERATION" && typeof promoted?.page_id !== "string") return bad("page_id needs to be passed as promoted_object");
    const locations = ((targeting.geo_locations as { custom_locations?: unknown } | undefined)?.custom_locations ?? []) as Array<Record<string, unknown>>;
    for (const l of locations) {
      const miles = Number(l.radius) * (l.distance_unit === "kilometer" ? 0.621371 : 1);
      if (!(miles >= 0.63 && miles <= 50)) return bad("custom_locations radius must be 0.63–50 miles");
    }
    if (campaign.special_ad_categories.includes("EMPLOYMENT")) {
      const forbidden = ["age_min", "age_max", "genders", "excluded_geo_locations", "flexible_spec", "exclusions"].filter((k) => k in targeting);
      const geo = (targeting.geo_locations ?? {}) as Record<string, unknown>;
      const geoForbidden = ["zips", "subcity", "neighborhood", "metro_area", "small_geo_area", "subneighborhood", "electoral_district"].filter((k) => k in geo);
      const tooSmall = locations.some((l) => Number(l.radius) * (l.distance_unit === "kilometer" ? 0.621371 : 1) < 15);
      if (forbidden.length || geoForbidden.length || tooSmall) {
        return bad(`Employment ads cannot use: ${[...forbidden, ...geoForbidden, ...(tooSmall ? ["radius under 15 miles"] : [])].join(", ")}`, 2909035);
      }
    }
    const id = this.ids();
    this.adsets.set(id, {
      id, account_id: accountId, campaign_id: campaign.id, name: b.name, status: b.status, daily_budget: b.daily_budget!,
      billing_event: b.billing_event, optimization_goal: b.optimization_goal, destination_type: b.destination_type ?? null,
      promoted_object: promoted, targeting,
    });
    return { status: 200, body: { id } };
  }
}
