import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { RoadsideCitationDto, RoadsideInspectionCitationsDto } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * What the court decided on a ticket, and the DataQs request over it (IC4 second merge, R-ADJ2/R-ADJ3; 0495) —
 * `POST /:id/citations/dispositions`, `/dataqs`, `/dataqs/filed`. Pinned: a disposition is read from a court paper
 * filed on THIS inspection and is the ticket's own; a request is approved only when the rule says it is ready,
 * over the disposition and the driver DECISION the page showed (D-IC7), and filed only over the approval.
 */

const ORG = "org-1";
const INSP = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";
const WARN = "44444444-4444-4444-8444-444444444444";
const PAPER = "55555555-5555-4555-8555-555555555555";
const OTHER_DOC = "66666666-6666-4666-8666-666666666666";
const ELSEWHERE_PAPER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DISP = "77777777-7777-4777-8777-777777777777";
const ATTR = "88888888-8888-4888-8888-888888888888";
const CASE = "99999999-9999-4999-8999-999999999999";

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
  { id: V1, org_id: ORG, inspection_id: INSP, viol_code: "392.2-SLLS1", description: "Speeding", citation_number: "E061", seq_no: 1, vanished_at: null },
  { id: V2, org_id: ORG, inspection_id: INSP, viol_code: "395.8E", description: "False log", citation_number: "E062", seq_no: 2, vanished_at: null },
  { id: WARN, org_id: ORG, inspection_id: INSP, viol_code: "393.9", description: "Lamp", citation_number: "WARNING", seq_no: 3, vanished_at: null },
];
const disp = (o: Record<string, unknown> = {}) => ({
  id: DISP, org_id: ORG, inspection_id: INSP, violation_id: V1, document_id: PAPER, outcome_code: 3, amended_charge: null,
  court_name: "Will County Circuit Court", decided_on: "2026-09-01", note: null, recorded_by: "u-9", created_at: "2026-10-02T00:00:00Z", ...o,
});
const approved = (o: Record<string, unknown> = {}) => ({
  id: CASE, org_id: ORG, inspection_id: INSP, violation_id: V1, disposition_id: DISP, state: "approved", narrative: "As attested.",
  attribution_id: ATTR, attested_by: "u-9", attested_at: "2026-10-03T00:00:00Z", rdr_number: null, filed_on: null, created_at: "2026-10-03T00:00:00Z", ...o,
});
let DISPS: Record<string, unknown>[] = [];
let CASES: Record<string, unknown>[] = [];
let RESULTS: Record<string, unknown>[] = [];
let PERSON: Record<string, unknown> | null = null;

/** The recorded filters applied to fixture rows — `.in()` included, as the inbox reads by inspection lists. */
const filtered = <T extends Record<string, unknown>>(rows: T[], q: RecordedQuery, cols: string[]) =>
  rows.filter((r) =>
    q.filters().every((f) => !cols.includes(f.col) || (Array.isArray(f.val) ? (f.val as unknown[]).includes(r[f.col]) : r[f.col] === f.val)),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T17:00:00Z"));
  manages = true;
  DISPS = [disp()];
  CASES = [];
  RESULTS = [];
  PERSON = { id: ATTR, source: "person", engine_version: "e1", created_at: "2026-10-01T00:00:00Z", outcome: "one_driver", decided_by: "u-9", driver_id: null, candidates: [] };
  rec = createSupabaseRecorder({
    tables: {
      roadside_violations: (q) => ({ data: filtered(VIOLATIONS, q, ["org_id", "inspection_id", "id"]) }),
      roadside_citations: (q) => ({ data: filtered(RESULTS, q, ["org_id", "inspection_id"]) }),
      roadside_inspections: () => ({ data: { report_number: "IL1234000123", report_state: "IL", inspection_date: "2026-06-01" } }),
      organizations: () => ({ data: { name: "Silvicom Freight", dot_number: "1234567", operating_hours: null } }),
      inspection_citation_actions: () => ({ data: [] }),
      inspection_citation_dispositions: (q) => (q.write ? { data: { id: "new-d" } } : { data: filtered(DISPS, q, ["org_id", "inspection_id", "violation_id"]) }),
      dataqs_cases: (q) => (q.write ? { data: { id: "new-c" } } : { data: filtered(CASES, q, ["org_id", "inspection_id", "violation_id", "id"]) }),
      documents: (q) => ({
        data: filtered(
          [
            { id: PAPER, org_id: ORG, subject_type: "roadside_inspection", subject_id: INSP, kind: "court_disposition", variant: "original", sha256: "a", uploaded_by: null, created_at: "2026-10-01T00:00:00Z" },
            // A court result — filed on ANOTHER inspection of ours.
            { id: ELSEWHERE_PAPER, org_id: ORG, subject_type: "roadside_inspection", subject_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "court_disposition", variant: "original", sha256: "c", uploaded_by: null, created_at: "2026-10-01T00:00:00Z" },
            { id: OTHER_DOC, org_id: ORG, subject_type: "roadside_inspection", subject_id: INSP, kind: "roadside_inspection_report", variant: "original", sha256: "b", uploaded_by: null, created_at: "2026-10-01T00:00:00Z" },
          ],
          q,
          ["org_id", "id", "subject_type", "subject_id", "kind", "variant"],
        ),
      }),
      inspection_attributions: (q) => ({ data: q.filters().some((f) => f.col === "source" && f.val === "person") ? PERSON : null }),
      memberships: () => ({ data: [] }),
      profiles: () => ({ data: [] }),
      audit_logs: () => ({ data: [] }),
    },
  });
});
afterEach(() => vi.useRealTimers());

// Only the GET reads `data`; the POSTs are read by status and error code.
type SentBody = { data: RoadsideInspectionCitationsDto; error?: { code: string } };

async function send(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: SentBody }> {
  const app = express();
  app.use(express.json());
  app.use("/api/roadside-inspections", roadsideInspectionsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/roadside-inspections/${INSP}/citations${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as SentBody };
  } finally {
    await closeTestServer(server);
  }
}

describe("the tickets, with what the court decided", () => {
  it("gives each ticket its own disposition and request, the inspection's court papers, and the facts a request names", async () => {
    CASES = [approved()];
    const { status, body } = await send("GET", "");
    expect(status).toBe(200);
    const tickets: RoadsideCitationDto[] = body.data.tickets;
    expect(tickets.map((t) => [t.citationNumber, t.disposition?.id ?? null, t.dataqsCase?.id ?? null])).toEqual([
      ["E061", DISP, CASE],
      ["E062", null, null],
    ]);
    expect(tickets[0]!.disposition).toMatchObject({ outcomeCode: 3, courtName: "Will County Circuit Court", decidedOn: "2026-09-01", documentId: PAPER });
    expect(body.data.courtPapers).toEqual([{ id: PAPER, filedAt: "2026-10-01T00:00:00Z" }]);
    expect(body.data.filing).toEqual({ carrierName: "Silvicom Freight", usdotNumber: "1234567", reportState: "IL", reportNumber: "IL1234000123", inspectionDate: "2026-06-01" });
    expectOrgScoped(rec, ORG, { exempt: ["memberships", "profiles", "user_profiles", "organizations"] });
  });
});

describe("recording what the court decided", () => {
  const body = (o: Record<string, unknown> = {}) => ({ violationId: V2, basedOn: null, documentId: PAPER, outcomeCode: 2, amendedCharge: " Improper lane use ", courtName: " Will County Circuit Court ", decidedOn: "2026-09-01", ...o });

  it("records it against THAT ticket, from the court paper, as the signed-in person, and audits it", async () => {
    const res = await send("POST", "/dispositions", body());
    expect(res.status).toBe(201);
    expect(rec.writtenRows("inspection_citation_dispositions")[0]).toEqual({
      org_id: ORG, inspection_id: INSP, violation_id: V2, document_id: PAPER, outcome_code: 2, amended_charge: "Improper lane use",
      court_name: "Will County Circuit Court", decided_on: "2026-09-01", note: null, recorded_by: "u-1",
    });
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "roadside.citation_disposition_recorded" });
  });

  it("refuses a paper that is not a court result on this inspection, and a day before the inspection or after today", async () => {
    expect((await send("POST", "/dispositions", body({ documentId: OTHER_DOC }))).body.error?.code).toBe("not_a_court_paper");
    expect((await send("POST", "/dispositions", body({ documentId: ELSEWHERE_PAPER }))).body.error?.code).toBe("not_a_court_paper");
    expect((await send("POST", "/dispositions", body({ decidedOn: "2026-05-31" }))).body.error?.code).toBe("decided_earlier");
    expect((await send("POST", "/dispositions", body({ decidedOn: "2026-10-20" }))).body.error?.code).toBe("decided_later");
    expect(rec.writtenRows("inspection_citation_dispositions")).toHaveLength(0);
  });

  it("refuses a warning, and a record over an older one than the newest", async () => {
    expect((await send("POST", "/dispositions", body({ violationId: WARN }))).status).toBe(422);
    expect((await send("POST", "/dispositions", body({ violationId: V1, basedOn: null }))).status).toBe(409);
    expect((await send("POST", "/dispositions", body({ violationId: V1, basedOn: DISP }))).status).toBe(201);
  });
});

describe("approving the DataQs request (R-ADJ2, D-IC7)", () => {
  const body = (o: Record<string, unknown> = {}) => ({ violationId: V1, dispositionId: DISP, attributionId: ATTR, narrative: " The court dismissed it. ", attested: true, ...o });

  it("records the attestation over the disposition and the driver decision the page showed", async () => {
    const res = await send("POST", "/dataqs", body());
    expect(res.status).toBe(201);
    expect(rec.writtenRows("dataqs_cases")[0]).toMatchObject({
      org_id: ORG, inspection_id: INSP, violation_id: V1, disposition_id: DISP, rdr_type: "inspection_citation_with_associated_violation",
      state: "approved", narrative: "The court dismissed it.", attribution_id: ATTR, attested_by: "u-1", acted_by: "u-1",
    });
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "roadside.dataqs_approved" });
  });

  it("refuses while who was driving is only Samsara's reading, or was decided again", async () => {
    PERSON = null;
    expect((await send("POST", "/dataqs", body())).body.error?.code).toBe("driver_unconfirmed");
    PERSON = { id: "attr-newer", source: "person", engine_version: "e1", created_at: "2026-10-05T00:00:00Z", outcome: "one_driver", candidates: [] };
    expect((await send("POST", "/dataqs", body())).body.error?.code).toBe("driver_changed");
    expect(rec.writtenRows("dataqs_cases")).toHaveLength(0);
  });

  it("refuses a conviction, a result FMCSA already shows, a disposition recorded again, and without the certification", async () => {
    DISPS = [disp({ outcome_code: 1 })];
    expect((await send("POST", "/dataqs", body())).body.error?.code).toBe("not_ready");
    DISPS = [disp()];
    RESULTS = [{ org_id: ORG, inspection_id: INSP, violation_id: V1, citation_result: "Not Guilty/Dismissed", adjseq: 1 }];
    expect((await send("POST", "/dataqs", body())).body.error?.code).toBe("not_ready");
    RESULTS = [];
    DISPS = [disp({ id: "d-newer", created_at: "2026-10-04T00:00:00Z" })];
    expect((await send("POST", "/dataqs", body())).body.error?.code).toBe("changed");
    DISPS = [disp()];
    expect((await send("POST", "/dataqs", body({ attested: false }))).status).toBe(400);
    expect(rec.writtenRows("dataqs_cases")).toHaveLength(0);
  });
});

describe("recording the RDR number", () => {
  const body = (o: Record<string, unknown> = {}) => ({ violationId: V1, caseId: CASE, rdrNumber: " 1234567 ", filedOn: "2026-10-19", ...o });

  it("files the approved request, carrying its approval forward", async () => {
    CASES = [approved()];
    const res = await send("POST", "/dataqs/filed", body());
    expect(res.status).toBe(201);
    expect(rec.writtenRows("dataqs_cases")[0]).toMatchObject({
      disposition_id: DISP, state: "filed", narrative: "As attested.", attribution_id: ATTR, attested_by: "u-9", attested_at: "2026-10-03T00:00:00Z",
      rdr_number: "1234567", filed_on: "2026-10-19", acted_by: "u-1",
    });
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "roadside.dataqs_filed" });
  });

  it("refuses with no approval, over a request already filed, and a day after today", async () => {
    expect((await send("POST", "/dataqs/filed", body())).body.error?.code).toBe("changed");
    CASES = [approved({ state: "filed", rdr_number: "1", filed_on: "2026-10-04" })];
    expect((await send("POST", "/dataqs/filed", body())).body.error?.code).toBe("changed");
    // An approval since replaced by another (the disposition was recorded again and approved again): its row
    // still exists, so only the standing can say it is no longer the one to file.
    const OLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    CASES = [approved({ id: OLD, created_at: "2026-10-02T00:00:00Z" }), approved()];
    expect((await send("POST", "/dataqs/filed", body({ caseId: OLD }))).body.error?.code).toBe("changed");
    expect((await send("POST", "/dataqs/filed", body({ filedOn: "2026-10-20" }))).body.error?.code).toBe("filed_later");
    expect(rec.writtenRows("dataqs_cases")).toHaveLength(0);
  });

  it("is safety's to manage, as every write on a ticket is", async () => {
    manages = false;
    CASES = [approved()];
    for (const [path, b] of [["/dispositions", { violationId: V2 }], ["/dataqs", { violationId: V1 }], ["/dataqs/filed", body()]] as const) {
      expect((await send("POST", path, b)).status).toBe(403);
    }
    expect(rec.writes()).toHaveLength(0);
  });
});
