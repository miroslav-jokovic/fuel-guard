import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadSink, PlatformLead } from "@silvicom/shared";
import express from "express";
import { createApp } from "../../../app.js";
import { mountBodyParsers } from "../../../appHttp.js";
import { setAppLocals } from "../../../lib/appLocals.js";
import { loadEnv, type Env } from "../../../env.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { SIMULATOR_PAGE_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { signMetaBody } from "../platforms/simulator/fakeMetaWebhooks.js";
import { fetchWebhookLead } from "../leads/leadFetch.js";
import { leadgenWebhookCounts, META_WEBHOOK_PATH, resetLeadgenWebhookCountsForTests, type LeadFetchEnqueue } from "../leads/leadgenWebhook.js";
import { metaWebhookRouter, queueEnqueue } from "./metaWebhook.js";
import type { QueueDriver } from "../../../queue/types.js";

/**
 * `/api/webhooks/meta` (B4b). The receiver runs on the app's own body parsers (`mountBodyParsers`, which keep
 * the raw bytes), with the queue handed in: a stand-in that keeps the jobs ledger's one rule that matters
 * here — one ACTIVE job per dedup key, across every carrier (0095's global index). Deliveries are FakeMeta's,
 * signed with its app secret. A last test asserts `createApp` routes the path the App Dashboard is given — a
 * re-mount breaks a test, not the integration (Samsara's receiver 404'd for six months on a wrong path).
 */
const queue = { jobs: [] as Array<{ orgId: string; payload: { leadgenId: string; formId: string }; done: boolean }>, kicks: [] as number[] };
const enqueue: LeadFetchEnqueue = async (orgId, payload) => {
  if (queue.jobs.some((j) => !j.done && j.orgId === orgId && j.payload.leadgenId === payload.leadgenId)) return "conflict";
  queue.jobs.push({ orgId, payload, done: false });
  return "queued";
};

const ORG = "00000000-0000-4000-8000-0000000000a1";
const CONN = "00000000-0000-4000-8000-0000000000c1";
const CAMP = "00000000-0000-4000-8000-00000000aa01";
const VERIFY = "our-verify-token-7f3a";

let fake: FakeMeta;
let form: string;
let db: SupabaseRecorder;
const servers: Server[] = [];
let configured = "";
let unconfigured = "";
let realApp = "";

async function listen(env: Env, real = false): Promise<string> {
  const app = real ? createApp(env) : express();
  if (!real) {
    setAppLocals(app, { env });
    mountBodyParsers(app);
    app.use(META_WEBHOOK_PATH, metaWebhookRouter({
      admin: () => db.client as never,
      enqueue: () => enqueue,
      kick: async (_e, _a, n) => {
        queue.kicks.push(n);
      },
    }));
  }
  return new Promise((resolve) => {
    const s = app.listen(0, () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
    servers.push(s);
  });
}

const post = (base: string, body: string, signature?: string) =>
  fetch(`${base}${META_WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) }, body });

function memorySink() {
  const stored = new Map<string, PlatformLead>();
  const sink: LeadSink = {
    async accept(_org, lead) {
      const key = `${lead.provider}|${lead.platform_lead_ref}`;
      if (stored.has(key)) return { stored: "duplicate", ref: key };
      stored.set(key, lead);
      return { stored: "new", ref: key };
    },
  };
  return { sink, stored };
}

beforeAll(async () => {
  fake = await simulatorFakeForTests();
  const base = { NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
  configured = await listen(loadEnv({ ...base, META_APP_SECRET: fake.webhooks.appSecret, META_WEBHOOK_VERIFY_TOKEN: VERIFY } as NodeJS.ProcessEnv));
  unconfigured = await listen(loadEnv(base as NodeJS.ProcessEnv));
  realApp = await listen(loadEnv(base as NodeJS.ProcessEnv), true);
});
afterAll(async () => {
  for (const s of servers) await closeTestServer(s);
  await stopSimulatorForTests();
});
beforeEach(() => {
  resetGraphThrottles();
  resetLeadgenWebhookCountsForTests();
  queue.jobs.length = 0;
  queue.kicks.length = 0;
  fake.leads.leads.length = 0;
  fake.webhooks.subscribe({ id: SIMULATOR_PAGE_ID, tasks: ["MODERATE"] }, { subscribed_fields: "leadgen" });
  form = (fake.forms.create(SIMULATOR_PAGE_ID, {
    name: `F-${Math.random()}`, locale: "EN_US", questions: JSON.stringify([{ type: "FULL_NAME", key: "full_name" }]),
    privacy_policy: JSON.stringify({ url: "https://silvicom.test/privacy" }),
  }).body as { id: string }).id;
  db = createSupabaseRecorder({
    tables: {
      ads_platform_connections: postgrestFixture([{ id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, page_token_sealed: null, status: "connected" }]),
      ads_campaigns: postgrestFixture([{ id: CAMP, org_id: ORG, connection_id: CONN, brief_source: "recruiting_opening", brief_ref: "op@v1", platform_refs: { meta_form_ids: { en: form } } }]),
    },
  });
});

const submit = (name: string) => fake.leads.submit(form, { full_name: name }, new Date());
const delivery = (leads = [submit("Ray Driver")], opts: { forge?: boolean } = {}) => fake.webhooks.leadgenDelivery(SIMULATOR_PAGE_ID, leads, opts)!;

describe("GET — Meta's subscribe handshake", () => {
  const verify = (base: string, token: string) =>
    fetch(`${base}${META_WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=1158201444`);

  it("echoes the challenge, as plain text, for our verify token", async () => {
    const r = await verify(configured, VERIFY);
    expect([r.status, await r.text(), r.headers.get("content-type")?.startsWith("text/plain")]).toEqual([200, "1158201444", true]);
  });

  it("refuses a wrong verify token with 403 and echoes nothing", async () => {
    const r = await verify(configured, "guess");
    expect([r.status, (await r.text()).includes("1158201444")]).toEqual([403, false]);
  });

  it("answers 503 while no verify token is configured", async () => {
    expect((await verify(unconfigured, VERIFY)).status).toBe(503);
  });
});

describe("POST — only what Meta signed is believed", () => {
  it("no META_APP_SECRET: 503, counted, and nothing is looked up or queued", async () => {
    const d = delivery();
    const r = await post(unconfigured, d.body, d.signature);
    expect([r.status, leadgenWebhookCounts().no_secret, queue.jobs.length, db.queries.length]).toEqual([503, 1, 0, 0]);
  });

  it("a forged body is 401, counted, and nothing is queued", async () => {
    const d = delivery([submit("Ray")], { forge: true });
    const r = await post(configured, d.body, d.signature);
    expect([r.status, leadgenWebhookCounts().bad_signature, queue.jobs.length]).toEqual([401, 1, 0]);
  });

  it("a genuine signature over a body altered after signing is 401", async () => {
    const d = delivery();
    const r = await post(configured, d.body.replace(form, "999999999"), d.signature);
    expect([r.status, queue.jobs.length]).toEqual([401, 0]);
  });

  it("an unsigned body, or a malformed header, is 401", async () => {
    const d = delivery();
    expect((await post(configured, d.body)).status).toBe(401);
    expect((await post(configured, d.body, d.signature.replace("sha256=", "sha1="))).status).toBe(401);
    expect(leadgenWebhookCounts().bad_signature).toBe(2);
  });

  it("a valid body serialised differently still verifies — the check is over the raw bytes", async () => {
    // Pretty-printed and keys reordered: `JSON.stringify(req.body)` would give back different bytes.
    const lead = submit("Ray");
    const parsed = JSON.parse(delivery([lead]).body) as { entry: unknown[]; object: string };
    const body = JSON.stringify({ entry: parsed.entry, object: parsed.object }, null, 2);
    const r = await post(configured, body, signMetaBody(fake.webhooks.appSecret, body));
    expect([r.status, queue.jobs.map((j) => j.payload)]).toEqual([200, [{ leadgenId: lead.id, formId: form }]]);
  });

  it("a body with non-ASCII text verifies when Meta signed its escaped-unicode form", async () => {
    const lead = submit("Ray");
    const d = JSON.parse(delivery([lead]).body) as { entry: Array<Record<string, unknown>> };
    d.entry[0]!.note = "Ñandú äöå";
    const raw = JSON.stringify(d);
    const escaped = raw.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
    expect((await post(configured, raw, signMetaBody(fake.webhooks.appSecret, escaped))).status).toBe(200);
    expect((await post(configured, raw, signMetaBody(`${fake.webhooks.appSecret}x`, escaped))).status).toBe(401);
  });
});

describe("POST — what a signed delivery queues", () => {
  it("answers 200 and queues one fetch per lead, kicked only after answering", async () => {
    const a = submit("Ray");
    const b = submit("Ana");
    const r = await post(configured, delivery([a, b]).body, delivery([a, b]).signature);
    expect([r.status, await r.json()]).toEqual([200, { ok: true, queued: 2 }]);
    expect(queue.jobs.map((j) => [j.orgId, j.payload.leadgenId])).toEqual([[ORG, a.id], [ORG, b.id]]);
    await vi.waitFor(() => expect(queue.kicks).toEqual([2]));
  });

  it("a duplicate delivery is one job and one lead — and one after the job finished is still one lead", async () => {
    const lead = submit("Ray");
    const d = delivery([lead]);
    expect((await post(configured, d.body, d.signature)).status).toBe(200);
    expect((await post(configured, d.body, d.signature)).status).toBe(200);
    expect([queue.jobs.length, leadgenWebhookCounts().already_queued]).toEqual([1, 1]);

    const { sink, stored } = memorySink();
    const deps = { admin: db.client as never, sink, env: loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv), processEnv: { NODE_ENV: "test" }, now: () => new Date() };
    await fetchWebhookLead(deps, ORG, queue.jobs[0]!.payload);
    queue.jobs[0]!.done = true;
    // Meta retries for 36 hours; the next copy finds the slot free and the sink holds the lead already.
    await post(configured, d.body, d.signature);
    expect(queue.jobs.length).toBe(2);
    expect(await fetchWebhookLead(deps, ORG, queue.jobs[1]!.payload)).toMatchObject({ outcome: "duplicate" });
    expect(stored.size).toBe(1);
  });

  it("a lead on a campaign's Spanish form finds its carrier like an English one (B2c2: a form per language)", async () => {
    const lead = submit("Ana");
    db = createSupabaseRecorder({ tables: { ads_campaigns: postgrestFixture([{ id: CAMP, org_id: ORG, connection_id: CONN, brief_source: "recruiting_opening", brief_ref: "op@v1", platform_refs: { meta_form_ids: { en: "990000000777", es: form } } }]) } });
    const r = await post(configured, delivery([lead]).body, delivery([lead]).signature);
    expect([r.status, queue.jobs.map((j) => [j.orgId, j.payload.leadgenId]), leadgenWebhookCounts().unknown_form]).toEqual([200, [[ORG, lead.id]], 0]);
  });

  it("a form we do not own is answered 200, counted, and nothing is queued or stored", async () => {
    const lead = submit("Ray");
    db = createSupabaseRecorder({ tables: { ads_campaigns: postgrestFixture([]) } });
    const r = await post(configured, delivery([lead]).body, delivery([lead]).signature);
    expect([r.status, queue.jobs.length, leadgenWebhookCounts().unknown_form]).toEqual([200, 0, 1]);
  });

  it("a signed change without usable ids is counted and skipped; the rest of the batch is queued", async () => {
    const lead = submit("Ray");
    const d = JSON.parse(delivery([lead]).body) as { entry: Array<{ changes: unknown[] }> };
    d.entry[0]!.changes.push({ field: "leadgen", value: { leadgen_id: "abc; drop", form_id: form, page_id: SIMULATOR_PAGE_ID } }, { field: "feed", value: {} });
    const body = JSON.stringify(d);
    const r = await post(configured, body, signMetaBody(fake.webhooks.appSecret, body));
    expect([r.status, queue.jobs.length, leadgenWebhookCounts().malformed]).toEqual([200, 1, 1]);
  });

  it("a Page not subscribed to leadgen gets no delivery at all — the backfill is what brings its leads", () => {
    fake.webhooks.subscriptions.delete(SIMULATOR_PAGE_ID);
    expect(fake.webhooks.leadgenDelivery(SIMULATOR_PAGE_ID, [submit("Ray")])).toBeNull();
  });
});

describe("the mount", () => {
  it("createApp routes the path Meta is given, unauthenticated, and fails closed while unconfigured", async () => {
    const get = await fetch(`${realApp}${META_WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`);
    const d = delivery();
    const posted = await post(realApp, d.body, d.signature);
    expect([get.status, posted.status]).toEqual([503, 503]);
  });
});

describe("the real queue", () => {
  it("one row per lead, keyed by carrier and lead, so the ledger's own conflict is the duplicate", async () => {
    const active = new Set<string>();
    const driver = {
      enqueue: async (_kind: string, o: { dedupKey?: string | null }) => {
        if (active.has(o.dedupKey!)) return { conflict: true as const };
        active.add(o.dedupKey!);
        return { jobId: "j" };
      },
    } as unknown as QueueDriver;
    const q = queueEnqueue(null as never, driver);
    const ask = { leadgenId: "555", formId: "777" };
    expect([await q(ORG, ask), await q(ORG, ask)]).toEqual(["queued", "conflict"]);
    expect([...active]).toEqual([`ads_lead_fetch:${ORG}:555`]);
  });
});
