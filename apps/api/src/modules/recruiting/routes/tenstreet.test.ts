import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rolesThatManage, type AuthContext, type TenstreetConnectionStatus, type TenstreetKeyIssued } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv, type Env } from "../../../env.js";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "../../../lib/stepUpToken.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashTenstreetKey, receiveTenstreetPost } from "../tenstreet/receive.js";

/**
 * TS4 (TENSTREET-INTAKE-PLAN): the Settings card's three doors — who may use them, when a fresh sign-in is asked,
 * what the card is told, and that the URL secret leaves the server once and is stored only as the receiver's hash.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CONN = "1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ROLES = ["admin", "recruiter", "fleet_manager", "safety_manager", "dispatcher", "auditor", "driver"];
const SECRET = Buffer.alloc(32, 7).toString("base64");

const makeEnv = (extra: Record<string, string> = {}): Env =>
  loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: SECRET, PUBLIC_API_URL: "https://api.example.test/", ...extra } as NodeJS.ProcessEnv);
let env = makeEnv();

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;
let conn: Array<Record<string, unknown>>;

interface Seed {
  conn?: Record<string, unknown> | null;
  counts?: { ACCEPTED?: number; REJECTED?: number; failed?: number };
  lastRejected?: Record<string, unknown> | null;
  lastFailed?: Record<string, unknown> | null;
  writeError?: { code: string; message: string };
}
function seed(over: Seed = {}): SupabaseRecorder {
  conn = over.conn === null ? [] : [{
    id: CONN, org_id: ORG, company_id: "14", mode: "test", enabled: false, key_hash: null, key_hint: null,
    rotated_at: null, last_post_at: null, ...(over.conn ?? {}),
  }];
  rec = createSupabaseRecorder({
    tables: {
      tenstreet_connections: (q: RecordedQuery) => {
        if (q.write) {
          if (over.writeError) return { writeError: over.writeError };
          if (q.write.method === "update") Object.assign(conn[0]!, q.write.payload as object);
          if (q.write.method === "insert") conn.push({ id: CONN, ...(q.write.payload as object) });
          return { data: null };
        }
        return postgrestFixture(conn)(q);
      },
      // Each count is answered by the filter that asked it, so a swapped filter shows as a wrong number.
      tenstreet_posts: (q: RecordedQuery) => {
        const head = q.ops.some((o) => o.method === "select" && (o.args[1] as { head?: boolean } | undefined)?.head);
        const status = q.filters().find((f) => f.col === "reply_status")?.val as string | undefined;
        const failed = q.ops.some((o) => o.method === "not" && o.args[0] === "process_error");
        if (head) return { data: null, count: failed ? (over.counts?.failed ?? 0) : (over.counts?.[status as "ACCEPTED" | "REJECTED"] ?? 0) };
        if (failed) return over.lastFailed ? [over.lastFailed] : [];
        return over.lastRejected ? [over.lastRejected] : [];
      },
      audit_logs: [],
    },
  });
  holder.client = rec.client;
  return rec;
}

const call = (method: string, path: string, role: string | null, body?: unknown, stepUp = false) =>
  fetch(`${baseUrl}/api/recruitment/tenstreet/connection${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(role ? { Authorization: `Bearer ${role}` } : {}),
      ...(role && stepUp ? { [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, `u-${role}`, ORG)!.token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const status = async (role = "admin") => (await (await call("GET", "", role)).json()) as TenstreetConnectionStatus;
const auditRows = () => rec.writtenRows("audit_logs");

async function start(e: Env) {
  if (server) await closeTestServer(server);
  env = e;
  const app = createApp(env);
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    if (!ROLES.includes(t)) throw new Error("bad token");
    return { userId: `u-${t}`, email: `${t}@x.test`, orgId: ORG, role: t } as AuthContext;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}
beforeAll(() => start(makeEnv()));
afterAll(async () => closeTestServer(server));

describe("who may use the Tenstreet card (recruitment manage)", () => {
  it("the roles that manage recruiting by default may read it; the others are refused before anything is read", async () => {
    // Read from the matrix, never restated: whoever the section lets manage is who this door admits.
    const managers = new Set<string>(rolesThatManage("recruitment"));
    expect(managers.has("recruiter")).toBe(true);
    expect(managers.has("dispatcher")).toBe(false);
    for (const role of ROLES) {
      seed();
      const res = await call("GET", "", role);
      const manages = managers.has(role);
      expect(res.status, role).toBe(manages ? 200 : 403);
      if (!manages) expect(rec.forTable("tenstreet_connections"), role).toHaveLength(0);
    }
  });

  it("the unauthenticated get 401", async () => {
    seed();
    expect((await call("GET", "", null)).status).toBe(401);
  });
});

describe("GET — what the card is told", () => {
  it("before a Company ID is saved: not configured, nothing counted, the log never read", async () => {
    seed({ conn: null });
    const s = await status();
    expect(s).toMatchObject({ configured: false, companyId: null, mode: "test", enabled: false, keyHint: null, endpointMasked: null });
    expect(s.last7Days).toEqual({ accepted: 0, rejected: 0, failed: 0 });
    expect(rec.forTable("tenstreet_posts")).toHaveLength(0);
  });

  it("a keyed connection: the address with the secret masked, the week's counts by kind, every query org-scoped", async () => {
    seed({ conn: { enabled: true, key_hash: "a".repeat(64), key_hint: "wxYz", last_post_at: "2026-11-20T14:00:00Z" }, counts: { ACCEPTED: 5, REJECTED: 2, failed: 1 } });
    const s = await status();
    expect(s).toMatchObject({ configured: true, companyId: "14", enabled: true, keyHint: "wxYz", lastPostAt: "2026-11-20T14:00:00Z", receiverReady: true });
    expect(s.endpointMasked).toBe("https://api.example.test/api/webhooks/tenstreet/••••wxYz");
    expect(s.last7Days).toEqual({ accepted: 5, rejected: 2, failed: 1 });
    // The window is seven days back from now, on every count.
    const sinces = rec.forTable("tenstreet_posts").map((q) => q.filters().find((f) => f.col === "received_at")?.val).filter(Boolean) as string[];
    expect(sinces).toHaveLength(3);
    for (const at of sinces) expect(Math.abs(Date.now() - 7 * 86_400_000 - Date.parse(at))).toBeLessThan(60_000);
    expectOrgScoped(rec, ORG);
  });

  it("the last problem is the newer of the last refusal and the last post that could not become a lead", async () => {
    const rejected = { received_at: "2026-11-19T10:00:00Z", reply_reason: "wrong_mode" };
    const failed = { processed_at: "2026-11-20T09:00:00Z", process_error: "unreadable: no lead in the post" };
    seed({ conn: { key_hash: "a".repeat(64), key_hint: "wxYz" }, lastRejected: rejected, lastFailed: failed });
    expect((await status()).lastProblem).toMatchObject({ at: failed.processed_at, kind: "failed", reason: failed.process_error, text: expect.stringContaining("add them by hand") });
    seed({ conn: { key_hash: "a".repeat(64), key_hint: "wxYz" }, lastRejected: { ...rejected, received_at: "2026-11-20T11:00:00Z" }, lastFailed: failed });
    expect((await status()).lastProblem).toEqual({
      at: "2026-11-20T11:00:00Z", kind: "rejected", reason: "wrong_mode", text: "This listener takes the other Mode (TEST or PROD).",
    });
    seed({ conn: { key_hash: "a".repeat(64), key_hint: "wxYz" } });
    expect((await status()).lastProblem).toBeNull();
  });

  it("a deploy with no PUBLIC_API_URL shows no address, and one that cannot seal says the receiver is not ready", async () => {
    await start(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
    try {
      seed({ conn: { key_hash: "a".repeat(64), key_hint: "wxYz" } });
      const s = await status();
      expect(s.endpointMasked).toBeNull();
      expect(s.receiverReady).toBe(false);
    } finally {
      await start(makeEnv());
    }
  });
});

describe("PUT — Company ID, mode and the switch", () => {
  it("the first save inserts the connection switched off, names its maker, and is audited", async () => {
    seed({ conn: null });
    const res = await call("PUT", "", "recruiter", { companyId: " 14 ", mode: "prod", enabled: false });
    expect(res.status).toBe(200);
    expect(rec.writtenRows("tenstreet_connections")).toEqual([{ org_id: ORG, company_id: "14", mode: "prod", enabled: false, created_by: "u-recruiter" }]);
    expect(auditRows()).toEqual([expect.objectContaining({
      action: "recruitment.tenstreet.connection_saved",
      meta: { created: true, companyIdChanged: false, mode: { was: null, now: "prod" }, enabled: { was: false, now: false } },
    })]);
    expectOrgScoped(rec, ORG);
  });

  it("a Company ID that is not digits is refused, and nothing is read or written", async () => {
    for (const companyId of ["", "14a", "1".repeat(21), "-14"]) {
      seed();
      expect((await call("PUT", "", "admin", { companyId, mode: "test", enabled: false })).status, companyId).toBe(400);
      expect(rec.queries, companyId).toHaveLength(0);
    }
    seed();
    expect((await call("PUT", "", "admin", { companyId: "14", mode: "TEST", enabled: false })).status).toBe(400);
    expect((await call("PUT", "", "admin", { companyId: "14", mode: "test", enabled: false, key_hash: "x" })).status).toBe(400);
  });

  it("switching ON asks for a fresh sign-in first, and nothing is read; switching off never does", async () => {
    seed({ conn: { key_hash: "a".repeat(64), key_hint: "wxYz" } });
    const res = await call("PUT", "", "admin", { companyId: "14", mode: "test", enabled: true });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    expect(rec.queries).toHaveLength(0);

    seed({ conn: { enabled: true, key_hash: "a".repeat(64), key_hint: "wxYz" } });
    expect((await call("PUT", "", "admin", { companyId: "14", mode: "test", enabled: false })).status).toBe(200);
    expect(conn[0]).toMatchObject({ enabled: false });
  });

  it("with a fresh sign-in and a key, it switches on and the audit says what moved", async () => {
    seed({ conn: { key_hash: "a".repeat(64), key_hint: "wxYz" } });
    expect((await call("PUT", "", "admin", { companyId: "15", mode: "prod", enabled: true }, true)).status).toBe(200);
    expect(conn[0]).toMatchObject({ company_id: "15", mode: "prod", enabled: true });
    expect(auditRows()[0]!.meta).toEqual({ created: false, companyIdChanged: true, mode: { was: "test", now: "prod" }, enabled: { was: false, now: true } });
    expectOrgScoped(rec, ORG);
  });

  it("switching on with no key is refused by name, not by the table's constraint", async () => {
    seed();
    const res = await call("PUT", "", "admin", { companyId: "14", mode: "test", enabled: true }, true);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("tenstreet_key_required");
    expect(rec.writes()).toHaveLength(0);
  });

  it("a Company ID another account holds is a 409 in the office's words, and nothing is audited", async () => {
    seed({ writeError: { code: "23505", message: "duplicate key value violates unique constraint" } });
    const res = await call("PUT", "", "admin", { companyId: "99", mode: "test", enabled: false });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("tenstreet_company_taken");
    expect(auditRows()).toEqual([]);
  });
});

describe("POST rotate-key — the secret, once", () => {
  it("always asks for a fresh sign-in, and nothing is read before it", async () => {
    seed();
    const res = await call("POST", "/rotate-key", "admin");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    expect(rec.queries).toHaveLength(0);
  });

  it("is refused until a Company ID is saved", async () => {
    seed({ conn: null });
    const res = await call("POST", "/rotate-key", "admin", undefined, true);
    expect(res.status).toBe(409);
    expect(rec.writes()).toHaveLength(0);
  });

  it("issues 32 random bytes as base64url, stores only the receiver's hash and the last four, and never logs the key", async () => {
    seed({ conn: { key_hash: "b".repeat(64), key_hint: "oldK" } });
    const res = await call("POST", "/rotate-key", "recruiter", undefined, true);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const issued = (await res.json()) as TenstreetKeyIssued;
    expect(issued.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(issued.key, "base64url")).toHaveLength(32);
    expect(issued.keyHint).toBe(issued.key.slice(-4));
    expect(issued.endpoint).toBe(`https://api.example.test/api/webhooks/tenstreet/${issued.key}`);
    const stored = rec.writtenRows("tenstreet_connections")[0]!;
    expect(stored.key_hash).toBe(createHash("sha256").update(issued.key, "utf8").digest("hex"));
    expect(stored).toMatchObject({ key_hint: issued.keyHint, rotated_at: issued.rotatedAt });
    expect(auditRows()[0]).toMatchObject({ action: "recruitment.tenstreet.key_rotated", meta: { keyHint: issued.keyHint, replaced: true } });
    // The key is in no write but its own answer: not the row (hash only), not the audit.
    expect(JSON.stringify(rec.writes().map((w) => w.write))).not.toContain(issued.key);
    expectOrgScoped(rec, ORG);
  });

  it("two rotations never issue the same key", async () => {
    seed();
    const a = (await (await call("POST", "/rotate-key", "admin", undefined, true)).json()) as TenstreetKeyIssued;
    const b = (await (await call("POST", "/rotate-key", "admin", undefined, true)).json()) as TenstreetKeyIssued;
    expect(a.key).not.toBe(b.key);
  });

  it("the issued key is one the receiver accepts, and the key it replaced is one the receiver refuses", async () => {
    const OLD = "o".repeat(43);
    seed({ conn: { enabled: true, key_hash: hashTenstreetKey(OLD), key_hint: "oooo" } });
    const issued = (await (await call("POST", "/rotate-key", "admin", undefined, true)).json()) as TenstreetKeyIssued;
    const receive = (key: string) => receiveTenstreetPost({ env, admin: rec.client as never, enqueue: async () => "queued" }, key, "<not-xml");
    // A refused body is answered past the key check (200 REJECTED); an unknown key never gets that far (401).
    expect((await receive(issued.key)).status).toBe(200);
    expect((await receive(OLD)).status).toBe(401);
  });
});
