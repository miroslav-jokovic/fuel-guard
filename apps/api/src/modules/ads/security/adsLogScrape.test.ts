import { inspect } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLeadScenarios, loadMonitorScenarios } from "@silvicom/ads-golden";
import { runLeadGolden } from "../../../testing/adsLeadGolden.js";
import { runMonitorGolden } from "../../../testing/adsMonitorGolden.js";
import { testEnv } from "../../../testing/testEnv.js";
import type { SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { loadEnv } from "../../../env.js";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, T0 } from "../../../testing/adsWorld.js";
import { receiveLeadgenDelivery } from "../leads/leadgenWebhook.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import { runCampaignStep } from "../orchestrator/runner.js";
import { adsWorkers } from "../orchestrator/workers.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { ADS_SETTINGS_UNSET } from "@silvicom/shared";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { FakeHiggsfield } from "../creative/higgsfield/fakeHiggsfield.js";
import { HiggsfieldClient } from "../creative/higgsfield/higgsfieldClient.js";
import { renderStep } from "../creative/higgsfield/render.js";

/**
 * Security L3, "a token in a log line" (ADS-AGENT-BUILD-WORKFLOW §4R, row "Security (all)"; G-sec, 2026-11-05).
 *
 * Every credential that leaves this process is collected AS IT LEAVES: `fetch` is wrapped, and each request's
 * `Authorization` (a Meta Bearer token — the system user's or a Page's) is added to the list of things no log
 * may hold. Meta is then made to echo that token inside every error it answers, as Graph's own messages quote an
 * `access_token=`, which is the case `MetaGraph.scrub` exists for. Through that, the roads that run unattended
 * with a token in hand run for real over the simulator:
 *   · every monitor golden scenario — the hourly insights pull, the checks and their pauses, reconcile;
 *   · every lead golden scenario — the webhook receiver (with the app secret), the lead fetch with the Page
 *     token, the hourly backfill;
 *   · the orchestrator over the real Meta path (`metaPath.test.ts`'s road): a launch whose read-back Meta refuses,
 *     then a pause Meta refuses twice. That is the road that STORES Meta's message — the adapter's failure body
 *     goes into `ads_actions.response` — so it is the one that shows the scrub working (the monitor and lead
 *     roads keep only error codes; a mutant removing the scrub survived until this road was added);
 *   · the webhook receiver once more, refusing a forged signature and a missing one, where it logs.
 * Then three places are scraped for any credential, the app secret and the sealing key:
 *   · every console line written meanwhile (what Railway's log keeps);
 *   · every failure a job reported (what `jobs.last_error` keeps, and the bell may show);
 *   · every row written (`ads_actions.response`, a connection's `last_error`, an alert's body).
 * The scrape is not vacuous: it first checks that tokens were sent, and that Meta's echo came back.
 *
 * Added by Track W's sec-fixes (2026-11-06, add-only, this one road): a Higgsfield key echoed in Higgsfield's
 * error `detail`. G-sec found `HiggsfieldClient` passing `detail` through unscrubbed, so a pending render's `why`
 * carried a vendor echo into the ads_render job's error. The client now scrubs at its boundary; the render road
 * below runs a FakeHiggsfield that quotes the `Key id:secret` it was sent, and its job error, ledger rows and
 * console lines join the scrape.
 */

const SESSION = "Bearer session";
const credentials = new Set<string>();
let echoed = 0;
const lines: string[] = [];
const failures: string[] = [];
const recorders: SupabaseRecorder[] = [];
/** The `ads_actions` rows the orchestrator road wrote, as stored. */
const stored: string[] = [];
let fake: FakeMeta;

const realFetch = globalThis.fetch;
type GraphBody = { error?: { message?: string } };
function parseGraph(text: string): GraphBody | null {
  try {
    return JSON.parse(text) as GraphBody;
  } catch {
    return null;
  }
}

async function wrapped(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization");
  const bearer = auth && auth !== SESSION && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (bearer) credentials.add(bearer);
  // Higgsfield's `Key id:secret`: the pair and the secret alone are both things no log may hold.
  if (auth?.startsWith("Key ")) {
    credentials.add(auth.slice(4));
    credentials.add(auth.slice(4).split(":").slice(1).join(":"));
  }
  const res = await realFetch(input, init);
  if (!bearer || res.ok) return res;
  const text = await res.text();
  const body = parseGraph(text);
  if (!body?.error) return new Response(text, { status: res.status, headers: res.headers });
  echoed += 1;
  body.error.message = `${body.error.message ?? ""} (access_token=${bearer})`;
  return Response.json(body, { status: res.status, headers: res.headers });
}

beforeAll(async () => {
  vi.stubGlobal("fetch", wrapped);
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 6 }))).join(" "));
    });
  }
  fake = await simulatorFakeForTests();

  for (const { file, scenario } of loadMonitorScenarios()) {
    const run = await runMonitorGolden(scenario, fake, file);
    failures.push(...run.failures);
    recorders.push(run.world.rec);
  }
  for (const { scenario } of loadLeadScenarios()) {
    const run = await runLeadGolden(scenario, fake);
    failures.push(...run.failures);
    recorders.push(run.rec);
  }
  await failingLaunchAndPause();
  await echoedRenderKey();
  const body = Buffer.from(JSON.stringify({ object: "page", entry: [] }));
  const quiet = { env: { META_APP_SECRET: fake.webhooks.appSecret }, admin: {} as never, enqueue: async () => undefined };
  await receiveLeadgenDelivery(quiet as never, body, "sha256=forged");
  await receiveLeadgenDelivery(quiet as never, body, undefined);
}, 120_000);

/** `metaPath.test.ts`'s launch-then-read-back-refused case, with the pause refused too, so failure bodies are stored. */
async function failingLaunchAndPause(): Promise<void> {
  resetGraphThrottles();
  fake.campaigns.set("600", { id: "600", account_id: SIMULATOR_ACCOUNT_ID, name: "S360|SIM|campaign", objective: "OUTCOME_LEADS", status: "PAUSED", special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "50000", daily_budget: null });
  fake.sets.adsets.set("601", { id: "601", account_id: SIMULATOR_ACCOUNT_ID, campaign_id: "600", name: "S360|SIM|adset", status: "PAUSED", daily_budget: "5000", billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: "1" }, targeting: {} });
  fake.sets.ads.set("602", { id: "602", adset_id: "601", name: "S360|SIM|ad", status: "PAUSED" });
  const settings = { ...LIVE_SETTINGS, limits: { ...LIVE_SETTINGS.limits, monthly_cap_cents: { meta: 300_000, simulator: 300_000 } } };
  const connections = [{ id: CONN, org_id: ORG, provider: "simulator", is_sandbox: false, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" }];
  const approval = { id: "appr-1", org_id: ORG, campaign_id: "c1", kind: "launch", withdraws_id: null, approved_by: "u-owner", approved_by_name: "Owner", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, created_at: T0 };
  const w = createAdsWorld({ campaigns: [campaign("c1", "launching", { platform_refs: { meta_campaign_id: "600", meta_adset_id: "601", meta_ad_ids: ["602"] } })], settings, connections, approvals: [approval] });
  const deps = { admin: w.admin, now: w.now, workers: adsWorkers({ admin: w.admin, env: loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv), now: w.now }) };
  fake.inject("GET", /^600$/, { kind: "token_expired" });
  await runCampaignStep(deps, ORG, "c1");
  fake.inject("POST", /^600$/, { kind: "token_expired" }, 2);
  await runCampaignStep(deps, ORG, "c1");
  stored.push(...w.actions.map((a) => JSON.stringify(a)));
  recorders.push(w.rec);
}

/**
 * A render whose submit Higgsfield answers with a 500 that QUOTES the credentials (`echo_key`). The step stays
 * pending, and the ads_render job throws `ads_render: still rendering (<why>)` (`queue/handlers/adsRender.ts`):
 * that message is the job's failure, kept in `jobs.last_error`.
 */
let renderEchoed = false;
async function echoedRenderKey(): Promise<void> {
  const key = { id: "hf-scrape-id", secret: `hf-scrape-secret-${Math.random().toString(36).slice(2)}` };
  const model = "higgsfield-ai/soul/v2/standard";
  const hf = new FakeHiggsfield({ keyId: key.id, keySecret: key.secret, webhookSecret: `whsec_${Buffer.alloc(32, 7).toString("base64")}`, balanceCents: 1_000, prices: { [model]: 40 } });
  const base = await hf.start();
  try {
    const settings = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, higgsfield_credits_monthly: 1_000, agents_enabled: { renderer: true } } };
    const rec = createSupabaseRecorder({ tables: {
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: T0, created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: "00000000-0000-4000-8000-0000000000e1", ...(q.write.payload as object) }] : []),
    } });
    hf.inject(/higgsfield-ai/, { kind: "echo_key" });
    const out = await renderStep({ admin: rec.client, client: new HiggsfieldClient(key, { baseUrl: base }), now: () => new Date(T0), prices: { [model]: 40 } },
      { orgId: ORG, campaignId: null, creativeId: "cr-scrape", attempt: 1, model, params: { prompt: "a road at dawn" }, reference: null });
    if (out.kind !== "pending") throw new Error(`the echoed render should stay pending, got ${out.kind}`);
    renderEchoed = out.why.includes("[key]");
    failures.push(`ads_render: still rendering (${out.why})`);
    recorders.push(rec);
  } finally {
    await hf.stop();
  }
}

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await stopSimulatorForTests();
});

const secrets = () => [...credentials, fake.webhooks.appSecret, testEnv().SECRETS_ENCRYPTION_KEY!].filter((s) => s && s.length >= 8);
const found = (where: string, texts: string[]) =>
  texts.flatMap((t) => secrets().filter((s) => t.includes(s)).map((s) => `${where} carries ${s.slice(0, 12)}…: ${t.slice(0, 160)}`));

describe("Security L3 — a token in a log line", () => {
  it("the scrape had something to find: tokens were sent, Meta echoed them, and the roads logged", () => {
    expect(credentials.size).toBeGreaterThanOrEqual(2); // the system user's token and at least one Page token
    expect(echoed).toBeGreaterThan(0);
    expect(lines.some((l) => l.startsWith("[meta-webhook] refused"))).toBe(true);
    expect(failures.length).toBeGreaterThan(0);
    // The orchestrator road stored Meta's (scrubbed) message: without this the scrub would have nothing to show.
    expect(stored.some((r) => r.includes("access_token=[token]"))).toBe(true);
    // The render road met a Higgsfield that quoted its key, and the job's failure shows it blanked.
    expect(renderEchoed).toBe(true);
    expect([...credentials].some((c) => c.startsWith("hf-scrape-id:"))).toBe(true);
  });

  it("no console line, job failure or written row holds a token, the app secret or the sealing key", () => {
    const rows = recorders.flatMap((r) => r.writes().map((q) => JSON.stringify(q.write?.payload ?? null)));
    expect([...found("a log line", lines), ...found("a job failure", failures), ...found("a written row", rows), ...found("a stored action", stored)]).toEqual([]);
  });
});
