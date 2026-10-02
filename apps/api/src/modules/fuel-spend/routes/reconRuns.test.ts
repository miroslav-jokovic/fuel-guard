import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/fueling/recon-runs` and `GET /api/fueling/recon-runs/:id` — the Pilot invoices page's two
 * reads (FS3). What only this boundary decides:
 *
 *   • the list is PAGED with a total, so a page can count past any cap, and stays newest period first;
 *   • a saved check is read back as it was WRITTEN — its lines from `fuel_recon_run_rows` — and a run
 *     that predates 0406 says its lines were not kept (`lines: null`), never an empty list;
 *   • an id that is not a uuid, or is another carrier's, is a 404, not a 500 and not their run;
 *   • every read names the org (the service role bypasses RLS).
 */

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const RUN = "31111111-2222-4333-8444-555555555555";
const OLD_RUN = "41111111-2222-4333-8444-555555555555";

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };

let server: Server;
let baseUrl = "";

const run = (id: string, start: string) => ({
  id, source_kind: "weekly_statement", source_filename: "db139445F.pdf", invoice_no: "799011888",
  statement_id: null, period_start: start, period_end: start, tie_out_gated: true, tie_out_notes: [],
  matcher_version: "f4", summary: { clean: 1 }, unmatchable_lines: 0, created_at: "2026-09-14T20:14:18Z",
  superseded_by: null, superseded_at: null,
});
const LINES = [{ status: "missing_in_system", report: { authNo: "a2", cardRef: "317971" }, system: null }];

/** Runs and lines answered per the filters the read applied, so a missing org or id filter shows. */
const seed = () =>
  createSupabaseRecorder({
    tables: {
      fuel_recon_runs: (q) => {
        const f = Object.fromEntries(q.filters().map((x) => [x.col, x.val]));
        if (f.org_id !== ORG) return [];
        const all = [run(RUN, "2026-09-07"), run(OLD_RUN, "2026-08-24")];
        const rows = f.id ? all.filter((r) => r.id === f.id) : all;
        return { data: rows, count: 61 };
      },
      fuel_recon_run_rows: (q) => {
        const f = Object.fromEntries(q.filters().map((x) => [x.col, x.val]));
        // OLD_RUN predates 0406: it has no lines.
        return f.org_id === ORG && f.run_id === RUN ? [{ rows: LINES, unmatchable: [] }] : [];
      },
    },
  });

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return ADMIN;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  holder.rec = seed();
});

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });
const rangeOf = (rec: SupabaseRecorder) =>
  rec.forTable("fuel_recon_runs")[0]!.ops.find((o) => o.method === "range")!.args;

describe("GET /api/fueling/recon-runs", () => {
  it("answers one page of live checks and how many there are in all", async () => {
    const res = await get("/api/fueling/recon-runs?limit=2&offset=4");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Array<{ id: string }>; total: number };
    expect(body.runs.map((r) => r.id)).toEqual([RUN, OLD_RUN]);
    expect(body.total).toBe(61);
    expect(rangeOf(holder.rec!)).toEqual([4, 5]);
    const q = holder.rec!.forTable("fuel_recon_runs")[0]!;
    expect(q.filters()).toContainEqual({ col: "superseded_by", val: null });
    expect(q.ops.find((o) => o.method === "order")!.args).toEqual(["period_start", { ascending: false }]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("pages 25 at a time when not told, and never more than 100", async () => {
    await get("/api/fueling/recon-runs");
    expect(rangeOf(holder.rec!)).toEqual([0, 24]);
    holder.rec = seed();
    await get("/api/fueling/recon-runs?limit=5000");
    expect(rangeOf(holder.rec!)).toEqual([0, 99]);
  });
});

describe("GET /api/fueling/recon-runs/:id", () => {
  it("reads a saved check back with the lines it recorded", async () => {
    const res = await get(`/api/fueling/recon-runs/${RUN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { id: string }; lines: unknown[] | null; unmatchable: unknown[] | null };
    expect(body.run.id).toBe(RUN);
    expect(body.lines).toEqual(LINES);
    expect(body.unmatchable).toEqual([]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("says a check from before its lines were kept has no lines, rather than an empty list", async () => {
    const body = (await (await get(`/api/fueling/recon-runs/${OLD_RUN}`)).json()) as { run: { id: string }; lines: unknown };
    expect(body.run.id).toBe(OLD_RUN);
    expect(body.lines).toBeNull();
  });

  it("is a 404 for an id that is not a run of this carrier", async () => {
    expect((await get("/api/fueling/recon-runs/51111111-2222-4333-8444-555555555555")).status).toBe(404);
  });

  it("is a 404, not a database error, for an id that is not a uuid", async () => {
    expect((await get("/api/fueling/recon-runs/not-a-run")).status).toBe(404);
    expect(holder.rec!.forTable("fuel_recon_runs")).toHaveLength(0);
  });
});

describe("POST /api/fueling/recon-runs", () => {
  it("accepts a body past the general 1 MB cap, as a real statement's words are", async () => {
    // 1.2 MB of words that are not a Pilot statement: the route must get to say so (422), rather than
    // the body parser refusing the upload before it (413).
    const words = Array.from({ length: 20_000 }, (_, i) => ({ text: `word${i}-padding-padding`, x: i, y: i, page: 1 }));
    const res = await fetch(`${baseUrl}/api/fueling/recon-runs`, {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ words, filename: "big.pdf" }),
    });
    expect(JSON.stringify({ words }).length).toBeGreaterThan(1_100_000);
    expect(res.status).toBe(422);
  });
});
