import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * `GET /api/tags/resolve` — one scan, one answer (D-INV7; INVENTORY-PLAN.md step I6, fabric half).
 *
 * ── WHAT THIS ROUTE CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ───────────────────────────────
 *
 *   1. **A failure must be a RESULT, not an error.** `unknown_tag` and `malformed` come back as
 *      200s with a discriminated member, because each has a different useful next action — a tag
 *      from a newer version of the product, versus a damaged label or somebody else's barcode. A
 *      404 for both collapses that into one dead end, and the sheet's "attach or create" needs to
 *      know which happened AND needs the scanned code kept.
 *   2. **A tag nobody has registered a resolver for, and a tag whose id is not ours, must be
 *      INDISTINGUISHABLE.** Answering differently would confirm another tenant's label to anyone
 *      holding a phone.
 *   3. **A non-tag string falls through to a supplier UPC**, which is only safe because `parseTag`
 *      accepts nothing without the `SIL1:` prefix and every retail symbology encodes digits.
 *   4. **Adding a kind is one registration** — asserted by registering a fake one, which is the
 *      step's own done-when.
 */

const ORG = "org-1";
const USER = "user-1";

let rec: SupabaseRecorder;
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "technician", email: "shop@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { tagsRouter } = await import("./routes.js");
const { registerTagResolvers } = await import("./resolvers.js");
const { registerTagResolver, clearTagResolvers, registeredTagKinds } = await import("./registry.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/tags", tagsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}

interface Body {
  ok?: boolean;
  result?: { kind: string; code: string; tagKind?: string | null; part?: { id: string }; stockLines?: unknown[] };
}
const resolve = async (code: string): Promise<Body> =>
  withServer(async (base) =>
    (await (await fetch(`${base}/api/tags/resolve?code=${encodeURIComponent(code)}`)).json()) as Body,
  );

const stockRow = {
  part_id: "p-1",
  location_id: "l-1",
  quantity_on_hand: 12,
  reorder_point: 3,
  reorder_quantity: 24,
  aisle: null,
  row: null,
  bin: null,
  tag_code: "7K3M9P",
  active: true,
  parts: { part_number: "LF-9009", description: "Oil filter", unit_of_measure: "each", last_cost: "12.50" },
  stock_locations: { name: "Main bay" },
};

const partRow = {
  id: "p-1",
  part_number: "LF-9009",
  description: "Oil filter",
  manufacturer: null,
  category: null,
  unit_of_measure: "each",
  upc: "012345678905",
  image_path: null,
  last_cost: "12.50",
  active: true,
  notes: null,
};

beforeEach(() => {
  clearTagResolvers();
  registerTagResolvers();
  rec = createSupabaseRecorder({
    tables: { part_stock: [stockRow], inventory_assets: [], parts: [] },
  });
});

describe("a tag of ours", () => {
  it("resolves a BIN tag to the stock line it names", async () => {
    const body = await resolve("SIL1:BIN:7K3M9P");
    expect(body.result?.kind).toBe("stock_line");
    expect(body.result?.code).toBe("SIL1:BIN:7K3M9P");
  });

  /**
   * The two are the same answer on purpose. A resolver that said "that tag exists, just not here"
   * would confirm another tenant's label to whoever scanned it.
   */
  it("answers unknown_tag for a kind with no resolver AND for an id that is not ours", async () => {
    clearTagResolvers();
    const unregistered = await resolve("SIL1:BIN:7K3M9P");
    expect(unregistered.result).toMatchObject({ kind: "unknown_tag", tagKind: "BIN" });

    registerTagResolvers();
    rec = createSupabaseRecorder({ tables: { part_stock: () => [], inventory_assets: () => [], parts: () => [] } });
    const foreign = await resolve("SIL1:BIN:ZZZZZZ");
    expect(foreign.result).toMatchObject({ kind: "unknown_tag", tagKind: "BIN" });
  });

  it("normalises the confusable characters before it looks, which is what a greasy label needs", async () => {
    // `O` folds to `0` and `I`/`L` to `1` (Crockford, `normalizeTagId`). The row's tag is `7K3M09`.
    rec = createSupabaseRecorder({
      tables: {
        part_stock: (q) => {
          const tag = q.filters().find((f) => f.col === "tag_code")?.val;
          return tag === "7K3M09" ? [{ ...stockRow, tag_code: "7K3M09" }] : [];
        },
        inventory_assets: () => [],
        parts: () => [],
      },
    });
    expect((await resolve("SIL1:BIN:7K3MO9")).result?.kind).toBe("stock_line");
  });
});

describe("a code that is not ours", () => {
  it("falls through to a supplier UPC and says where that part is held", async () => {
    rec = createSupabaseRecorder({
      tables: { parts: [partRow], part_stock: [stockRow], inventory_assets: () => [] },
    });
    const body = await resolve("012345678905");
    expect(body.result?.kind).toBe("part_by_upc");
    expect(body.result?.part?.id).toBe("p-1");
    expect(Array.isArray(body.result?.stockLines)).toBe(true);
  });

  it("answers malformed — with the code kept — when it is neither", async () => {
    rec = createSupabaseRecorder({ tables: { parts: () => [], part_stock: () => [], inventory_assets: () => [] } });
    const body = await resolve("not-a-code");
    // The code comes back because the sheet's next action is "create a part with it".
    expect(body.result).toMatchObject({ kind: "malformed", code: "not-a-code" });
  });

  it("refuses an empty code rather than guessing what was scanned", async () => {
    const res = await withServer((base) => fetch(`${base}/api/tags/resolve`));
    expect(res.status).toBe(400);
  });
});

describe("the registry", () => {
  /** The step's own done-when: adding a kind is one registration and no change to this route. */
  it("dispatches to a kind registered from outside this file", async () => {
    clearTagResolvers();
    registerTagResolver("AST", async (ctx) => ({
      kind: "malformed",
      code: `fake:${ctx.id}`,
    }));
    const body = await resolve("SIL1:AST:7K3M9P");
    expect(body.result).toMatchObject({ kind: "malformed", code: "fake:7K3M9P" });
    expect(registeredTagKinds()).toEqual(["AST"]);
  });

  it("registers both of maintenance's kinds at startup", () => {
    clearTagResolvers();
    registerTagResolvers();
    expect(registeredTagKinds().sort()).toEqual(["AST", "BIN"]);
  });
});
