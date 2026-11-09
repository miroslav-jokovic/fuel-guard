import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type AdsWorld } from "../../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { runCampaignStep } from "../../orchestrator/runner.js";
import type { FakeMetaFault } from "../simulator/fakeMetaFaults.js";
import { fieldNames } from "../simulator/fakeMetaShapes.js";
import { openMetaTarget, SANDBOX_VARIABLES, targetName, type MetaTarget } from "./contract/metaTarget.js";
import { compareRecorded, kindOf, type Observed } from "./contract/readings.js";
import { MetaGraph, resetGraphThrottles } from "./graphClient.js";
import { publishPaused, type PublishInput } from "./publisher.js";

/**
 * The Meta publisher's CONTRACT SUITE (§4R Publisher row; Publisher L3, 2026-11-05). One file, two targets:
 * FakeMeta by default (L3), Meta's sandbox with `ADS_TARGET=sandbox` (L4) — `contract/metaTarget.ts` is the
 * one switch, and nothing below names a target. Faults are injected on the wire by the fault proxy in front
 * of either target; what was made is what the TARGET answered success to (`proxy.made`), and every check of
 * what exists reads it back through Graph. No assertion here reads FakeMeta's maps — that is what makes the
 * sandbox run the same file rather than a port of it.
 *
 * Each test gets a fresh campaign and creative id, so names (naming.ts) never meet a previous run's objects
 * on a sandbox account that keeps them. Images are real PNGs (sharp), so the sandbox is sent what an
 * approved creative is, not a 24-byte header.
 *
 * `publisher.test.ts` stays the fake-only suite: it plants states only a fake can hold (a twin campaign, a
 * creative showing another image) and asserts on the fake's view. This file holds what must be true of
 * Meta itself.
 */

const STEPS = [
  ["campaign", /^act_\d+\/campaigns$/],
  ["ad set", /^act_\d+\/adsets$/],
  ["form", /^\d+\/leadgen_forms$/],
  ["image", /^act_\d+\/adimages$/],
  ["ad creative", /^act_\d+\/adcreatives$/],
  ["ad", /^act_\d+\/ads$/],
] as const;
const EDGE = Object.fromEntries(STEPS) as Record<(typeof STEPS)[number][0], RegExp>;
const FAULTS: Array<[string, FakeMetaFault]> = [["a 429", { kind: "throttle", regainMinutes: 1 }], ["a 5xx", { kind: "temporary" }], ["a timeout", { kind: "hang" }]];

let images: Map<string, Buffer>;
let en: string;
let es: string;
beforeAll(async () => {
  const draw = (r: number, g: number, b: number) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const bufs = [await draw(20, 60, 110), await draw(110, 60, 20)];
  const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");
  [en, es] = bufs.map(sha) as [string, string];
  images = new Map(bufs.map((x) => [sha(x), x]));
});

let t: MetaTarget;
let w: AdsWorld;
let campaignId: string;
let creativeId: string;
beforeEach(async () => {
  resetGraphThrottles();
  t = await openMetaTarget();
  campaignId = randomUUID();
  creativeId = randomUUID();
  w = createAdsWorld({
    campaigns: [campaign(campaignId, "creating")], settings: LIVE_SETTINGS,
    connections: [{ id: CONN, org_id: ORG, provider: "meta", is_sandbox: true, token_sealed: null, page_token_sealed: null, account_ref: t.accountId, page_ref: t.pageId, status: "connected" }],
  });
});
afterEach(() => t.close());

const input = (key: string): PublishInput => ({
  orgId: ORG, campaignId, connectionId: CONN, accountId: t.accountId, pageId: t.pageId, platform: "meta",
  brief_source: "recruiting_opening", brief_ref: "op-1@v3", created_at: "2026-11-05T15:00:00Z",
  area: { label: "Joliet yard", latitude: 41.525, longitude: -88.0817, radius_miles: 25, reason: "Drivers report to the Joliet yard daily" },
  daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, key: `${campaignId}:${key}`,
  claims: [{ kind: "money", cents: 62, per: "mile" }, { kind: "quantity", value: 23, unit: "age" }, { kind: "quantity", value: 2, unit: "year" }], form_questions: ["class_a_held", "class_a_years"], privacy_url: "https://app.silvicom360.com/privacy",
  creatives: [{
    id: creativeId, preset_key: "P2", platform_slots: { primary_text: "body", headline: "title" },
    copy: { en: { hook: "Home every weekend", cta: "Apply now", body: "Regional lanes out of Joliet.", title: "Class A drivers" },
            es: { hook: "En casa cada fin de semana", cta: "Aplica ya", body: "Rutas regionales desde Joliet.", title: "Choferes Clase A" } },
    assets: [{ format: "4:5", language: "en", sha256: en }, { format: "4:5", language: "es", sha256: es }],
  }],
});

const graph = (token: string) => new MetaGraph({ token, throttleKey: `contract:${campaignId}`, baseUrl: t.base, timeoutMs: t.timeoutMs, sleep: async () => {} });
const readAsset = async (_org: string, ref: { sha256: string }) => images.get(ref.sha256) ?? Promise.reject(new Error(`no asset ${ref.sha256}`));
const deps = () => ({ admin: w.admin, graph: graph(t.token()), pageGraph: graph(t.pageToken()), readAsset, now: w.now });
const publish = (key: string) => publishPaused(deps(), input(key));
/** How many of each object the target really made: one campaign, one ad set, a form, creative and ad per language. */
const madeCounts = () => STEPS.filter(([s]) => s !== "image").map(([, edge]) => t.proxy.made(edge).length);
const ONCE = [1, 1, 2, 2, 2];
const stintRows = (stint: string) => w.actions.filter((a) => a.kind === "create_paused" && String(a.idempotency_key).includes(`:${stint}:`));

describe("the target switch (§4R: L4 is this suite with ADS_TARGET=sandbox)", () => {
  it("ADS_TARGET picks the target: unset or fake is FakeMeta, sandbox is Meta, anything else is refused", () => {
    expect([targetName({}), targetName({ ADS_TARGET: "fake" }), targetName({ ADS_TARGET: "sandbox" })]).toEqual(["fake", "fake", "sandbox"]);
    expect(() => targetName({ ADS_TARGET: "sandbx" })).toThrow(/not a target/);
  });

  it("a sandbox run without its credentials is refused, naming each missing variable — never a quiet fake run", async () => {
    await expect(openMetaTarget({ ADS_TARGET: "sandbox", META_SANDBOX_TOKEN: "x" })).rejects.toThrow(SANDBOX_VARIABLES.slice(1).join(", "));
  });
});

describe("Meta publisher contract (§4R Publisher L3) — every create step under each fault", () => {
  const cases = STEPS.flatMap(([step]) => FAULTS.map(([label, fault]) => [step, label, fault] as const));

  it.each(cases)("the %s create meeting %s: the step stops or recovers, nothing after it is sent, and the next stint ends with every object made once", async (step, _label, fault) => {
    t.proxy.faults.inject("POST", EDGE[step], fault);
    const first = await publish("stint-1");
    const posts = t.proxy.calls.filter((c) => c.method === "POST");
    const faulted = posts.findIndex((c) => c.fault !== null);
    expect(faulted).toBeGreaterThanOrEqual(0);

    // An image upload sets a value (the same bytes answer the same hash), so the client re-sends it after
    // a 5xx or a timeout and the step goes on. Every other create is never re-sent: the step stops.
    const retried = step === "image" && fault.kind !== "throttle";
    if (retried) {
      expect(first.ok).toBe(true);
    } else {
      expect(first).toMatchObject({ ok: false, error_code: fault.kind === "throttle" ? "rate_limited" : "create_outcome_unknown" });
      expect(posts.slice(faulted + 1)).toEqual([]);
      // The ledger says which fault it was: a timeout is not a 5xx, though both leave the outcome unknown.
      if (step !== "image") {
        const kind = { throttle: "rate_limited", temporary: "transient", hang: "timeout" }[fault.kind as "throttle" | "temporary" | "hang"];
        expect(stintRows("stint-1").at(-1)).toMatchObject({ status: "failed", response: { kind } });
      }
      // The throttle's regain time passes before the next stint; Graph's block is per process, and this is a new one.
      resetGraphThrottles();
      const second = await publish("stint-2");
      expect(second.ok).toBe(true);
    }
    expect(madeCounts()).toEqual(ONCE);
    expectOrgScoped(w.rec, ORG);
  });
});

describe("Meta publisher contract — half-created objects are resumed, never duplicated", () => {
  it.each([
    ["campaign yes, ad set no", "ad set", [1, 0, 0, 0, 0], 1],
    ["ad set yes, creative no", "ad creative", [1, 1, 2, 0, 0], 4],
    ["creative yes, ad no", "ad", [1, 1, 2, 1, 0], 5],
  ] as const)("half-created (%s): the next stint adopts what exists and makes only what is missing", async (_l, step, afterFirst, adopted) => {
    t.proxy.faults.inject("POST", EDGE[step], { kind: "hang" });
    expect(await publish("stint-1")).toEqual({ ok: false, error_code: "create_outcome_unknown" });
    expect(madeCounts()).toEqual(afterFirst);

    expect((await publish("stint-2")).ok).toBe(true);
    expect(madeCounts()).toEqual(ONCE);
    const rows = stintRows("stint-2");
    expect(rows.slice(0, adopted).map((r) => r.response)).toEqual(Array(adopted).fill({ adopted: true }));
    expect(rows.slice(adopted).every((r) => r.status === "succeeded" && r.response === null)).toBe(true);
  });
});

describe("Meta publisher contract — a revoked token stops the step and tells an admin", () => {
  // The runner is real (its alert is what is under test); its createPaused is the publisher on the target.
  const step = () => runCampaignStep({ admin: w.admin, now: w.now, workers: { compose: null, platform: null, createPaused: (_c, key) => publishPaused(deps(), input(key.replace(`${campaignId}:`, ""))) } }, ORG, campaignId);
  const toldOnce = () => {
    expect(w.byId(campaignId).last_error).toBe("token_invalid");
    expect(w.connections[0]).toMatchObject({ status: "failing", last_error: "create: token_invalid" });
    expect(w.bell.map((b) => [b.category, b.severity])).toEqual([["ads_token_expiring", "critical"]]);
  };

  it("a revoked token stops the create at its first call, marks the connection failing and tells an admin once", async () => {
    t.revoke();
    expect(await step()).toMatchObject({ kind: "stepped", event: "create_failed" });
    toldOnce();
    expect(t.proxy.sent(/./)).toEqual([]);
  });

  it.each(STEPS.map(([s]) => [s] as const))("a token revoked mid-run, met first at the %s create, stops there as token_invalid and tells an admin once", async (s) => {
    t.proxy.faults.inject("POST", EDGE[s], { kind: "token_expired" });
    expect(await step()).toMatchObject({ kind: "stepped", event: "create_failed" });
    toldOnce();
    const posts = t.proxy.calls.filter((c) => c.method === "POST");
    expect(posts.at(-1)?.fault).toBe("token_expired");
  });
});

/**
 * How each object is read back: the fields that hold what was sent; a sent field read under another name
 * (and how its value is found there); and each sent field no read returns, with why. A field sent that is
 * in none of the three fails the test — a new parameter must say how it is checked.
 */
const READ_BACK: Array<{ step: (typeof STEPS)[number][0]; page?: true; fields: string; renamed?: Record<string, [string, (sent: Record<string, unknown>) => unknown]>; writeOnly?: Record<string, string> }> = [
  { step: "campaign", fields: "name,objective,buying_type,status,special_ad_categories,special_ad_category_country,spend_cap" },
  { step: "ad set", fields: "name,campaign_id,status,daily_budget,billing_event,bid_strategy,optimization_goal,destination_type,promoted_object,targeting" },
  { step: "form", page: true, fields: "name,locale,questions,privacy_policy_url,is_optimized_for_quality,context_card{title,style,content},thank_you_page{title,body,button_type}",
    // `link_text` is the words of the privacy link; the form's read fields carry only its URL (OUR reading — L4 settles it).
    renamed: { privacy_policy: ["privacy_policy_url", (p) => p.url] },
    writeOnly: {
      block_display_for_non_targeted_viewer: "a delivery switch, not among a form's read fields in our reading (fakeMetaForms.ts); L4 settles it",
      is_phone_sms_verify_enabled: "not a LeadgenForm read field (Business SDK v26 leadgenform.py); the reading form-sms-verify-read records what the target answers when asked (Q-AD48)",
    } },
  { step: "ad creative", fields: "name,object_story_spec" },
  { step: "ad", fields: "name,adset_id,status,creative", renamed: { creative: ["creative", (c) => ({ id: c.creative_id })] } },
];

/** A sent form value as Graph took it: objects and arrays went as JSON strings. */
const asSent = (v: string): unknown => (/^[[{]/.test(v) ? JSON.parse(v) : v);
/** Where `read` does not hold what was `sent`: objects by their sent keys, arrays item by item, scalars as Graph's strings. */
function differences(read: unknown, sent: unknown, at: string): string[] {
  if (Array.isArray(sent)) {
    if (!Array.isArray(read) || read.length !== sent.length) return [`${at}: sent ${sent.length} items, read ${JSON.stringify(read)}`];
    return sent.flatMap((x, i) => differences(read[i], x, `${at}[${i}]`));
  }
  if (sent !== null && typeof sent === "object") {
    if (read === null || typeof read !== "object") return [`${at}: sent an object, read ${JSON.stringify(read)}`];
    return Object.entries(sent).flatMap(([k, v]) => differences((read as Record<string, unknown>)[k], v, `${at}.${k}`));
  }
  return String(read) === String(sent) ? [] : [`${at}: sent ${JSON.stringify(sent)}, read ${JSON.stringify(read)}`];
}

describe("Meta publisher contract — every object it made, read back from the target", () => {
  it("every created object is read back and holds what was asked; each field sent is compared or says why not", async () => {
    expect((await publish("stint-1")).ok).toBe(true);
    const found: string[] = [];
    let checked = 0;
    for (const kind of READ_BACK) {
      for (const call of t.proxy.made(EDGE[kind.step])) {
        const id = (call.upstream!.body as { id: string }).id;
        const read = await graph(kind.page ? t.pageToken() : t.token()).get<Record<string, unknown>>(id, { fields: kind.fields });
        if (!read.ok) throw new Error(`${kind.step} ${id}: ${read.error.error_code}`);
        const listed = new Set(fieldNames(kind.fields));
        for (const [field, raw] of Object.entries(call.body)) {
          const sent = asSent(raw);
          const renamed = kind.renamed?.[field];
          if (renamed) found.push(...differences(read.data[renamed[0]], renamed[1](sent as Record<string, unknown>), `${kind.step}.${field}→${renamed[0]}`));
          else if (listed.has(field)) found.push(...differences(read.data[field], sent, `${kind.step}.${field}`));
          else if (!kind.writeOnly?.[field]) found.push(`${kind.step}.${field}: sent, but neither read back nor named write-only`);
        }
        checked += 1;
      }
    }
    // Images: the upload answers a hash; the account's image under that hash is the picture that was sent.
    for (const call of t.proxy.made(EDGE.image)) {
      const hash = Object.values((call.upstream!.body as { images: Record<string, { hash: string }> }).images)[0]!.hash;
      const read = await graph(t.token()).get<{ data: Array<{ hash: string; width: number; height: number }> }>(`act_${t.accountId}/adimages`, { hashes: [hash], fields: "hash,width,height" });
      if (!read.ok) throw new Error(`image ${hash}: ${read.error.error_code}`);
      const meta = await sharp(Buffer.from(call.body.bytes!, "base64")).metadata();
      found.push(...differences(read.data.data, [{ hash, width: meta.width, height: meta.height }], `image ${hash}`));
      checked += 1;
    }
    expect(found).toEqual([]);
    expect(checked).toBe(1 + 1 + 2 + 2 + 2 + 2);
  });

  it("asked for SMS verification by name, the target's answer is the committed reading (Q-AD48)", async () => {
    expect((await publish("stint-1")).ok).toBe(true);
    const id = (t.proxy.made(EDGE.form)[0]!.upstream!.body as { id: string }).id;
    // Our own request's answer, not the wire's first GET of this id (that is the publisher's read-back).
    const r = await graph(t.pageToken()).get<Record<string, unknown>>(id, { fields: "id,is_phone_sms_verify_enabled" });
    const observed: Observed = r.ok
      ? { status: 200, is_phone_sms_verify_enabled: kindOf(r.data.is_phone_sms_verify_enabled) }
      : { status: r.error.http, "error.code": r.error.code };
    const differences = compareRecorded("publisher-form", { "form-sms-verify-read": { fake: "platforms/simulator/fakeMetaForms.ts", observed } }, t.name);
    expect(differences).toEqual([]);
  });
});
