import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_CONNECTION_VIEW_COLUMNS } from "@silvicom/shared";
import { loadEnv } from "../../../env.js";
import { open, secretAad } from "../../../lib/secretBox.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { metaPageTokenPurpose, metaTokenPurpose, stopSimulatorForTests } from "../platforms/registry.js";
import { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { connectMeta, connectSimulator, disconnect, listConnections, testConnection } from "./connections.js";

/**
 * The connection doors' service (B1b) over FakeMeta and a stateful connections table. What must hold:
 * a token Meta refuses is stored nowhere; a token that is stored is sealed to its org AND account kind;
 * no answer, ledger row, audit row or log line carries a token; disconnecting is refused while an ad
 * may be delivering; the simulator exists only where the gate allows it.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN = { id: "11111111-1111-4111-8111-111111111111", name: "Owner" };
const TOKEN = "EAAB-system-user-token-service-0001";
const PAGE_TOKEN = "EAAB-page-token-service-0001";
const PAGE = { id: "200100", name: "Silvicom Trucking", access_token: PAGE_TOKEN, tasks: ["ADVERTISE"] };
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") } as NodeJS.ProcessEnv);
const NOW = new Date("2026-11-02T18:00:00Z");

let meta: FakeMeta;
let base: string;
let rows: FixtureRow[];
let campaigns: FixtureRow[];
let actions: FixtureRow[];
let audits: FixtureRow[];
let raceOnInsert: boolean;
let logs: string[];

function world() {
  let seq = 0;
  return createSupabaseRecorder({
    tables: {
      ads_platform_connections: (q) => {
        if (q.write?.method === "insert") {
          const row: FixtureRow = { id: `00000000-0000-4000-8000-00000000c${String(++seq).padStart(3, "0")}`, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), token_expires_on: null, last_test_at: null, last_test: null, last_error: null, scopes: [], account_ref: null, page_ref: null, ...(q.write.payload as FixtureRow) };
          if (raceOnInsert || rows.some((r) => r.org_id === row.org_id && r.provider === row.provider && r.is_sandbox === row.is_sandbox)) {
            if (raceOnInsert) { raceOnInsert = false; rows.push({ ...row, id: "00000000-0000-4000-8000-00000000c999" }); }
            const dup = { code: "23505", message: "duplicate key" };
            return { data: null, error: dup, writeError: dup };
          }
          rows.push(row);
          return projected([row], q);
        }
        if (q.write?.method === "update") {
          const hit = postgrestFixture(rows)({ ...q, ops: q.ops.filter((o) => o.method !== "select" && o.method !== "single") });
          for (const h of hit) Object.assign(rows.find((r) => r.id === h.id)!, q.write.payload as object);
          return projected(hit.map((h) => rows.find((r) => r.id === h.id)!), q);
        }
        return postgrestFixture(rows)(q);
      },
      ads_campaigns: (q) => postgrestFixture(campaigns)(q),
      ads_actions: (q) => {
        if (q.write?.method === "insert") actions.push(q.write.payload as FixtureRow);
        return [{ id: `act-${actions.length}` }];
      },
      audit_logs: (q) => {
        if (q.write?.method === "insert") audits.push(q.write.payload as FixtureRow);
        return [{ id: "aud" }];
      },
    },
  });
}

/** What the database hands back after a write: the written rows through the query's own `select(...)`. */
const projected = (written: FixtureRow[], q: Parameters<ReturnType<typeof postgrestFixture>>[0]): FixtureRow[] =>
  postgrestFixture(written)({ ...q, ops: q.ops.filter((o) => o.method === "select") });

let db: ReturnType<typeof world>;
const deps = (patch: Record<string, unknown> = {}) => ({ admin: db.client, env, now: () => NOW, metaBaseUrl: base, ...patch });
const ask = (patch: Record<string, unknown> = {}) => ({ token: TOKEN, account_id: "act_1001", page_id: PAGE.id, sandbox: false, ...patch });

beforeEach(async () => {
  resetGraphThrottles();
  meta = new FakeMeta({ token: TOKEN, accounts: [{ id: "1001", spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" }], pages: [PAGE] });
  base = await meta.start();
  rows = [];
  campaigns = [];
  actions = [];
  audits = [];
  raceOnInsert = false;
  logs = [];
  for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  db = world();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await meta.stop();
});
afterAll(() => stopSimulatorForTests());

/** Nothing anyone can read — an answer, a ledger row, an audit row, a log line — holds a token. */
function expectNoTokenAnywhere(answer: unknown) {
  const seen = JSON.stringify({ answer, actions, audits, logs });
  for (const t of [TOKEN, PAGE_TOKEN]) expect(seen).not.toContain(t);
}

describe("connectMeta — a token Meta accepts", () => {
  it("is sealed to the org and the account kind, with the Page token beside it; the row is connected with the report", async () => {
    const out = await connectMeta(deps(), ORG, ADMIN, ask());
    expect(out).toMatchObject({ kind: "saved", connection: { provider: "meta", is_sandbox: false, status: "connected", account_ref: "1001", page_ref: PAGE.id }, report: { ok: true } });
    const row = rows[0]!;
    expect(open(env, String(row.token_sealed), secretAad(ORG, metaTokenPurpose(false)))).toBe(TOKEN);
    expect(open(env, String(row.page_token_sealed), secretAad(ORG, metaPageTokenPurpose(false)))).toBe(PAGE_TOKEN);
    // The account kind is in the seal: the live token does not open as a sandbox one.
    expect(() => open(env, String(row.token_sealed), secretAad(ORG, metaTokenPurpose(true)))).toThrow();
    expect(actions).toEqual([expect.objectContaining({ kind: "connection_test", status: "succeeded", connection_id: row.id, actor_kind: "person", actor_id: ADMIN.id })]);
    expect(audits).toEqual([expect.objectContaining({ action: "ads.connection.connect", actor_id: ADMIN.id, entity_id: row.id })]);
    expectNoTokenAnywhere(out);
    expectOrgScoped(db, ORG);
  });

  it("answers with the view's columns only — a sealed token cannot ride out even as ciphertext", async () => {
    const out = await connectMeta(deps(), ORG, ADMIN, ask());
    expect(out.kind === "saved" && Object.keys(out.connection)).not.toContain("token_sealed");
    for (const q of db.forTable("ads_platform_connections")) {
      const select = q.ops.find((o) => o.method === "select")?.args[0];
      if (typeof select === "string" && select !== "id") expect([ADS_CONNECTION_VIEW_COLUMNS, "id, org_id, provider, is_sandbox, token_sealed, account_ref, page_ref, status"]).toContain(select);
    }
    expect((await listConnections(db.client, ORG)).every((c) => !("token_sealed" in c) && !("page_token_sealed" in c))).toBe(true);
    expect(ADS_CONNECTION_VIEW_COLUMNS).not.toMatch(/token_sealed/);
  });

  it("a token missing a scope is still saved — failing, with what to fix — so the owner need not paste it again", async () => {
    meta.permissions.leads_retrieval = "declined";
    const out = await connectMeta(deps(), ORG, ADMIN, ask());
    expect(out).toMatchObject({ kind: "saved", connection: { status: "failing", last_error: expect.stringContaining("leads_retrieval") } });
    expect(actions[0]).toMatchObject({ status: "failed", error_code: "permissions_missing" });
  });

  it("connecting again updates the one row for that account kind; a sandbox connection is a row of its own", async () => {
    await connectMeta(deps(), ORG, ADMIN, ask());
    await connectMeta(deps(), ORG, ADMIN, ask());
    expect(rows).toHaveLength(1);
    await connectMeta(deps(), ORG, ADMIN, ask({ sandbox: true }));
    expect(rows.map((r) => r.is_sandbox)).toEqual([false, true]);
  });

  it("two admins connecting at once: the insert that loses the slot becomes an update, not an error", async () => {
    raceOnInsert = true;
    const out = await connectMeta(deps(), ORG, ADMIN, ask());
    expect(out.kind).toBe("saved");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_sealed).toBeTruthy();
  });
});

describe("connectMeta — a token Meta refuses", () => {
  it("is stored nowhere: no row, no ledger row, no audit — and the answer says why", async () => {
    meta.revokeToken();
    const out = await connectMeta(deps(), ORG, ADMIN, ask());
    expect(out).toMatchObject({ kind: "token_refused", report: { ok: false, error_code: "token_invalid" } });
    expect(rows).toEqual([]);
    expect(db.forTable("ads_platform_connections").some((q) => q.write)).toBe(false);
    expect(actions).toEqual([]);
    expectNoTokenAnywhere(out);
  });

  it("with no sealing key configured, nothing is written in plaintext — the connect fails before any write", async () => {
    const bare = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    await expect(connectMeta(deps({ env: bare }), ORG, ADMIN, ask())).rejects.toThrow();
    expect(db.forTable("ads_platform_connections").some((q) => q.write)).toBe(false);
  });
});

describe("testConnection and disconnect", () => {
  it("testing again uses the stored token, records one ledger row, and marks a revoked token failing", async () => {
    await connectMeta(deps(), ORG, ADMIN, ask());
    const id = String(rows[0]!.id);
    meta.revokeToken();
    const out = await testConnection(deps(), ORG, ADMIN, id);
    expect(out).toMatchObject({ kind: "saved", connection: { status: "failing" }, report: { error_code: "token_invalid" } });
    expect(actions.map((a) => a.status)).toEqual(["succeeded", "failed"]);
    expectNoTokenAnywhere(out);
  });

  it("disconnect is refused while a campaign on the connection may be delivering — pausing it needs the token", async () => {
    await connectMeta(deps(), ORG, ADMIN, ask());
    const id = String(rows[0]!.id);
    for (const state of ["launching", "live", "pausing"]) {
      campaigns = [{ id: "camp-1", org_id: ORG, connection_id: id, state }];
      expect(await disconnect(deps(), ORG, ADMIN, id)).toMatchObject({ kind: "refused", error_code: "campaigns_delivering" });
    }
    expect(rows[0]!.token_sealed).toBeTruthy();
  });

  it("disconnect clears both tokens and the scopes, and is audited; a disconnected connection cannot be tested", async () => {
    await connectMeta(deps(), ORG, ADMIN, ask());
    const id = String(rows[0]!.id);
    campaigns = [{ id: "camp-1", org_id: ORG, connection_id: id, state: "paused" }];
    expect(await disconnect(deps(), ORG, ADMIN, id)).toMatchObject({ kind: "disconnected", connection: { status: "disconnected" } });
    expect(rows[0]).toMatchObject({ token_sealed: null, page_token_sealed: null, scopes: [] });
    expect(audits.map((a) => a.action)).toEqual(["ads.connection.connect", "ads.connection.disconnect"]);
    expect(await testConnection(deps(), ORG, ADMIN, id)).toMatchObject({ kind: "refused", error_code: "disconnected" });
    expectOrgScoped(db, ORG);
  });
});

describe("connectSimulator — only where the gate allows", () => {
  it("on a non-production host it connects to the in-process FakeMeta and passes the same connection test", async () => {
    const out = await connectSimulator(deps({ processEnv: { DEPLOY_ENVIRONMENT: "staging", NODE_ENV: "production" } }), ORG, ADMIN);
    expect(out).toMatchObject({ kind: "saved", connection: { provider: "simulator", is_sandbox: true, status: "connected" }, report: { ok: true } });
    expect(rows[0]).toMatchObject({ token_sealed: null });
  });

  it("in production, under an unknown name, or on a nameless built server it is refused with the reason, writing nothing", async () => {
    for (const processEnv of [{ RAILWAY_ENVIRONMENT_NAME: "production", NODE_ENV: "production" }, { DEPLOY_ENVIRONMENT: "Staging", NODE_ENV: "production" }, { NODE_ENV: "production" }]) {
      const out = await connectSimulator(deps({ processEnv }), ORG, ADMIN);
      expect(out).toMatchObject({ kind: "refused", error_code: "simulator_not_allowed" });
    }
    expect(rows).toEqual([]);
    expect(actions).toEqual([]);
  });
});
