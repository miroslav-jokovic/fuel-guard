import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv, type Env } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { parseCardDocument } from "../lib/efsCardXml.js";

/**
 * `POST /api/fuel-cards/restore/:mutationId` — the route's own guards. What may be restored is the
 * harness's decision and is tested in `harness/restore.test.ts`. What is tested here is everything
 * that must stop a request before the harness is reached: the proof flag, the typed confirmation, a
 * card number that is not the card the row wrote to, and a row from another company.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const OTHER_CARD_ID = "9b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const MUTATION = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ENDPOINT = "https://ws.partner.efsllc.com/axis2/services/CardManagementWS/";
/** Obviously fake: `lint:secrets` scans tracked content and a realistic PAN would trip it. */
const PAN = "70830000000000000";

const envWith = (probe: "true" | "false"): Env => loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: KEY,
  EFS_CARD_CONTROL_ENABLED: "true",
  EFS_CARD_CONTROL_PROBE_ENABLED: probe,
  EFS_SOAP_INTERACTIVE_RPS: "100",
  EFS_SOAP_MAX_RPS: "100",
} as NodeJS.ProcessEnv);
const env = envWith("true");

const ADMIN: AuthContext = { userId: "11111111-1111-4111-8111-111111111111", email: "a@x.test", orgId: ORG, role: "admin" };

const soap = (body: string): string =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const ACTIVE = readFileSync(fileURLToPath(new URL("../lib/__fixtures__/efs/getCardV2.full.xml", import.meta.url)), "utf8");
const HELD = ACTIVE.replace("<status>Active</status>", "<status>HOLD</status>");

const CREDENTIALS = {
  org_id: ORG, environment: "sandbox", endpoint_url: ENDPOINT,
  soap_username: "user", soap_password: "pass", soap_password_sealed: null, account_id: null,
  posted_last_cursor: null, rejected_last_cursor: null,
  posted_last_polled_at: null, rejected_last_polled_at: null,
  posted_last_success_at: null, rejected_last_success_at: null,
  posted_last_error: null, rejected_last_error: null,
  enabled: true,
};

/** A card_lock proof's apply row: Active before, Held after. */
const LEDGER_ROW = {
  id: MUTATION, efs_card_id: CARD_ID, capability_key: "card_lock", proof_run_id: "proof-1",
  before_version: parseCardDocument(ACTIVE).version,
  after_version: parseCardDocument(HELD).version,
  before_document: parseCardDocument(ACTIVE).card,
};

/** Every vendor operation, in order. The card reads back Active: the card is already restored. */
function stubVendor(): { ops: string[] } {
  const realFetch = globalThis.fetch;
  const ops: string[] = [];
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("127.0.0.1") || url.includes("localhost")) return realFetch(input as Parameters<typeof fetch>[0], init);
    const op = /<CardManagementEP_([A-Za-z0-9]+)>/.exec(String(init?.body ?? ""))?.[1] ?? "unknown";
    ops.push(op);
    if (op === "login") return new Response(soap("<loginResponse><result>sess-1</result></loginResponse>"), { status: 200 });
    return new Response(ACTIVE, { status: 200 });
  }) as typeof fetch);
  return { ops };
}

let db: ReturnType<typeof createSupabaseRecorder>;
function recorder(opts: { cardId?: string; row?: unknown } = {}) {
  db = createSupabaseRecorder({
    tables: {
      efs_soap_credentials: [CREDENTIALS],
      efs_cards: { data: { id: opts.cardId ?? CARD_ID }, error: null },
      efs_card_mutations: { data: opts.row === undefined ? LEDGER_ROW : opts.row, error: null },
      efs_capability_proofs: { data: { capability_key: "card_lock" }, error: null },
      audit_logs: { data: [], error: null },
    },
  });
  holder.client = db.client;
}

async function listen(e: Env): Promise<{ server: Server; baseUrl: string; stepUp: string }> {
  const app = createApp(e);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return ADMIN;
  };
  const { mintStepUpToken } = await import("../../../lib/stepUpToken.js");
  const stepUp = mintStepUpToken(e, ADMIN.userId, ORG)!.token;
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, stepUp };
}

let live: Awaited<ReturnType<typeof listen>>;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  live = await listen(env);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestServer(live.server);
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetEfsSessions();
});

async function post(target: typeof live, body: unknown, mutationId = MUTATION) {
  const res = await fetch(`${target.baseUrl}/api/fuel-cards/restore/${mutationId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer token", "x-step-up-token": target.stepUp },
    body: JSON.stringify(body),
  });
  return { status: res.status, payload: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/fuel-cards/restore/:mutationId", () => {
  it("reaches the harness when every guard passes, and reads only this company's rows", async () => {
    recorder();
    const vendor = stubVendor();
    const { status, payload } = await post(live, { cardNumber: PAN, confirm: `RESTORE ${PAN.slice(-4)}` });

    expect(status).toBe(200);
    expect(payload.outcome).toBe("already_restored");
    expect(vendor.ops).toEqual(["login", "getCardv2"]);
    expectOrgScoped(db, ORG);
  });

  it("is switched off with the proof flag", async () => {
    const off = await listen(envWith("false"));
    try {
      recorder();
      const vendor = stubVendor();
      const { status, payload } = await post(off, { cardNumber: PAN, confirm: `RESTORE ${PAN.slice(-4)}` });
      expect(status).toBe(403);
      expect(payload.code ?? (payload.error as { code?: string })?.code).toBe("probe_disabled");
      expect(vendor.ops).toEqual([]);
    } finally {
      await closeTestServer(off.server);
    }
  });

  it("demands the operator type RESTORE and the card's last four", async () => {
    recorder();
    const vendor = stubVendor();
    const { status } = await post(live, { cardNumber: PAN, confirm: "RESTORE 9999" });

    expect(status).toBe(400);
    expect(vendor.ops).toEqual([]);
    expect(db.queries).toEqual([]);
  });

  it("refuses a card number that is not the card the change was written to", async () => {
    recorder({ cardId: OTHER_CARD_ID });
    const vendor = stubVendor();
    const { status, payload } = await post(live, { cardNumber: PAN, confirm: `RESTORE ${PAN.slice(-4)}` });

    expect(status).toBe(400);
    expect(JSON.stringify(payload)).toMatch(/card_mismatch/);
    expect(vendor.ops).toEqual([]);
  });

  it("answers 404 for a change that is not in this company", async () => {
    recorder({ row: null });
    const vendor = stubVendor();
    const { status } = await post(live, { cardNumber: PAN, confirm: `RESTORE ${PAN.slice(-4)}` });

    expect(status).toBe(404);
    expect(vendor.ops).toEqual([]);
  });
});
