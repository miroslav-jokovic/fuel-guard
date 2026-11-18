import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response as ExpressResponse } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * A work order's vendor paper, read live from FleetPal (F16, D-FP28), and the drawer by FleetPal's id.
 *
 * FleetPal is a fake `fetch` that answers the invoice read with its attachments and the signed link with
 * bytes; every request to it is recorded, so "never asked FleetPal" and "never sent the key to the
 * storage link" are assertions about what actually went over the wire. The recorder's fixtures honour
 * the query's own filters, so a read that drops `org_id` or the work order's id gets another order's
 * invoice back.
 */

const ORG = "org-1";
const ROW = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const KEY = "fp_test_key";
let rec: SupabaseRecorder;
let connected = true;

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../fleetpal/credentials.js", () => ({
  getApiKey: async () => (connected ? { apiKey: KEY, baseUrl: "https://fleetpal.test" } : null),
}));
vi.mock("../../../middleware/auth.js", () => ({
  requireAdminOnly: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
  requireAuth: (req: Request, _res: ExpressResponse, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "fleet_manager", email: "office@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
}));

const { maintenanceRouter } = await import("./index.js");

const matches = (q: RecordedQuery, r: Record<string, unknown>) =>
  q.filters().every((f) => (Array.isArray(f.val) ? f.val.includes(r[f.col]) : r[f.col] === f.val));
const table = (rows: Record<string, unknown>[]) => (q: RecordedQuery) => rows.filter((r) => matches(q, r));

function recorder() {
  return createSupabaseRecorder({
    tables: {
      fleetpal_sync_state: [],
      fleetpal_units: [],
      fleetpal_jobs: [],
      fleetpal_work_orders: table([
        { org_id: ORG, id: ROW, fleetpal_id: "fpwo1", unit_fleetpal_id: null, reference_number: "WO-5436", status: "CLOSED", vendor_created_at: null, completed: null, description: null },
        { org_id: "org-2", id: "row-theirs", fleetpal_id: "fpwo9", unit_fleetpal_id: null, reference_number: "THEIRS", status: "CLOSED", vendor_created_at: null, completed: null, description: null },
      ]),
      fleetpal_purchase_orders: table([
        { org_id: ORG, fleetpal_id: "po1", work_order_fleetpal_id: "fpwo1", reference_number: "PO-1" },
        { org_id: ORG, fleetpal_id: "po2", work_order_fleetpal_id: "other", reference_number: "PO-2" },
      ]),
      fleetpal_po_invoices: table([
        { org_id: ORG, fleetpal_id: "inv1", purchase_order_fleetpal_id: "po1", invoice_number: "8812", invoice_date: null, invoice_type: "STANDARD", amount: "10" },
        { org_id: ORG, fleetpal_id: "invOther", purchase_order_fleetpal_id: "po2", invoice_number: "9", invoice_date: null, invoice_type: "STANDARD", amount: "1" },
      ]),
    },
  });
}

const PDF = Buffer.from("%PDF-1.4 scanned bill");
const SIGNED = "https://nyc3.storage.test/fleetpal-media/inv1.PDF?X-Amz-Expires=3600&X-Amz-Signature=abc";
let vendorCalls: { url: string; auth: string | null }[] = [];
let invoiceAnswer: () => Response = () =>
  Response.json({ id: "inv1", attachments: [{ index: 0, filename: "WO_Priced_4011391635_00613_2026111713055", content_type: "application/pdf", url: SIGNED }] });

const realFetch = globalThis.fetch;
beforeEach(() => {
  rec = recorder();
  connected = true;
  vendorCalls = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    vendorCalls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (url === SIGNED) return new Response(PDF, { headers: { "content-type": "application/pdf" } });
    if (url.startsWith("https://fleetpal.test/v1/purchase-order-invoices/inv1/")) return invoiceAnswer();
    return new Response("{}", { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  invoiceAnswer = () =>
    Response.json({ id: "inv1", attachments: [{ index: 0, filename: "WO_Priced_4011391635_00613_2026111713055", content_type: "application/pdf", url: SIGNED }] });
});

async function call(path: string): Promise<{ status: number; headers: Headers; body: unknown; bytes: Buffer }> {
  const app = express();
  app.use("/api/maintenance", maintenanceRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await realFetch(`http://127.0.0.1:${port}/api/maintenance/${path}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const json = res.headers.get("content-type")?.includes("json") ? (JSON.parse(bytes.toString()) as unknown) : null;
    return { status: res.status, headers: res.headers, body: json, bytes };
  } finally {
    await closeTestServer(server);
  }
}

describe("GET /work-orders/:id/files — which invoices carry a file, asked of FleetPal now", () => {
  it("lists each file on the order's own invoices, without FleetPal's signed link", async () => {
    const { status, body } = await call(`work-orders/${ROW}/files`);
    expect(status).toBe(200);
    expect((body as { data: unknown }).data).toEqual({
      state: "read",
      files: [{ invoiceId: "inv1", index: 0, filename: "WO_Priced_4011391635_00613_2026111713055", contentType: "application/pdf" }],
    });
    expect(JSON.stringify(body)).not.toContain("X-Amz");
    // Only this order's invoice was asked about — never the org's other one.
    expect(vendorCalls.map((c) => c.url)).toEqual(["https://fleetpal.test/v1/purchase-order-invoices/inv1/"]);
    expectOrgScoped(rec, ORG);
  });

  it("says FleetPal is not connected — never 'no file' — when the org has no key", async () => {
    connected = false;
    const { body } = await call(`work-orders/${ROW}/files`);
    expect((body as { data: unknown }).data).toEqual({ state: "not_connected" });
  });

  it("says FleetPal could not be reached — never 'no file' — when it fails", async () => {
    invoiceAnswer = () => new Response("down", { status: 500 });
    const { body } = await call(`work-orders/${ROW}/files`);
    expect((body as { data: unknown }).data).toEqual({ state: "unreachable" });
  });

  it("is a 404 for another carrier's work order, and FleetPal is never asked", async () => {
    expect((await call("work-orders/1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/files")).status).toBe(404);
    expect(vendorCalls).toEqual([]);
  });
});

describe("GET /work-orders/:id/files/:invoiceId/:index — the file itself", () => {
  it("passes the bytes through with a name that opens, and sends no key to the storage link", async () => {
    const { status, headers, bytes } = await call(`work-orders/${ROW}/files/inv1/0`);
    expect(status).toBe(200);
    expect(bytes.equals(PDF)).toBe(true);
    expect(headers.get("content-type")).toBe("application/pdf");
    expect(headers.get("content-disposition")).toBe('inline; filename="WO_Priced_4011391635_00613_2026111713055.pdf"');
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(vendorCalls).toEqual([
      { url: "https://fleetpal.test/v1/purchase-order-invoices/inv1/", auth: `Bearer ${KEY}` },
      { url: SIGNED, auth: null },
    ]);
  });

  it("⚠ refuses an invoice that is not on this work order before FleetPal is asked", async () => {
    expect((await call(`work-orders/${ROW}/files/invOther/0`)).status).toBe(404);
    expect(vendorCalls).toEqual([]);
  });

  it("is a 404 when FleetPal no longer has that file", async () => {
    expect((await call(`work-orders/${ROW}/files/inv1/3`)).status).toBe(404);
  });

  it("refuses a storage link that is not https", async () => {
    invoiceAnswer = () => Response.json({ id: "inv1", attachments: [{ index: 0, filename: "a.pdf", content_type: "application/pdf", url: "http://169.254.169.254/latest" }] });
    expect((await call(`work-orders/${ROW}/files/inv1/0`)).status).toBe(502);
    expect(vendorCalls.map((c) => c.url)).not.toContain("http://169.254.169.254/latest");
  });

  it("is a 400 for ids that are not ids", async () => {
    expect((await call(`work-orders/WO-5436/files/inv1/0`)).status).toBe(400);
    expect((await call(`work-orders/${ROW}/files/inv1/-1`)).status).toBe(400);
    expect((await call(`work-orders/${ROW}/files/inv%2F1/0`)).status).toBe(400);
  });
});

describe("GET /fleetpal-work-orders/:fleetpalId — the drawer from a roadside repair", () => {
  it("answers the same record, carrying our row id for the files read", async () => {
    const { status, body } = await call("fleetpal-work-orders/fpwo1");
    expect(status).toBe(200);
    expect((body as { data: unknown }).data).toMatchObject({ id: ROW, record: { reference: "WO-5436", invoices: [{ invoiceId: "inv1", invoiceNumber: "8812" }] } });
    expectOrgScoped(rec, ORG);
  });

  it("is a 404 for another carrier's FleetPal id", async () => {
    expect((await call("fleetpal-work-orders/fpwo9")).status).toBe(404);
  });
});
