import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type RecordedQuery,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { readCarrierStepFacts } from "../carrierSteps.js";

/**
 * The carrier's own hiring steps (§10 CE2, 0545), through the mount: the list in Settings → Recruiting
 * and the office's done / undone on one applicant. 0545's tables have no client policies and the API
 * reads with the service role, so `expectOrgScoped` is the only layer that sees a missing org filter.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const OTHER_DRIVER = "77777777-8888-4999-8aaa-000000000000";
const INV = "44444444-5555-4666-8777-888888888888";
const S1 = "90000000-0000-4000-8000-000000000001";
const S2 = "90000000-0000-4000-8000-000000000002";
const S_OLD = "90000000-0000-4000-8000-0000000000aa";
const S_THEIRS = "90000000-0000-4000-8000-00000000000f";
const DOC = "a0000000-0000-4000-8000-000000000001";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(
  ["admin", "recruiter", "auditor", "dispatcher", "driver"].map((r) => [r, ctx(r)]),
);

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    ...init,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
  });
const post = (path: string, token: string, body: unknown) => call(path, token, { method: "POST", body: JSON.stringify(body) });

const STEP = (id: string, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, label: id === S1 ? "Fuel card issued" : "Hair test", instructions: null, after_step: "road_test",
  position: 0, owes: "us", proof: "tick", blocks_hire: false, created_at: "2026-11-01T00:00:00Z", retired_at: null, ...over,
});
const STEPS = [
  STEP(S1),
  STEP(S2, { after_step: "drug_test", proof: "document", position: 0 }),
  STEP(S_OLD, { position: 9, retired_at: "2026-11-01T12:00:00Z" }),
  STEP(S_THEIRS, { org_id: OTHER_ORG }),
];

/** Inserts answer with the row they wrote; `refuse` makes the record insert fail with a 0545 SQLSTATE. */
function seed(over: { refuse?: string; records?: Record<string, unknown>[] } = {}): SupabaseRecorder {
  const read = postgrestFixture(STEPS);
  const records = postgrestFixture(over.records ?? []);
  rec = createSupabaseRecorder({
    tables: {
      drivers: postgrestFixture([
        { id: DRIVER, org_id: ORG, status: "applicant" },
        { id: OTHER_DRIVER, org_id: OTHER_ORG, status: "applicant" },
      ]),
      application_invitations: postgrestFixture([
        { id: INV, org_id: ORG, driver_id: DRIVER, revoked_at: null, expires_at: "2099-01-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z" },
      ]),
      memberships: [],
      user_profiles: [{ full_name: "Dana Recruiter" }],
      hiring_carrier_steps: (q: RecordedQuery) => {
        if (q.write?.method === "insert") return { data: [{ id: "new-step", created_at: "2026-11-02T00:00:00Z", retired_at: null, ...(q.write.payload as object) }] };
        if (q.write?.method === "update") {
          const id = q.filters().find((f) => f.col === "id")?.val;
          const hit = STEPS.find((s) => s.id === id && s.org_id === ORG && s.retired_at === null);
          return { data: hit ? [{ ...hit, ...(q.write.payload as object) }] : [] };
        }
        return read(q);
      },
      hiring_carrier_step_records: (q: RecordedQuery) => {
        if (q.write?.method === "insert") {
          if (over.refuse) return { writeError: { code: over.refuse, message: "refused" } };
          return { data: [{ id: "r1", recorded_at: "2026-11-02T10:00:00Z", ...(q.write.payload as object) }] };
        }
        return records(q);
      },
      audit_logs: [],
    },
  });
  holder.client = rec.client;
  return rec;
}

/**
 * `user_profiles` is a person's own profile, read by their user id (`displayNameFor`) — not a carrier's
 * row, so it carries no org filter; `notes.test.ts` exempts it for the same reason.
 */
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

describe("the carrier's list (Settings → Recruiting)", () => {
  it("lists this carrier's live steps to anybody who can view recruiting, and nobody else", async () => {
    seed();
    const res = await call("/carrier-steps", "auditor");
    expect(res.status).toBe(200);
    const { steps } = (await res.json()) as { steps: Array<{ id: string }> };
    expect(steps.map((s) => s.id).sort()).toEqual([S1, S2].sort());
    expectOrgScoped(rec, ORG);
    for (const token of ["dispatcher", "driver"]) {
      seed();
      expect((await call("/carrier-steps", token)).status).toBe(403);
    }
  });

  it("adds a step last among those after the same built-in step, and audits it", async () => {
    seed();
    const res = await post("/carrier-steps", "recruiter", { label: "Tablet issued", afterStep: "road_test", blocksHire: true });
    expect(res.status).toBe(201);
    const row = rec.writtenRows("hiring_carrier_steps").at(-1) as Record<string, unknown>;
    expect(row).toMatchObject({ org_id: ORG, label: "Tablet issued", after_step: "road_test", position: 1, proof: "tick", blocks_hire: true, created_by: "u-recruiter" });
    expect(rec.writtenRows("audit_logs").at(-1)).toMatchObject({ action: "recruitment.hiring_step_added" });
    expectOrgScoped(rec, ORG);
  });

  it("refuses a step placed after the hire, and a view-only role", async () => {
    seed();
    expect((await post("/carrier-steps", "recruiter", { label: "x", afterStep: "hired" })).status).toBe(400);
    seed();
    expect((await post("/carrier-steps", "auditor", { label: "x", afterStep: "road_test" })).status).toBe(403);
  });

  it("changes a live step but never what proves it, and retires it once", async () => {
    seed();
    const res = await call(`/carrier-steps/${S1}`, "recruiter", { method: "PATCH", body: JSON.stringify({ label: "Fuel card + PIN", proof: "document" }) });
    expect(res.status).toBe(200);
    const write = rec.writes().find((w) => w.table === "hiring_carrier_steps")!.write!.payload as Record<string, unknown>;
    expect(write).toEqual({ label: "Fuel card + PIN" });
    expectOrgScoped(rec, ORG);

    seed();
    const gone = await call(`/carrier-steps/${S_OLD}`, "recruiter", { method: "PATCH", body: JSON.stringify({ retire: true }) });
    expect(gone.status).toBe(404);
    seed();
    expect((await call(`/carrier-steps/${S_THEIRS}`, "recruiter", { method: "PATCH", body: JSON.stringify({ label: "x" }) })).status).toBe(404);
  });
});

describe("the office's act on one applicant", () => {
  it("records a done tick with the session's name and the live invitation, and audits it without the note", async () => {
    seed();
    const res = await post(`/applicants/${DRIVER}/carrier-steps/${S1}`, "recruiter", { act: "done", note: "Card 4411" });
    expect(res.status).toBe(201);
    const row = rec.writtenRows("hiring_carrier_step_records").at(-1) as Record<string, unknown>;
    expect(row).toMatchObject({ org_id: ORG, step_id: S1, driver_id: DRIVER, invitation_id: INV, act: "done", note: "Card 4411", document_id: null, recorded_by: "u-recruiter" });
    expect(row.recorded_by_name).toBe("Dana Recruiter");
    const audit = rec.writtenRows("audit_logs").at(-1) as { action: string; meta: Record<string, unknown> };
    expect(audit.action).toBe("recruitment.hiring_step_done");
    expect(JSON.stringify(audit.meta)).not.toContain("4411");
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });

  it("another carrier's applicant reads as no applicant, and writes nothing", async () => {
    seed();
    const res = await post(`/applicants/${OTHER_DRIVER}/carrier-steps/${S1}`, "recruiter", { act: "done" });
    expect(res.status).toBe(404);
    expect(rec.writtenRows("hiring_carrier_step_records")).toEqual([]);
  });

  it("an undo without a reason is refused before the database", async () => {
    seed();
    expect((await post(`/applicants/${DRIVER}/carrier-steps/${S1}`, "recruiter", { act: "undone" })).status).toBe(400);
  });

  it("the database's refusals come back as words", async () => {
    for (const [code, status, apiCode] of [["CS026", 422, "document_required"], ["CS025", 409, "step_retired"], ["CS024", 404, "not_found"]] as const) {
      seed({ refuse: code });
      const res = await post(`/applicants/${DRIVER}/carrier-steps/${S2}`, "recruiter", { act: "done", documentId: DOC });
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(apiCode);
    }
  });

  it("a view-only role cannot tick a step", async () => {
    seed();
    expect((await post(`/applicants/${DRIVER}/carrier-steps/${S1}`, "auditor", { act: "done" })).status).toBe(403);
  });
});

describe("the fold's facts", () => {
  it("the latest act per step wins, only live steps count, and every read is org-scoped", async () => {
    seed({
      records: [
        { id: "r1", org_id: ORG, step_id: S1, driver_id: DRIVER, act: "done", note: null, document_id: null, recorded_by_name: "Dana", recorded_at: "2026-11-01T10:00:00Z" },
        { id: "r2", org_id: ORG, step_id: S1, driver_id: DRIVER, act: "undone", note: "wrong card", document_id: null, recorded_by_name: "Lee", recorded_at: "2026-11-01T11:00:00Z" },
        { id: "r3", org_id: ORG, step_id: S_OLD, driver_id: DRIVER, act: "done", note: null, document_id: null, recorded_by_name: "Dana", recorded_at: "2026-11-01T10:00:00Z" },
      ],
    });
    const facts = (await readCarrierStepFacts(rec.client as never, ORG, [DRIVER])).get(DRIVER)!;
    expect(facts.steps.map((s) => s.id).sort()).toEqual([S1, S2].sort());
    expect(facts.latest).toEqual([{ stepId: S1, act: "undone", at: "2026-11-01T11:00:00Z", byName: "Lee", note: "wrong card", documentId: null }]);
    expectOrgScoped(rec, ORG);
  });
});
