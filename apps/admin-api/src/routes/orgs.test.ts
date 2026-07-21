import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { setAppLocals } from "../lib/appLocals.js";
import type { PlatformToken } from "../lib/auth.js";
import type { PlatformAdmin } from "../lib/platformAdmins.js";

const OVERVIEW = [
  {
    org_id: "org-1",
    name: "Silvicom",
    created_at: "2026-01-01T00:00:00Z",
    member_count: 3,
    vehicle_count: 150,
    active_vehicle_count: 148,
    driver_count: 160,
    open_anomaly_count: 5,
    last_txn_at: "2026-07-20T10:00:00Z",
  },
];

const auditInserts: unknown[] = [];

/** Minimal fake service-role client covering exactly the calls orgs.ts makes. */
function fakeClient(): SupabaseClient {
  const builder = (single: unknown, list: unknown) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = async () => ({ data: single, error: null });
    b.insert = async (row: unknown) => {
      auditInserts.push(row);
      return { error: null };
    };
    (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null });
    return b;
  };
  return {
    rpc: async (_fn: string, _args: unknown) => ({ data: OVERVIEW, error: null }),
    from: (table: string) => {
      if (table === "organizations") return builder({ allowed_domains: ["silvicominc.com"], operating_hours: {} }, null);
      if (table === "org_integrations") return builder(null, [{ provider: "mcleod", enabled: true, last_synced_at: null }]);
      return builder(null, []); // platform_audit_log insert
    },
  } as unknown as SupabaseClient;
}

const aal2: PlatformToken = { userId: "u1", email: "owner@uncdevelopment.com", aal: "aal2", amr: ["totp"], sessionId: "s1" };
const admin: PlatformAdmin = {
  id: "a1", email: "owner@uncdevelopment.com", userId: "u1", role: "platform_owner",
  status: "active", mfaEnrolledAt: "2026-01-01T00:00:00Z", lastReauthAt: null,
};

async function start() {
  const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const app = createApp(env);
  setAppLocals(app, {
    verifyToken: async () => aal2,
    lookupPlatformAdmin: async () => admin,
    supabaseAdmin: fakeClient(),
  });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

describe("/admin/orgs (read-only oversight)", () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => (ctx = await start()));
  afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));

  it("lists customers with aggregate stats", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs`, { headers: { authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orgs: { name: string; vehicleCount: number; openAnomalyCount: number }[] };
    expect(body.orgs).toHaveLength(1);
    expect(body.orgs[0]!.name).toBe("Silvicom");
    expect(body.orgs[0]!.vehicleCount).toBe(150);
    expect(body.orgs[0]!.openAnomalyCount).toBe(5);
  });

  it("returns one customer's detail AND writes an audit row for the access", async () => {
    const before = auditInserts.length;
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1`, { headers: { authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { org: { name: string; modules: { provider: string }[]; allowedDomains: string[] } };
    expect(body.org.name).toBe("Silvicom");
    expect(body.org.modules[0]!.provider).toBe("mcleod");
    expect(body.org.allowedDomains).toContain("silvicominc.com");
    // the view was audited
    const written = auditInserts.slice(before) as { action: string; target_org_id: string }[];
    expect(written.some((w) => w.action === "org.view" && w.target_org_id === "org-1")).toBe(true);
  });
});
