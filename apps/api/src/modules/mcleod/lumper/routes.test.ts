import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext, LumperCasesResponse } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { surfaceClaims } from "../../org/surfaceClaimCache.js";

/**
 * `/api/lumper-cases` through the real mount (LUMPER-REVISED-RC-PLAN LRC3): who may open the list, what a
 * case says, and that a revised RC is on a case only after the stored bytes are checked. The SQL rules
 * (a filed paper is never changed, a sweep never reopens a case) are `supabase/tests/lumper-sweep.test.mjs`'s.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CASE_WAITING = "50000000-0000-4000-8000-00000000000a";
const CASE_DONE = "50000000-0000-4000-8000-00000000000b";
const CASE_NO_LUMPER = "50000000-0000-4000-8000-00000000000c";
const FILE = "60000000-0000-4000-8000-00000000000a";
const NEW_FILE = "60000000-0000-4000-8000-00000000000b";
const DANA = "90000000-0000-4000-8000-0000000000a0";

const ctx = (userId: string, role: string): AuthContext => ({ userId, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  dispatcher: ctx(DANA, "dispatcher"),
  accountant: ctx("90000000-0000-4000-8000-0000000000a1", "accountant"),
  admin: ctx("90000000-0000-4000-8000-0000000000a2", "admin"),
  recruiter: ctx("90000000-0000-4000-8000-0000000000a3", "recruiter"),
  auditor: ctx("90000000-0000-4000-8000-0000000000a4", "auditor"),
  driver: ctx("90000000-0000-4000-8000-0000000000a5", "driver"),
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/lumper-cases${path}`, { ...init, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } });
const post = (path: string, token: string, body: unknown = {}) => call(path, token, { method: "POST", body: JSON.stringify(body) });

const PDF = new TextEncoder().encode("%PDF-1.7 a revised rate confirmation");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const confirm = (o: Record<string, unknown> = {}) => ({ file_id: NEW_FILE, file_name: "revised-rc.pdf", mime: "application/pdf", byte_size: PDF.length, sha256: sha(PDF), ...o });

const aCase = (id: string, order: string, o: Record<string, unknown> = {}) => ({
  id, org_id: ORG, company_id: "TMS", order_id: order, charge_code: "LUM", opened_at: "2026-10-02T12:00:00Z",
  closed_at: null, closed_by: null, close_reason: null, close_note: null, ...o,
});
const order = (id: string) => ({
  org_id: ORG, company_id: "TMS", order_id: id, customer_name: "A Broker", dispatcher_user_id: "kane", dispatcher_name: "Kane",
  consignee_name: "A Warehouse", consignee_city: "Joliet", consignee_state: "IL", consignee_arrived_at: "2026-10-01T00:00:00Z", consignee_departed_at: "2026-10-01T00:00:00Z",
});
const payment = (id: string, orderId: string | null, o: Record<string, unknown> = {}) => ({
  org_id: ORG, company_id: "TMS", payment_id: id, settlement_state: "paid", order_id: orderId, deduct_code: "UNL", amount: "310.00",
  transacted_at: "2026-10-02T00:00:00Z", reference_no: `EFS-${id}`, driver_code: "DRV1", tractor_unit: "101", is_void: false, ...o,
});
const bill = (id: string, orderId: string, lumper: string) => ({
  org_id: ORG, company_id: "TMS", bill_id: id, order_id: orderId, bill_type: "I", bill_date: "2026-10-05T00:00:00Z", invoice_no: `INV-${id}`, lumper_amount: lumper,
});

function seed(over: { cases?: Record<string, unknown>[]; files?: Record<string, unknown>[]; stored?: Uint8Array | null; roleAccess?: Record<string, unknown>[]; userAccess?: Record<string, unknown>[]; module?: boolean } = {}): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: postgrestFixture((over.roleAccess ?? []).map((g) => ({ org_id: ORG, ...g }))),
      user_surface_access: postgrestFixture((over.userAccess ?? []).map((g) => ({ org_id: ORG, ...g }))),
      lumper_cases: postgrestFixture(over.cases ?? [aCase(CASE_WAITING, "A"), aCase(CASE_DONE, "B"), aCase(CASE_NO_LUMPER, "C")]),
      mcleod_lumper_orders: postgrestFixture([order("A"), order("B"), order("C")]),
      mcleod_lumper_charges: postgrestFixture([
        { org_id: ORG, company_id: "TMS", charge_id: "OC1", order_id: "A", charge_code: "LUM", descr: "Unloading", amount: "310.00" },
        { org_id: ORG, company_id: "TMS", charge_id: "OC2", order_id: "B", charge_code: "LUM", descr: "Unloading", amount: "200.00" },
      ]),
      mcleod_lumper_payments: postgrestFixture([
        payment("D1", "A"),
        payment("D2", "A", { deduct_code: "LUM", reference_no: null }),
        payment("D3", "B", { amount: "200.00" }),
        payment("D4", "C", { amount: "150.00" }),
        payment("D5", null, { amount: "90.00", settlement_state: "pending" }),
      ]),
      mcleod_lumper_bills: postgrestFixture([bill("BL1", "B", "200.00"), bill("BL2", "C", "0.00")]),
      lumper_case_files: postgrestFixture(
        over.files ?? [{ id: FILE, org_id: ORG, case_id: CASE_DONE, file_name: "rc-b.pdf", mime: "application/pdf", byte_size: 1200, uploaded_by: DANA, created_at: "2026-10-04T15:00:00Z", removed_at: null, storage_path: `${ORG}/${CASE_DONE}/${FILE}` }],
      ),
      mcleod_lumper_sweeps: postgrestFixture([{ org_id: ORG, company_id: "TMS", swept_at: "2026-10-09T13:00:00Z" }]),
      user_profiles: [{ user_id: DANA, full_name: "Dana Dispatch" }],
      audit_logs: [],
    },
    rpc: (fn: string) => (fn === "org_module_enabled" ? over.module !== false : null),
    storage: {
      createSignedUploadUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}`, token: "t", path }, error: null }),
      createSignedUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/read/${path}` }, error: null }),
      download: () => (over.stored === null ? { data: null, error: { message: "not found" } } : { data: new Blob([Buffer.from(over.stored ?? PDF)]), error: null }),
    },
  });
  // The gate caches a caller's screen answers for a few seconds; each seed is a different carrier setup.
  surfaceClaims.forget(() => true);
  holder.client = rec.client;
  return rec;
}

const audits = () => rec.writtenRows("audit_logs") as Record<string, unknown>[];
// `user_profiles` is keyed by the person; the screen-access tables are read by the gate, by org.
const EXEMPT = { exempt: ["user_profiles"] };

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((done) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("who works the lumper cases (D-LRC11)", () => {
  it("opens for dispatch, for billing and for the admin, and for nobody else", async () => {
    seed();
    expect((await call("/", "dispatcher")).status).toBe(200);
    expect((await call("/", "accountant")).status).toBe(200);
    expect((await call("/", "admin")).status).toBe(200);
    expect((await call("/", "recruiter")).status).toBe(403);
    expect((await call("/", "auditor")).status).toBe(403);
    expect((await call("/", "driver")).status).toBe(403);
    expect((await call("/", "nobody")).status).toBe(401);
  });

  it("opens for another role, or for one person, once an admin turns the screen on, and closes for a role turned off", async () => {
    seed({ roleAccess: [{ role: "recruiter", surface_key: "dispatch.lumper-cases", allowed: true }, { role: "dispatcher", surface_key: "dispatch.lumper-cases", allowed: false }] });
    expect((await call("/", "recruiter")).status).toBe(200);
    expect((await call("/", "dispatcher")).status).toBe(403);
    expect((await post(`/${CASE_WAITING}/close`, "dispatcher", { reason: "broker_refused", note: null })).status).toBe(403);
    seed({ userAccess: [{ user_id: CTX.auditor!.userId, surface_key: "dispatch.lumper-cases", allowed: true }] });
    expect((await call("/", "auditor")).status).toBe(200);
    expect((await call("/", "recruiter")).status).toBe(403);
  });

  it("is closed to a carrier without the Dispatch module", async () => {
    seed({ module: false });
    expect((await call("/", "dispatcher")).status).toBe(403);
  });
});

describe("what the list says", () => {
  it("lists the open cases with where and what we paid, and leaves out the one that is done", async () => {
    seed();
    const res = await call("/", "dispatcher");
    const body = (await res.json()) as LumperCasesResponse;
    expect(body.cases.map((c) => [c.orderId, c.state])).toEqual([["A", "waiting_for_rc"], ["C", "billed_without_lumper"]]);
    const a = body.cases[0]!;
    // The money code and its reimbursement are one $310 payment, not $620.
    expect(a).toMatchObject({ paidAmount: 310, chargeAmount: 310, references: ["EFS-D1"], customerName: "A Broker", dispatcherName: "Kane", consigneeCity: "Joliet", consigneeState: "IL", driverCode: "DRV1", rcOnFile: false, invoiced: false });
    expect(body.cases[1]).toMatchObject({ paidAmount: 150, billedAmount: 0, shortAmount: 150, lastInvoiceNo: "INV-BL2" });
    expect(body.unmatchedPayments).toEqual([{ id: "pending:D5", deductCode: "UNL", amount: 90, transactedAt: "2026-10-02T00:00:00Z", referenceNo: "EFS-D5", driverCode: "DRV1", tractorUnit: "101", pending: true }]);
    expect(body.sweptAt).toBe("2026-10-09T13:00:00Z");
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("shows every case, with the filed paper and who filed it, when asked for all", async () => {
    seed();
    const body = (await (await call("/?scope=all", "accountant")).json()) as LumperCasesResponse;
    const b = body.cases.find((c) => c.orderId === "B")!;
    expect(b).toMatchObject({ state: "billed_rc_on_file", open: false, rcOnFile: true, billedAmount: 200 });
    expect(b.files).toEqual([{ id: FILE, fileName: "rc-b.pdf", mime: "application/pdf", byteSize: 1200, uploadedBy: DANA, uploadedByName: "Dana Dispatch", uploadedAt: "2026-10-04T15:00:00Z" }]);
  });

  it("does not count a removed paper as the revised RC", async () => {
    seed({ files: [{ id: FILE, org_id: ORG, case_id: CASE_DONE, file_name: "rc-b.pdf", mime: "application/pdf", byte_size: 1200, uploaded_by: DANA, created_at: "2026-10-04T15:00:00Z", removed_at: "2026-10-06T00:00:00Z" }] });
    const body = (await (await call("/", "dispatcher")).json()) as LumperCasesResponse;
    expect(body.cases.find((c) => c.orderId === "B")).toMatchObject({ state: "billed_no_rc", rcOnFile: false, files: [] });
  });
});

describe("filing the revised RC (D-LRC3)", () => {
  it("gives a place to upload to, and files nothing yet", async () => {
    seed();
    const res = await post(`/${CASE_WAITING}/files/upload`, "dispatcher");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { file_id: string; upload_url: string };
    expect(body.upload_url).toBe(`https://storage.test/upload/${ORG}/${CASE_WAITING}/${body.file_id}`);
    expect(rec.writtenRows("lumper_case_files")).toHaveLength(0);
  });

  it("files it once the stored bytes are the file that was picked, and records who did", async () => {
    seed();
    const res = await post(`/${CASE_WAITING}/files`, "accountant", confirm());
    expect(res.status).toBe(201);
    expect(rec.writtenRows("lumper_case_files")).toEqual([
      { id: NEW_FILE, org_id: ORG, case_id: CASE_WAITING, kind: "revised_rc", file_name: "revised-rc.pdf", mime: "application/pdf", byte_size: PDF.length, sha256: sha(PDF), storage_path: `${ORG}/${CASE_WAITING}/${NEW_FILE}`, uploaded_by: CTX.accountant!.userId },
    ]);
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ org_id: ORG, action: "lumper_case.revised_rc_filed", entity_id: CASE_WAITING });
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("refuses bytes that differ from what the browser declared, a file that is not what it says, and a file that never arrived", async () => {
    seed();
    expect((await post(`/${CASE_WAITING}/files`, "dispatcher", confirm({ sha256: "0".repeat(64) }))).status).toBe(422);
    expect((await post(`/${CASE_WAITING}/files`, "dispatcher", confirm({ byte_size: PDF.length + 1 }))).status).toBe(422);
    const exe = new TextEncoder().encode("MZ this is not a PDF");
    seed({ stored: exe });
    const notPdf = await post(`/${CASE_WAITING}/files`, "dispatcher", confirm({ byte_size: exe.length, sha256: sha(exe) }));
    expect(notPdf.status).toBe(422);
    expect(JSON.stringify(await notPdf.json())).toContain("file_not_its_kind");
    seed({ stored: null });
    expect((await post(`/${CASE_WAITING}/files`, "dispatcher", confirm())).status).toBe(422);
    expect(rec.writtenRows("lumper_case_files")).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  it("refuses a file type outside PDF, JPEG and PNG, and a case that is not ours", async () => {
    seed();
    expect((await post(`/${CASE_WAITING}/files`, "dispatcher", confirm({ mime: "application/zip" }))).status).toBe(400);
    expect((await post(`/70000000-0000-4000-8000-000000000000/files`, "dispatcher", confirm())).status).toBe(404);
    expect((await post(`/not-an-id/files/upload`, "dispatcher")).status).toBe(404);
  });

  it("opens a filed paper through a short-lived link", async () => {
    seed();
    const res = await call(`/files/${FILE}/link`, "accountant");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: `https://storage.test/read/${ORG}/${CASE_DONE}/${FILE}`, file_name: "rc-b.pdf", mime: "application/pdf" });
  });

  it("takes a wrong paper off the case with a reason, and never without one", async () => {
    seed();
    expect((await post(`/files/${FILE}/remove`, "dispatcher", { reason: "" })).status).toBe(400);
    const res = await post(`/files/${FILE}/remove`, "dispatcher", { reason: "This is the original RC" });
    expect(res.status).toBe(200);
    const update = rec.forTable("lumper_case_files").find((q) => q.write?.method === "update")!;
    expect(update.write!.payload).toMatchObject({ removed_by: DANA, remove_reason: "This is the original RC" });
    expect(update.filters()).toEqual(expect.arrayContaining([expect.objectContaining({ col: "org_id", val: ORG }), expect.objectContaining({ col: "id", val: FILE }), expect.objectContaining({ col: "removed_at", val: null })]));
    expect(audits()[0]).toMatchObject({ action: "lumper_case.revised_rc_removed", entity_id: CASE_DONE });
  });
});

describe("closing a case that will not be billed (D-LRC4)", () => {
  it("closes it with a reason from the list and records who and why", async () => {
    seed();
    expect((await post(`/${CASE_WAITING}/close`, "accountant", { reason: "because", note: null })).status).toBe(400);
    const res = await post(`/${CASE_WAITING}/close`, "accountant", { reason: "broker_paid_directly", note: " Paid at the dock " });
    expect(res.status).toBe(200);
    const update = rec.forTable("lumper_cases").find((q) => q.write?.method === "update")!;
    expect(update.write!.payload).toMatchObject({ closed_by: CTX.accountant!.userId, close_reason: "broker_paid_directly", close_note: "Paid at the dock" });
    expect(audits()[0]).toMatchObject({ action: "lumper_case.closed", entity_id: CASE_WAITING });
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("refuses to close a closed case and to reopen an open one", async () => {
    seed({ cases: [aCase(CASE_WAITING, "A", { closed_at: "2026-10-03T00:00:00Z", closed_by: DANA, close_reason: "broker_refused" })] });
    expect((await post(`/${CASE_WAITING}/close`, "dispatcher", { reason: "broker_refused", note: null })).status).toBe(409);
    seed();
    expect((await post(`/${CASE_WAITING}/reopen`, "dispatcher")).status).toBe(409);
    expect(audits()).toHaveLength(0);
  });

  it("reopens a closed case, clearing all four close fields, and says what the reason was", async () => {
    seed({ cases: [aCase(CASE_WAITING, "A", { closed_at: "2026-10-03T00:00:00Z", closed_by: DANA, close_reason: "broker_refused", close_note: "x" })] });
    const res = await post(`/${CASE_WAITING}/reopen`, "dispatcher");
    expect(res.status).toBe(200);
    const update = rec.forTable("lumper_cases").find((q) => q.write?.method === "update")!;
    expect(update.write!.payload).toEqual({ closed_at: null, closed_by: null, close_reason: null, close_note: null });
    expect(audits()[0]).toMatchObject({ action: "lumper_case.reopened", entity_id: CASE_WAITING });
    expect((audits()[0]!.meta as Record<string, unknown>).wasReason).toBe("broker_refused");
  });
});
