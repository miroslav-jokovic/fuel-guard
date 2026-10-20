import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { RoadsideCitationDto } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * A roadside inspection's tickets — `GET`/`POST /api/roadside-inspections/:id/citations` (IC4, R-ADJ1). Pinned:
 * a warning is not a ticket; FMCSA's result and the office's newest act are each ticket's own; acting needs
 * safety's manage level, a ticket on THIS inspection, and the act the page showed; the act is audited.
 */

const ORG = "org-1";
const INSP = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";
const WARN = "44444444-4444-4444-8444-444444444444";
const ELSEWHERE = "99999999-9999-4999-8999-999999999999";
const ACT_OLD = "55555555-5555-4555-8555-555555555555";
const ACT_NEW = "66666666-6666-4666-8666-666666666666";

let rec: SupabaseRecorder;
let manages = true;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "safety_manager", email: "s@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: (section: string, level = "manage") => (_req: Request, res: Response, next: NextFunction) =>
    level !== "view" && (section !== "safety" || !manages) ? void res.status(403).json({ error: { code: "forbidden" } }) : next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { roadsideInspectionsRouter } = await import("./roadside.js");

const VIOLATIONS = [
  { id: V1, org_id: ORG, inspection_id: INSP, viol_code: "392.2-SLLS1", description: "Speeding", citation_number: " E061 ", seq_no: 1, vanished_at: null },
  { id: V2, org_id: ORG, inspection_id: INSP, viol_code: "395.8E", description: "False log", citation_number: "E062", seq_no: 2, vanished_at: null },
  { id: WARN, org_id: ORG, inspection_id: INSP, viol_code: "393.9", description: "Lamp", citation_number: "WARNING", seq_no: 3, vanished_at: null },
  // Ours, ticketed — on ANOTHER inspection.
  { id: ELSEWHERE, org_id: ORG, inspection_id: "88888888-8888-4888-8888-888888888888", viol_code: "392.2", description: "Speeding", citation_number: "E099", seq_no: 1, vanished_at: null },
];
const act = (id: string, o: Record<string, unknown>) => ({
  id, org_id: ORG, inspection_id: INSP, violation_id: V2, action: "requested_from_court", follow_up_on: "2026-11-01", note: null, acted_by: "u-9", created_at: "2026-10-01T00:00:00Z", ...o,
});
let ACTS: Record<string, unknown>[] = [];

const val = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
const filtered = <T extends Record<string, unknown>>(rows: T[], q: RecordedQuery, cols: string[]) =>
  rows.filter((r) => cols.every((c) => val(q, c) === undefined || r[c] === val(q, c)));

beforeEach(() => {
  manages = true;
  ACTS = [act(ACT_OLD, { action: "not_contested", follow_up_on: null }), act(ACT_NEW, { created_at: "2026-10-05T00:00:00Z" }), act("x-other", { org_id: "org-2", created_at: "2026-10-09T00:00:00Z" })];
  rec = createSupabaseRecorder({
    tables: {
      roadside_violations: (q) => ({ data: filtered(VIOLATIONS, q, ["org_id", "inspection_id", "id"]) }),
      roadside_citations: (q) => ({ data: filtered([{ org_id: ORG, inspection_id: INSP, violation_id: V1, citation_result: "Not Guilty/Dismissed", adjseq: 1 }], q, ["org_id", "inspection_id"]) }),
      inspection_citation_actions: (q) => (q.write ? { data: { id: "new-1" } } : { data: filtered(ACTS, q, ["org_id", "inspection_id", "violation_id"]) }),
      documents: () => ({ data: [] }),
      roadside_inspections: () => ({ data: null }),
      organizations: () => ({ data: null }),
      inspection_citation_dispositions: () => ({ data: [] }),
      dataqs_cases: () => ({ data: [] }),
      memberships: () => ({ data: [] }),
      profiles: () => ({ data: [] }),
      audit_logs: () => ({ data: [] }),
    },
  });
});

type Body = { data?: { tickets: RoadsideCitationDto[]; courtPapers: unknown[] }; error?: { code: string } };
async function send(method: "GET" | "POST", body?: unknown): Promise<{ status: number; body: Body }> {
  const app = express();
  app.use(express.json());
  app.use("/api/roadside-inspections", roadsideInspectionsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/roadside-inspections/${INSP}/citations`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Body };
  } finally {
    await closeTestServer(server);
  }
}

describe("an inspection's tickets", () => {
  it("lists each ticket, never a warning, with FMCSA's result and the office's NEWEST act", async () => {
    const { status, body } = await send("GET");
    expect(status).toBe(200);
    expect(body.data!.tickets.map((t) => [t.citationNumber, t.courtResults, t.action?.id ?? null])).toEqual([
      ["E061", ["Not Guilty/Dismissed"], null],
      ["E062", [], ACT_NEW],
    ]);
    expect(body.data!.courtPapers).toEqual([]);
    // A name is read by user id once `memberLabels` has found the member in THIS org's memberships.
    expectOrgScoped(rec, ORG, { exempt: ["memberships", "profiles", "user_profiles"] });
  });
});

describe("the office acts on a ticket", () => {
  it("records a request with its day to follow up, as the signed-in person, and audits it", async () => {
    const res = await send("POST", { action: "requested_from_court", violationId: V1, basedOn: null, followUpOn: "2026-11-18", note: " Will County " });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("inspection_citation_actions")[0]).toEqual({
      org_id: ORG, inspection_id: INSP, violation_id: V1, action: "requested_from_court", follow_up_on: "2026-11-18", note: "Will County", acted_by: "u-1",
    });
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "roadside.citation_requested" });
  });

  it("refuses an act over an older one than the newest", async () => {
    const res = await send("POST", { action: "not_contested", violationId: V2, basedOn: ACT_OLD });
    expect(res.status).toBe(409);
    expect(rec.writtenRows("inspection_citation_actions")).toHaveLength(0);
    expect((await send("POST", { action: "not_contested", violationId: V2, basedOn: ACT_NEW })).status).toBe(201);
  });

  it("refuses a warning, a violation of another inspection, and a reader who only views safety", async () => {
    expect((await send("POST", { action: "not_contested", violationId: WARN, basedOn: null })).status).toBe(422);
    expect((await send("POST", { action: "not_contested", violationId: ELSEWHERE, basedOn: null })).status).toBe(404);
    manages = false;
    expect((await send("POST", { action: "not_contested", violationId: V1, basedOn: null })).status).toBe(403);
    expect(rec.writtenRows("inspection_citation_actions")).toHaveLength(0);
  });
});
