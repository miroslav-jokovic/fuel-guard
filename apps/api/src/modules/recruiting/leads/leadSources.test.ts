import { describe, expect, it } from "vitest";
import { leadSourceOutcomeSchema } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { readLeadOutcomes, recruitingLeadSources } from "./leadOutcomes.js";

/**
 * Recruiting's `LeadSources` (V7d) — every source, a window closed at both ends, the ad Meta named — over a fake
 * that APPLIES the query, as `leadOutcomes.test.ts` does (that file holds the stages themselves). The `raw->>ad_id`
 * alias is the database's to compute; the fixture rows carry `ad_ref` as PostgREST would answer it.
 */
const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER = "0b000000-0000-4000-8000-000000000002";
const FROM = "2026-11-01T05:00:00.000Z";
const TO = "2026-11-08T06:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function applying(rows: Array<Record<string, unknown>>) {
  return (q: RecordedQuery) => {
    let out = rows;
    for (const op of q.ops) {
      const [col, a, b] = op.args as [string, unknown, unknown];
      if (op.method === "eq") out = out.filter((r) => r[col] === a);
      if (op.method === "in") out = out.filter((r) => (a as unknown[]).includes(r[col]));
      if (op.method === "gte") out = out.filter((r) => Date.parse(String(r[col])) >= Date.parse(String(a)));
      if (op.method === "not" && a === "is" && b === null) out = out.filter((r) => r[col] !== null && r[col] !== undefined);
    }
    return out;
  };
}
const lead = (n: number, patch: Record<string, unknown> = {}) => ({
  id: id(n), org_id: ORG, channel: "meta", external_ref: `lg-${n}`, campaign_ref: "camp-1", ad_ref: "120200000001",
  platform_created_at: "2026-11-03T15:00:00Z", received_at: "2026-11-03T15:01:00Z", ...patch,
});
function world(leads: Array<Record<string, unknown>>, extra: Record<string, Array<Record<string, unknown>>> = {}) {
  const names = ["recruiting_contacts", "recruiting_lead_closures", "lead_conversions", "driver_applications", "drivers", "applicant_dispositions"];
  return createSupabaseRecorder({ tables: { recruiting_leads: applying(leads), ...Object.fromEntries(names.map((t) => [t, applying(extra[t] ?? [])])) } });
}
const read = (rec: ReturnType<typeof world>) => recruitingLeadSources(rec.client as never).everyLeadBetween(ORG, FROM, TO);

describe("recruiting's LeadSources (V7d)", () => {
  it("reads every source, with its channel, its campaign when it had one, and Meta's ad id", async () => {
    const rec = world([
      lead(1),
      lead(2, { channel: "phone_call", campaign_ref: null, ad_ref: null, external_ref: null, platform_created_at: null }),
      lead(3, { channel: "tenstreet", campaign_ref: null, ad_ref: null }),
    ]);
    const got = await read(rec);
    expect(got.map((l) => [l.channel, l.campaign_id, l.platform_ad_ref])).toEqual([
      ["meta", "camp-1", "120200000001"], ["phone_call", null, null], ["tenstreet", null, null],
    ]);
    for (const l of got) expect(leadSourceOutcomeSchema.safeParse(l).success).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("the window holds on ARRIVAL at both ends, the end exclusive; a late-stored lead that arrived inside still counts", async () => {
    const rec = world([
      lead(1, { platform_created_at: "2026-10-31T23:00:00Z", received_at: "2026-11-01T06:00:00Z" }),
      lead(2, { platform_created_at: "2026-11-08T05:59:59Z", received_at: "2026-11-08T09:00:00Z" }),
      lead(3, { platform_created_at: "2026-11-08T06:00:00Z", received_at: "2026-11-08T06:00:01Z" }),
      lead(4, { platform_created_at: null, received_at: "2026-11-01T05:00:00Z" }),
    ]);
    expect((await read(rec)).map((l) => l.lead_id)).toEqual([id(2), id(4)]);
  });

  it("an ad id that is not Meta's digits is no ad, never passed on", async () => {
    const rec = world([lead(1, { ad_ref: "../../x" }), lead(2, { ad_ref: 12 }), lead(3, { ad_ref: "" })]);
    expect((await read(rec)).map((l) => l.platform_ad_ref)).toEqual([null, null, null]);
  });

  it("another carrier's lead is never read", async () => {
    expect(await read(world([lead(1, { org_id: OTHER })]))).toEqual([]);
  });

  it("the ad-leads reading is unchanged: a lead with no campaign is still left out of it", async () => {
    const rec = world([lead(1), lead(2, { channel: "phone_call", campaign_ref: null })]);
    const got = await readLeadOutcomes(rec.client as never, ORG, FROM);
    expect(got.map((l) => [l.lead_id, l.campaign_id])).toEqual([[id(1), "camp-1"]]);
    expect(Object.keys(got[0]!).sort()).toEqual(["arrived_at", "campaign_id", "lead_id", "platform_lead_ref", "provider", "reached"]);
  });

  it("stages reach a non-ad lead too: a typed-in lead qualified and hired", async () => {
    const D = id(900);
    const rec = world([lead(1, { channel: "walk_in", campaign_ref: null, ad_ref: null })], {
      recruiting_lead_closures: [{ org_id: ORG, lead_id: id(1), kind: "qualified", status_after: "qualified", recorded_at: "2026-11-04T15:00:00Z", seq: 1 }],
      lead_conversions: [{ id: id(50), org_id: ORG, lead_id: id(1), driver_id: D, created_at: "2026-11-04T16:00:00Z" }],
      drivers: [{ id: D, org_id: ORG, status: "active", hire_date: "2026-11-06" }],
    });
    const [l] = await read(rec);
    expect(Object.keys(l!.reached).sort()).toEqual(["converted", "hired", "qualified"]);
  });
});
