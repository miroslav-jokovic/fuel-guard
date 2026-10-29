import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/maintenance/inventory/purchases` — equipment bills (M10b, 0530).
 *
 * 0530's matrix owns what the database refuses. What is left is the translation, each item invisible
 * from that side:
 *
 *   · **each refusal arrives as a sentence and the right status** — the same bill twice (by the index's
 *     NAME), an item on another bill (naming that bill), a correction somebody beat us to, a FleetPal
 *     order that is not ours — and an unknown 23505 stays a 500 rather than being called a duplicate;
 *   · **the list is live bills only**, with the database's counts of items and papers;
 *   · **the paper is filed only against our bill, as `equipment_invoice`**, and a download answers only
 *     for a document that IS this bill's — not a medical card reached by its id;
 *   · **the org filter**, because the service role bypasses RLS.
 */

const ORG = "org-1";
const USER = "user-1";
const BILL = "11111111-1111-4111-8111-111111111111";
const OLD_BILL = "22222222-2222-4222-8222-222222222222";
const RIVAL_BILL = "33333333-3333-4333-8333-333333333333";
const ASSET = "44444444-4444-4444-8444-444444444444";
const ASSET_2 = "55555555-5555-4555-8555-555555555555";
const PO = "66666666-6666-4666-8666-666666666666";
const DOC = "77777777-7777-4777-8777-777777777777";
const MEDICAL = "88888888-8888-4888-8888-888888888888";
const NEW_DOC = "99999999-9999-4999-8999-999999999999";
const SHA = "a".repeat(64);

let rec: SupabaseRecorder;
const audit = vi.hoisted(() => ({
  writeAudit: vi.fn(async (_admin: unknown, _entry: Record<string, unknown>) => true),
}));
vi.mock("../../../lib/audit.js", () => audit);
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../queue/dispatch.js", () => ({ dispatchJob: async () => ({ ok: true }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "technician", email: "shop@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  // What each gate admits is middleware/requireSection.test.ts's question against the real one.
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { inventoryPurchasesRouter } = await import("./inventoryPurchases.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance/inventory/purchases", inventoryPurchasesRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}
const call = (base: string, path: string, method = "GET", body?: unknown) =>
  fetch(`${base}/api/maintenance/inventory/purchases${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response | Awaited<ReturnType<typeof fetch>>): Promise<any> => (res as Awaited<ReturnType<typeof fetch>>).json();
const val = (q: RecordedQuery, method: string, col: string) => q.ops.find((o) => o.method === method && o.args[0] === col)?.args[1];

const bill = (over: Record<string, unknown> = {}) => ({
  id: BILL, org_id: ORG, vendor: "AT&T Business", invoice_number: "INV-1001", invoice_date: "2026-10-02",
  total: "4120.50", notes: null, fleetpal_purchase_order_id: null, superseded_by: null, created_by: USER,
  created_at: "2026-10-03T12:00:00Z", ...over,
});
const BILLS = [bill(), bill({ id: OLD_BILL, superseded_by: BILL }), bill({ id: RIVAL_BILL, org_id: "org-2" })];
const ASSETS = [
  { id: ASSET, org_id: ORG, purchase_id: BILL, display_seq: 412, name: "Cab tablet", purchase_cost: "412.05", asset_types: { name: "Tablet" } },
  { id: ASSET_2, org_id: ORG, purchase_id: BILL, display_seq: 413, name: "Cab tablet", purchase_cost: null, asset_types: { name: "Tablet" } },
];
const doc = (id: string, subject_type: string, subject_id: string, kind: string) => ({
  id, org_id: ORG, subject_type, subject_id, kind, content_type: "application/pdf", bytes: 1000, sha256: SHA, page: 1,
  variant: "original", captured_at: null, created_at: "2026-10-03T12:00:00Z", storage_path: `${ORG}/${subject_type}/${subject_id}/${id}.pdf`, derived_from: null,
});
const DOCUMENTS = [doc(DOC, "equipment_purchase", BILL, "equipment_invoice"), doc(MEDICAL, "driver", ASSET, "medical_card")];

const byOrgAndId = <T extends { org_id: string; id: string }>(rows: T[]) => (q: RecordedQuery) =>
  rows.filter((r) => r.org_id === val(q, "eq", "org_id") && (val(q, "eq", "id") === undefined || r.id === val(q, "eq", "id")));

function recorder(rpc: Record<string, unknown> = { record_equipment_purchase: bill() }) {
  return createSupabaseRecorder({
    tables: {
      equipment_purchases: (q) => {
        const live = q.ops.some((o) => o.method === "is" && o.args[0] === "superseded_by" && o.args[1] === null);
        return byOrgAndId(BILLS)(q).filter((b) => !live || b.superseded_by === null);
      },
      inventory_assets: (q) => ASSETS.filter((a) => a.org_id === val(q, "eq", "org_id")),
      documents: (q) => {
        if (q.write) return [];
        return DOCUMENTS.filter(
          (d) =>
            (val(q, "eq", "id") === undefined || d.id === val(q, "eq", "id")) &&
            (val(q, "eq", "subject_type") === undefined || d.subject_type === val(q, "eq", "subject_type")),
        );
      },
      fleetpal_purchase_orders: [{ id: PO, reference_number: "RS-1042", description: "Ratchet straps 2in", total_invoices: "212.40", vendor_created_at: "2026-09-30T00:00:00Z" }],
      user_profiles: [{ full_name: "Shop Lead" }],
      audit_logs: [],
    },
    rpc: { org_member_directory: [{ user_id: USER, full_name: "Shop Lead", email: "shop@example.test" }], ...rpc },
    storage: {
      createSignedUploadUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}`, token: "tok" }, error: null }),
      createSignedUrls: (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/read/${p}` })), error: null }),
      createSignedUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/download/${path}` }, error: null }),
    },
  });
}

const input = (over: Record<string, unknown> = {}) => ({
  id: BILL, vendor: "AT&T Business", invoiceNumber: "INV-1001", invoiceDate: "2026-10-02", total: 4120.5,
  assetIds: [ASSET, ASSET_2], ...over,
});
const SCOPED = { exempt: ["user_profiles"] };

beforeEach(() => {
  audit.writeAudit.mockClear();
  rec = recorder();
});

describe("reading bills", () => {
  it("lists live bills only, with the database's item and paper counts, scoped to the org", async () => {
    const body = await withServer(async (base) => json(await call(base, "/")));
    expect(body.purchases.map((p: { id: string }) => p.id)).toEqual([BILL]);
    expect(body.purchases[0]).toMatchObject({ itemCount: 2, paperCount: 1, total: 4120.5, createdByName: "Shop Lead", supersededBy: null });
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("answers one bill with every item it paid for, numbered as the shop says them", async () => {
    const body = await withServer(async (base) => json(await call(base, `/${BILL}`)));
    expect(body.purchase.items.map((i: { displayNo: string }) => i.displayNo)).toEqual(["A-0412", "A-0413"]);
    expect(body.purchase.items[0]).toMatchObject({ assetTypeName: "Tablet", purchaseCost: 412.05 });
  });

  it("answers a corrected bill too, pointing at its correction", async () => {
    const body = await withServer(async (base) => json(await call(base, `/${OLD_BILL}`)));
    expect(body.purchase.supersededBy).toBe(BILL);
  });

  it("answers 404 for another org's bill, and for a path that is not an id — without asking the database", async () => {
    const [rival, junk] = await withServer(async (base) => [await call(base, `/${RIVAL_BILL}`), await call(base, "/not-a-bill")]);
    expect(rival.status).toBe(404);
    expect(junk.status).toBe(404);
    expect(rec.forTable("equipment_purchases")).toHaveLength(1);
  });

  it("names FleetPal's purchase order by its reference, from FleetPal's own module", async () => {
    BILLS[0] = bill({ fleetpal_purchase_order_id: PO });
    try {
      const body = await withServer(async (base) => json(await call(base, "/")));
      expect(body.purchases[0].fleetpalOrder).toMatchObject({ id: PO, referenceNumber: "RS-1042", total: 212.4 });
    } finally {
      BILLS[0] = bill();
    }
  });

  it("finds FleetPal orders a bill can link, leaving out cancelled ones", async () => {
    const body = await withServer(async (base) => json(await call(base, "/fleetpal-orders?search=strap")));
    expect(body.orders[0]).toMatchObject({ referenceNumber: "RS-1042" });
    const q = rec.forTable("fleetpal_purchase_orders")[0]!;
    expect(q.ops.some((o) => o.method === "is" && o.args[0] === "canceled_on" && o.args[1] === null)).toBe(true);
    expectOrgScoped(rec, ORG, SCOPED);
  });
});

describe("recording a bill", () => {
  it("sends the whole bill to the one writer as the org and the person, and audits it", async () => {
    const res = await withServer((base) => call(base, "/", "POST", input()));
    expect(res.status).toBe(201);
    const [rpc] = rec.rpcs().filter((r) => r.fn === "record_equipment_purchase");
    expect(rpc?.args).toMatchObject({ p_org: ORG, p_actor: USER, p_row: { id: BILL, assetIds: [ASSET, ASSET_2] } });
    expect(audit.writeAudit.mock.calls[0]?.[1]).toMatchObject({ action: "maintenance.purchase_recorded", entityId: BILL });
  });

  it("calls a correction a correction in the audit", async () => {
    await withServer((base) => call(base, "/", "POST", input({ supersedes: OLD_BILL })));
    expect(audit.writeAudit.mock.calls[0]?.[1]).toMatchObject({ action: "maintenance.purchase_corrected", meta: { supersedes: OLD_BILL } });
  });

  it.each([
    ["no id", { id: undefined }],
    ["no item list (a correction must send the whole set)", { assetIds: undefined }],
    ["a total in fractions of a cent", { total: 10.005 }],
    ["a date that is not a date", { invoiceDate: "10/02/2026" }],
    ["an empty vendor", { vendor: "  " }],
  ])("refuses %s before the writer", async (_why, over) => {
    const res = await withServer((base) => call(base, "/", "POST", input(over)));
    expect(res.status).toBe(400);
    expect(rec.rpcs().filter((r) => r.fn === "record_equipment_purchase")).toHaveLength(0);
  });

  it.each([
    ["the same bill twice", { code: "23505", message: 'duplicate key value violates unique constraint "idx_equipment_purchases_live_invoice"' }, 409, "duplicate_invoice", /already on file/],
    ["an item on another bill", { code: "IV029", message: "an item on this bill is already on Amazon 114-77" }, 409, "IV029", /\(Amazon 114-77\)/],
    ["a correction somebody beat us to", { code: "IV028", message: "x" }, 409, "IV028", /newest one/],
    ["a correction of a bill that is not ours", { code: "IV027", message: "x" }, 422, "IV027", /not on file/],
    ["an item that is not ours", { code: "IV024", message: "x" }, 422, "IV024", /not on the books/],
    ["a FleetPal order that is not ours", { code: "23503", message: "x" }, 422, "unknown_purchase_order", /FleetPal/],
  ])("answers %s with its own sentence", async (_why, error, status, code, sentence) => {
    rec = recorder({ record_equipment_purchase: { error } });
    const res = await withServer((base) => call(base, "/", "POST", input()));
    const body = await json(res);
    expect(res.status).toBe(status);
    expect(body.error.code).toBe(code);
    expect(body.error.message).toMatch(sentence);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("does not call another unique index a duplicate bill", async () => {
    rec = recorder({ record_equipment_purchase: { error: { code: "23505", message: 'unique constraint "some_other_index"' } } });
    const res = await withServer((base) => call(base, "/", "POST", input()));
    expect(res.status).toBe(500);
  });
});

describe("the bill's paper", () => {
  const register = { id: NEW_DOC, contentType: "application/pdf", sha256: SHA, bytes: 1000 };

  it("files it against our bill, always as an equipment invoice", async () => {
    const res = await withServer((base) => call(base, `/${BILL}/documents`, "POST", register));
    expect(res.status).toBe(201);
    const [row] = rec.writtenRows("documents");
    expect(row).toMatchObject({ id: NEW_DOC, subject_type: "equipment_purchase", subject_id: BILL, kind: "equipment_invoice", org_id: ORG });
  });

  it("refuses a kind in the body rather than filing it as something else", async () => {
    const res = await withServer((base) => call(base, `/${BILL}/documents`, "POST", { ...register, kind: "medical_card" }));
    // The schema strips unknown keys, so the kind cannot reach the register; what is filed is still an invoice.
    expect(res.status).toBe(201);
    expect(rec.writtenRows("documents")[0]).toMatchObject({ kind: "equipment_invoice" });
  });

  it("files nothing against another org's bill", async () => {
    const res = await withServer((base) => call(base, `/${RIVAL_BILL}/documents`, "POST", register));
    expect(res.status).toBe(404);
    expect(rec.writes()).toHaveLength(0);
  });

  it("downloads this bill's paper, and answers a medical card reached by its id as not on file", async () => {
    const [ok, other] = await withServer(async (base) => [
      await call(base, `/${BILL}/documents/${DOC}/download`),
      await call(base, `/${BILL}/documents/${MEDICAL}/download`),
    ]);
    expect(ok.status).toBe(200);
    expect((await json(ok)).url).toMatch(/storage\.test\/download/);
    expect(other.status).toBe(404);
  });
});
