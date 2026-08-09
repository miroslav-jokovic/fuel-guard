import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { setAppLocals } from "../lib/appLocals.js";
import type { PlatformToken } from "../lib/auth.js";
import type { PlatformAdmin } from "../lib/platformAdmins.js";
import { STEP_UP_WINDOW_MS } from "../middleware/platformAuth.js";

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
    // The entitlement route upserts (first grant creates the row) and the impersonation route inserts
    // a grant. Both are stubbed so the step-up assertions below can distinguish "the gate let me
    // through" from "the handler blew up", instead of both showing as a non-403.
    b.upsert = async () => ({ error: null });
    b.maybeSingle = async () => ({ data: single, error: null });
    b.insert = async (row: { action: string; target_org_id: string }) => {
      auditInserts.push(row);
      return { error: null };
    };
    (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null });
    return b;
  };
  const grantClient = () => {
    const b: Record<string, unknown> = {};
    b.insert = () => b;
    b.select = () => b;
    b.single = async () => ({
      data: {
        id: "grant-1", org_id: "org-1", admin_id: "a1", scope: "read_only", reason: "support review",
        created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null,
      },
      error: null,
    });
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
      if (table === "support_impersonation_grants") return grantClient();
      return make(null, []); // platform_audit_log
    },
  } as unknown as SupabaseClient;
}

// The step-up gate (middleware/platformAuth.ts) measures how long ago the caller proved a SECOND
// factor, straight from the token's `amr` timestamps. So these fixtures are built relative to now
// rather than pinned to a literal instant — a hard-coded 2026 timestamp would silently rot into
// "stale" and turn every gated assertion below into a 403 that looks like a real regression.
const secondsAgo = (n: number) => Math.floor((Date.now() - n * 1000) / 1000);
const freshMfa = (): PlatformToken => ({
  userId: "u1", email: "owner@uncdevelopment.com", aal: "aal2",
  amr: [{ method: "password", timestamp: secondsAgo(120) }, { method: "totp", timestamp: secondsAgo(30) }],
  sessionId: "s1",
});
const staleMfa = (): PlatformToken => ({
  ...freshMfa(),
  amr: [{ method: "totp", timestamp: secondsAgo(STEP_UP_WINDOW_MS / 1000 + 60) }],
});
const passwordOnly = (): PlatformToken => ({ ...freshMfa(), amr: [{ method: "password", timestamp: secondsAgo(10) }] });
const noAmr = (): PlatformToken => ({ ...freshMfa(), amr: null });

const owner: PlatformAdmin = { id: "a1", email: "owner@uncdevelopment.com", userId: "u1", role: "platform_owner", status: "active", mfaEnrolledAt: "x", lastReauthAt: null };
const readonly: PlatformAdmin = { ...owner, id: "a2", role: "platform_readonly" };

async function start(who: PlatformAdmin, token: () => PlatformToken = freshMfa) {
  const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const app = createApp(env);
  setAppLocals(app, { verifyToken: async () => token(), lookupPlatformAdmin: async () => who, supabaseAdmin: fakeClient() });
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

describe("/admin/orgs — step-up (recent second factor) on sensitive writes", () => {
  // Regression test for audit 2026-08-09 finding 3.8. requireStepUp existed, was exported, and was
  // applied to NOTHING, while reading a column (platform_admins.last_reauth_at) that nothing wrote.
  // These assertions pin both halves: that the gate is actually mounted on the sensitive routes, and
  // that it derives freshness from the token's amr rather than from a column.
  //
  // Every case below uses the platform_owner, so a 403 here can only come from step-up, never RBAC.
  const gated: [string, string, unknown][] = [
    ["module kill-switch", "/admin/orgs/org-1/modules/mcleod", { enabled: false }],
    ["entitlement grant", "/admin/orgs/org-1/entitlements/hazmatguard", { enabled: true }],
    ["impersonation start", "/admin/orgs/org-1/impersonation", { reason: "customer raised a ticket" }],
  ];

  for (const [label, path, body] of gated) {
    it(`${label}: allowed with a second factor proved just now`, async () => {
      const c = await start(owner, freshMfa);
      const res = await fetch(`${c.baseUrl}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
      expect(res.status).toBeLessThan(400); // the gate let it through AND the handler ran
      await new Promise<void>((r) => c.server.close(() => r()));
    });

    it(`${label}: DENIED when the second factor is older than the window`, async () => {
      const c = await start(owner, staleMfa);
      const res = await fetch(`${c.baseUrl}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
      await new Promise<void>((r) => c.server.close(() => r()));
    });
  }

  it("DENIED when the session only ever proved a password — aal2 alone is not a second factor", async () => {
    const c = await start(owner, passwordOnly);
    const res = await fetch(`${c.baseUrl}/admin/orgs/org-1/impersonation`, {
      method: "POST", headers: H, body: JSON.stringify({ reason: "customer raised a ticket" }),
    });
    expect(res.status).toBe(403);
    await new Promise<void>((r) => c.server.close(() => r()));
  });

  it("DENIED when the token carries no amr at all — fails closed, never open", async () => {
    const c = await start(owner, noAmr);
    const res = await fetch(`${c.baseUrl}/admin/orgs/org-1/impersonation`, {
      method: "POST", headers: H, body: JSON.stringify({ reason: "customer raised a ticket" }),
    });
    expect(res.status).toBe(403);
    await new Promise<void>((r) => c.server.close(() => r()));
  });

  it("does NOT gate reads — a stale second factor can still view the customer list", async () => {
    const c = await start(owner, staleMfa);
    const res = await fetch(`${c.baseUrl}/admin/orgs`, { headers: H });
    expect(res.status).toBe(200);
    await new Promise<void>((r) => c.server.close(() => r()));
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
