import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/maintenance/spend` — the shop home's repair-spend card (I4's owed sum, paid 2026-09-09).
 *
 * ── ⚠ THE ASSERTION THIS FILE EXISTS FOR ─────────────────────────────────────────────────────
 * **The total is over the WINDOW, never over the page.** The endpoint answers with fifty entries and
 * a row count; the card used to show the count because there was no sum, and I4 recorded the debt
 * rather than adding the page up — a figure that is right for fifty repairs and wrong for the
 * fifty-first is worse than no figure, and would be believed. That is the same defect the
 * 2026-09-09 review found in `/low-stock`, where a list of what to order stopped early and said
 * "nothing more to order".
 *
 * So the fixture makes the two answers DIFFERENT on purpose: the page carries two entries worth
 * $30, and the window's aggregation says $18,452.19. A route summing its own page reports $30.
 */

const ORG = "org-1";

const searchEntries = vi.hoisted(() =>
  vi.fn(async () => ({
    entries: [{ id: "e1", amount: 10 }, { id: "e2", amount: 20 }],
    total: 37,
  })),
);
const summarizeByCategory = vi.hoisted(() =>
  vi.fn(async () => [
    { category: "maintenance", direction: "out", entries: 37, amount: 18452.19 },
    { category: "fuel", direction: "out", entries: 900, amount: 120000 },
  ]),
);
vi.mock("../../financial/index.js", () => ({ searchEntries, summarizeByCategory }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "fleet_manager", email: "office@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { maintenanceRouter } = await import("./index.js");

async function call(query: string): Promise<{ total?: number; totalAmount?: number; pendingSources?: string | null }> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance", maintenanceRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    return (await (await fetch(`http://127.0.0.1:${port}/api/maintenance/spend?${query}`)).json()) as never;
  } finally {
    await closeTestServer(server);
  }
}

beforeEach(() => {
  searchEntries.mockClear();
  summarizeByCategory.mockClear();
});

describe("the repair-spend window", () => {
  it("answers with the window's dollars, not the page's", async () => {
    const body = await call("from=2026-08-01&to=2026-09-01");
    expect(body.total).toBe(37);
    // $18,452.19 and not $30 — the page's two entries sum to thirty.
    expect(body.totalAmount).toBe(18452.19);
  });

  it("takes the maintenance category and leaves fuel's alone", async () => {
    const body = await call("from=2026-08-01&to=2026-09-01");
    expect(body.totalAmount).not.toBe(120000);
  });

  it("reports zero rather than nothing when the ledger holds no repairs", async () => {
    summarizeByCategory.mockResolvedValueOnce([]);
    const body = await call("from=2026-08-01&to=2026-09-01");
    // Zero is a real answer about a real window; null would make the card render a dash for it.
    expect(body.totalAmount).toBe(0);
  });

  it("asks the ledger for the same window it asked for the page", async () => {
    await call("from=2026-08-01&to=2026-09-01");
    expect(summarizeByCategory.mock.calls[0]?.slice(2)).toEqual(["2026-08-01", "2026-09-01"]);
  });
});
