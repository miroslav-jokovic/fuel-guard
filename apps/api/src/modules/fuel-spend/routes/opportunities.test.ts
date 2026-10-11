import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The savings strip's route, through the real app (FS-STRIP). `findingsOpportunities.test.ts` pins the read;
 * what only the HTTP layer can show is that the section gate holds, that the page's query reaches the
 * read parsed (a hand-edited value is dropped, not passed to the database), and that it is mounted at all.
 */

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V1 = "11111111-2222-4333-8444-555555555555";

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };
const DRIVER: AuthContext = { userId: "u-drv", email: "d@x.test", orgId: ORG, role: "driver" };

let server: Server;
let baseUrl = "";
let auth: AuthContext = ADMIN;

const seed = () =>
  createSupabaseRecorder({
    tables: {
      vehicles: [{ id: V1, unit_number: "701" }],
      fuel_exceptions: [{ kind: "contract_variance", amount: "20.00", occurred_on: "2026-09-20" }],
    },
  });

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return auth;
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
  auth = ADMIN;
  holder.rec = seed();
});

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });

describe("GET /api/fueling/findings/opportunities", () => {
  it("answers a caller who may see the ledger with one row per kind", async () => {
    const res = await get("/api/fueling/findings/opportunities?from=2026-09-01&to=2026-09-30");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; rows: { kind: string; count: number; amount: number }[] };
    expect(body.ok).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ kind: "contract_variance", count: 1, amount: 20 });
  });

  it("refuses a caller without the fuel section, and never reads the ledger for them", async () => {
    auth = DRIVER;
    const res = await get("/api/fueling/findings/opportunities");
    expect(res.status).toBe(403);
    expect(holder.rec!.forTable("fuel_exceptions")).toHaveLength(0);
  });

  const filters = () => holder.rec!.forTable("fuel_exceptions").at(-1)!.filters().map((x) => [x.col, x.val] as const);

  it("passes the window and the trucks on", async () => {
    await get(`/api/fueling/findings/opportunities?from=2026-09-01&to=2026-09-30&vehicles=${V1}`);
    expect(filters()).toEqual(expect.arrayContaining([
      ["occurred_on", "2026-09-01"], ["occurred_on", "2026-09-30"], ["unit_number", ["701"]], ["org_id", ORG],
    ]));
  });

  it("drops a date that is not a date and an id that is not a UUID, each on its own", async () => {
    await get(`/api/fueling/findings/opportunities?from=junk&to=2026-09-30&vehicles=${V1},nope`);
    expect(filters().some(([c, v]) => c === "occurred_on" && v === "junk")).toBe(false);
    expect(filters()).toEqual(expect.arrayContaining([["occurred_on", "2026-09-30"], ["unit_number", ["701"]]]));
    await get("/api/fueling/findings/opportunities?from=2026-09-01&to=junk");
    expect(filters().some(([c, v]) => c === "occurred_on" && v === "junk")).toBe(false);
    expect(filters()).toEqual(expect.arrayContaining([["occurred_on", "2026-09-01"]]));
  });
});
