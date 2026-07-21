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
    org_id: "org-1", name: "Silvicom", created_at: "2026-01-01T00:00:00Z",
    member_count: 2, vehicle_count: 150, active_vehicle_count: 148,
    driver_count: 160, open_anomaly_count: 5, last_txn_at: "2026-07-20T10:00:00Z",
  },
];

const auditInserts: { action: string; target_org_id: string }[] = [];

/** Minimal fake service-role client covering exactly the calls the orgs routes make. */
function fakeClient(): SupabaseClient {
  const make = (single: unknown, list: unknown) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.update = () => b;
    b.maybeSingle = async () => ({ data: single, error: null });
    b.insert = async (row: { action: string; target_org_id: string }) => {
      auditInserts.push(row);
      return { error: null };
    };
    (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null });
    return b;
  };
  return {
    rpc: async () => ({ data: OVERVIEW, error: null }),
    auth: {
      admin: {
        getUserById: async (uid: string) => ({ data: { user: { id: uid, email: `${uid}@silvicominc.com` } }, error: null }),
      },
    },
    from: (table: string) => {
      if (table === "organizations") return make({ allowed_domains: ["silvicominc.com"], operating_hours: {} }, null);
      if (table === "org_integrations") return make({ provider: "mcleod" }, [{ provider: "mcleod", enabled: true, last_synced_at: null }]);
      if (table === "memberships") return make(null, [{ user_id: "owner", role: "admin", created_at: "2026-01-01T00:00:00Z" }]);
      return make(null, []); // platform_audit_log
    },
  } as unknown as SupabaseClient;
}

const aal2: PlatformToken = { userId: "u1", email: "owner@uncdevelopment.com", aal: "aal2", amr: ["totp"], sessionId: "s1" };
const owner: PlatformAdmin = { id: "a1", email: "owner@uncdevelopment.com", userId: "u1", role: "platform_owner", status: "active", mfaEnrolledAt: "x", lastReauthAt: null };
const readonly: PlatformAdmin = { ...owner, id: "a2", role: "platform_readonly" };

async function start(who: PlatformAdmin) {
  const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const app = createApp(env);
  setAppLocals(app, { verifyToken: async () => aal2, lookupPlatformAdmin: async () => who, supabaseAdmin: fakeClient() });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const H = { authorization: "Bearer x", "content-type": "application/json" };

describe("/admin/orgs (read-only oversight)", () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => (ctx = await start(owner)));
  afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));

  it("lists customers with aggregate stats", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs`, { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orgs: { name: string; vehicleCount: number }[] };
    expect(body.orgs[0]!.name).toBe("Silvicom");
    expect(body.orgs[0]!.vehicleCount).toBe(150);
  });

  it("returns detail AND audits the access", async () => {
    const before = auditInserts.length;
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1`, { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { org: { modules: { provider: string }[] } };
    expect(body.org.modules[0]!.provider).toBe("mcleod");
    expect(auditInserts.slice(before).some((w) => w.action === "org.view" && w.target_org_id === "org-1")).toBe(true);
  });

  it("lists members with resolved emails", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1/members`, { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: { email: string; role: string }[] };
    expect(body.members[0]!.email).toBe("owner@silvicominc.com");
    expect(body.members[0]!.role).toBe("admin");
  });

  it("toggles a module (owner) and audits it", async () => {
    const before = auditInserts.length;
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1/modules/mcleod`, {
      method: "POST", headers: H, body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(auditInserts.slice(before).some((w) => w.action === "module.disable")).toBe(true);
  });
});

describe("/admin/orgs module toggle — RBAC", () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => (ctx = await start(readonly)));
  afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));

  it("rejects a read-only admin from toggling a module (403)", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1/modules/mcleod`, {
      method: "POST", headers: H, body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(403);
  });
});
