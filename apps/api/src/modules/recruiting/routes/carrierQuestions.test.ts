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

/**
 * The carrier's own application questions (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3 CQ2, 0567), through the
 * mount: the list in Settings → Recruiting. 0567's table has no client policies and the API reads with the
 * service role, so `expectOrgScoped` is the only layer that sees a missing org filter.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";
const Q1 = "91000000-0000-4000-8000-000000000001";
const Q2 = "91000000-0000-4000-8000-000000000002";
const Q_OLD = "91000000-0000-4000-8000-0000000000aa";
const Q_THEIRS = "91000000-0000-4000-8000-00000000000f";

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
const post = (body: unknown, token = "recruiter") => call("/carrier-questions", token, { method: "POST", body: JSON.stringify(body) });
const patch = (id: string, body: unknown, token = "recruiter") =>
  call(`/carrier-questions/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });

const QUESTION = (id: string, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, wording: id === Q1 ? "Do you own a pet?" : "Preferred lane", hint: null, kind: "boolean",
  choices: null, required: false, position: 0, created_at: "2026-11-04T00:00:00Z", retired_at: null, ...over,
});
const QUESTIONS = [
  QUESTION(Q1),
  QUESTION(Q2, { kind: "select", choices: ["East", "West"], position: 4 }),
  QUESTION(Q_OLD, { position: 9, retired_at: "2026-11-04T12:00:00Z" }),
  QUESTION(Q_THEIRS, { org_id: OTHER_ORG, position: 30 }),
];

/** Inserts answer with the row they wrote; `refuse` makes the insert fail with a 0567 SQLSTATE. */
function seed(over: { refuse?: string; rows?: Record<string, unknown>[] } = {}): SupabaseRecorder {
  const rows = over.rows ?? QUESTIONS;
  const read = postgrestFixture(rows);
  rec = createSupabaseRecorder({
    tables: {
      recruiting_carrier_questions: (q: RecordedQuery) => {
        if (q.write?.method === "insert") {
          if (over.refuse) return { writeError: { code: over.refuse, message: "refused" } };
          return { data: [{ id: "new-q", created_at: "2026-11-04T10:00:00Z", retired_at: null, ...(q.write.payload as object) }] };
        }
        if (q.write?.method === "update") {
          const id = q.filters().find((f) => f.col === "id")?.val;
          const org = q.filters().find((f) => f.col === "org_id")?.val;
          // Honours the query's own `retired_at is null`, so a writer that dropped it would reach a retired row.
          const liveOnly = q.filters().some((f) => f.col === "retired_at");
          const hit = rows.find((s) => s.id === id && s.org_id === org && (!liveOnly || s.retired_at === null));
          return { data: hit ? [{ ...hit, ...(q.write.payload as object) }] : [] };
        }
        return read(q);
      },
      audit_logs: [],
    },
  });
  holder.client = rec.client;
  return rec;
}

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

describe("the carrier's own questions (Settings → Recruiting)", () => {
  it("lists this carrier's live questions in their order to anybody who can view recruiting, and nobody else", async () => {
    seed();
    const res = await call("/carrier-questions", "auditor");
    expect(res.status).toBe(200);
    const { questions } = (await res.json()) as { questions: Array<{ id: string }> };
    expect(questions.map((q) => q.id)).toEqual([Q1, Q2]);
    expectOrgScoped(rec, ORG);
    for (const token of ["dispatcher", "driver"]) {
      seed();
      expect((await call("/carrier-questions", token)).status).toBe(403);
    }
  });

  it("adds a question last on the list with the session's name, and audits it", async () => {
    seed();
    const res = await post({ wording: "  Which lane do you prefer?  ", kind: "select", choices: ["North", "South"], required: true });
    expect(res.status).toBe(201);
    const row = rec.writtenRows("recruiting_carrier_questions").at(-1) as Record<string, unknown>;
    expect(row).toMatchObject({
      org_id: ORG, wording: "Which lane do you prefer?", hint: null, kind: "select", choices: ["North", "South"],
      required: true, position: 5, created_by: "u-recruiter",
    });
    expect(rec.writtenRows("audit_logs").at(-1)).toMatchObject({ action: "recruitment.question_added" });
    expectOrgScoped(rec, ORG);
  });

  it("the first question on an empty list goes first", async () => {
    seed({ rows: [] });
    expect((await post({ wording: "Ever driven a tanker?", kind: "boolean" })).status).toBe(201);
    expect(rec.writtenRows("recruiting_carrier_questions").at(-1)).toMatchObject({ position: 0, choices: null, required: false });
  });

  it("refuses a list question with one choice, a view-only role, and a full list as words", async () => {
    seed();
    expect((await post({ wording: "Lane?", kind: "select", choices: ["Only"] })).status).toBe(400);
    seed();
    expect((await post({ wording: "Lane?", kind: "boolean" }, "auditor")).status).toBe(403);
    seed({ refuse: "CQ013" });
    const full = await post({ wording: "One more?", kind: "boolean" });
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: { code: string } }).error.code).toBe("questions_full");
  });

  it("changes a live question's hint, required and place but never its wording, kind or choices", async () => {
    seed();
    const res = await patch(Q1, { hint: "Dogs and cats count", required: true, position: 2, wording: "Pets?", kind: "text" });
    expect(res.status).toBe(200);
    const write = rec.writes().find((w) => w.table === "recruiting_carrier_questions")!.write!.payload as Record<string, unknown>;
    expect(write).toEqual({ hint: "Dogs and cats count", required: true, position: 2 });
    expect(rec.writtenRows("audit_logs").at(-1)).toMatchObject({ action: "recruitment.question_changed" });
    expectOrgScoped(rec, ORG);
  });

  it("retires a question once, with who and when, and never another carrier's", async () => {
    seed();
    const res = await patch(Q2, { retire: true });
    expect(res.status).toBe(200);
    const write = rec.writes().find((w) => w.table === "recruiting_carrier_questions")!.write!.payload as Record<string, unknown>;
    expect(write).toMatchObject({ retired_by: "u-recruiter" });
    expect(typeof write.retired_at).toBe("string");
    expect(rec.writtenRows("audit_logs").at(-1)).toMatchObject({ action: "recruitment.question_retired" });
    expectOrgScoped(rec, ORG);

    seed();
    expect((await patch(Q_OLD, { retire: true })).status).toBe(404);
    seed();
    expect((await patch(Q_THEIRS, { required: true })).status).toBe(404);
    seed();
    expect((await patch(Q1, { required: true }, "auditor")).status).toBe(403);
    seed();
    expect((await patch(Q1, {})).status).toBe(400);
  });
});
