import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type AdsWorld } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { openMetaTarget, type MetaTarget } from "../platforms/meta/contract/metaTarget.js";
import { MetaGraph, resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { publishPaused, type PublishInput } from "../platforms/meta/publisher.js";
import { runCampaignStep } from "./runner.js";
import { applyCampaignEvent, loadCampaign } from "./transitions.js";

/**
 * The ORCHESTRATOR's L4 suite (stage2-kit-2c; §4R "the orchestrator over the real adapters' sandbox runs"). One
 * file, two targets, the Publisher's pattern: `ADS_TARGET` picks FakeMeta or Meta's sandbox (`metaTarget.ts`), a
 * fault proxy sits in front of either, and nothing below names a target or reads the fake's maps.
 *
 * What runs is the real runner and state machine (`runner.ts`, `transitions.ts`, the shared campaign machine) with
 * the real publisher as its create step, against the target. One campaign is taken the whole way the agent may take
 * it before a person approves a launch: approved → creating → a lost answer leaves it half-made → failed → a person
 * resumes → created, paused. Nothing is ever made ACTIVE, so neither target can spend.
 *
 * Afterwards the campaign is deleted through Graph and READ BACK as deleted (Meta deletes its ad sets and ads with
 * it): a sandbox account keeps nothing a run made, and the suite proves that rather than assuming it.
 */

const STEPS = [/^act_\d+\/campaigns$/, /^act_\d+\/adsets$/, /^\d+\/leadgen_forms$/, /^act_\d+\/adcreatives$/, /^act_\d+\/ads$/];
const ONCE = [1, 1, 2, 2, 2];
const PERSON = { kind: "person" as const, id: "11111111-1111-4111-8111-111111111111", name: "Owner" };

let images: Map<string, Buffer>;
let en: string;
let es: string;
beforeAll(async () => {
  const draw = (r: number, g: number, b: number) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const bufs = [await draw(30, 90, 60), await draw(90, 30, 60)];
  const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");
  [en, es] = bufs.map(sha) as [string, string];
  images = new Map(bufs.map((x) => [sha(x), x]));
});

let t: MetaTarget;
let w: AdsWorld;
let id: string;
beforeEach(async () => {
  resetGraphThrottles();
  t = await openMetaTarget();
  id = randomUUID();
  w = createAdsWorld({
    campaigns: [campaign(id, "approved")], settings: LIVE_SETTINGS,
    connections: [{ id: CONN, org_id: ORG, provider: "meta", is_sandbox: true, token_sealed: null, page_token_sealed: null, account_ref: t.accountId, page_ref: t.pageId, status: "connected" }],
  });
});
afterEach(() => t.close());

const input = (key: string): PublishInput => ({
  orgId: ORG, campaignId: id, connectionId: CONN, accountId: t.accountId, pageId: t.pageId, platform: "meta",
  brief_source: "recruiting_opening", brief_ref: "op-1@v3", created_at: "2026-11-09T15:00:00Z",
  area: { label: "Joliet yard", latitude: 41.525, longitude: -88.0817, radius_miles: 25, reason: "Drivers report to the Joliet yard daily" },
  daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, key,
  claims: [{ kind: "money", cents: 62, per: "mile" }, { kind: "quantity", value: 23, unit: "age" }, { kind: "quantity", value: 2, unit: "year" }], form_questions: ["class_a_held", "class_a_years"], privacy_url: "https://app.silvicom360.com/privacy",
  creatives: [{
    id: `${id}-cr`, preset_key: "P2", platform_slots: { primary_text: "body", headline: "title" },
    copy: { en: { hook: "Home every weekend", cta: "Apply now", body: "Regional lanes out of Joliet.", title: "Class A drivers" },
            es: { hook: "En casa cada fin de semana", cta: "Aplica ya", body: "Rutas regionales desde Joliet.", title: "Choferes Clase A" } },
    assets: [{ format: "4:5", language: "en", sha256: en }, { format: "4:5", language: "es", sha256: es }],
  }],
});
const graph = (token: string) => new MetaGraph({ token, throttleKey: `orchestrator:${id}`, baseUrl: t.base, timeoutMs: t.timeoutMs, sleep: async () => {} });
const readAsset = async (_o: string, ref: { sha256: string }) => images.get(ref.sha256) ?? Promise.reject(new Error(`no asset ${ref.sha256}`));
const createPaused = (_c: unknown, key: string) => publishPaused({ admin: w.admin, graph: graph(t.token()), pageGraph: graph(t.pageToken()), readAsset, now: w.now }, input(key));
const deps = () => ({ admin: w.admin, now: w.now, workers: { compose: null, platform: null, createPaused } });
const made = () => STEPS.map((edge) => t.proxy.made(edge).length);
const madeId = (edge: RegExp, i = 0) => (t.proxy.made(edge)[i]!.upstream!.body as { id: string }).id;

describe("the orchestrator on the target (§4R Orchestrator L4)", () => {
  it("a run on the target: created PAUSED, half-made after a lost answer, resumed by a person without a duplicate, every object read back as asked", async () => {
    expect(await runCampaignStep(deps(), ORG, id)).toMatchObject({ kind: "stepped", event: "create_paused" });
    // The ad set create is lost on the wire: the campaign exists on the target, nothing after it does.
    t.proxy.faults.inject("POST", STEPS[1]!, { kind: "hang" });
    expect(await runCampaignStep(deps(), ORG, id)).toMatchObject({ kind: "stepped", event: "create_failed" });
    expect(made()).toEqual([1, 0, 0, 0, 0]);
    expect(w.byId(id).state).toBe("failed");

    const failed = (await loadCampaign(w.admin, ORG, id))!;
    expect(await applyCampaignEvent(w.admin, failed, { event: "resume_create", actor: PERSON }, w.now().toISOString())).toMatchObject({ kind: "moved", to: "creating" });
    expect(await runCampaignStep(deps(), ORG, id)).toMatchObject({ kind: "stepped", event: "created", result: { kind: "moved", to: "paused" } });
    expect(made()).toEqual(ONCE);

    // What the campaign row holds is what the target made; each object reads back paused, with what was asked.
    const refs = w.byId(id).platform_refs as { meta_campaign_id: string; meta_adset_id: string; meta_ad_ids: string[] };
    expect(refs.meta_campaign_id).toBe(madeId(STEPS[0]!));
    expect(refs.meta_adset_id).toBe(madeId(STEPS[1]!));
    expect([...refs.meta_ad_ids].sort()).toEqual([madeId(STEPS[4]!, 0), madeId(STEPS[4]!, 1)].sort());
    const g = graph(t.token());
    const read = async (oid: string, fields: string) => {
      const r = await g.get<Record<string, unknown>>(oid, { fields });
      if (!r.ok) throw new Error(`${oid}: ${r.error.error_code}`);
      return r.data;
    };
    expect(await read(refs.meta_campaign_id, "status,spend_cap")).toMatchObject({ status: "PAUSED", spend_cap: "50000" });
    expect(await read(refs.meta_adset_id, "status,daily_budget,campaign_id")).toMatchObject({ status: "PAUSED", daily_budget: "5000", campaign_id: refs.meta_campaign_id });
    for (const ad of refs.meta_ad_ids) expect(await read(ad, "status,adset_id")).toMatchObject({ status: "PAUSED", adset_id: refs.meta_adset_id });
    // Nothing the agent did asked the target to make anything ACTIVE.
    expect(t.proxy.sent(/./).filter((c) => Object.values(c.body).some((v) => v.includes("ACTIVE")))).toEqual([]);
    expectOrgScoped(w.rec, ORG);

    // Clean-up, proven by a read: the campaign is deleted, and the target answers so.
    const del = await g.post<{ success?: boolean }>(refs.meta_campaign_id, { status: "DELETED" }, { idempotent: true });
    expect(del.ok).toBe(true);
    const after = await g.get<{ status?: string }>(refs.meta_campaign_id, { fields: "status" });
    expect(after.ok ? after.data.status : `gone:${after.error.error_code}`).toMatch(/^(DELETED|gone:.+)$/);
  });
});
