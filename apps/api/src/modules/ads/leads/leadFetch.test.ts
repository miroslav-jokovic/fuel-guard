import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LeadSink, PlatformLead } from "@silvicom/shared";
import { testEnv } from "../../../testing/testEnv.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { SIMULATOR_PAGE_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { backfillConnectionLeads } from "./backfill.js";
import { fetchWebhookLead, LeadFetchError, type LeadFetchDeps } from "./leadFetch.js";

/**
 * B4b — the lead a leadgen webhook named, read by id against the in-process simulator over real HTTP, with
 * a sink that stores a lead once per (provider, lead id) as recruiting's does. The webhook and the hourly
 * backfill are two roads to one lead; §4R's bar is that it arrives once whichever road brings it.
 */

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000a2";
const CONN = "00000000-0000-4000-8000-0000000000c1";
const CAMP = "00000000-0000-4000-8000-00000000aa01";
const OPENING = "00000000-0000-4000-8000-00000000bb01";
const NOW = new Date("2026-11-03T15:00:00Z");

let fake: FakeMeta;
let form: string;
let rec: SupabaseRecorder;

function memorySink(opts: { refuse?: boolean } = {}) {
  const stored = new Map<string, PlatformLead>();
  const sink: LeadSink = {
    async accept(_org, lead) {
      if (opts.refuse) throw new Error("check violation: phone '+1312…'");
      const key = `${lead.provider}|${lead.platform_lead_ref}`;
      if (stored.has(key)) return { stored: "duplicate", ref: key };
      stored.set(key, lead);
      return { stored: "new", ref: key };
    },
  };
  return { sink, stored };
}

function seed(over: { status?: string } = {}) {
  rec = createSupabaseRecorder({
    tables: {
      ads_platform_connections: postgrestFixture([
        { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, page_token_sealed: null, status: over.status ?? "connected" },
      ]),
      memberships: postgrestFixture([{ org_id: ORG, user_id: "u-admin", role: "admin", suspended_at: null }]),
      ads_settings_versions: [],
      driver_app_features: [],
      ads_campaigns: postgrestFixture([
        { id: CAMP, org_id: ORG, connection_id: CONN, brief_source: "recruiting_opening", brief_ref: `${OPENING}@v2`, platform_refs: { meta_form_id: form } },
        // Another carrier's campaign on a form of the same id must never be the one found.
        { id: "00000000-0000-4000-8000-00000000ff01", org_id: OTHER_ORG, connection_id: CONN, brief_source: "recruiting_opening", brief_ref: "other@v1", platform_refs: { meta_form_id: form } },
      ]),
    },
  });
}
const deps = (sink: LeadSink): LeadFetchDeps => ({ admin: rec.client as never, sink, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: () => NOW });

beforeAll(async () => {
  fake = await simulatorFakeForTests();
});
afterAll(async () => stopSimulatorForTests());
beforeEach(() => {
  resetGraphThrottles();
  fake.leads.leads.length = 0;
  form = (fake.forms.create(SIMULATOR_PAGE_ID, {
    name: `F-${Math.random()}`, locale: "EN_US", questions: JSON.stringify([{ type: "FULL_NAME", key: "full_name" }]),
    privacy_policy: JSON.stringify({ url: "https://silvicom.test/privacy" }),
  }).body as { id: string }).id;
});

describe("fetchWebhookLead — the lead a webhook named", () => {
  it("reaches the sink with its campaign and brief, read by id with the Page's token", async () => {
    const lead = fake.leads.submit(form, { full_name: "Ray Driver", phone_number: "+13125550100" }, new Date(NOW.getTime() - 60_000), { ad_id: "777" });
    seed();
    const { sink, stored } = memorySink();
    const before = fake.requests.length;
    const r = await fetchWebhookLead(deps(sink), ORG, { leadgenId: lead.id, formId: form });
    expect(r).toEqual({ outcome: "stored", lead_id: lead.id, campaign_id: CAMP, latency_ms: 60_000 });
    expect([...stored.values()][0]).toMatchObject({
      provider: "simulator", platform_lead_ref: lead.id, campaign_id: CAMP, brief_source: "recruiting_opening", brief_ref: `${OPENING}@v2`,
      answers: { full_name: "Ray Driver", phone_number: "+13125550100" },
    });
    // FakeMeta answers a lead only to its form's Page token (190 otherwise), so a read that succeeded used it.
    expect(fake.requests.slice(before).map((q) => q.path)).toEqual([`/v26.0/${lead.id}`]);
    expectOrgScoped(rec, ORG);
  });

  const rung = () => rec.rpcs().filter((c) => c.fn === "emit_notification").map((c) => c.args as Record<string, unknown>);

  it("past five minutes a new lead is stored, and rings the connection's late-lead alert", async () => {
    const lead = fake.leads.submit(form, { full_name: "Ray Driver" }, new Date(NOW.getTime() - 6 * 60_000));
    seed();
    const r = await fetchWebhookLead(deps(memorySink().sink), ORG, { leadgenId: lead.id, formId: form });
    expect(r).toMatchObject({ outcome: "stored", latency_ms: 360_000 });
    expect(rung()).toEqual([expect.objectContaining({ p_user: "u-admin", p_category: "lead_intake_failing", p_dedupe_key: `lead_intake_failing:webhook:${CONN}:2026-11-03` })]);
  });

  it("at five minutes, and for a lead already stored, nothing rings; a lead dated ahead of our clock reads as zero", async () => {
    const onTime = fake.leads.submit(form, { full_name: "Ray Driver" }, new Date(NOW.getTime() - 5 * 60_000));
    seed();
    const { sink } = memorySink();
    await fetchWebhookLead(deps(sink), ORG, { leadgenId: onTime.id, formId: form });
    const again = await fetchWebhookLead({ ...deps(sink), now: () => new Date(NOW.getTime() + 3_600_000) }, ORG, { leadgenId: onTime.id, formId: form });
    expect([again.outcome, rung()]).toEqual(["duplicate", []]);
    const ahead = fake.leads.submit(form, { full_name: "Ana Lopez" }, new Date(NOW.getTime() + 30_000));
    expect(await fetchWebhookLead(deps(sink), ORG, { leadgenId: ahead.id, formId: form })).toMatchObject({ latency_ms: 0 });
  });

  it("the same lead from the webhook and from the backfill is stored once", async () => {
    const lead = fake.leads.submit(form, { full_name: "Ana Lopez" }, new Date(NOW.getTime() - 60_000));
    seed();
    const { sink, stored } = memorySink();
    await fetchWebhookLead(deps(sink), ORG, { leadgenId: lead.id, formId: form });
    const b = await backfillConnectionLeads({ ...deps(sink), now: () => NOW }, ORG, CONN);
    expect([b.read, b.stored_new, b.duplicates, stored.size]).toEqual([1, 0, 1, 1]);
    expect(await fetchWebhookLead(deps(sink), ORG, { leadgenId: lead.id, formId: form })).toMatchObject({ outcome: "duplicate" });
  });

  it("a form no campaign of this carrier has is acknowledged as not ours, and Meta is not asked", async () => {
    seed();
    const before = fake.requests.length;
    const r = await fetchWebhookLead(deps(memorySink().sink), ORG, { leadgenId: "123", formId: "999999999" });
    expect(r).toEqual({ outcome: "not_ours", lead_id: "123", form_id: "999999999" });
    expect(fake.requests.length).toBe(before);
  });
});

describe("fetchWebhookLead — it throws, so the job retries and the backfill is the net", () => {
  it("a lead Meta refuses to read fails, naming the lead by id", async () => {
    const lead = fake.leads.submit(form, { full_name: "Ray" }, NOW);
    fake.inject("GET", new RegExp(`^${lead.id}$`), { kind: "token_expired" });
    seed();
    await expect(fetchWebhookLead(deps(memorySink().sink), ORG, { leadgenId: lead.id, formId: form })).rejects.toThrow(`lead ${lead.id} not brought in — graph:`);
  });

  it("a lead that is not on the form the delivery named is not stored", async () => {
    const lead = fake.leads.submit(form, { full_name: "Ray" }, NOW);
    seed();
    const { sink, stored } = memorySink();
    // The org owns `form`, so the campaign is found; Meta then says the lead lives on another form.
    fake.leads.leads[0]!.form_id = "424242";
    fake.forms.forms.set("424242", { ...fake.forms.forms.get(form)!, id: "424242" });
    const err = await fetchWebhookLead(deps(sink), ORG, { leadgenId: lead.id, formId: form }).catch((e: unknown) => e);
    expect([(err as LeadFetchError).reason, stored.size]).toEqual(["form_mismatch", 0]);
  });

  it("a lead the sink refuses fails by id, never by the person's details", async () => {
    const lead = fake.leads.submit(form, { full_name: "Ray", phone_number: "+13125550100" }, NOW);
    seed();
    const err = (await fetchWebhookLead(deps(memorySink({ refuse: true }).sink), ORG, { leadgenId: lead.id, formId: form }).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe(`ads_lead_fetch: lead ${lead.id} not brought in — sink`);
  });

  it("a disconnected connection fails rather than reporting nothing", async () => {
    const lead = fake.leads.submit(form, { full_name: "Ray" }, NOW);
    seed({ status: "disconnected" });
    await expect(fetchWebhookLead(deps(memorySink().sink), ORG, { leadgenId: lead.id, formId: form })).rejects.toThrow("connection:disconnected");
  });
});
