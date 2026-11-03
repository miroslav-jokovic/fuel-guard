import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HIRING_PROFILE_V1, type AuthContext, type PlatformLead } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { recruitingLeadSink } from "../index.js";

/**
 * The lead queue (ads D1, 0553/0554) through the mount, and recruiting's `LeadSink` as the ads module will
 * call it. The functions' own behaviour — stored once, matched by phone or email, converted once — is the
 * PGlite matrix `recruiting-lead-functions.test.mjs`; this file holds what the API adds around them: the
 * doors, the org scope, the verdicts, the roster create, and the refusals in words.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LEAD = "50000000-0000-4000-8000-000000000001";
const NAMELESS = "50000000-0000-4000-8000-000000000002";
const OPENING = "60000000-0000-4000-8000-000000000001";
const PV = "70000000-0000-4000-8000-000000000001";
const PV_OLD = "70000000-0000-4000-8000-000000000000";
const APPLICANT = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NEW_DRIVER = "77777777-8888-4999-8aaa-cccccccccccc";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(["admin", "recruiter", "auditor", "dispatcher", "driver"].map((r) => [r, ctx(r)]));

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, { ...init, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } });
const post = (path: string, token: string, body: unknown) => call(path, token, { method: "POST", body: JSON.stringify(body) });

const QUEUE_ROW = (id: string, at: string) => ({
  id, channel: "meta", source: "instant_form", campaign_ref: "c-1", opening_id: OPENING, full_name: "Ray Driver",
  phone_e164: "+17082365732", email_lower: "ray@example.com", status: "new", assigned_to: null, received_at: at,
  answers: {}, also: [], drivers: [],
});

interface Seed {
  ingest?: unknown;
  convertError?: string;
  queue?: unknown[];
  existingVerdicts?: unknown[];
}
function seed(over: Seed = {}): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      recruiting_leads: postgrestFixture([
        { id: LEAD, org_id: ORG, full_name: "Ray Driver", phone_e164: "+17082365732", email_lower: "ray@example.com", status: "new" },
        { id: NAMELESS, org_id: ORG, full_name: null, phone_e164: "+17082365799", email_lower: null, status: "new" },
      ]),
      recruiting_opening_versions: postgrestFixture([
        { org_id: ORG, opening_id: OPENING, version: 1, profile_version_id: PV_OLD },
        { org_id: ORG, opening_id: OPENING, version: 2, profile_version_id: PV },
      ]),
      hiring_profile_versions: postgrestFixture([
        { org_id: ORG, id: PV_OLD, requirements: HIRING_PROFILE_V1 },
        { org_id: ORG, id: PV, requirements: HIRING_PROFILE_V1 },
      ]),
      lead_match_verdicts: (q: RecordedQuery) => {
        if (q.write?.method === "insert") return { data: q.write.payload };
        return postgrestFixture((over.existingVerdicts ?? []) as Record<string, unknown>[])(q);
      },
      drivers: (q: RecordedQuery) => {
        if (q.write?.method === "insert") return { data: [{ id: NEW_DRIVER, ...(q.write.payload as object) }] };
        return { data: [] };
      },
      memberships: [],
      user_profiles: [{ full_name: "Dana Recruiter" }],
      audit_logs: [],
    },
    rpc: (fn, args) => {
      if (fn === "ingest_lead") return over.ingest ?? { lead_id: LEAD, stored: "new", matches: { leads: [], drivers: [] } };
      if (fn === "convert_lead") {
        if (over.convertError) return { error: { code: over.convertError, message: "refused" } };
        const a = args as { p_driver: string };
        return { conversion_id: "conv-1", lead_id: LEAD, driver_id: a.p_driver, created: true };
      }
      if (fn === "recruiting_lead_queue") return over.queue ?? [];
      return null;
    },
  });
  holder.client = rec.client;
  return rec;
}
/** `user_profiles` is read by the actor's own user id (`displayNameFor`): not a carrier's row (`notes.test.ts`). */
const PROFILE_EXEMPT = { exempt: ["user_profiles"] };

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("the LeadSink — how the ads module hands recruiting a lead", () => {
  const LEAD_IN: PlatformLead = {
    provider: "meta", platform_lead_ref: "leadgen-1", campaign_id: null, brief_source: "recruiting_opening", brief_ref: OPENING,
    created_at: "2026-11-03T14:00:00+00:00", raw: { id: "leadgen-1" },
    answers: { full_name: "Ray Driver", phone_number: "(708) 236-5732", class_a_held: "Yes", class_a_years: "lt1" },
  };

  it("stores the projection once and writes leadMatch's verdicts against the opening's profile", async () => {
    seed();
    const r = await recruitingLeadSink(rec.client as never, () => new Date("2026-11-03T15:00:00Z")).accept(ORG, LEAD_IN);
    expect(r).toEqual({ stored: "new", ref: LEAD });
    const args = rec.rpcs().find((c) => c.fn === "ingest_lead")!.args as { p_org: string; p_lead: Record<string, unknown> };
    expect([args.p_org, args.p_lead.phone_e164, args.p_lead.opening_id, args.p_lead.external_ref]).toEqual([ORG, "+17082365732", OPENING, "leadgen-1"]);
    const rows = rec.writtenRows("lead_match_verdicts") as Array<Record<string, unknown>>;
    const byReq = Object.fromEntries(rows.map((v) => [v.requirement, v]));
    expect([byReq.class_a?.verdict, byReq.class_a_experience?.verdict, byReq.age?.verdict, rows.every((v) => v.profile_version_id === PV && v.org_id === ORG)])
      .toEqual(["meets", "does_not_meet", "unknown", true]);
    // The preference is stored as one, so the queue does not count a missing hazmat as a hard miss.
    expect([(byReq.hazmat?.detail as { hard: boolean }).hard, (byReq.class_a?.detail as { hard: boolean }).hard]).toEqual([false, true]);
    expectOrgScoped(rec, ORG);
  });

  it("a repeat of a lead whose verdicts are already written writes none again", async () => {
    seed({ ingest: { lead_id: LEAD, stored: "duplicate", matches: { leads: [], drivers: [] } },
      existingVerdicts: [{ id: "v1", org_id: ORG, lead_id: LEAD, profile_version_id: PV }] });
    const r = await recruitingLeadSink(rec.client as never).accept(ORG, LEAD_IN);
    expect([r.stored, rec.writtenRows("lead_match_verdicts").length]).toEqual(["duplicate", 0]);
  });

  it("a repeat of a lead stored before its verdicts were (a crash between the two) writes them", async () => {
    seed({ ingest: { lead_id: LEAD, stored: "duplicate", matches: { leads: [], drivers: [] } } });
    await recruitingLeadSink(rec.client as never).accept(ORG, LEAD_IN);
    expect(rec.writtenRows("lead_match_verdicts").length).toBeGreaterThan(0);
  });

  it("throws when the store fails, so the caller retries rather than losing the lead", async () => {
    seed({ ingest: { error: { code: "XX000", message: "down" } } });
    await expect(recruitingLeadSink(rec.client as never).accept(ORG, LEAD_IN)).rejects.toThrow(/ingest_lead failed/);
  });
});

describe("the queue", () => {
  it("is read by anyone who can view recruiting, scoped to the carrier, with a cursor when the page is full", async () => {
    seed({ queue: [QUEUE_ROW("a", "2026-11-03T12:02:00Z"), QUEUE_ROW("b", "2026-11-03T12:01:00Z")] });
    const res = await call("/leads?limit=2", "auditor");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { leads: Array<{ id: string }>; next: { before_at: string; before_id: string } | null };
    expect([body.leads.map((l) => l.id), body.next]).toEqual([["a", "b"], { before_at: "2026-11-03T12:01:00Z", before_id: "b" }]);
    const args = rec.rpcs().find((c) => c.fn === "recruiting_lead_queue")!.args as Record<string, unknown>;
    expect([args.p_org, args.p_statuses, args.p_limit]).toEqual([ORG, ["new", "contacted", "qualified"], 2]);
    expectOrgScoped(rec, ORG);
  });
  it("each row carries its newest verdict per requirement, and a missed preference is not a hard miss", async () => {
    const v = (requirement: string, verdict: string, at: string, hard = true) =>
      ({ org_id: ORG, lead_id: "a", requirement, verdict, evidence: verdict === "unknown" ? null : "self_reported", detail: { hard }, computed_at: at });
    seed({
      queue: [QUEUE_ROW("a", "2026-11-03T12:02:00Z")],
      existingVerdicts: [
        v("class_a", "does_not_meet", "2026-11-01T00:00:00Z"), v("class_a", "meets", "2026-11-03T00:00:00Z"),
        v("hazmat", "does_not_meet", "2026-11-03T00:00:00Z", false), v("age", "unknown", "2026-11-03T00:00:00Z"),
      ],
    });
    const lead = ((await (await call("/leads", "recruiter")).json()) as { leads: Array<{ verdicts: Array<{ requirement: string; verdict: string }>; summary: unknown }> }).leads[0]!;
    expect([lead.verdicts.find((x) => x.requirement === "class_a")?.verdict, lead.summary]).toEqual(["meets", { hardUnmet: 0, unknown: 1, met: 1 }]);
  });
  it("a short page has no next cursor", async () => {
    seed({ queue: [QUEUE_ROW("a", "2026-11-03T12:02:00Z")] });
    expect(((await (await call("/leads?limit=2", "recruiter")).json()) as { next: unknown }).next).toBeNull();
  });
  it("refuses an unknown status and a half cursor", async () => {
    seed();
    expect((await call("/leads?status=hired", "recruiter")).status).toBe(400);
    expect((await call("/leads?before_at=2026-11-03T12:00:00Z", "recruiter")).status).toBe(400);
  });
  it("is closed to roles outside recruiting", async () => {
    for (const t of ["dispatcher", "driver"]) {
      seed();
      expect((await call("/leads", t)).status).toBe(403);
    }
  });
});

describe("a lead entered by hand", () => {
  it("goes in through the same sink and is audited without the person's details", async () => {
    seed();
    const res = await post("/leads", "recruiter", { channel: "phone_call", full_name: "Ray Driver", phone: "(708) 236-5732", email: null, opening_id: null, note: "called the yard" });
    expect(res.status).toBe(201);
    const lead = (rec.rpcs().find((c) => c.fn === "ingest_lead")!.args as { p_lead: Record<string, unknown> }).p_lead;
    expect([lead.channel, lead.phone_e164, lead.external_ref]).toEqual(["phone_call", "+17082365732", null]);
    const audit = rec.writtenRows("audit_logs").at(-1) as { action: string; meta: Record<string, unknown> };
    expect([audit.action, JSON.stringify(audit.meta).includes("236")]).toEqual(["recruitment.lead_added", false]);
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });
  it("is refused without a phone or an email, and for a view-only role", async () => {
    seed();
    expect((await post("/leads", "recruiter", { channel: "paste", full_name: "Ray", phone: null, email: null, opening_id: null, note: null })).status).toBe(400);
    expect((await post("/leads", "auditor", { channel: "paste", full_name: "Ray", phone: "7082365732", email: null, opening_id: null, note: null })).status).toBe(403);
  });
});

describe("converting a lead", () => {
  it("creates the applicant through roster's door, then records the conversion in the session's name", async () => {
    seed();
    const res = await post(`/leads/${LEAD}/convert`, "recruiter", { driver_id: null });
    expect(res.status).toBe(201);
    const driver = rec.writtenRows("drivers").at(-1) as Record<string, unknown>;
    expect(driver).toMatchObject({ org_id: ORG, full_name: "Ray Driver", status: "applicant", identity_source: "manual", phone: "+17082365732" });
    const args = rec.rpcs().find((c) => c.fn === "convert_lead")!.args as Record<string, unknown>;
    expect([args.p_driver, args.p_actor, args.p_actor_name]).toEqual([NEW_DRIVER, "u-recruiter", "Dana Recruiter"]);
    expect((rec.writtenRows("audit_logs") as Array<{ action: string }>).map((a) => a.action)).toEqual(["driver.created", "recruitment.lead_converted"]);
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });
  it("attaches the lead to an applicant already on the board without creating another", async () => {
    seed();
    const res = await post(`/leads/${LEAD}/convert`, "recruiter", { driver_id: APPLICANT });
    expect([res.status, rec.writtenRows("drivers").length]).toEqual([200, 0]);
  });
  it("says why it refuses, in words", async () => {
    seed({ convertError: "RL021" });
    expect(((await (await post(`/leads/${LEAD}/convert`, "recruiter", { driver_id: APPLICANT })).json()) as { error: { code: string } }).error.code)
      .toBe("not_an_open_applicant");
    seed({ convertError: "RL022" });
    expect((await post(`/leads/${LEAD}/convert`, "recruiter", { driver_id: APPLICANT })).status).toBe(409);
  });
  it("another carrier's lead reads as no lead", async () => {
    seed();
    expect((await post("/leads/50000000-0000-4000-8000-0000000000ff/convert", "recruiter", { driver_id: null })).status).toBe(404);
  });
  it("a lead with no name cannot become an applicant until somebody adds one", async () => {
    seed();
    const res = await post(`/leads/${NAMELESS}/convert`, "recruiter", { driver_id: null });
    expect([res.status, rec.writtenRows("drivers").length]).toEqual([422, 0]);
  });
  it("is refused to a view-only role", async () => {
    seed();
    expect((await post(`/leads/${LEAD}/convert`, "auditor", { driver_id: null })).status).toBe(403);
  });
});
