import { describe, expect, it } from "vitest";
import { leadOutcomeSchema } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { readLeadOutcomes } from "./leadOutcomes.js";

/**
 * Recruiting's `LeadOutcomes` (Q-AD34) over a fake that APPLIES the query: `eq`, `in`, `gte`, `not … is
 * null`, `order` and `range` (PostgREST's 1,000-row cap included). The recorder alone does not filter
 * (memory supabase-recorder-does-not-filter), so without this a lost org filter or a lost page would pass.
 */
const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER = "0b000000-0000-4000-8000-000000000002";
const SINCE = "2026-10-05T05:00:00.000Z"; // Monday 10/05 00:00 CDT
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function applying(rows: Array<Record<string, unknown>>) {
  return (q: RecordedQuery) => {
    let out = rows;
    let range: [number, number] | null = null;
    for (const op of q.ops) {
      const [col, a, b] = op.args as [string, unknown, unknown];
      if (op.method === "eq") out = out.filter((r) => r[col] === a);
      if (op.method === "in") out = out.filter((r) => (a as unknown[]).includes(r[col]));
      if (op.method === "gte") out = out.filter((r) => Date.parse(String(r[col])) >= Date.parse(String(a)));
      if (op.method === "not" && a === "is" && b === null) out = out.filter((r) => r[col] !== null && r[col] !== undefined);
      if (op.method === "order") out = [...out].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : 1));
      if (op.method === "range") range = [op.args[0] as number, op.args[1] as number];
    }
    // PostgREST answers at most 1,000 rows whatever range was asked.
    const [from, to] = range ?? [0, 999];
    return out.slice(from, Math.min(to + 1, from + 1000));
  };
}

const lead = (n: number, patch: Record<string, unknown> = {}) => ({
  id: id(n), org_id: ORG, channel: "meta", external_ref: `leadgen-${n}`, campaign_ref: "camp-1", platform_created_at: "2026-10-06T15:00:00Z", received_at: "2026-10-06T15:01:00Z", ...patch,
});

function world(t: Partial<Record<string, Array<Record<string, unknown>>>>) {
  const names = ["recruiting_leads", "recruiting_contacts", "lead_conversions", "driver_applications", "drivers", "applicant_dispositions"];
  return createSupabaseRecorder({ tables: Object.fromEntries(names.map((n) => [n, applying(t[n] ?? [])])) });
}

describe("recruiting's LeadOutcomes — each stage from the row that records it (Q-AD34)", () => {
  it("reads each recorded stage from its row: first contact, conversion, filed application, hire, and a loss only without a hire", async () => {
    const D1 = id(901), D2 = id(902);
    const rec = world({
      recruiting_leads: [lead(1), lead(2), lead(3)],
      recruiting_contacts: [
        { id: id(11), org_id: ORG, lead_id: id(1), contacted_at: "2026-10-07T16:00:00Z" },
        { id: id(12), org_id: ORG, lead_id: id(1), contacted_at: "2026-10-06T18:00:00Z" },
      ],
      lead_conversions: [{ id: id(21), org_id: ORG, lead_id: id(1), driver_id: D1, created_at: "2026-10-08T15:00:00Z" },
        { id: id(22), org_id: ORG, lead_id: id(2), driver_id: D2, created_at: "2026-10-08T16:00:00Z" }],
      driver_applications: [{ id: id(31), org_id: ORG, driver_id: D1, certified_at: "2026-10-10T15:00:00Z" }],
      drivers: [{ id: D1, org_id: ORG, status: "terminated", hire_date: "2026-10-20" }, { id: D2, org_id: ORG, status: "applicant", hire_date: null }],
      applicant_dispositions: [
        { id: id(41), org_id: ORG, driver_id: D2, decided_on: "2026-10-12", created_at: "2026-10-12T15:00:00Z" },
        { id: id(42), org_id: ORG, driver_id: D2, decided_on: "2026-10-14", created_at: "2026-10-14T15:00:00Z" },
        { id: id(43), org_id: ORG, driver_id: D1, decided_on: "2026-10-11", created_at: "2026-10-11T15:00:00Z" },
      ],
    });
    const out = await readLeadOutcomes(rec.client, ORG, SINCE);
    expect(out.map((o) => leadOutcomeSchema.parse(o))).toHaveLength(3);
    expect(out[0]).toEqual({ lead_id: id(1), provider: "meta", platform_lead_ref: "leadgen-1", campaign_id: "camp-1", arrived_at: "2026-10-06T15:00:00.000Z", reached: {
      contacted: "2026-10-06T18:00:00.000Z", converted: "2026-10-08T15:00:00.000Z", applied: "2026-10-10T15:00:00.000Z",
      // Hired and later terminated is still a hire; a disposition on a hired driver is not a loss.
      hired: "2026-10-20T05:00:00.000Z",
    } });
    // The newest disposition stands (a correction is a new row, 0238).
    expect(out[1]!.reached).toEqual({ converted: "2026-10-08T16:00:00.000Z", lost_after_conversion: "2026-10-14T05:00:00.000Z" });
    expect(out[2]!.reached).toEqual({});
    expectOrgScoped(rec, ORG);
  });

  it("hired means hire_date set and status no longer applicant — never a hire date from before the lead arrived", async () => {
    const rec = world({
      recruiting_leads: [lead(1), lead(2), lead(3)],
      lead_conversions: [1, 2, 3].map((n) => ({ id: id(20 + n), org_id: ORG, lead_id: id(n), driver_id: id(900 + n), created_at: "2026-10-08T15:00:00Z" })),
      drivers: [
        { id: id(901), org_id: ORG, status: "active", hire_date: "2026-10-06" },     // hired the day the lead arrived
        { id: id(902), org_id: ORG, status: "active", hire_date: "2024-03-01" },     // an old roster row the lead merged into
        { id: id(903), org_id: ORG, status: "applicant", hire_date: "2026-10-20" },  // a date typed on an applicant is not a hire
      ],
    });
    const out = await readLeadOutcomes(rec.client, ORG, SINCE);
    expect(out.map((o) => o.reached.hired ?? null)).toEqual(["2026-10-06T05:00:00.000Z", null, null]);
  });

  it("only this org's ad leads that arrived since: a typed-in lead, another org's and an older one are not read", async () => {
    const rec = world({ recruiting_leads: [
      lead(1),
      lead(2, { campaign_ref: null }),
      lead(3, { org_id: OTHER }),
      // Received after `since` but arrived on the platform before it: a backfill of an old lead.
      lead(4, { platform_created_at: "2026-10-04T15:00:00Z", received_at: "2026-10-06T15:00:00Z" }),
      lead(5, { platform_created_at: null, received_at: "2026-10-05T06:00:00Z" }),
    ] });
    expect((await readLeadOutcomes(rec.client, ORG, SINCE)).map((o) => [o.lead_id, o.arrived_at])).toEqual([
      [id(1), "2026-10-06T15:00:00.000Z"], [id(5), "2026-10-05T06:00:00.000Z"],
    ]);
  });

  it("reads past PostgREST's 1,000-row cap on the leads and on each stage's rows", async () => {
    const leads = Array.from({ length: 1_203 }, (_, i) => lead(i + 1));
    const contacts = leads.map((l, i) => ({ id: id(100_000 + i), org_id: ORG, lead_id: l.id, contacted_at: "2026-10-07T16:00:00Z" }));
    const rec = world({ recruiting_leads: leads, recruiting_contacts: contacts });
    const out = await readLeadOutcomes(rec.client, ORG, SINCE);
    expect(out).toHaveLength(1_203);
    expect(out.filter((o) => o.reached.contacted).length).toBe(1_203);
    // No id list is longer than a chunk: a big cohort never overflows a request header.
    expect(Math.max(...rec.forTable("recruiting_contacts").flatMap((q) => q.ops.filter((o) => o.method === "in").map((o) => (o.args[1] as unknown[]).length)))).toBe(100);
  });
});
