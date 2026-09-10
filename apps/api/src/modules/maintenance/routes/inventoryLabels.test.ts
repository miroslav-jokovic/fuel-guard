import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/maintenance/inventory/labels` (INVENTORY-PLAN.md I10).
 *
 * `labels.test.ts` owns issuance and `labelPdf.test.ts` owns the drawing. What is only true at this
 * edge, and would be true nowhere else:
 *
 *   · **the preset id is validated HERE.** `labelRunSchema` types it as a bounded string on purpose
 *     — `@silvicom/shared` is compiled for React Native and must not pull `@silvicom/qr` into the
 *     driver bundle for a screen the driver app does not have — so this route is the ONLY thing
 *     standing between a typo and `labelSheet()` throwing on an undefined preset;
 *   · **a start position is checked against the chosen preset's own capacity.** 30 is a legal
 *     position on a 30-up address sheet and does not exist on a 24-up square sheet, which no schema
 *     can know because it depends on another field;
 *   · **printing is audited and previewing is not.** "Who printed labels for these forty things"
 *     is the question asked when two objects turn out to carry one code; a preview somebody opened
 *     and closed is not an event anybody needs six months later;
 *   · **the sheet comes back as a PDF**, not as JSON describing one.
 */

const ORG = "org-1";
const USER = "user-1";
const ASSET = "33333333-3333-4333-8333-333333333333";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
const audit = vi.hoisted(() => ({
  writeAudit: vi.fn(async (_admin: unknown, _entry: Record<string, unknown>) => true),
}));
vi.mock("../../../lib/audit.js", () => audit);
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "technician", email: "shop@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  // What each gate ADMITS is proved in middleware/requireSection.test.ts against the real
  // implementation; stubbing it here would only prove the stub.
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { inventoryLabelsRouter } = await import("./inventoryLabels.js");

const recorder = () =>
  createSupabaseRecorder({
    tables: {
      inventory_assets: (q) => {
        const update = q.ops.find((o) => o.method === "update");
        if (update) return [update.args[0] as Record<string, unknown>] as never;
        return [{ id: ASSET, tag_code: null, display_seq: 412, name: "Cab tablet" }] as never;
      },
    },
  });

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance/inventory/labels", inventoryLabelsRouter());
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
  fetch(`${base}/api/maintenance/inventory/labels${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const RUN = { presetId: "avery-22805", targets: [{ kind: "asset", assetId: ASSET }] };

beforeEach(() => {
  rec = recorder();
  audit.writeAudit.mockClear();
});

describe("the label presets", () => {
  it("names the stock and what it survives, because that is decided at the moment of printing", async () => {
    await withServer(async (base) => {
      const res = await call(base, "/presets");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { presets: Array<{ id: string; perSheet: number; material: string }> };
      expect(body.presets).toHaveLength(5);
      const square = body.presets.find((p) => p.id === "avery-22805")!;
      expect(square.perSheet).toBe(24);
      // §2.4: adhesive paper fails in 60–90 days in a shop, and the only moment that advice can
      // change an outcome is while somebody is choosing what to print onto.
      expect(square.material).toMatch(/polyester/i);
    });
  });
});

describe("printing a sheet", () => {
  it("answers with a PDF and audits the run", async () => {
    await withServer(async (base) => {
      const res = await call(base, "/sheet", "POST", RUN);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("x-silvicom-label-count")).toBe("1");
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

      expect(audit.writeAudit).toHaveBeenCalledTimes(1);
      expect(audit.writeAudit.mock.calls[0]![1]).toMatchObject({
        orgId: ORG,
        action: "maintenance.labels_printed",
        meta: { count: 1, preset: "avery-22805" },
      });
    });
  });

  /**
   * ⚠ The schema cannot catch this and nothing downstream would: `labelSheet()` looks the preset up
   * in a record and would hand `undefined.columns` to the renderer, which is a 500 for what is
   * really a caller naming a sheet we do not stock.
   */
  it("refuses a preset we do not stock, with a sentence rather than a crash", async () => {
    await withServer(async (base) => {
      const res = await call(base, "/sheet", "POST", { ...RUN, presetId: "avery-99999" });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("unknown_preset");
      expect(audit.writeAudit).not.toHaveBeenCalled();
    });
  });

  /**
   * Position 30 is real on a 30-up address sheet and does not exist on a 24-up square one, so the
   * bound depends on ANOTHER field and no schema can express it. `labelSheet()` throws rather than
   * answering, which would reach the caller as a 500 about a number they can see on their screen.
   */
  it("refuses a start position the chosen sheet does not have", async () => {
    await withServer(async (base) => {
      const res = await call(base, "/sheet", "POST", { ...RUN, startPosition: 30 });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe("start_position_out_of_range");
      // The sentence has to carry the number that IS legal, or the reader has to go and count.
      expect(body.error?.message).toContain("24");
    });
  });

  it("accepts that same position on a sheet that has it", async () => {
    await withServer(async (base) => {
      const res = await call(base, "/sheet", "POST", {
        ...RUN,
        presetId: "avery-5160",
        startPosition: 30,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
    });
  });
});

describe("previewing", () => {
  it("returns the faces and does not audit", async () => {
    await withServer(async (base) => {
      const res = await call(base, "/faces", "POST", { targets: RUN.targets });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { faces: Array<{ code: string; payload: string }>; dropped: number };
      expect(body.dropped).toBe(0);
      expect(body.faces[0]!.code).toBe("A-0412");
      expect(body.faces[0]!.payload).toMatch(/^SIL1:AST:[0-9A-Z]{6}$/);
      expect(audit.writeAudit).not.toHaveBeenCalled();
    });
  });
});
