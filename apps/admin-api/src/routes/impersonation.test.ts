import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { setAppLocals } from "../lib/appLocals.js";
import type { PlatformToken } from "../lib/auth.js";
import type { PlatformAdmin } from "../lib/platformAdmins.js";

interface GrantRow {
  id: string; org_id: string; admin_id: string; scope: string; reason: string;
  created_at: string; expires_at: string; revoked_at: string | null;
}
interface Store {
  grants: GrantRow[];
  platformAudit: { action: string }[];
  tenantAudit: { action: string; org_id: string }[];
  anomalies: { id: string; rule_id: string; severity: string; status: string; message: string; created_at: string }[];
}

type Filter = { c: string; op: "eq" | "is" | "gt"; v: unknown };
function apply(rows: GrantRow[], filters: Filter[]): GrantRow[] {
  return rows.filter((row) =>
    filters.every((f) => {
      const val = (row as unknown as Record<string, unknown>)[f.c];
      if (f.op === "eq" || f.op === "is") return val === f.v;
      if (f.op === "gt") return String(val) > String(f.v);
      return true;
    }),
  );
}

/** Stateful fake exercising the real start → active → view → revoke → denied flow. */
function fakeClient(store: Store): SupabaseClient {
  let idc = 0;
  const grantBuilder = () => {
    const filters: Filter[] = [];
    let insertRow: Record<string, unknown> | null = null;
    let updateVals: Record<string, unknown> | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => (filters.push({ c, op: "eq", v }), b);
    b.is = (c: string, v: unknown) => (filters.push({ c, op: "is", v }), b);
    b.gt = (c: string, v: unknown) => (filters.push({ c, op: "gt", v }), b);
    b.order = () => b;
    b.limit = () => b;
    b.insert = (row: Record<string, unknown>) => ((insertRow = row), b);
    b.update = (vals: Record<string, unknown>) => ((updateVals = vals), b);
    b.single = async () => {
      if (insertRow) {
        const g: GrantRow = { id: `g${++idc}`, created_at: new Date().toISOString(), revoked_at: null, ...(insertRow as object) } as GrantRow;
        store.grants.push(g);
        return { data: g, error: null };
      }
      return { data: apply(store.grants, filters)[0] ?? null, error: null };
    };
    b.maybeSingle = async () => ({ data: apply(store.grants, filters)[0] ?? null, error: null });
    (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      if (updateVals) {
        apply(store.grants, filters).forEach((g) => Object.assign(g, updateVals));
        return resolve({ data: null, error: null });
      }
      return resolve({ data: apply(store.grants, filters), error: null });
    };
    return b;
  };
  const simple = (list: unknown, sink?: unknown[]) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.insert = async (row: unknown) => (sink?.push(row), { error: null });
    (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: list ?? [], error: null });
    return b;
  };
  return {
    from: (table: string) => {
      if (table === "support_impersonation_grants") return grantBuilder();
      if (table === "anomalies") return simple(store.anomalies);
      if (table === "platform_audit_log") return simple([], store.platformAudit);
      if (table === "audit_logs") return simple([], store.tenantAudit);
      return simple([]);
    },
  } as unknown as SupabaseClient;
}

const aal2: PlatformToken = { userId: "u1", email: "owner@uncdevelopment.com", aal: "aal2", amr: ["totp"], sessionId: "s1" };
const owner: PlatformAdmin = { id: "a1", email: "owner@uncdevelopment.com", userId: "u1", role: "platform_owner", status: "active", mfaEnrolledAt: "x", lastReauthAt: null };
const readonly: PlatformAdmin = { ...owner, role: "platform_readonly" };
const H = { authorization: "Bearer x", "content-type": "application/json" };

async function start(who: PlatformAdmin, store: Store) {
  const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const app = createApp(env);
  setAppLocals(app, { verifyToken: async () => aal2, lookupPlatformAdmin: async () => who, supabaseAdmin: fakeClient(store) });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
const newStore = (): Store => ({ grants: [], platformAudit: [], tenantAudit: [], anomalies: [{ id: "an1", rule_id: "r", severity: "high", status: "open", message: "m", created_at: "2026-07-20T00:00:00Z" }] });

describe("impersonation lifecycle (read-only)", () => {
  const store = newStore();
  let ctx: Awaited<ReturnType<typeof start>>;
  let grantId = "";
  beforeAll(async () => (ctx = await start(owner, store)));
  afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));

  it("denies view-as before any grant (403)", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1/view/anomalies`, { headers: H });
    expect(res.status).toBe(403);
  });

  it("starts a reason-required grant and dual-audits it", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1/impersonation`, {
      method: "POST", headers: H, body: JSON.stringify({ reason: "investigating a reefer alert" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { grant: { id: string; scope: string } };
    expect(body.grant.scope).toBe("read_only");
    grantId = body.grant.id;
    expect(store.platformAudit.some((a) => a.action === "impersonation.start")).toBe(true);
    expect(store.tenantAudit.some((a) => a.action === "platform.impersonation.start" && a.org_id === "org-1")).toBe(true);
  });

  it("rejects a start with no/short reason (400)", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1/impersonation`, {
      method: "POST", headers: H, body: JSON.stringify({ reason: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("allows the grant-gated view and audits the access", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1/view/anomalies`, { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { anomalies: { id: string }[] };
    expect(body.anomalies[0]!.id).toBe("an1");
    expect(store.platformAudit.some((a) => a.action === "impersonation.view")).toBe(true);
  });

  it("lists the active grant, revokes it, then denies the view again", async () => {
    const list = await (await fetch(`${ctx.baseUrl}/admin/impersonation`, { headers: H })).json() as { grants: { id: string }[] };
    expect(list.grants.some((g) => g.id === grantId)).toBe(true);

    const rev = await fetch(`${ctx.baseUrl}/admin/impersonation/${grantId}/revoke`, { method: "POST", headers: H });
    expect(rev.status).toBe(200);

    const after = await fetch(`${ctx.baseUrl}/admin/orgs/org-1/view/anomalies`, { headers: H });
    expect(after.status).toBe(403);
  });
});

describe("impersonation RBAC", () => {
  const store = newStore();
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => (ctx = await start(readonly, store)));
  afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));

  it("forbids a read-only platform role from starting a session (403)", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-1/impersonation`, {
      method: "POST", headers: H, body: JSON.stringify({ reason: "should not be allowed" }),
    });
    expect(res.status).toBe(403);
  });
});
