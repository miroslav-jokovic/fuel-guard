import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import type { AuthContext } from "@fuelguard/shared";
import { createSupabaseRecorder, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * Declaring the carrier's TMS the master of the roster.
 *
 * The switch has existed since M5 and until now had no way to set it — `/mcleod/config`, `/enable`
 * and `/disable` never touched `config.roster_master`, so the only path was an UPDATE typed into the
 * SQL editor. What is asserted here is mostly the REFUSALS, because the dangerous direction is
 * turning it on: doing so stands three Samsara syncs down, and if no agent can authenticate, nothing
 * takes over and the roster silently stops being maintained.
 */
const ORG = "11111111-1111-1111-1111-111111111111";
const CTX: Record<string, AuthContext> = {
  admin: { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" },
  fleet: { userId: "u-fleet", email: "f@x.test", orgId: ORG, role: "fleet_manager" },
};

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

let server: Server;
let baseUrl = "";

/** `row` null means the org has never connected McLeod at all. */
const seed = (row: Record<string, unknown> | null): SupabaseRecorder =>
  createSupabaseRecorder({ tables: { org_integrations: row ? [row] : [], audit_logs: [] } });

const CONNECTED = {
  org_id: ORG,
  provider: "mcleod",
  enabled: true,
  ingest_token_hash: "hash",
  // A pre-existing key, so the merge can be shown to preserve it rather than replace the object.
  config: { company_id: "TMS" },
};

const call = (enabled: boolean, token = "admin") =>
  fetch(`${baseUrl}/api/integrations/mcleod/roster-master`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const ctx = CTX[t];
    if (!ctx) throw new Error("bad token");
    return ctx;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("POST /api/integrations/mcleod/roster-master", () => {
  it("is admin-only — reassigning roster ownership is not a fleet-manager act", async () => {
    holder.client = seed(CONNECTED).client;
    expect((await call(true, "fleet")).status).toBe(403);
  });

  it("refuses an org that has never connected McLeod", async () => {
    holder.client = seed(null).client;
    const res = await call(true);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("mcleod_not_configured");
  });

  it("refuses to hand the roster to a TMS with no live ingest token", async () => {
    // The silent-failure case: Samsara stands down, and no agent can authenticate to take over.
    holder.client = seed({ ...CONNECTED, ingest_token_hash: null }).client;
    const res = await call(true);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("mcleod_not_connected");
  });

  it("refuses while the integration is disabled", async () => {
    holder.client = seed({ ...CONNECTED, enabled: false }).client;
    expect((await call(true)).status).toBe(409);
  });

  it("declares mastery, preserving the rest of the config", async () => {
    const rec = seed(CONNECTED);
    holder.client = rec.client;
    const res = await call(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rosterMaster: true });
    const written = rec.writtenRows("org_integrations")[0]!;
    expect(written.config).toEqual({ company_id: "TMS", roster_master: true });
  });

  it("records who did it — ownership of the roster is an attributable act", async () => {
    const rec = seed(CONNECTED);
    holder.client = rec.client;
    await call(true);
    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit).toMatchObject({
      org_id: ORG,
      actor_id: "u-admin",
      action: "integration.mcleod.roster_master_declared",
    });
  });

  it("never refuses the withdrawal — a rollback that can be blocked is not one", async () => {
    // Even with the integration disabled, which is precisely when an operator needs Samsara back.
    const rec = seed({ ...CONNECTED, enabled: false, config: { roster_master: true } });
    holder.client = rec.client;
    const res = await call(false);
    expect(res.status).toBe(200);
    expect(rec.writtenRows("org_integrations")[0]!.config).toEqual({ roster_master: false });
    expect(rec.writtenRows("audit_logs")[0]!.action).toBe("integration.mcleod.roster_master_withdrawn");
  });

  it("rejects a body that is not a boolean decision", async () => {
    holder.client = seed(CONNECTED).client;
    const res = await fetch(`${baseUrl}/api/integrations/mcleod/roster-master`, {
      method: "POST",
      headers: { Authorization: "Bearer admin", "content-type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(res.status).toBe(400);
  });
});
