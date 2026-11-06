import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);
const ADMIN: AuthContext = { userId: "u-admin", email: "admin@example.test", orgId: ORG, role: "admin" };

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => ADMIN;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));
beforeEach(() => {
  holder.rec = createSupabaseRecorder({ tables: { jobs: [] } });
});

describe("GET /api/jobs/latest", () => {
  it("accepts sync_odometer so the odometer card can poll its running job", async () => {
    const response = await fetch(`${baseUrl}/api/jobs/latest?kind=sync_odometer`, {
      headers: { Authorization: "Bearer token" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ latest: null, lastDone: null });
  });
});

/**
 * Q-AD41 (b), 2026-11-06: the kinds come from the shared catalogue, not a hand list — `efs_store_sync` was missing,
 * so Data & sync's card answered 400 on every load. Widening to every kind keeps the rows that can name a lead, a
 * campaign, a drug-test sync or finance totals behind Settings, as `/failed` is; fuel, Samsara and EFS stay open.
 */
describe("GET /api/jobs/latest — every catalogued kind, held to its area's gate", () => {
  const as = async (who: AuthContext, kind: string) => {
    const app = createApp(env);
    app.locals.verifyToken = async (): Promise<AuthContext> => who;
    const s = app.listen(0);
    await new Promise((r) => s.once("listening", r));
    try {
      return (await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/jobs/latest?kind=${kind}`, { headers: { Authorization: "Bearer token" } })).status;
    } finally {
      await closeTestServer(s);
    }
  };
  const DISPATCHER: AuthContext = { userId: "u-disp", email: "disp@example.test", orgId: ORG, role: "dispatcher" };

  it("serves efs_store_sync, the kind the hand list missed", async () => {
    expect(await as(ADMIN, "efs_store_sync")).toBe(200);
  });

  it("a fuel, Samsara or EFS kind stays open to any member", async () => {
    for (const kind of ["efs_store_sync", "sync_ifta", "rebuild"]) expect(await as(DISPATCHER, kind), kind).toBe(200);
  });

  it("an ads, compliance or finance kind needs the Settings section", async () => {
    for (const kind of ["ads_lead_fetch", "medstop_sync", "financial_projection"]) {
      expect(await as(DISPATCHER, kind), kind).toBe(403);
      expect(await as(ADMIN, kind), kind).toBe(200);
    }
  });

  it("a kind the catalogue does not name is still refused", async () => {
    expect(await as(ADMIN, "not_a_kind")).toBe(400);
  });
});
