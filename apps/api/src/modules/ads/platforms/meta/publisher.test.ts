import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { introLines, META_FORM_WORDS, parseAdName } from "@silvicom/shared";
import { expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { campaign, CONN, createAdsWorld, ORG, type AdsWorld } from "../../../../testing/adsWorld.js";
import { FakeMeta } from "../simulator/fakeMeta.js";
import { MetaGraph, resetGraphThrottles } from "./graphClient.js";
import { adNameFor, formParams, nameFor, publishPaused, type PublishInput } from "./publisher.js";
import type { PublishCreative } from "./publisherAds.js";

/**
 * The Meta publisher's first half (B2a) against FakeMeta over real HTTP and the stateful ads world.
 * L1: what it sends, and what it refuses before sending. L2 (§4R, Publisher row): 429/5xx/timeout on
 * each create step, a half-created campaign resumed and never duplicated, a revoked token, a crash
 * between a create and its ledger row, and the same step delivered twice at once. B2c: the forms per
 * language, and per approved creative and language its image, ad creative and ad.
 */
const TOKEN = "EAAB-publisher-token-0123456789";
const ACCOUNT = "2001";
const PAGE = "3001";
const CAMPAIGN = "ab12cd34-0000-4000-8000-000000000001";
const PAGE_TOKEN = "EAAB-page-token-9876543210";
const CREATIVE = "9f8e7d6c-0000-4000-8000-0000000000c1";

/** A PNG's first 24 bytes as FakeMeta reads them (signature, IHDR, width, height), then a tag. */
function png(width: number, height: number, tag: string): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.from(tag)]);
}
const STORE = new Map<string, Buffer>([
  ["a".repeat(64), png(1080, 1350, "en 4:5")], ["b".repeat(64), png(1080, 1350, "es 4:5")],
  ["c".repeat(64), png(1080, 1080, "en 1:1")], ["d".repeat(64), png(1080, 1920, "en 9:16")],
]);
const creative = (patch: Partial<PublishCreative> = {}): PublishCreative => ({
  id: CREATIVE, preset_key: "P2",
  copy: { en: { hook: "Home every weekend", cta: "Apply now", body: "Regional lanes out of Joliet.", title: "Class A drivers" },
          es: { hook: "En casa cada fin de semana", cta: "Aplica ya", body: "Rutas regionales desde Joliet.", title: "Choferes Clase A" } },
  assets: [
    { format: "4:5", language: "en", sha256: "a".repeat(64) }, { format: "4:5", language: "es", sha256: "b".repeat(64) },
    { format: "1:1", language: "en", sha256: "c".repeat(64) }, { format: "9:16", language: "en", sha256: "d".repeat(64) },
  ],
  platform_slots: { primary_text: "body", headline: "title" }, ...patch,
});

let meta: FakeMeta;
let base: string;
let w: AdsWorld;

beforeEach(async () => {
  resetGraphThrottles();
  meta = new FakeMeta({ token: TOKEN, accounts: [{ id: ACCOUNT, spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" }],
    pages: [{ id: PAGE, name: "Carrier Page", access_token: PAGE_TOKEN, tasks: ["ADVERTISE"] }] });
  base = await meta.start();
  w = createAdsWorld({ campaigns: [campaign(CAMPAIGN, "creating")] });
});
afterEach(() => meta.stop());

const input = (patch: Partial<PublishInput> = {}): PublishInput => ({
  orgId: ORG, campaignId: CAMPAIGN, connectionId: CONN, accountId: ACCOUNT, pageId: PAGE, platform: "meta",
  brief_source: "recruiting_opening", brief_ref: "op-1@v3", created_at: "2026-11-02T15:00:00Z",
  area: { label: "Joliet yard", latitude: 41.525, longitude: -88.0817, radius_miles: 25, reason: "Drivers report to the Joliet yard daily" },
  daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, key: `${CAMPAIGN}:stint-1`,
  claims: [{ kind: "money", cents: 62, per: "mile" }, { kind: "quantity", value: 23, unit: "age" }, { kind: "quantity", value: 2, unit: "year" }], form_questions: ["class_a_held", "class_a_years", "hazmat_endorsement"], creatives: [creative()], privacy_url: "https://app.silvicom360.com/privacy", ...patch,
});

const graph = (token = TOKEN) => new MetaGraph({ token, throttleKey: "conn-pub", baseUrl: base, timeoutMs: 300, sleep: async () => {} });
const readAsset = async (_org: string, ref: { sha256: string }) => {
  const b = STORE.get(ref.sha256);
  if (!b) throw new Error(`no asset ${ref.sha256}`);
  return b;
};
const publish = (patch: Partial<PublishInput> = {}) => publishPaused({ admin: w.admin, graph: graph(), pageGraph: graph(PAGE_TOKEN), readAsset, now: w.now }, input(patch));
const levels = () => creates().map((x) => (x.request as { level: string }).level);
const posts = (re: RegExp) => meta.requests.filter((r) => r.method === "POST" && re.test(r.path)).length;
const creates = () => w.actions.filter((a) => a.kind === "create_paused");

describe("Meta publisher (B2a) — what it sends", () => {
  it("creates a paused EMPLOYMENT campaign in the US with the spend cap, then a paused lead ad set on the Page, each read back", async () => {
    const r = await publish();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = meta.campaigns.get(r.platform_refs.meta_campaign_id)!;
    expect(c).toMatchObject({ status: "PAUSED", objective: "OUTCOME_LEADS", special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "50000" });
    const a = meta.adsets.get(r.platform_refs.meta_adset_id)!;
    expect(a).toMatchObject({ campaign_id: c.id, status: "PAUSED", daily_budget: "5000", optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: PAGE } });
    expect(levels()).toEqual(["campaign", "adset", "form:en", "form:es", "creative:9f8e7d6c:EN", "ad:9f8e7d6c:EN", "creative:9f8e7d6c:ES", "ad:9f8e7d6c:ES"]);
    expect(creates().every((x) => x.status === "succeeded")).toBe(true);
    expectOrgScoped(w.rec, ORG);
  });

  it("the ad set targets a pin and a radius and nothing else — no age, gender, ZIP or exclusion is ever sent", async () => {
    const r = await publish();
    if (!r.ok) throw new Error(r.error_code);
    const t = meta.adsets.get(r.platform_refs.meta_adset_id)!.targeting;
    expect(t).toEqual({ geo_locations: { custom_locations: [{ latitude: 41.525, longitude: -88.0817, radius: 25, distance_unit: "mile" }] } });
  });

  it("names come from naming.ts, the same on every attempt; a simulator connection's objects read SIM", async () => {
    const a = nameFor(input(), "campaign");
    expect(nameFor(input({ key: "other-stint" }), "campaign")).toBe(a);
    expect(parseAdName(a)).toMatchObject({ platform: "meta", level: "campaign", preset_key: "ALL", day: "2026-11-02", campaign_short: "ab12cd34" });
    expect(parseAdName(nameFor(input({ platform: "simulator" }), "adset"))).toMatchObject({ platform: "simulator", level: "adset" });
    // 03:00Z on the 3rd is still the 2nd in Chicago: the name's day is the org's, not UTC's.
    expect(parseAdName(nameFor(input({ created_at: "2026-11-03T03:00:00Z" }), "campaign"))?.day).toBe("2026-11-02");
  });

  it.each([
    ["budget_unset", { daily_budget_cents: null }],
    ["spend_cap_below_meta_minimum", { lifetime_cap_cents: 9_999 }],
    ["area_outside_meta_limits", { area: { ...input().area, radius_miles: 51 } }],
    ["area_invalid", { area: { ...input().area, radius_miles: 14 } }],
    ["connection_incomplete", { pageId: "" }],
    ["form_question_not_allowed", { form_questions: ["class_a_held", "date_of_birth"] }],
    ["privacy_url_not_https", { privacy_url: "http://app.silvicom360.com/privacy" }],
  ] as const)("refuses before calling Meta: %s — a refused row, and no request at all", async (code, patch) => {
    const r = await publish(patch as Partial<PublishInput>);
    expect(r).toEqual({ ok: false, error_code: code });
    expect(meta.requests).toHaveLength(0);
    expect(creates().map((x) => [x.status, x.error_code])).toEqual([["refused", code]]);
  });

  it("refuses before calling Meta when the form's intro would show a figure the claim checker cannot place (LQ1)", async () => {
    const r = await publish({ claims: [{ kind: "quantity", value: 1000, unit: "age" }] });
    expect(r).toEqual({ ok: false, error_code: "form_screens_refused" });
    expect(meta.requests).toHaveLength(0);
  });

  it("FakeMeta holds Meta's employment rules: age, gender or a radius under 15 miles is a hard 2909035", async () => {
    const g = graph();
    const c = await g.post<{ id: string }>(`act_${ACCOUNT}/campaigns`, { name: "x", status: "PAUSED", special_ad_categories: ["EMPLOYMENT"], spend_cap: 50_000 }, { idempotent: false });
    if (!c.ok) throw new Error("campaign");
    const adset = (targeting: Record<string, unknown>) => g.post(`act_${ACCOUNT}/adsets`, {
      name: "y", campaign_id: c.data.id, status: "PAUSED", daily_budget: 5_000, billing_event: "IMPRESSIONS",
      optimization_goal: "LEAD_GENERATION", promoted_object: { page_id: PAGE }, targeting,
    }, { idempotent: false });
    const geo = (radius: number) => ({ geo_locations: { custom_locations: [{ latitude: 41.5, longitude: -88, radius, distance_unit: "mile" }] } });
    for (const t of [{ ...geo(25), age_min: 23 }, { ...geo(25), genders: [1] }, geo(10)]) {
      const r = await adset(t);
      expect(r.ok ? null : r.error.error_code).toBe("meta_2909035");
    }
    expect((await adset(geo(25))).ok).toBe(true);
  });
});

describe("Meta publisher (B2a) — resume, never duplicate (§4R Publisher L2)", () => {
  it("a create Meta applied but answered 5xx is found by its name and taken, never sent twice", async () => {
    meta.inject("POST", /campaigns$/, { kind: "applied_then_temporary" });
    const r = await publish();
    expect(r.ok).toBe(true);
    expect(posts(/campaigns$/)).toBe(1);
    expect(meta.campaigns.size).toBe(1);
    expect(creates()[0]).toMatchObject({ status: "succeeded", response: { resumed: true } });
  });

  it("half-created (campaign yes, ad set no): the next attempt adopts the campaign and creates only the ad set", async () => {
    meta.inject("POST", /adsets$/, { kind: "hang" });
    const first = await publish();
    expect(first).toEqual({ ok: false, error_code: "create_outcome_unknown" });
    expect([meta.campaigns.size, meta.adsets.size]).toEqual([1, 0]);

    const second = await publish({ key: `${CAMPAIGN}:stint-2` });
    expect(second.ok).toBe(true);
    expect([meta.campaigns.size, meta.adsets.size]).toEqual([1, 1]);
    expect(posts(/campaigns$/)).toBe(1);
    const stint2 = creates().filter((a) => String(a.idempotency_key).includes("stint-2"));
    expect(stint2.map((a) => a.response)).toEqual([{ adopted: true }, ...Array(stint2.length - 1).fill(null)]);
  });

  it.each([
    ["the campaign create", /campaigns$/, [0, 0]],
    ["the ad set create", /adsets$/, [1, 0]],
  ] as const)("a 429 on %s stops the step as rate_limited and sends nothing after it", async (_label, path, sizes) => {
    meta.inject("POST", path, { kind: "throttle", regainMinutes: 3 });
    const r = await publish();
    expect(r).toMatchObject({ ok: false, error_code: "rate_limited" });
    expect([meta.campaigns.size, meta.adsets.size]).toEqual(sizes);
    expect(posts(/adsets$/)).toBe(path.source.includes("adsets") ? 1 : 0);
  });

  it.each([
    ["a timeout", { kind: "hang" } as const],
    ["a 5xx that did not apply", { kind: "temporary" } as const],
  ])("%s on the campaign create is an unknown outcome: one create sent, and the next stint creates exactly one", async (_l, fault) => {
    meta.inject("POST", /campaigns$/, fault);
    expect(await publish()).toEqual({ ok: false, error_code: "create_outcome_unknown" });
    expect(posts(/campaigns$/)).toBe(1);
    expect((await publish({ key: `${CAMPAIGN}:stint-2` })).ok).toBe(true);
    expect([meta.campaigns.size, meta.adsets.size]).toEqual([1, 1]);
  });

  it("a revoked token stops the step at its first read: token_invalid, and no create is sent", async () => {
    meta.revokeToken();
    expect(await publish()).toMatchObject({ ok: false, error_code: "token_invalid" });
    expect(posts(/./)).toBe(0);
  });

  it("a crash between a create and its ledger row: the next delivery adopts the object and never creates a second", async () => {
    w.crashOnWrite("ads_actions", 2); // write 1 starts the campaign row, write 2 would complete it
    await expect(publish()).rejects.toThrow(/injected crash/);
    expect(meta.campaigns.size).toBe(1);
    const again = await publish();
    expect(again.ok).toBe(true);
    expect([meta.campaigns.size, meta.adsets.size, posts(/campaigns$/)]).toEqual([1, 1, 1]);
    expect(creates().every((a) => a.status === "succeeded")).toBe(true);
  });

  it("the same step delivered twice at once creates each object once", async () => {
    const [a, b] = await Promise.all([publish(), publish()]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([meta.campaigns.size, meta.adsets.size, meta.forms.forms.size, posts(/campaigns$/), posts(/adsets$/), posts(/leadgen_forms$/)]).toEqual([1, 1, 2, 1, 1, 2]);
    expect([meta.ads.creatives.size, meta.sets.ads.size, posts(/adcreatives$/), posts(/act_\d+\/ads$/)]).toEqual([2, 2, 2, 2]);
  });

  it("two objects carrying our name are refused, never a guess; one found active is refused, never adopted", async () => {
    const name = nameFor(input(), "campaign");
    const twin = (id: string, status: "PAUSED" | "ACTIVE") => meta.campaigns.set(id, {
      id, account_id: ACCOUNT, name, objective: "OUTCOME_LEADS", status, special_ad_categories: ["EMPLOYMENT"],
      special_ad_category_country: ["US"], spend_cap: "50000", daily_budget: null,
    });
    twin("900", "ACTIVE");
    expect(await publish()).toMatchObject({ ok: false, error_code: "found_not_paused" });
    twin("901", "PAUSED");
    expect(await publish({ key: "k2" })).toMatchObject({ ok: false, error_code: "duplicate_on_platform" });
    expect(posts(/./)).toBe(0);
  });
});

describe("Meta publisher (B2b) — the Instant Form", () => {
  it("makes the form on the Page with the Page's token: contact, then the catalogue's questions, our privacy page, shown only from the ad", async () => {
    const r = await publish();
    if (!r.ok) throw new Error(r.error_code);
    const f = meta.forms.forms.get(r.platform_refs.meta_form_ids.en)!;
    expect(f).toMatchObject({ page_id: PAGE, status: "ACTIVE", locale: "EN_US", privacy_policy_url: "https://app.silvicom360.com/privacy" });
    expect(f.questions.map((q) => q.key)).toEqual(["full_name", "phone", "email", "class_a_held", "class_a_years", "hazmat_endorsement"]);
    expect(parseAdName(f.name)).toMatchObject({ level: "form", preset_key: "ALL", campaign_short: "ab12cd34", language: "en" });
    const sent = meta.requests.find((q) => q.method === "POST" && q.path.endsWith("/leadgen_forms"))!;
    expect(JSON.parse(sent.body.block_display_for_non_targeted_viewer!)).toBe(true);
  });

  it("every form is higher intent with an SMS-verified phone, an intro of the job's requirements and a thank-you page (LQ1)", async () => {
    const r = await publish();
    if (!r.ok) throw new Error(r.error_code);
    for (const lang of ["en", "es"] as const) {
      const id = r.platform_refs.meta_form_ids[lang];
      const f = meta.forms.forms.get(id)!;
      expect(f.is_optimized_for_quality).toBe(true);
      expect(meta.forms.smsVerified.has(id)).toBe(true);
      expect(f.context_card).toEqual({ title: META_FORM_WORDS.intro_title[lang], style: "LIST_STYLE", content: introLines(input(), lang) });
      expect(f.thank_you_page).toEqual({ title: META_FORM_WORDS.thank_you_title[lang], body: META_FORM_WORDS.thank_you_body[lang], button_type: "NONE" });
    }
    expect(meta.forms.forms.get(r.platform_refs.meta_form_ids.en)!.context_card!.content).toContain("At least 2 years of Class A driving");
  });

  it("a Spanish ad gets a Spanish form with the same question keys", async () => {
    const r = await publish();
    if (!r.ok) throw new Error(r.error_code);
    const f = meta.forms.forms.get(r.platform_refs.meta_form_ids.es)!;
    expect(f.questions.map((q) => q.key)).toEqual(meta.forms.forms.get(r.platform_refs.meta_form_ids.en)!.questions.map((q) => q.key));
    expect(f.locale).toBe("ES_LA");
    expect(f.questions[3]!.label).toMatch(/Clase A/);
  });

  it("the system user's token cannot make a form — FakeMeta holds the Page-token rule", async () => {
    const r = await graph(TOKEN).post(`${PAGE}/leadgen_forms`, { name: "x", questions: [{ type: "EMAIL", key: "email" }], privacy_policy: { url: "https://a.b/privacy" } }, { idempotent: false });
    expect(r.ok ? null : r.error.error_code).toBe("token_invalid");
  });

  it("half-created (campaign and ad set yes, form no): the next attempt adopts both and makes one form", async () => {
    meta.inject("POST", /leadgen_forms$/, { kind: "hang" });
    expect(await publish()).toEqual({ ok: false, error_code: "create_outcome_unknown" });
    expect((await publish({ key: `${CAMPAIGN}:stint-2` })).ok).toBe(true);
    expect([meta.campaigns.size, meta.adsets.size, meta.forms.forms.size, posts(/campaigns$/), posts(/adsets$/)]).toEqual([1, 1, 2, 1, 1]);
  });

  it("a form create Meta applied but answered 5xx is found on the Page by name, never made twice", async () => {
    meta.inject("POST", /leadgen_forms$/, { kind: "applied_then_temporary" });
    expect((await publish()).ok).toBe(true);
    expect([meta.forms.forms.size, posts(/leadgen_forms$/)]).toEqual([2, 2]);
  });

  it("a form with our name that asks other questions is refused, never adopted", async () => {
    const name = nameFor(input(), "form", "en");
    const spec = formParams(input(), name, "en");
    meta.forms.forms.set("777", { id: "777", page_id: PAGE, name, status: "ACTIVE", locale: "EN_US", privacy_policy_url: "https://app.silvicom360.com/privacy", questions: [{ type: "EMAIL", key: "email" }],
      is_optimized_for_quality: true, context_card: spec.context_card, thank_you_page: spec.thank_you_page });
    expect(await publish()).toMatchObject({ ok: false, error_code: "readback_mismatch", response: { id: "777", fields: ["questions"] } });
    expect(posts(/leadgen_forms$/)).toBe(0);
  });

  it("a form made before LQ1 — no review step, no intro, no thank-you page — is refused, never adopted", async () => {
    const name = nameFor(input(), "form", "en");
    const spec = formParams(input(), name, "en");
    meta.forms.forms.set("778", { id: "778", page_id: PAGE, name, status: "ACTIVE", locale: "EN_US", privacy_policy_url: "https://app.silvicom360.com/privacy", questions: spec.questions, is_optimized_for_quality: false });
    expect(await publish()).toMatchObject({ ok: false, error_code: "readback_mismatch", response: { id: "778", fields: ["is_optimized_for_quality", "context_card", "thank_you_page"] } });
    expect(posts(/leadgen_forms$/)).toBe(0);
  });

  it("a form whose intro or thank-you words differ from ours is refused, never adopted", async () => {
    const name = nameFor(input(), "form", "en");
    const spec = formParams(input(), name, "en");
    meta.forms.forms.set("779", { id: "779", page_id: PAGE, name, status: "ACTIVE", locale: "EN_US", privacy_policy_url: "https://app.silvicom360.com/privacy", questions: spec.questions,
      is_optimized_for_quality: true, context_card: { ...spec.context_card!, content: ["Any licence"] }, thank_you_page: { ...spec.thank_you_page, body: "We may call." } });
    expect(await publish()).toMatchObject({ ok: false, error_code: "readback_mismatch", response: { id: "779", fields: ["context_card", "thank_you_page"] } });
  });
});

describe("Meta publisher (B2c) — the image, the ad creative and the ad, per approved creative and language", () => {
  const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex");

  it("each language's ad is PAUSED in the one ad set and shows the feed image, the platform slots' words and that language's form", async () => {
    const r = await publish();
    if (!r.ok) throw new Error(r.error_code);
    expect(r.platform_refs.meta_ad_ids).toHaveLength(2);
    for (const [language, sha, body, title] of [["en", "a", "Regional lanes out of Joliet.", "Class A drivers"], ["es", "b", "Rutas regionales desde Joliet.", "Choferes Clase A"]] as const) {
      const placed = r.platform_refs.ads.find((a) => a.language === language)!;
      const ad = meta.sets.ads.get(placed.meta_ad_id)!;
      expect(ad).toMatchObject({ adset_id: r.platform_refs.meta_adset_id, status: "PAUSED", creative: { id: placed.meta_creative_id } });
      expect(parseAdName(ad.name)).toMatchObject({ level: "ad", preset_key: "P2", creative_short: "9f8e7d6c", language });
      const spec = meta.ads.creatives.get(placed.meta_creative_id)!.object_story_spec;
      expect(spec).toEqual({ page_id: PAGE, link_data: {
        image_hash: md5(STORE.get(sha.repeat(64))!), link: "https://fb.me/", message: body, name: title,
        call_to_action: { type: "APPLY_NOW", value: { lead_gen_form_id: r.platform_refs.meta_form_ids[language] } },
      } });
    }
    // The overlay's words are in the image; the 9:16 image waits for Q-AD28 and is never sent.
    expect([...meta.ads.images.values()].map((i) => i.height).sort()).toEqual([1350, 1350]);
  });

  it("a creative with no 4:5 image runs its 1:1", async () => {
    const c = creative({ assets: [{ format: "1:1", language: "en", sha256: "c".repeat(64) }, { format: "4:5", language: "es", sha256: "b".repeat(64) }] });
    const r = await publish({ creatives: [c] });
    if (!r.ok) throw new Error(r.error_code);
    const en = r.platform_refs.ads.find((a) => a.language === "en")!;
    expect(en.image_hash).toBe(md5(STORE.get("c".repeat(64))!));
  });

  it.each([
    ["no_approved_creative", { creatives: [] }],
    ["no_platform_slots", { creatives: [creative({ platform_slots: null })] }],
    ["creative_copy_missing", { creatives: [creative({ copy: { en: creative().copy.en } })] }],
    ["no_feed_image", { creatives: [creative({ assets: [{ format: "9:16", language: "en", sha256: "d".repeat(64) }, { format: "4:5", language: "es", sha256: "b".repeat(64) }] })] }],
  ] as const)("refuses before calling Meta: %s — nothing is made, not even the campaign", async (code, patch) => {
    expect(await publish(patch as Partial<PublishInput>)).toEqual({ ok: false, error_code: code });
    expect(meta.requests).toHaveLength(0);
  });

  it("half-created (creative yes, ad no): the next stint adopts the creative and makes the ad once", async () => {
    meta.inject("POST", /^act_\d+\/ads$/, { kind: "hang" });
    expect(await publish()).toEqual({ ok: false, error_code: "create_outcome_unknown" });
    expect([meta.ads.creatives.size, meta.sets.ads.size]).toEqual([1, 0]);
    expect((await publish({ key: `${CAMPAIGN}:stint-2` })).ok).toBe(true);
    expect([meta.ads.creatives.size, meta.sets.ads.size, posts(/adcreatives$/)]).toEqual([2, 2, 2]);
  });

  it("a creative create Meta applied but answered 5xx is found by its name, never made twice", async () => {
    meta.inject("POST", /adcreatives$/, { kind: "applied_then_temporary" });
    expect((await publish()).ok).toBe(true);
    expect([meta.ads.creatives.size, posts(/adcreatives$/)]).toEqual([2, 2]);
  });

  it("an image upload whose answer was lost is sent again and answers the same hash: one image per set of bytes", async () => {
    meta.inject("POST", /adimages$/, { kind: "applied_then_temporary" });
    expect((await publish()).ok).toBe(true);
    expect([meta.ads.images.size, posts(/adimages$/)]).toEqual([2, 3]);
  });

  it("a 429 on the ad create stops the step as rate_limited and makes nothing after it", async () => {
    meta.inject("POST", /^act_\d+\/ads$/, { kind: "throttle" });
    expect(await publish()).toMatchObject({ ok: false, error_code: "rate_limited" });
    expect([meta.sets.ads.size, posts(/adcreatives$/)]).toEqual([0, 1]);
  });

  it("a creative with our name that shows another image is refused, never adopted; an ad with our name running is refused", async () => {
    const first = await publish();
    if (!first.ok) throw new Error(first.error_code);
    const en = first.platform_refs.ads.find((a) => a.language === "en")!;
    meta.ads.creatives.get(en.meta_creative_id)!.object_story_spec.link_data.image_hash = "0".repeat(32);
    expect(await publish({ key: "k2" })).toMatchObject({ ok: false, error_code: "readback_mismatch", response: { id: en.meta_creative_id, fields: ["image_hash"] } });

    meta.ads.creatives.get(en.meta_creative_id)!.object_story_spec.link_data.image_hash = en.image_hash;
    meta.sets.ads.get(en.meta_ad_id)!.status = "ACTIVE";
    expect(await publish({ key: "k3" })).toMatchObject({ ok: false, error_code: "found_not_paused" });
    expect([meta.ads.creatives.size, meta.sets.ads.size]).toEqual([2, 2]);
  });

  it("the ledger names the creative on its creative and ad rows; the ad's name is a pure function of the rows", async () => {
    await publish();
    expect(creates().filter((a) => a.creative_id === CREATIVE).map((a) => (a.request as { level: string }).level)).toEqual(["creative:9f8e7d6c:EN", "ad:9f8e7d6c:EN", "creative:9f8e7d6c:ES", "ad:9f8e7d6c:ES"]);
    expect(adNameFor(input({ key: "other" }), creative(), "es")).toBe(adNameFor(input(), creative(), "es"));
  });

  it("FakeMeta holds the lead ad's rules: an image not on the account, a link other than fb.me, or another Page's form is refused", async () => {
    const r = await publish();
    if (!r.ok) throw new Error(r.error_code);
    const ok = meta.ads.creatives.get(r.platform_refs.ads[0]!.meta_creative_id)!.object_story_spec;
    const tryCreative = (link_data: Record<string, unknown>) => graph().post(`act_${ACCOUNT}/adcreatives`, { name: "x", object_story_spec: { page_id: PAGE, link_data } }, { idempotent: false });
    for (const bad of [{ image_hash: "f".repeat(32) }, { link: "https://example.com/" }, { call_to_action: { type: "APPLY_NOW", value: { lead_gen_form_id: "123" } } }]) {
      expect((await tryCreative({ ...ok.link_data, ...bad })).ok).toBe(false);
    }
    expect((await tryCreative(ok.link_data)).ok).toBe(true);
  });
});
