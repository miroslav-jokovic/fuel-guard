import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEDULERS } from "../../../schedulers.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { leadUncontactedDedupKey, leadUncontactedTick, startLeadUncontacted, sweepUncontactedLeads } from "./leadUncontacted.js";

/** The alarm on a lead nobody has contacted (D2c), through the recorder's filters and the real `ringLead`. */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-04T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const lead = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, org_id: ORG, channel: "meta", status: "new", phone_e164: `+1708236${id.padStart(4, "0")}`, received_at: ago(30), ...over });

let rec: SupabaseRecorder;
function world(leads: Array<Record<string, unknown>>, over: { contacts?: unknown[]; held?: string[]; sent?: string[]; readFails?: boolean; verdicts?: unknown[] } = {}): void {
  rec = createSupabaseRecorder({
    tables: {
      // PostgREST's `lte`, which the shared fixture does not apply: the cutoff is this test's whole point.
      recruiting_leads: (q: RecordedQuery) => {
        if (over.readFails) return { data: null, error: { message: "down" } };
        const cut = q.ops.find((o) => o.method === "lte")?.args[1] as string | undefined;
        return postgrestFixture(leads.filter((l) => !cut || String(l.received_at) <= cut))({ ...q, ops: q.ops.filter((o) => o.method !== "range") });
      },
      recruiting_contacts: postgrestFixture((over.contacts ?? []) as Array<Record<string, unknown>>),
      sms_suppressions: postgrestFixture((over.held ?? []).map((phone) => ({ org_id: ORG, phone, lifted_at: null }))),
      lead_match_verdicts: postgrestFixture((over.verdicts ?? []) as Array<Record<string, unknown>>),
      driver_app_features: [],
    },
    rpc: (fn) => (fn === "notification_keys_sent" ? over.sent ?? [] : "note-1"),
  });
}
const sweep = (minutes = 15) => sweepUncontactedLeads(rec.client as never, ORG, NOW, { minutes, configured: async () => ["u-dana"] });
const rung = () => rec.rpcs().filter((c) => c.fn === "emit_notification").map((c) => c.args as Record<string, unknown>);

beforeEach(() => vi.clearAllMocks());

describe("a lead nobody has contacted", () => {
  it("rings once it is past the carrier's threshold, and not before, as a warning keyed to the lead", async () => {
    world([lead("1", { received_at: ago(16) }), lead("2", { received_at: ago(14) })]);
    expect(await sweep()).toEqual({ overdue: 1, rung: 1, contacted: 0, held: 0, disqualified_by_answer: 0 });
    expect(rung()).toEqual([expect.objectContaining({
      p_org: ORG, p_user: "u-dana", p_category: "lead_uncontacted", p_severity: "warning", p_entity_id: "1", p_dedupe_key: "lead_uncontacted:1",
    })]);
    expectOrgScoped(rec, ORG);
  });

  it("the threshold is the carrier's: at 60 minutes the same lead waits", async () => {
    world([lead("1")]);
    expect((await sweep(60)).overdue).toBe(0);
  });

  it("a lead already rung is not rung again", async () => {
    world([lead("1")], { sent: ["lead_uncontacted:1"] });
    expect([(await sweep()).rung, rung()]).toEqual([0, []]);
  });

  it("leaves out a lead somebody did call, though its status never moved", async () => {
    world([lead("1")], { contacts: [{ org_id: ORG, lead_id: "1" }] });
    expect(await sweep()).toEqual({ overdue: 1, rung: 0, contacted: 1, held: 0, disqualified_by_answer: 0 });
    expect(rung()).toEqual([]);
  });

  it("never asks anybody to call a number held from contact", async () => {
    world([lead("1"), lead("2")], { held: ["+17082360001"] });
    expect(await sweep()).toEqual({ overdue: 2, rung: 1, contacted: 0, held: 1, disqualified_by_answer: 0 });
    expect(rung().map((a) => a.p_entity_id)).toEqual(["2"]);
  });

  it("a lead whose own answer fails a hard requirement is counted, not rung; unknown and a missed preference still ring (LQ6, Q-AD63)", async () => {
    const v = (lead_id: string, requirement: string, verdict: string, hard = true) =>
      ({ org_id: ORG, lead_id, requirement, verdict, evidence: verdict === "unknown" ? null : "self_reported", detail: { hard }, computed_at: "2026-11-03T15:00:00Z" });
    world([lead("1"), lead("2"), lead("3")], { verdicts: [
      v("1", "class_a", "does_not_meet"),
      v("2", "class_a", "unknown"),
      v("3", "hazmat", "does_not_meet", false),
    ] });
    expect(await sweep()).toEqual({ overdue: 3, rung: 2, contacted: 0, held: 0, disqualified_by_answer: 1 });
    expect(rung().map((a) => a.p_entity_id).sort()).toEqual(["2", "3"]);
  });

  it("a lead with no phone is still rung, and a lead a person typed in or one past new is not", async () => {
    world([lead("1", { phone_e164: null }), lead("2", { channel: "phone_call" }), lead("3", { status: "contacted" })]);
    expect((await sweep()).rung).toBe(1);
    expect(rung().map((a) => a.p_entity_id)).toEqual(["1"]);
  });

  it("every page is swept, not only the first hundred", async () => {
    const many = Array.from({ length: 230 }, (_, i) => lead(String(i + 1)));
    rec = createSupabaseRecorder({
      tables: {
        recruiting_leads: (q: RecordedQuery) => {
          const [from, to] = q.ops.find((o) => o.method === "range")!.args as [number, number];
          return many.slice(from, to + 1);
        },
        recruiting_contacts: [], sms_suppressions: [], driver_app_features: [],
      },
      rpc: (fn) => (fn === "notification_keys_sent" ? [] : "note-1"),
    });
    expect((await sweep()).rung).toBe(230);
  });

  it("a read that fails fails the job, so the run is listed rather than reading as nothing overdue", async () => {
    world([], { readFails: true });
    await expect(sweep()).rejects.toThrow(/uncontacted leads/);
  });
});

describe("the tick", () => {
  it("queues one job per carrier holding a new lead, keyed by the carrier", async () => {
    world([lead("1"), lead("2"), lead("3", { org_id: "other-org" }), lead("4", { org_id: "closed-org", status: "lost" })]);
    const asked: string[] = [];
    const r = await leadUncontactedTick(rec.client as never, async (org) => { asked.push(org); return org === ORG ? "queued" : "conflict"; });
    expect([asked.sort(), r]).toEqual([[ORG, "other-org"].sort(), { orgs: 2, queued: 1 }]);
    expect(leadUncontactedDedupKey(ORG)).toBe(`lead_uncontacted:${ORG}`);
  });

  it("is registered on the general lane and starts no timer unless ADS_ENABLED", () => {
    expect(SCHEDULERS.find((s) => s.name === "lead-uncontacted")?.lane).toBe("general");
    const timer = vi.spyOn(globalThis, "setInterval");
    startLeadUncontacted({ ADS_ENABLED: false, SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y" } as never);
    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();
  });
});
