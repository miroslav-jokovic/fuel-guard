import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AD_NAME_ALL_PRESETS, AD_NAME_LANGUAGES, adAreaSchema, buildAdName, DEFAULT_ORG_TIMEZONE, metaLeadFormQuestions, shortId, todayInZone,
  type AdArea, type AdNameLanguage, type AdNameLevel, type MetaFormLocale,
} from "@silvicom/shared";
import { completeAction, recordFinished, startAction, type ActionRow } from "../../actions/actionLedger.js";
import type { PlatformOutcome } from "../adapter.js";
import type { GraphFailure, GraphResult, MetaGraph } from "./graphClient.js";
import { creativeRefusal, publishAds, type PublishCreative, type PublishedAd } from "./publisherAds.js";

/**
 * The Meta publisher (ADS-AGENT-BUILD-WORKFLOW.md B2a + B2b + B2c): put a campaign and its ad set on the
 * ad account, PAUSED (B2a), the Instant Forms the ads open on the Page — one per language (B2b, B2c) —
 * and, for every approved creative in every language, its image, ad creative and ad, PAUSED
 * (`publisherAds.ts`, B2c). A form is made with the PAGE's token (`pageGraph`), not the system user's.
 *
 * ── HOW IT IS CALLED ─────────────────────────────────────────────────────────────────────────────
 * `publishCampaign.ts` reads our rows into a `PublishInput` and is the orchestrator's `createPaused`
 * (B2c2). It was wired only after lead intake learned to find a campaign by EVERY language's form
 * (`leads/formRefs.ts`): a campaign has a form per language (`meta_form_ids`), and intake reading one
 * would have lost each Spanish lead.
 *
 * ── RESUME, NEVER DUPLICATE ──────────────────────────────────────────────────────────────────────
 * Meta takes no idempotency key on a create, and `MetaGraph` never re-sends one whose answer was lost
 * (`outcome_unknown`). So every level is: READ the parent for our exact name (`naming.ts` makes it a
 * pure function of the campaign row) → one found = take its id, no create; none = create; two or more
 * = refuse (someone duplicated it; picking one would be a guess). A create whose outcome is unknown
 * reads once more: found = resumed, not found = the step fails `create_outcome_unknown` and the
 * campaign goes to `failed`. A person's Resume starts a new stint, whose first read finds the object
 * if Meta did make it late. Nothing in this file can send a second create for one name in one stint.
 *
 * ── WHAT A CAMPAIGN MAY ASK META FOR ─────────────────────────────────────────────────────────────
 * The builders below take no age, gender, ZIP or exclusion input: the types have no field for one, so
 * no caller can pass it (D-AD1; Special Ad Category page: employment audiences are "enforced with a hard
 * error", 2909035). The area is a pin and a radius, 15–50 miles: 15 is Meta's employment floor in the US,
 * 50 the most a custom location takes (Basic Targeting). Our `adAreaSchema` allows 500, for platforms
 * that take more, so this adapter refuses beyond 50 itself and says so before calling Meta.
 *
 * Every create and every adoption of a found object is an `ads_actions` row (`create_paused`), started
 * before the call and completed after, keyed per stint and level, so a delivered-twice job finds the
 * first row. A refusal before any call is a row too: a refusal nobody can see is one nobody trusts.
 */

/** Meta's floor for employment ads in the US, and the custom-location ceiling. Read 2026-11-02. */
export const META_EMPLOYMENT_MIN_MILES = 15;
export const META_CUSTOM_LOCATION_MAX_MILES = 50;
/** Meta refuses a campaign `spend_cap` under $100 (Ad Campaign reference). */
export const META_SPEND_CAP_MIN_CENTS = 10_000;

export interface PublishInput {
  orgId: string;
  campaignId: string;
  connectionId: string;
  /** The connection's ad account (no `act_` prefix) and Page. */
  accountId: string;
  pageId: string;
  /** `simulator` connections name their objects SIM, so a simulated object never reads as a real one. */
  platform: "meta" | "simulator";
  brief_source: string;
  brief_ref: string;
  /** The campaign row's `created_at`: the name's day, in the org's zone — the same on every attempt. */
  created_at: string;
  area: AdArea;
  daily_budget_cents: number | null;
  lifetime_cap_cents: number | null;
  /** The brief's form question keys (`metaLeadForm.ts` catalogue), asked in every language's form. */
  form_questions: readonly string[];
  /** The campaign's APPROVED creatives (D-AD12: a person approved each); each becomes an ad per language. */
  creatives: readonly PublishCreative[];
  /** The production web host's `/privacy` page (V7 checks its wording for Meta's review). */
  privacy_url: string;
  /** The runner's `<campaign id>:<stint>` key. */
  key: string;
}

export interface PublisherDeps {
  admin: SupabaseClient;
  graph: MetaGraph;
  /** The same connection, with the Page's token (`registry.pageGraphForConnection`). */
  pageGraph: MetaGraph;
  /** A creative's stored image by hash (`brandAssets.readAdAsset`, which checks the bytes' hash). */
  readAsset: (orgId: string, ref: { sha256: string; format: "png" }) => Promise<Buffer>;
  now: () => Date;
}

export const PUBLISHER = { actor_kind: "agent" as const, actor_id: null, actor_name: "Ads publisher (Meta)" };

/** What the campaign row will hold: `meta_ad_ids` is what launch turns on (`metaAdapter.ts`). */
export interface PublishedRefs {
  meta_campaign_id: string;
  meta_adset_id: string;
  meta_form_ids: Record<AdNameLanguage, string>;
  meta_ad_ids: string[];
  ads: PublishedAd[];
}
export type PublishOutcome = (Extract<PlatformOutcome, { ok: true }> & { platform_refs: PublishedRefs }) | Extract<PlatformOutcome, { ok: false }>;

export async function publishPaused(deps: PublisherDeps, input: PublishInput): Promise<PublishOutcome> {
  const refusal = preflight(input);
  if (refusal) {
    await recordFinished(deps.admin, row(input, "campaign", { refused_before_call: true }), { status: "refused", error_code: refusal, at: deps.now().toISOString() });
    return { ok: false, error_code: refusal };
  }
  const campaignName = nameFor(input, "campaign");
  const campaign = await ensure(deps, input, "campaign", {
    find: () => deps.graph.get<Listing>(`act_${input.accountId}/campaigns`, byName(campaignName, CAMPAIGN_FIELDS)),
    readBack: (id) => deps.graph.get<Found>(id, { fields: CAMPAIGN_FIELDS }),
    create: () => deps.graph.post<{ id: string }>(`act_${input.accountId}/campaigns`, campaignParams(input, campaignName), { idempotent: false }),
    expect: { name: campaignName, status: "PAUSED", spend_cap: String(input.lifetime_cap_cents) },
    expectCategory: true,
  });
  if (!campaign.ok) return campaign;

  const adsetName = nameFor(input, "adset");
  const adset = await ensure(deps, input, "adset", {
    find: () => deps.graph.get<Listing>(`${campaign.id}/adsets`, byName(adsetName, ADSET_FIELDS)),
    readBack: (id) => deps.graph.get<Found>(id, { fields: ADSET_FIELDS }),
    create: () => deps.graph.post<{ id: string }>(`act_${input.accountId}/adsets`, adSetParams(input, adsetName, campaign.id), { idempotent: false }),
    expect: { name: adsetName, status: "PAUSED", daily_budget: String(input.daily_budget_cents) },
    expectCategory: false,
  });
  if (!adset.ok) return adset;

  // A form per language: a Spanish ad opens a Spanish form. The form is the Page's, so it is found on the
  // Page by name. The Page edge takes no `filtering` (the reference documents none), so the publisher
  // pages through and compares names itself.
  const forms = {} as Record<AdNameLanguage, string>;
  for (const language of AD_NAME_LANGUAGES) {
    const formName = nameFor(input, "form", language);
    const spec = formParams(input, formName, language);
    const form = await ensure(deps, input, `form:${language}`, {
      find: () => formsNamed(deps.pageGraph, input.pageId, formName),
      readBack: (id) => deps.pageGraph.get<Found>(id, { fields: FORM_FIELDS }),
      create: () => deps.pageGraph.post<{ id: string }>(`${input.pageId}/leadgen_forms`, spec, { idempotent: false }),
      expect: { name: formName, status: "ACTIVE", privacy_policy_url: input.privacy_url, locale: spec.locale },
      expectCategory: false,
      verify: (o) => (sameQuestions(o.questions, spec.questions) ? [] : ["questions"]),
      ref: "meta_form_id",
    });
    if (!form.ok) return form;
    forms[language] = form.id;
  }

  const ads = await publishAds(deps, input, { adsetId: adset.id, forms });
  if (!ads.ok) return ads;
  return { ok: true, platform_refs: { meta_campaign_id: campaign.id, meta_adset_id: adset.id, meta_form_ids: forms, meta_ad_ids: ads.ads.map((a) => a.meta_ad_id), ads: ads.ads } };
}

// ── the builders: what we send, and nothing a campaign could target people by ─────────────────────

export function campaignParams(input: Pick<PublishInput, "lifetime_cap_cents">, name: string) {
  return {
    name,
    objective: "OUTCOME_LEADS",
    buying_type: "AUCTION",
    status: "PAUSED",
    special_ad_categories: ["EMPLOYMENT"],
    special_ad_category_country: ["US"],
    spend_cap: input.lifetime_cap_cents,
  };
}

export function adSetParams(input: Pick<PublishInput, "area" | "daily_budget_cents" | "pageId">, name: string, campaignId: string) {
  return {
    name,
    campaign_id: campaignId,
    status: "PAUSED",
    daily_budget: input.daily_budget_cents,
    billing_event: "IMPRESSIONS",
    optimization_goal: "LEAD_GENERATION",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    // Instant Forms: the lead is captured on Meta (D-AD5; the form itself is B2b).
    destination_type: "ON_AD",
    promoted_object: { page_id: input.pageId },
    targeting: {
      geo_locations: {
        custom_locations: [{ latitude: input.area.latitude, longitude: input.area.longitude, radius: input.area.radius_miles, distance_unit: "mile" }],
      },
    },
  };
}

export function formParams(input: Pick<PublishInput, "form_questions" | "privacy_url">, name: string, locale: MetaFormLocale) {
  const built = metaLeadFormQuestions(input.form_questions, locale);
  if (!built.ok) throw new Error(`formParams: refused ${built.refused.join(", ")} — preflight should have said so`);
  return {
    name,
    locale: built.locale,
    questions: built.questions,
    privacy_policy: { url: input.privacy_url, link_text: locale === "es" ? "Política de privacidad" : "Privacy policy" },
    // The form opens only from our ad, never as an organic post on the Page.
    block_display_for_non_targeted_viewer: true,
  };
}

type NameInput = Pick<PublishInput, "platform" | "brief_source" | "brief_ref" | "created_at" | "campaignId">;

/** A campaign's, ad set's or (with its language) form's name. */
export function nameFor(input: NameInput, level: Exclude<AdNameLevel, "ad">, language?: AdNameLanguage): string {
  return buildAdName({
    platform: input.platform, level, brief_source: input.brief_source, brief_ref: input.brief_ref,
    preset_key: AD_NAME_ALL_PRESETS, day: todayInZone(new Date(input.created_at), DEFAULT_ORG_TIMEZONE), campaign_short: shortId(input.campaignId),
    ...(language ? { language } : {}),
  });
}

/** One ad's name: its creative's preset and short id, and its language. */
export function adNameFor(input: NameInput, creative: Pick<PublishCreative, "id" | "preset_key">, language: AdNameLanguage): string {
  return buildAdName({
    platform: input.platform, level: "ad", brief_source: input.brief_source, brief_ref: input.brief_ref, preset_key: creative.preset_key,
    day: todayInZone(new Date(input.created_at), DEFAULT_ORG_TIMEZONE), campaign_short: shortId(input.campaignId), creative_short: shortId(creative.id), language,
  });
}

/** Everything that would make Meta refuse — or let through what we must not send — said before a call. */
export function preflight(input: PublishInput): string | null {
  if (input.daily_budget_cents === null || input.lifetime_cap_cents === null) return "budget_unset";
  if (input.lifetime_cap_cents < META_SPEND_CAP_MIN_CENTS) return "spend_cap_below_meta_minimum";
  if (!adAreaSchema.safeParse(input.area).success) return "area_invalid";
  if (input.area.radius_miles < META_EMPLOYMENT_MIN_MILES || input.area.radius_miles > META_CUSTOM_LOCATION_MAX_MILES) return "area_outside_meta_limits";
  if (!input.accountId || !input.pageId) return "connection_incomplete";
  if (AD_NAME_LANGUAGES.some((l) => !metaLeadFormQuestions(input.form_questions, l).ok)) return "form_question_not_allowed";
  if (!/^https:\/\/[^/]+\/privacy$/.test(input.privacy_url)) return "privacy_url_not_https";
  // Nothing approved = nothing to launch, so nothing is made: a campaign with no ad is a false `paused`.
  if (input.creatives.length === 0) return "no_approved_creative";
  for (const c of input.creatives) {
    const refused = creativeRefusal(c);
    if (refused) return refused;
  }
  return null;
}

// ── one level: read, adopt or create, read back ──────────────────────────────────────────────────

export type Listing = { data: Array<Record<string, unknown> & { id: string }> };
const CAMPAIGN_FIELDS = "id,name,status,special_ad_categories,special_ad_category_country,spend_cap";
const ADSET_FIELDS = "id,name,status,daily_budget,campaign_id,targeting";
const FORM_FIELDS = "id,name,status,locale,questions,privacy_policy_url";
const FORM_PAGES_MAX = 10;

/** The Page's forms carrying this name, as a `Listing` — `ensure` then reads it like any level. */
async function formsNamed(pageGraph: MetaGraph, pageId: string, name: string): Promise<GraphResult<Listing>> {
  const hits: Listing["data"] = [];
  let after: string | undefined;
  for (let page = 0; page < FORM_PAGES_MAX; page++) {
    const r = await pageGraph.get<Listing & { paging?: { cursors?: { after?: string }; next?: string } }>(`${pageId}/leadgen_forms`, { fields: FORM_FIELDS, limit: 100, after });
    if (!r.ok) return r;
    hits.push(...(r.data.data ?? []).filter((f) => f.name === name));
    after = r.data.paging?.next ? r.data.paging.cursors?.after : undefined;
    if (!after) return { ok: true, data: { data: hits }, usage: r.usage, attempts: r.attempts };
  }
  // More than a thousand forms on one Page: an unread page could hold ours, so a create could duplicate.
  return { ok: false, error: { kind: "invalid_request", error_code: "form_list_too_long", http: null, code: null, subcode: null, fbtrace_id: null, message: `more than ${FORM_PAGES_MAX * 100} forms on the Page`, retry_after_ms: null, outcome_unknown: false, attempts: 1 } };
}

/** The form Meta holds asks exactly our questions, in our order, with our option keys. */
function sameQuestions(got: unknown, want: Array<{ type: string; key: string; options?: Array<{ key: string }> }>): boolean {
  if (!Array.isArray(got) || got.length !== want.length) return false;
  return want.every((q, i) => {
    const g = got[i] as { type?: unknown; key?: unknown; options?: Array<{ key?: unknown }> };
    return g.type === q.type && g.key === q.key && JSON.stringify((g.options ?? []).map((o) => o.key)) === JSON.stringify((q.options ?? []).map((o) => o.key));
  });
}
export type Found = Record<string, unknown> & { id: string };

export interface Level {
  find: () => Promise<GraphResult<Listing>>;
  create: () => Promise<GraphResult<{ id: string }>>;
  /** By id, not by name: a list read may lag a create; the object itself does not. */
  readBack: (id: string) => Promise<GraphResult<Found>>;
  /** Fields the object must carry, read back after the create (workflow B2: "read back and compared"). */
  expect: Record<string, string>;
  expectCategory: boolean;
  /** Any further comparison a level needs (the form's questions); returns the wrong field names. */
  verify?: (object: Found) => string[];
  /** The ledger row's `platform_refs` key; default `meta_<level>_id`. */
  ref?: string;
  /** The creative an ad level is for, on its ledger row. */
  creativeId?: string;
}

export type Ensured = { ok: true; id: string } | { ok: false; error_code: string; response?: unknown };

export const byName = (name: string, fields: string) => ({ fields, filtering: [{ field: "name", operator: "EQUAL", value: name }], limit: 5 });

/**
 * One level, keyed in the ledger by `level`: `campaign`, `adset`, `form:<lang>`, and per creative
 * `creative:<short>:<lang>` / `ad:<short>:<lang>` (`publisherAds.ts`).
 */
export async function ensure(deps: PublisherDeps, input: PublishInput, level: string, l: Level): Promise<Ensured> {
  const found = await lookup(l);
  if (!found.ok) return found;
  const refKey = l.ref ?? `meta_${level}_id`;
  const base = row(input, level, { name: l.expect.name }, l.creativeId);
  const started = await startAction(deps.admin, base, deps.now().toISOString());
  if (started !== "duplicate" && "refusedBy" in started) return { ok: false, error_code: started.refusedBy };

  if (started === "duplicate") {
    // An earlier delivery of this step started this level in this stint. Its create may have landed.
    const prior = await priorRow(deps.admin, input.orgId, base.idempotency_key!);
    if (found.object) {
      if (prior.status === "started") await completeAction(deps.admin, input.orgId, prior.id, { status: "succeeded", response: { resumed: true }, platform_refs: { [refKey]: found.object.id }, at: deps.now().toISOString() });
      return checked(found.object, l);
    }
    return { ok: false, error_code: prior.status === "failed" ? (prior.error_code ?? "create_failed") : "create_outcome_unknown" };
  }

  const done = (status: "succeeded" | "failed", extra: { error_code?: string; response?: unknown; id?: string }) =>
    completeAction(deps.admin, input.orgId, started.id, {
      status, error_code: extra.error_code ?? null, response: extra.response ?? null,
      platform_refs: extra.id ? { [refKey]: extra.id } : null, at: deps.now().toISOString(),
    });

  if (found.object) {
    const verdict = checked(found.object, l);
    await done(verdict.ok ? "succeeded" : "failed", verdict.ok ? { id: found.object.id, response: { adopted: true } } : { error_code: verdict.error_code, response: verdict.response });
    return verdict;
  }

  const created = await l.create();
  if (created.ok) {
    const back = await l.readBack(created.data.id);
    const verdict: Ensured = back.ok ? checked(back.data, l) : { ok: false, error_code: `readback_${back.error.error_code}` };
    await done(verdict.ok ? "succeeded" : "failed", verdict.ok ? { id: created.data.id } : { error_code: verdict.error_code, id: created.data.id, response: "response" in verdict ? verdict.response : undefined });
    return verdict;
  }
  if (created.error.outcome_unknown) {
    const again = await lookup(l);
    if (again.ok && again.object) {
      const verdict = checked(again.object, l);
      await done(verdict.ok ? "succeeded" : "failed", verdict.ok ? { id: again.object.id, response: { resumed: true } } : { error_code: verdict.error_code });
      return verdict;
    }
    await done("failed", { error_code: "create_outcome_unknown", response: failureBody(created.error) });
    return { ok: false, error_code: "create_outcome_unknown" };
  }
  await done("failed", { error_code: created.error.error_code, response: failureBody(created.error) });
  return { ok: false, error_code: created.error.error_code, response: failureBody(created.error) };
}

async function lookup(l: Level): Promise<{ ok: true; object: Found | null } | { ok: false; error_code: string; response?: unknown }> {
  const r = await l.find();
  if (!r.ok) return { ok: false, error_code: r.error.error_code, response: failureBody(r.error) };
  const rows = r.data?.data ?? [];
  if (rows.length > 1) return { ok: false, error_code: "duplicate_on_platform", response: { ids: rows.map((x) => x.id) } };
  return { ok: true, object: rows[0] ?? null };
}

/** The object must be what we would have sent: paused, ours, employment, the amounts we set. */
function checked(object: Found, l: Level): Ensured {
  const wrong = Object.entries(l.expect).filter(([k, v]) => String(object[k] ?? "") !== v).map(([k]) => k);
  if (l.expectCategory) {
    const cats = object.special_ad_categories;
    if (!Array.isArray(cats) || !cats.includes("EMPLOYMENT")) wrong.push("special_ad_categories");
  }
  wrong.push(...(l.verify?.(object) ?? []));
  const statusWrong = wrong.includes("status");
  if (wrong.length) return { ok: false, error_code: statusWrong ? (l.expect.status === "PAUSED" ? "found_not_paused" : "found_wrong_status") : "readback_mismatch", response: { id: object.id, fields: wrong } };
  return { ok: true, id: object.id };
}

function row(input: PublishInput, level: string, request: Record<string, unknown>, creativeId?: string): ActionRow {
  return {
    org_id: input.orgId, campaign_id: input.campaignId, creative_id: creativeId ?? null, connection_id: input.connectionId, kind: "create_paused",
    ...PUBLISHER, idempotency_key: `create_paused:${input.key}:${level}`, request: { level, ...request },
  };
}

async function priorRow(admin: SupabaseClient, orgId: string, key: string): Promise<{ id: string; status: string; error_code: string | null }> {
  const { data, error } = await admin.from("ads_actions").select("id, status, error_code").eq("org_id", orgId).eq("idempotency_key", key).maybeSingle();
  if (error) throw new Error(`ads_actions: ${error.message}`);
  if (!data) throw new Error(`ads_actions: ${key} reported duplicate and cannot be read`);
  return data as { id: string; status: string; error_code: string | null };
}

/** What a failure leaves in the ledger: Meta's classification and trace, never a token (graphClient scrubs). */
export const failureBody = (f: GraphFailure) => ({ kind: f.kind, code: f.code, subcode: f.subcode, fbtrace_id: f.fbtrace_id, message: f.message, attempts: f.attempts });
