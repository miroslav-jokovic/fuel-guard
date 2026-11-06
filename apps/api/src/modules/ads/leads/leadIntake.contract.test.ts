import { HIRING_PROFILE_V1, type LeadProjection } from "@silvicom/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leadSinkFor } from "../../../queue/handlers/leadSinkFor.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { openMetaTarget, type MetaTarget } from "../platforms/meta/contract/metaTarget.js";
import { compareRecorded, fromWire, kindOf } from "../platforms/meta/contract/readings.js";
import { contractEnv, targetConnection } from "../platforms/meta/contract/targetConnection.js";
import { MetaGraph, resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { leadgenDeliveryBody, signMetaBody } from "../platforms/simulator/fakeMetaWebhooks.js";
import { fetchWebhookLead } from "./leadFetch.js";
import { adsLeadFetchDedupKey, receiveLeadgenDelivery } from "./leadgenWebhook.js";

/**
 * LEAD INTAKE's L4 suite (stage2-kit-2c; §4R "a test lead from Meta's lead-ads testing tool"). The Publisher's
 * pattern: one file, the target `ADS_TARGET` names, a fault proxy in front.
 *
 * The lead is the target's: on the sandbox, the one the owner made with the Lead Ads Testing Tool
 * (`META_SANDBOX_LEAD_ID`); on the fake, the one `metaTarget.ts` submits. Its form is READ from the target, never
 * named. The road is production's: a signed leadgen delivery → `receiveLeadgenDelivery` (signature, form owner,
 * one job per lead) → `fetchWebhookLead` (the Page token, unsealed through the registry, reading the lead from the
 * target) → the sink the job handler uses (`leadSinkFor`), whose `ingest_lead` keeps one row per carrier ×
 * channel × lead.
 *
 * What it cannot be is Meta's own POST: a sandbox's webhook cannot reach a laptop. So the delivery is built by
 * `leadgenDeliveryBody` (the fake's reading of the webhook pages) and signed with this run's secret; the parts
 * Meta answers — the lead, its form, its fields — come from the target and are recorded as readings.
 */

const env = { ...contractEnv(), META_APP_SECRET: "contract-app-secret" };
const ORG = "00000000-0000-4000-8000-0000000000a1";
const CONN = "00000000-0000-4000-8000-0000000000c1";
const CAMP = "00000000-0000-4000-8000-00000000aa01";
const OPENING = "00000000-0000-4000-8000-00000000bb01";
const PROFILE = "00000000-0000-4000-8000-00000000cc01";

let t: MetaTarget;
let lead: { id: string; form_id: string; ad_id: string | null; created_time: string };
beforeEach(async () => {
  resetGraphThrottles();
  t = await openMetaTarget();
  if (!t.leadId) throw new Error("ADS_TARGET=sandbox needs META_SANDBOX_LEAD_ID for Lead intake — a lead made with the Lead Ads Testing Tool on the sandbox Page");
  const g = new MetaGraph({ token: t.pageToken(), throttleKey: "lead-intake-setup", baseUrl: t.base, timeoutMs: t.timeoutMs, sleep: async () => {} });
  const r = await g.get<{ id: string; form_id?: string; ad_id?: string; created_time?: string }>(t.leadId, { fields: "id,form_id,ad_id,created_time" });
  if (!r.ok || !r.data.form_id || !r.data.created_time) throw new Error(`the target's lead ${t.leadId} could not be read with its form: ${r.ok ? "no form_id" : r.error.error_code}`);
  lead = { id: r.data.id, form_id: r.data.form_id, ad_id: r.data.ad_id ?? null, created_time: r.data.created_time };
  t.proxy.calls.length = 0;
});
afterEach(() => t.close());

function world() {
  const rows = new Map<string, LeadProjection>();
  const rec = createSupabaseRecorder({
    tables: {
      ads_platform_connections: postgrestFixture([targetConnection(t, env, { org: ORG, connection: CONN })]),
      ads_campaigns: postgrestFixture([{ id: CAMP, org_id: ORG, connection_id: CONN, brief_source: "recruiting_opening", brief_ref: `${OPENING}@v2`, platform_refs: { meta_form_ids: { en: lead.form_id } } }]),
      recruiting_opening_versions: postgrestFixture([{ org_id: ORG, opening_id: OPENING, version: 2, profile_version_id: PROFILE }]),
      hiring_profile_versions: postgrestFixture([{ org_id: ORG, id: PROFILE, requirements: HIRING_PROFILE_V1 }]),
      lead_match_verdicts: (q: RecordedQuery) => ({ data: q.write ? q.write.payload : [] }),
      memberships: postgrestFixture([{ org_id: ORG, user_id: "u-admin", role: "admin", suspended_at: null }]),
    },
    rpc: (fn, args) => {
      if (fn !== "ingest_lead") return fn === "emit_notification" ? "ntf-1" : null;
      const { p_org, p_lead } = args as { p_org: string; p_lead: LeadProjection };
      const key = `${p_org}|${p_lead.channel}|${p_lead.external_ref}`;
      const stored = rows.has(key) ? "duplicate" : "new";
      rows.set(key, p_lead);
      return { lead_id: "50000000-0000-4000-8000-000000000001", stored, matches: { leads: [], drivers: [] } };
    },
  });
  const queue = new Map<string, { leadgenId: string; formId: string }>();
  const enqueue = async (orgId: string, job: { leadgenId: string; formId: string }) => {
    const key = adsLeadFetchDedupKey(orgId, job.leadgenId);
    if (queue.has(key)) return "conflict" as const;
    queue.set(key, job);
    return "queued" as const;
  };
  const admin = rec.client as never;
  const deps = { admin, sink: leadSinkFor(admin), env, processEnv: { NODE_ENV: "test" }, now: () => new Date(), metaGraphBase: t.base };
  return { rec, rows, queue, enqueue, admin, deps };
}

const delivery = () => {
  const body = leadgenDeliveryBody(t.pageId, [lead], new Date());
  return { raw: Buffer.from(body), signature: signMetaBody(env.META_APP_SECRET, body) };
};

describe("lead intake on the target (§4R Lead intake L4)", () => {
  it("the target's test lead goes webhook → fetch → one lead row, and a second delivery of it makes no second row", async () => {
    const w = world();
    const d = delivery();
    expect(await receiveLeadgenDelivery({ env, admin: w.admin, enqueue: w.enqueue }, d.raw, d.signature)).toEqual({ status: 200, body: { ok: true, queued: 1 } });
    // Meta delivers again (its retry, or the same lead in a later batch): the job is not queued twice.
    expect(await receiveLeadgenDelivery({ env, admin: w.admin, enqueue: w.enqueue }, d.raw, d.signature)).toEqual({ status: 200, body: { ok: true, queued: 0 } });
    // The receive's form-owner lookup is the one read that is NOT org-scoped, by design (leadgenWebhook.ts: the
    // delivery names a form, not a carrier). Everything from here on reads and writes as the carrier.
    w.rec.queries.length = 0;
    const [job] = [...w.queue.values()];
    expect(job).toEqual({ leadgenId: lead.id, formId: lead.form_id });
    expect(await fetchWebhookLead(w.deps, ORG, job!)).toMatchObject({ outcome: "stored", lead_id: lead.id, campaign_id: CAMP });
    // The job run twice (a worker killed after the store): the sink answers duplicate, and still one row.
    expect(await fetchWebhookLead(w.deps, ORG, job!)).toMatchObject({ outcome: "duplicate" });
    expect([...w.rows.values()].map((r) => r.external_ref)).toEqual([lead.id]);
    expectOrgScoped(w.rec, ORG);
  });

  it("a delivery signed with another secret is refused and nothing is fetched", async () => {
    const w = world();
    const d = delivery();
    expect(await receiveLeadgenDelivery({ env, admin: w.admin, enqueue: w.enqueue }, d.raw, signMetaBody("not-our-secret", d.raw))).toEqual({ status: 401, body: { ok: false } });
    expect(w.queue.size).toBe(0);
    expect(t.proxy.calls).toEqual([]);
  });

  it("the target's answer to the lead read is what FakeMeta committed to (OUR readings, diffed by field)", async () => {
    const w = world();
    await fetchWebhookLead(w.deps, ORG, { leadgenId: lead.id, formId: lead.form_id });
    const differences = compareRecorded("leads", {
      "lead-read": fromWire(t.proxy.calls, /^\d+$/, "platforms/simulator/fakeMetaLeads.ts", (b) => ({
        id: kindOf(b.id), form_id: kindOf(b.form_id), field_data: kindOf(b.field_data),
        "created_time is +0000": typeof b.created_time === "string" && /\+0000$/.test(b.created_time),
        "each answer is { name, values[] }": Array.isArray(b.field_data) && (b.field_data as Array<{ name?: unknown; values?: unknown }>).every((f) => typeof f.name === "string" && Array.isArray(f.values)),
      })),
    }, t.name);
    expect(differences).toEqual([]);
  });
});
