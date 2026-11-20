import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rolesThatCanView, tenstreetDrawerView, USER_ROLES, type AuthContext, type TenstreetLeadPost } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { seal, secretAad } from "../../../lib/secretBox.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { TENSTREET_SEAL_PURPOSE } from "../tenstreet/receive.js";
import { readTenstreetXml } from "../tenstreet/tenstreetXml.js";

/**
 * TS5 (TENSTREET-INTAKE-PLAN): "From Tenstreet" in the lead drawer — read from the newest processed post, cut to what an
 * office reader needs, and never the criminal-history answers (Q-TS11), the licence number, or the SSN (removed before
 * the post was kept). Tenstreet's sample 1 is the post: it carries "y" criminal answers with free text, which must not
 * reach the drawer.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LEAD = "50000000-0000-4000-8000-000000000001";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const SAMPLE_PATH = (n: number) => new URL(`../../../../../../docs/tenstreet/samples/receiving_application_data_sample_${n}_xml.txt`, import.meta.url);
const PLANTED = "000-12-3456";
const SAMPLE = readFileSync(SAMPLE_PATH(1), "utf8").replace(/(documentType="SSN">)xxx-xx-\d{4}/g, `$1${PLANTED}`);
const cleaned = (xml: string) => {
  const r = readTenstreetXml(xml);
  if (!r.ok) throw new Error(r.reason);
  return r.cleaned;
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

function seed(over: { lead?: Record<string, unknown> | null; posts?: Array<Record<string, unknown>> } = {}) {
  const leads = over.lead === null ? [] : [{ id: LEAD, org_id: ORG, channel: "tenstreet", purged_at: null, ...(over.lead ?? {}) }];
  const posts = over.posts ?? [{ id: "p1", org_id: ORG, lead_id: LEAD, reply_status: "ACCEPTED", received_at: "2026-11-20T15:00:00Z", body_sealed: seal(env, cleaned(SAMPLE), secretAad(ORG, TENSTREET_SEAL_PURPOSE)) }];
  rec = createSupabaseRecorder({
    tables: {
      recruiting_leads: postgrestFixture(leads),
      // The read asks for the newest; the fake answers the first row, so a test puts the newest first.
      tenstreet_posts: (q: RecordedQuery) => postgrestFixture(posts)({ ...q, ops: q.ops.filter((o) => o.method !== "not") }),
    },
  });
  holder.client = rec.client;
}

const get = (role: string, id = LEAD) => fetch(`${baseUrl}/api/recruitment/leads/${id}/tenstreet`, { headers: { Authorization: `Bearer ${role}` } });
const body = async (role = "recruiter", id = LEAD) => (await (await get(role, id)).json()) as { post: TenstreetLeadPost | null };

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => ({ userId: `u-${t}`, email: `${t}@x.test`, orgId: ORG, role: t } as AuthContext);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("who may read what Tenstreet sent (recruitment view)", () => {
  it("whoever may view recruiting may; the others are refused before anything is read", async () => {
    const viewers = new Set<string>(rolesThatCanView("recruitment"));
    expect(viewers.has("auditor")).toBe(true);
    for (const role of USER_ROLES) {
      seed();
      const res = await get(role);
      expect(res.status, role).toBe(viewers.has(role) ? 200 : 403);
      if (!viewers.has(role)) expect(rec.queries, role).toHaveLength(0);
    }
  });
});

describe("GET /leads/:id/tenstreet", () => {
  it("reads the newest processed post that still holds its body, org-scoped, and answers no-store", async () => {
    seed();
    const res = await get("recruiter");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const q = rec.forTable("tenstreet_posts")[0]!;
    expect(q.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "lead_id", val: LEAD }, { col: "reply_status", val: "ACCEPTED" },
    ]));
    const nots = q.ops.filter((o) => o.method === "not").map((o) => o.args[0]);
    expect(nots.sort()).toEqual(["body_sealed", "processed_at"]);
    expect(q.ops.find((o) => o.method === "order")?.args).toEqual(["received_at", { ascending: false }]);
    expectOrgScoped(rec, ORG);
  });

  it("shows the licences, employers, counts, driving-record answers, Tags, custom questions and document names", async () => {
    seed();
    const { post } = await body();
    expect(post!.receivedAt).toBe("2026-11-20T15:00:00Z");
    const v = post!.view;
    expect(v.licences[0]).toEqual({ class: "A", cdl: true, current: true, state: "CA", endorsements: ["Tanker", "HazMat", "DoublesTriples"] });
    expect(v.employers.length).toBeGreaterThan(0);
    expect(v.employers[0]!.name).toEqual(expect.any(String));
    expect(v.accidents).toBe(1);
    expect(v.tags).toEqual(expect.arrayContaining([{ prompt: "Job Class", value: "E3R" }]));
    expect(v.documents.length).toBeGreaterThan(0);
    expect(v.mvr.find((m) => m.type === "Suspension")?.question).toMatch(/denied, suspended or revoked/);
  });

  it("never shows a criminal-history answer, the drug-conviction answer, the licence number or the SSN — and says answers were withheld", async () => {
    seed();
    const res = await get("recruiter");
    const text = await res.text();
    const { post } = JSON.parse(text) as { post: TenstreetLeadPost };
    expect(post.view.criminalWithheld).toBe(true);
    expect(post.view.mvr.map((m) => m.type)).not.toContain("ConvictedDrugs");
    for (const secret of ["stole a truck", "pled guilty", "crim charges", "ConvictedCrime", "Felony", "Misdemeanors", "c12345676", PLANTED]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("a purged lead answers nothing, and its posts are never read", async () => {
    seed({ lead: { purged_at: "2026-11-02T00:00:00Z" } });
    expect(await body()).toEqual({ post: null });
    expect(rec.forTable("tenstreet_posts")).toHaveLength(0);
  });

  it("a lead with no processed post answers nothing; an unknown or malformed lead is a 404", async () => {
    seed({ posts: [] });
    expect(await body()).toEqual({ post: null });
    seed({ lead: null });
    expect((await get("recruiter")).status).toBe(404);
    expect((await get("recruiter", "not-a-uuid")).status).toBe(404);
  });

  it("a body this server cannot open is a 503 in words, not a crash", async () => {
    seed({ posts: [{ id: "p1", org_id: ORG, lead_id: LEAD, reply_status: "ACCEPTED", received_at: "2026-11-20T15:00:00Z", body_sealed: "v1.garbage" }] });
    const res = await get("recruiter");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("tenstreet_unreadable");
  });
});

describe("tenstreetDrawerView — the edges a sample does not show", () => {
  const view = (inner: string, top = "") => {
    const r = readTenstreetXml(`<TenstreetData><Mode>TEST</Mode><CompanyId>14</CompanyId><DriverId>9</DriverId><ApplicationData>${inner}</ApplicationData>${top}</TenstreetData>`);
    if (!r.ok) throw new Error(r.reason);
    return tenstreetDrawerView(r.root);
  };

  it("no Accidents or Violations block is 'not asked' (null), an empty one is zero", () => {
    expect(view("")).toMatchObject({ accidents: null, violations: null });
    expect(view("<Accidents/><Violations/>")).toMatchObject({ accidents: 0, violations: 0 });
  });

  it("a Violation row answering n is not a violation", () => {
    expect(view("<Violations><Violation><DriverHaveViolation>n</DriverHaveViolation></Violation></Violations>").violations).toBe(0);
    expect(view("<Violations><Violation><DriverHaveViolation>y</DriverHaveViolation></Violation><Violation/></Violations>").violations).toBe(2);
  });

  it("ConvictedDrugs alone withholds; a type the guide does not name is shown by its own name", () => {
    const v = view('<MotorVehicleRecords><MotorVehicleRecord Type="ConvictedDrugs" Answer="n"/><MotorVehicleRecord Type="NewQuestion" Answer="y"/></MotorVehicleRecords>');
    expect(v.criminalWithheld).toBe(true);
    expect(v.mvr).toEqual([{ type: "NewQuestion", question: "NewQuestion", answer: true }]);
    expect(view("").criminalWithheld).toBe(false);
  });

  it("criminal-history answers alone withhold, whatever they answered", () => {
    expect(view('<CriminalRecords><CriminalRecord Type="Felony" Answer="n"/></CriminalRecords>').criminalWithheld).toBe(true);
  });

  it("a custom question shows its own question text, not its id", () => {
    const v = view("<CustomQuestions><CustomQuestion><QuestionId>Position</QuestionId><Question>What position are you applying for?</Question><Answer>Company Driver</Answer></CustomQuestion></CustomQuestions>");
    expect(v.custom).toEqual([{ question: "What position are you applying for?", answer: "Company Driver" }]);
  });

  it("a custom question with no text shows its id; a Tag or document with no name is dropped", () => {
    const v = view(
      "<CustomQuestions><CustomQuestion><QuestionId>Q7</QuestionId><Answer>yes</Answer></CustomQuestion></CustomQuestions>" +
        "<CustomDataElements><CustomDataElement><CustomDataValue>x</CustomDataValue></CustomDataElement></CustomDataElements>",
      "<Documents><Document><FileCategoryName>General</FileCategoryName></Document></Documents>",
    );
    expect(v.custom).toEqual([{ question: "Q7", answer: "yes" }]);
    expect(v.tags).toEqual([]);
    expect(v.documents).toEqual([]);
  });

  it("every one of Tenstreet's three samples reads, and none carries a criminal answer through", () => {
    for (const n of [1, 2, 3]) {
      const r = readTenstreetXml(readFileSync(SAMPLE_PATH(n), "utf8"));
      if (!r.ok) throw new Error(`sample ${n}: ${r.reason}`);
      const v = tenstreetDrawerView(r.root);
      expect(JSON.stringify(v), `sample ${n}`).not.toMatch(/CriminalRecord|ConvictedCrime|ConvictedDrugs/);
      expect(v.licences.length, `sample ${n}`).toBeGreaterThan(0);
    }
  });
});
